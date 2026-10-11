import { BadRequestException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import {
  Permission,
  type CustomerRefundResponse,
  type CustomerRefundListItem,
  type PageResponse,
  type ReturnEligibilityResponse,
  type SalesReturnResponse,
  type SalesReturnListItem,
} from '@saas/types';
import type { OrganizationContext } from '../auth/auth-context.js';
import { Prisma } from '../generated/prisma/client.js';
import type { InventoryTx } from '../inventory/inventory-locks.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { decodeCursor, encodeCursor } from '../sales/pagination.js';
import { decimal } from '../sales/totals.js';
import { position, quote, returnedLines } from './return-calculation.js';
import type { ReturnQueryDto } from './returns.dto.js';
const orderInclude = { customer: true, location: true };
const include = {
  order: { include: orderInclude },
  items: {
    orderBy: { id: 'asc' as const },
    take: 100,
    include: { location: true, sourceItem: { select: { variantId: true } } },
  },
  inventoryTransaction: { select: { id: true } },
};
type Row = Prisma.SalesReturnGetPayload<{ include: typeof include }>;
const refundInclude = { order: { include: orderInclude } };
type RefundRow = Prisma.CustomerRefundGetPayload<{ include: typeof refundInclude }>;
const saleNumber = (n: number) => `SO-${String(n).padStart(6, '0')}`;
export const returnNumber = (n: number) => `SR-${String(n).padStart(6, '0')}`;
export const refundNumber = (n: number) => `CR-${String(n).padStart(6, '0')}`;
const visible = (ctx: OrganizationContext) => ctx.permissions.includes(Permission.FINANCE_VIEW);
function source(order: Row['order']) {
  return {
    id: order.id,
    sequenceNumber: order.sequenceNumber,
    number: saleNumber(order.sequenceNumber),
    customer: order.customer
      ? { id: order.customer.id, name: order.customer.name, isActive: order.customer.isActive }
      : null,
    location: order.location
      ? { id: order.location.id, name: order.location.name, isActive: order.location.isActive }
      : null,
  };
}
function summary(
  row: Row,
  finance: boolean,
  allocated = new Prisma.Decimal(0),
): SalesReturnListItem {
  return {
    id: row.id,
    sequenceNumber: row.sequenceNumber,
    number: returnNumber(row.sequenceNumber),
    status: row.status,
    salesOrder: source(row.order),
    currencyCode: row.currencyCode,
    totalRefundableAmount: finance ? row.totalRefundableAmount.toFixed(4) : null,
    refundedForReturn: finance ? allocated.toFixed(4) : null,
    remainingReturnCredit:
      finance && row.status === 'POSTED'
        ? decimal(row.totalRefundableAmount).minus(allocated).toFixed(4)
        : null,
    itemsCount: row.items.length,
    createdAt: row.createdAt.toISOString(),
    postedAt: row.postedAt?.toISOString() ?? null,
  };
}
export function refundSummary(row: RefundRow, finance: boolean): CustomerRefundListItem {
  return {
    id: row.id,
    sequenceNumber: row.sequenceNumber,
    number: refundNumber(row.sequenceNumber),
    salesOrder: source(row.order),
    amount: finance ? row.amount.toFixed(4) : null,
    currencyCode: row.currencyCode,
    paymentDate: row.paymentDate.toISOString().slice(0, 10),
    paymentMethod: row.paymentMethod,
    reference: row.reference,
    createdAt: row.createdAt.toISOString(),
  };
}
function bounds(query: ReturnQueryDto) {
  if (query.from && query.to && query.from > query.to)
    throw new BadRequestException('from must not exceed to');
  const c = query.cursor ? decodeCursor(query.cursor) : null;
  return {
    AND: c ? [{ OR: [{ createdAt: { lt: c.at } }, { createdAt: c.at, id: { lt: c.id } }] }] : [],
  };
}
@Injectable()
export class ReturnsQueryService {
  constructor(private readonly prisma: PrismaService) {}
  private read<T>(work: (tx: InventoryTx) => Promise<T>) {
    return this.prisma.$transaction(work, {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 15000,
    });
  }
  async list(
    ctx: OrganizationContext,
    query: ReturnQueryDto,
  ): Promise<PageResponse<SalesReturnListItem>> {
    return this.read(async (tx) => {
      let postedAt: Prisma.SalesReturnWhereInput['postedAt'];
      if (query.from || query.to) {
        const org = await tx.organization.findUniqueOrThrow({
          where: { id: ctx.organizationId },
          select: { timezone: true },
        });
        const [range] = await tx.$queryRaw<{ start: Date | null; end: Date | null }[]>(Prisma.sql`
          SELECT (${query.from ?? null}::date::timestamp AT TIME ZONE ${org.timezone}) AS start,
            ((${query.to ?? null}::date+1)::timestamp AT TIME ZONE ${org.timezone}) AS end
        `);
        postedAt = { not: null, gte: range!.start ?? undefined, lt: range!.end ?? undefined };
      }
      const rows = await tx.salesReturn.findMany({
        where: {
          organizationId: ctx.organizationId,
          status: query.status,
          salesOrderId: query.salesOrderId,
          order: { customerId: query.customerId, locationId: query.locationId },
          ...bounds(query),
          postedAt,
        },
        include,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      });
      const last = rows[query.limit - 1];
      const totals = visible(ctx)
        ? await tx.refundAllocation.groupBy({
            by: ['salesReturnId'],
            where: {
              organizationId: ctx.organizationId,
              salesReturnId: { in: rows.map((r) => r.id) },
            },
            _sum: { allocatedAmount: true },
          })
        : [];
      const allocated = new Map(
        totals.map((r) => [r.salesReturnId, r._sum.allocatedAmount ?? new Prisma.Decimal(0)]),
      );
      return {
        items: rows.slice(0, query.limit).map((r) => summary(r, visible(ctx), allocated.get(r.id))),
        nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
      };
    });
  }
  get(ctx: OrganizationContext, id: string): Promise<SalesReturnResponse> {
    return this.read(async (tx) => {
      const row = await tx.salesReturn.findFirst({
        where: { organizationId: ctx.organizationId, id },
        include,
      });
      if (!row) throw new NotFoundException();
      const finance = visible(ctx),
        org = ctx.organizationId;
      const pos = await position(tx, org, row.salesOrderId, row.order.total);
      const allocated = await tx.refundAllocation.aggregate({
        where: { organizationId: org, salesReturnId: id },
        _sum: { allocatedAmount: true },
      });
      const amount = decimal(allocated._sum.allocatedAmount ?? 0),
        remaining = decimal(row.totalRefundableAmount).minus(amount);
      let quoteValid = true,
        currentQuote = row.totalRefundableAmount;
      if (row.status === 'DRAFT') {
        const order = await tx.salesOrder.findFirstOrThrow({
          where: { organizationId: org, id: row.salesOrderId },
          include: { items: { take: 100 } },
        });
        try {
          currentQuote = (
            await quote(
              tx,
              org,
              order,
              row.items.map((i) => ({
                salesOrderItemId: i.salesOrderItemId,
                quantity: i.quantity.toFixed(6),
                restockDisposition: i.restockDisposition,
                locationId: i.locationId,
              })),
            )
          ).total;
        } catch (error) {
          if (!(error instanceof HttpException)) throw error;
          quoteValid = false;
        }
      }
      const refunds = finance
        ? await tx.customerRefund.findMany({
            where: {
              organizationId: org,
              allocations: { some: { organizationId: org, salesReturnId: id } },
            },
            include: refundInclude,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 101,
          })
        : [];
      return {
        ...summary(row, finance),
        reason: row.reason,
        note: row.note,
        revision: row.revision,
        createdBy: { id: row.createdByUserId },
        postedBy: row.postedByUserId ? { id: row.postedByUserId } : null,
        updatedAt: row.updatedAt.toISOString(),
        cancelledAt: row.cancelledAt?.toISOString() ?? null,
        cancelledBy: row.cancelledByUserId ? { id: row.cancelledByUserId } : null,
        cancelReason: row.cancelReason,
        financeVisible: finance,
        quoteValid,
        currentQuoteAmount: finance && quoteValid ? currentQuote.toFixed(4) : null,
        collectedAmount: finance ? pos.p.toFixed(4) : null,
        refundedAmount: finance ? pos.f.toFixed(4) : null,
        refundedForReturn: finance ? amount.toFixed(4) : null,
        remainingReturnCredit: finance ? remaining.toFixed(4) : null,
        availableRefundAmount:
          finance && row.status === 'POSTED'
            ? Prisma.Decimal.min(remaining, pos.cash).toFixed(4)
            : null,
        inventoryTransactionId: row.inventoryTransaction?.id ?? null,
        refunds: finance ? refunds.slice(0, 100).map((r) => refundSummary(r, true)) : null,
        refundsTruncated: refunds.length > 100,
        items: row.items.map((i) => ({
          id: i.id,
          salesOrderItemId: i.salesOrderItemId,
          variantId: i.sourceItem.variantId,
          quantity: i.quantity.toFixed(6),
          restockDisposition: i.restockDisposition,
          location: i.location
            ? { id: i.location.id, name: i.location.name, isActive: i.location.isActive }
            : null,
          refundAmount: finance ? i.refundAmount.toFixed(4) : null,
          stockRestocked: i.stockRestocked,
          snapshotItemName: i.snapshotItemName,
          snapshotVariantName: i.snapshotVariantName,
          snapshotSku: i.snapshotSku,
          snapshotUnit: i.snapshotUnit,
          snapshotItemType: i.snapshotItemType,
        })),
      };
    });
  }
  eligibility(ctx: OrganizationContext, id: string): Promise<ReturnEligibilityResponse> {
    return this.read(async (tx) => {
      const order = await tx.salesOrder.findFirst({
        where: { id, organizationId: ctx.organizationId, status: 'COMPLETED' },
        include: { ...orderInclude, items: { take: 100 } },
      });
      if (!order) throw new NotFoundException();
      const org = ctx.organizationId,
        finance = visible(ctx),
        pos = await position(tx, org, id, order.total),
        prior = await returnedLines(tx, org, id);
      return {
        salesOrder: source(order),
        currencyCode: order.currencyCode,
        financeVisible: finance,
        postedReturnsCount: pos.count,
        postedReturnCredits: finance ? pos.c.toFixed(4) : null,
        collectedAmount: finance ? pos.p.toFixed(4) : null,
        refundedAmount: finance ? pos.f.toFixed(4) : null,
        remainingRefundableCashCap: finance ? pos.cash.toFixed(4) : null,
        unusedReturnCredit: finance ? pos.unused.toFixed(4) : null,
        availableRefundAmount: finance ? pos.available.toFixed(4) : null,
        adjustedSalesAmount: finance ? pos.adjusted.toFixed(4) : null,
        netOutstandingAmount: finance ? pos.outstanding.toFixed(4) : null,
        netPaidAmount: finance ? pos.netPaid.toFixed(4) : null,
        items: order.items.map((i) => {
          const old = prior.get(i.id) ?? { quantity: decimal(0), credit: decimal(0) };
          return {
            salesOrderItemId: i.id,
            variantId: i.variantId,
            snapshotItemName: i.snapshotItemName,
            snapshotVariantName: i.snapshotVariantName,
            snapshotSku: i.snapshotSku,
            snapshotUnit: i.snapshotUnit,
            snapshotItemType: i.snapshotItemType,
            stockDeducted: i.stockDeducted,
            restockAllowed: i.snapshotItemType === 'PRODUCT',
            soldQuantity: i.quantity.toFixed(6),
            returnedQuantity: old.quantity.toFixed(6),
            remainingQuantity: decimal(i.quantity).minus(old.quantity).toFixed(6),
            originalLineAmount: finance ? i.lineTotal.toFixed(4) : null,
            creditedAmount: finance ? old.credit.toFixed(4) : null,
            remainingCredit: finance ? decimal(i.lineTotal).minus(old.credit).toFixed(4) : null,
          };
        }),
      };
    });
  }
  async refunds(
    ctx: OrganizationContext,
    query: ReturnQueryDto,
  ): Promise<PageResponse<CustomerRefundListItem>> {
    if (query.from && query.to && query.from > query.to)
      throw new BadRequestException('from must not exceed to');
    const rows = await this.prisma.customerRefund.findMany({
      where: {
        organizationId: ctx.organizationId,
        salesOrderId: query.salesOrderId,
        order: { customerId: query.customerId, locationId: query.locationId },
        ...bounds({ ...query, from: undefined, to: undefined }),
        paymentDate: {
          gte: query.from ? new Date(`${query.from}T00:00:00Z`) : undefined,
          lte: query.to ? new Date(`${query.to}T00:00:00Z`) : undefined,
        },
      },
      include: refundInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const last = rows[query.limit - 1];
    return {
      items: rows.slice(0, query.limit).map((r) => refundSummary(r, visible(ctx))),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
    };
  }
  async refund(ctx: OrganizationContext, id: string): Promise<CustomerRefundResponse> {
    const row = await this.prisma.customerRefund.findFirst({
      where: { id, organizationId: ctx.organizationId },
      include: {
        ...refundInclude,
        allocations: { take: 100, include: { salesReturn: { select: { sequenceNumber: true } } } },
      },
    });
    if (!row) throw new NotFoundException();
    return {
      ...refundSummary(row, visible(ctx)),
      note: row.note,
      createdBy: { id: row.createdByUserId },
      allocations: row.allocations.map((a) => ({
        salesReturnId: a.salesReturnId,
        returnNumber: returnNumber(a.salesReturn.sequenceNumber),
        allocatedAmount: visible(ctx) ? a.allocatedAmount.toFixed(4) : null,
      })),
    };
  }
}
