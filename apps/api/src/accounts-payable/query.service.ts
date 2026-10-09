import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AccountsPayableSummaryResponse,
  PageResponse,
  SupplierBillListItem,
  SupplierBillResponse,
  SupplierPaymentResponse,
} from '@saas/types';
import { Prisma, type SupplierBill, type SupplierPayment } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { inventoryConflict, type InventoryTx } from '../inventory/inventory-locks.js';
import { decodeCursor, encodeCursor } from '../sales/pagination.js';
import { decimal } from '../sales/totals.js';
import type { SupplierBillQueryDto, SupplierPaymentQueryDto } from './accounts-payable.dto.js';

type BillRow = SupplierBill & {
  supplier: { id: string; name: string; isActive: boolean };
  purchaseOrder: {
    id: string;
    sequenceNumber: number;
    status: string;
    total: Prisma.Decimal;
  } | null;
};
type BillListRaw = { id: string; paid: Prisma.Decimal };
type SummaryRaw = {
  currencyCode: string;
  outstanding: Prisma.Decimal;
  overdue: Prisma.Decimal;
  unpaid: number;
  partial: number;
  overdueCount: number;
};
const billInclude = {
  supplier: { select: { id: true, name: true, isActive: true } },
  purchaseOrder: { select: { id: true, sequenceNumber: true, status: true, total: true } },
} as const;
export const paymentResponse = (row: SupplierPayment): SupplierPaymentResponse => ({
  id: row.id,
  supplierBillId: row.supplierBillId,
  amount: row.amount.toFixed(4),
  method: row.method,
  reference: row.reference,
  note: row.note,
  paymentDate: row.paymentDate.toISOString().slice(0, 10),
  createdBy: { id: row.createdByUserId },
  createdAt: row.createdAt.toISOString(),
});
function serialize(row: BillRow, paid: Prisma.Decimal, today: string): SupplierBillListItem {
  const outstanding = decimal(row.amount).minus(paid);
  return {
    id: row.id,
    sequenceNumber: row.sequenceNumber,
    number: `BILL-${String(row.sequenceNumber).padStart(6, '0')}`,
    status: row.status,
    supplier: row.supplier,
    purchaseOrder: row.purchaseOrder
      ? {
          id: row.purchaseOrder.id,
          number: `PO-${String(row.purchaseOrder.sequenceNumber).padStart(6, '0')}`,
          status: row.purchaseOrder.status,
          total: row.purchaseOrder.total.toFixed(4),
        }
      : null,
    supplierInvoiceNumber: row.supplierInvoiceNumber,
    issueDate: row.issueDate.toISOString().slice(0, 10),
    dueDate: row.dueDate?.toISOString().slice(0, 10) ?? null,
    currencyCode: row.currencyCode,
    amount: row.amount.toFixed(4),
    paidAmount: paid.toFixed(4),
    outstandingAmount: outstanding.toFixed(4),
    paymentStatus: paid.eq(0) ? 'UNPAID' : outstanding.eq(0) ? 'PAID' : 'PARTIALLY_PAID',
    isOverdue:
      row.status === 'POSTED' &&
      outstanding.gt(0) &&
      !!row.dueDate &&
      row.dueDate.toISOString().slice(0, 10) < today,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
  };
}
function billSearch(q: string | undefined) {
  if (!q) return Prisma.empty;
  const number = q.replace(/^BILL-/i, '').replace(/^0+(?=\d)/, '');
  const sequence =
    /^\d+$/.test(number) && Number.isSafeInteger(Number(number)) ? Number(number) : null;
  const pattern = `%${q}%`;
  return Prisma.sql`AND (
    b."supplierInvoiceNumber" ILIKE ${pattern} OR s.name ILIKE ${pattern}
    OR b.description ILIKE ${pattern} OR b.note ILIKE ${pattern}
    ${sequence === null ? Prisma.empty : Prisma.sql`OR b."sequenceNumber" = ${sequence}`}
  )`;
}
function paymentFilter(q: SupplierBillQueryDto) {
  if (q.paymentStatus === 'UNPAID') return Prisma.sql`AND base.paid = 0`;
  if (q.paymentStatus === 'PARTIALLY_PAID')
    return Prisma.sql`AND base.paid > 0 AND base.paid < base.amount`;
  if (q.paymentStatus === 'PAID') return Prisma.sql`AND base.paid = base.amount`;
  return Prisma.empty;
}

