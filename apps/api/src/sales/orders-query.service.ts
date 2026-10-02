import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  PageResponse,
  SalesOrderListItem,
  SalesOrderResponse,
  SalesPaymentResponse,
} from '@saas/types';
import { Prisma, type SalesOrder, type SalesPayment } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { SalesQueryDto } from './sales.dto.js';
import { decodeCursor, encodeCursor, filterDate } from './pagination.js';
import { decimal } from './totals.js';
import type { InventoryTx } from '../inventory/inventory-locks.js';
type Relation = { id: string; name: string; isActive: boolean };
type OrderRow = SalesOrder & { customer: Relation | null; location: Relation | null };
// Prisma relation includes may issue parallel queries on one interactive-transaction connection.
// Explicit sequential, page-bounded bulk reads preserve REPEATABLE READ without driver queueing.
async function withRelations(
  tx: InventoryTx,
  org: string,
  rows: SalesOrder[],
): Promise<OrderRow[]> {
  const customers = await tx.customer.findMany({
    where: {
      organizationId: org,
      id: { in: [...new Set(rows.flatMap((r) => (r.customerId ? [r.customerId] : [])))] },
    },
    select: { id: true, name: true, isActive: true },
  });
  const locations = await tx.location.findMany({
    where: {
      organizationId: org,
      id: { in: [...new Set(rows.flatMap((r) => (r.locationId ? [r.locationId] : [])))] },
    },
    select: { id: true, name: true, isActive: true },
  });
  const customerMap = new Map(customers.map((c) => [c.id, c])),
    locationMap = new Map(locations.map((l) => [l.id, l]));
  return rows.map((row) => ({
    ...row,
    customer: row.customerId ? (customerMap.get(row.customerId) ?? null) : null,
    location: row.locationId ? (locationMap.get(row.locationId) ?? null) : null,
  }));
}
export function paymentResponse(row: SalesPayment): SalesPaymentResponse {
  return {
    id: row.id,
    salesOrderId: row.salesOrderId,
    amount: row.amount.toFixed(4),
    method: row.method,
    reference: row.reference,
    note: row.note,
    createdBy: { id: row.createdByUserId },
    createdAt: row.createdAt.toISOString(),
  };
}
function summary(row: OrderRow, paid: Prisma.Decimal): SalesOrderListItem {
  return {
    id: row.id,
    sequenceNumber: row.sequenceNumber,
    status: row.status,
    currencyCode: row.currencyCode,
    customer: row.customer,
    location: row.location,
    subtotal: row.subtotal.toFixed(4),
    discountTotal: row.discountTotal.toFixed(4),
    total: row.total.toFixed(4),
    paidAmount: paid.toFixed(4),
    outstandingAmount: decimal(row.total).minus(paid).toFixed(4),
    paymentStatus: paid.eq(row.total) ? 'PAID' : paid.isZero() ? 'UNPAID' : 'PARTIALLY_PAID',
    createdAt: row.createdAt.toISOString(),
  };
}
@Injectable()
export class OrdersQueryService {
  constructor(private readonly prisma: PrismaService) {}
  async get(org: string, id: string): Promise<SalesOrderResponse> {
    return this.prisma.$transaction(
      async (tx) => {
        const row = await tx.salesOrder.findFirst({
          where: { organizationId: org, id },
        });
        if (!row) throw new NotFoundException();
        const [related] = await withRelations(tx, org, [row]);
        const items = await tx.salesOrderItem.findMany({
          where: { organizationId: org, salesOrderId: id },
          orderBy: { id: 'asc' },
        });
        const payments = await tx.salesPayment.findMany({
          where: { organizationId: org, salesOrderId: id },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
        const aggregate = await tx.salesPayment.aggregate({
          where: { organizationId: org, salesOrderId: id },
          _sum: { amount: true },
        });
        return {
          ...summary(related!, aggregate._sum.amount ?? decimal(0)),
          note: row.note,
          createdBy: { id: row.createdByUserId },
          updatedAt: row.updatedAt.toISOString(),
          completedAt: row.completedAt?.toISOString() ?? null,
          cancelledAt: row.cancelledAt?.toISOString() ?? null,
          items: items.map((item) => ({
            id: item.id,
            variantId: item.variantId,
            quantity: item.quantity.toFixed(6),
            unitPrice: item.unitPrice.toFixed(4),
            discountAmount: item.discountAmount.toFixed(4),
            lineTotal: item.lineTotal.toFixed(4),
            snapshotItemName: item.snapshotItemName,
            snapshotVariantName: item.snapshotVariantName,
            snapshotSku: item.snapshotSku,
            snapshotUnit: item.snapshotUnit,
          })),
          payments: payments.map(paymentResponse),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async list(org: string, q: SalesQueryDto): Promise<PageResponse<SalesOrderListItem>> {
    const cursor = decodeCursor(q.cursor),
      from = filterDate(q.from),
      to = filterDate(q.to);
    if (from && to && from > to) throw new BadRequestException('from must not exceed to');
    const clauses = [Prisma.sql`o."organizationId"=${org}::uuid`];
    if (q.status) clauses.push(Prisma.sql`o.status::text=${q.status}`);
    if (q.customerId) clauses.push(Prisma.sql`o."customerId"=${q.customerId}::uuid`);
    if (q.locationId) clauses.push(Prisma.sql`o."locationId"=${q.locationId}::uuid`);
    if (from) clauses.push(Prisma.sql`o."createdAt">=${from}`);
    if (to) clauses.push(Prisma.sql`o."createdAt"<=${to}`);
    if (cursor) clauses.push(Prisma.sql`(o."createdAt",o.id)<(${cursor.at},${cursor.id}::uuid)`);
    if (q.q) {
      const number = q.q.replace(/^SO-/i, '').replace(/^0+(?=\d)/, '');
      const search = `%${q.q.replace(/[\\%_]/g, '\\$&')}%`;
      clauses.push(Prisma.sql`(o."sequenceNumber"::text=${number} OR c.name ILIKE ${search})`);
    }
    const status =
      q.paymentStatus === 'PAID'
        ? Prisma.sql`paid=o.total`
        : q.paymentStatus === 'UNPAID'
          ? Prisma.sql`paid=0 AND o.total>0`
          : q.paymentStatus === 'PARTIALLY_PAID'
            ? Prisma.sql`paid>0 AND paid<o.total`
            : Prisma.sql`TRUE`;
    return this.prisma.$transaction(
      async (tx) => {
        const selected = await tx.$queryRaw<{ id: string; paid: Prisma.Decimal }[]>(Prisma.sql`
        SELECT o.id,p.paid FROM ${this.prisma.sqlSchema}."SalesOrder" o
        LEFT JOIN ${this.prisma.sqlSchema}."Customer" c ON c.id=o."customerId" AND c."organizationId"=o."organizationId"
        CROSS JOIN LATERAL (SELECT COALESCE(SUM(amount),0) AS paid FROM ${this.prisma.sqlSchema}."SalesPayment" sp
          WHERE sp."organizationId"=o."organizationId" AND sp."salesOrderId"=o.id) p
        WHERE ${Prisma.join(clauses, ' AND ')} AND (${status})
        ORDER BY o."createdAt" DESC,o.id DESC LIMIT ${q.limit + 1}`);
        const rows = await tx.salesOrder.findMany({
          where: { organizationId: org, id: { in: selected.slice(0, q.limit).map((r) => r.id) } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
        const related = await withRelations(tx, org, rows);
        const paid = new Map(selected.map((r) => [r.id, r.paid]));
        const last = rows.at(-1);
        return {
          items: related.map((row) => summary(row, paid.get(row.id) ?? decimal(0))),
          nextCursor: selected.length > q.limit && last ? encodeCursor(last) : null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