@Injectable()
export class AccountsPayableQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async context(tx: InventoryTx, org: string) {
    const organization = await tx.organization.findUniqueOrThrow({
      where: { id: org },
      select: { defaultCurrency: true, timezone: true },
    });
    const rows = await tx.$queryRaw<{ today: string }[]>(Prisma.sql`
      SELECT to_char((now() AT TIME ZONE ${organization.timezone})::date, 'YYYY-MM-DD') AS today
    `);
    return { ...organization, today: rows[0]!.today };
  }

  async list(org: string, q: SupplierBillQueryDto): Promise<PageResponse<SupplierBillListItem>> {
    if (
      (q.issueDateFrom && q.issueDateTo && q.issueDateFrom > q.issueDateTo) ||
      (q.dueDateFrom && q.dueDateTo && q.dueDateFrom > q.dueDateTo)
    )
      throw new BadRequestException('Invalid date range');
    const cursor = decodeCursor(q.cursor);
    const schema = this.prisma.sqlSchema;
    return this.prisma.$transaction(
      async (tx) => {
        const { today } = await this.context(tx, org);
        const ids = await tx.$queryRaw<BillListRaw[]>(Prisma.sql`
        WITH base AS (
          SELECT b.id, b."createdAt", b.amount, b.status, b."dueDate",
            COALESCE(p.paid, 0) AS paid
          FROM ${schema}."SupplierBill" b
          JOIN ${schema}."Supplier" s ON s.id = b."supplierId" AND s."organizationId" = b."organizationId"
          LEFT JOIN (
            SELECT "supplierBillId", SUM(amount) AS paid
            FROM ${schema}."SupplierPayment" WHERE "organizationId" = ${org}::uuid
            GROUP BY "supplierBillId"
          ) p ON p."supplierBillId" = b.id
          WHERE b."organizationId" = ${org}::uuid
            ${q.status ? Prisma.sql`AND b.status = ${q.status}::${schema}."SupplierBillStatus"` : Prisma.empty}
            ${q.supplierId ? Prisma.sql`AND b."supplierId" = ${q.supplierId}::uuid` : Prisma.empty}
            ${q.purchaseOrderId ? Prisma.sql`AND b."purchaseOrderId" = ${q.purchaseOrderId}::uuid` : Prisma.empty}
            ${q.issueDateFrom ? Prisma.sql`AND b."issueDate" >= ${q.issueDateFrom}::date` : Prisma.empty}
            ${q.issueDateTo ? Prisma.sql`AND b."issueDate" <= ${q.issueDateTo}::date` : Prisma.empty}
            ${q.dueDateFrom ? Prisma.sql`AND b."dueDate" >= ${q.dueDateFrom}::date` : Prisma.empty}
            ${q.dueDateTo ? Prisma.sql`AND b."dueDate" <= ${q.dueDateTo}::date` : Prisma.empty}
            ${billSearch(q.q)}
        )
        SELECT base.id, base.paid FROM base
        WHERE true ${paymentFilter(q)}
          ${q.overdue === 'true' ? Prisma.sql`AND base.status = 'POSTED' AND base."dueDate" < ${today}::date AND base.amount > base.paid` : Prisma.empty}
          ${q.overdue === 'false' ? Prisma.sql`AND NOT (base.status = 'POSTED' AND base."dueDate" IS NOT NULL AND base."dueDate" < ${today}::date AND base.amount > base.paid)` : Prisma.empty}
          ${cursor ? Prisma.sql`AND (base."createdAt", base.id) < (${cursor.at}, ${cursor.id}::uuid)` : Prisma.empty}
        ORDER BY base."createdAt" DESC, base.id DESC LIMIT ${q.limit + 1}
      `);
        const selected = ids.slice(0, q.limit);
        const rows = await tx.supplierBill.findMany({
          where: { organizationId: org, id: { in: selected.map((item) => item.id) } },
          include: billInclude,
        });
        const byId = new Map(rows.map((row) => [row.id, row]));
        const last = selected.at(-1);
        return {
          items: selected.map((item) => serialize(byId.get(item.id)!, decimal(item.paid), today)),
          nextCursor: ids.length > q.limit && last ? encodeCursor(byId.get(last.id)!) : null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async get(org: string, id: string): Promise<SupplierBillResponse> {
    return this.prisma.$transaction(
      async (tx) => {
        const { today } = await this.context(tx, org);
        const row = await tx.supplierBill.findFirst({
          where: { organizationId: org, id },
          include: { ...billInclude, payments: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
        });
        if (!row) throw new NotFoundException();
        const paid = row.payments.reduce(
          (result, payment) => result.plus(payment.amount),
          decimal(0),
        );
        return {
          ...serialize(row, paid, today),
          note: row.note,
          createdBy: { id: row.createdByUserId },
          updatedAt: row.updatedAt.toISOString(),
          postedAt: row.postedAt?.toISOString() ?? null,
          voidedAt: row.voidedAt?.toISOString() ?? null,
          voidedBy: row.voidedByUserId ? { id: row.voidedByUserId } : null,
          voidReason: row.voidReason,
          payments: row.payments.map(paymentResponse),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async getPayment(
    org: string,
    billId: string,
    paymentId: string,
  ): Promise<SupplierPaymentResponse> {
    const row = await this.prisma.supplierPayment.findFirst({
      where: { organizationId: org, supplierBillId: billId, id: paymentId },
    });
    if (!row) throw new NotFoundException();
    return paymentResponse(row);
  }

  async payments(
    org: string,
    billId: string,
    q: SupplierPaymentQueryDto,
  ): Promise<PageResponse<SupplierPaymentResponse>> {
    if (
      !(await this.prisma.supplierBill.findFirst({
        where: { organizationId: org, id: billId },
        select: { id: true },
      }))
    )
      throw new NotFoundException();
    const cursor = decodeCursor(q.cursor);
    const rows = await this.prisma.supplierPayment.findMany({
      where: {
        organizationId: org,
        supplierBillId: billId,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.at } },
                { createdAt: cursor.at, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    const last = rows[q.limit - 1];
    return {
      items: rows.slice(0, q.limit).map(paymentResponse),
      nextCursor: rows.length > q.limit && last ? encodeCursor(last) : null,
    };
  }

  async summary(org: string): Promise<AccountsPayableSummaryResponse> {
    const schema = this.prisma.sqlSchema;
    return this.prisma.$transaction(
      async (tx) => {
        const organization = await this.context(tx, org);
        const rows = await tx.$queryRaw<SummaryRaw[]>(Prisma.sql`
        WITH balances AS (
          SELECT b."currencyCode", b."dueDate", b.amount, COALESCE(p.paid, 0) AS paid
          FROM ${schema}."SupplierBill" b LEFT JOIN (
            SELECT "supplierBillId", SUM(amount) AS paid FROM ${schema}."SupplierPayment"
            WHERE "organizationId" = ${org}::uuid GROUP BY "supplierBillId"
          ) p ON p."supplierBillId" = b.id
          WHERE b."organizationId" = ${org}::uuid AND b.status = 'POSTED'
        )
        SELECT "currencyCode", SUM(amount - paid) AS outstanding,
          SUM(CASE WHEN "dueDate" < ${organization.today}::date AND amount > paid THEN amount - paid ELSE 0 END) AS overdue,
          COUNT(*) FILTER (WHERE paid = 0)::int AS unpaid,
          COUNT(*) FILTER (WHERE paid > 0 AND paid < amount)::int AS partial,
          COUNT(*) FILTER (WHERE "dueDate" < ${organization.today}::date AND amount > paid)::int AS "overdueCount"
        FROM balances GROUP BY "currencyCode"
      `);
        if (rows.length > 1) inventoryConflict('AP_MIXED_CURRENCY');
        const row = rows[0];
        return {
          currencyCode: row?.currencyCode ?? organization.defaultCurrency,
          timezone: organization.timezone,
          asOf: organization.today,
          totalOutstanding: decimal(row?.outstanding ?? 0).toFixed(4),
          overdueOutstanding: decimal(row?.overdue ?? 0).toFixed(4),
          unpaidBillsCount: row?.unpaid ?? 0,
          partiallyPaidBillsCount: row?.partial ?? 0,
          overdueBillsCount: row?.overdueCount ?? 0,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
