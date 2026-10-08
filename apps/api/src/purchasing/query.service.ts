import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  GoodsReceiptResponse,
  PageResponse,
  PurchaseOrderListItem,
  PurchaseOrderResponse,
} from '@saas/types';
import { Prisma, type PurchaseOrder } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { decimal } from '../sales/totals.js';
import { decodeCursor, encodeCursor, filterDate } from '../sales/pagination.js';
import type { PurchaseQueryDto } from './purchasing.dto.js';

@Injectable()
export class PurchasingQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(org: string, q: PurchaseQueryDto): Promise<PageResponse<PurchaseOrderListItem>> {
    const cursor = decodeCursor(q.cursor),
      from = filterDate(q.from),
      to = filterDate(q.to);
    if (from && to && from > to) throw new BadRequestException('from must not exceed to');
    const number = q.q?.replace(/^PO-/i, '').replace(/^0+(?=\d)/, '');
    const rows = await this.prisma.purchaseOrder.findMany({
      where: {
        organizationId: org,
        status: q.status,
        supplierId: q.supplierId,
        destinationLocationId: q.destinationLocationId,
        createdAt: { gte: from, lte: to },
        AND: [
          ...(cursor
            ? [
                {
                  OR: [
                    { createdAt: { lt: cursor.at } },
                    { createdAt: cursor.at, id: { lt: cursor.id } },
                  ],
                },
              ]
            : []),
          ...(q.q
            ? [
                {
                  OR: [
                    ...(number && /^\d+$/.test(number) && Number.isSafeInteger(Number(number))
                      ? [{ sequenceNumber: Number(number) }]
                      : []),
                    { supplier: { name: { contains: q.q, mode: 'insensitive' as const } } },
                  ],
                },
              ]
            : []),
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      include: {
        supplier: { select: { id: true, name: true, isActive: true } },
        destinationLocation: { select: { id: true, name: true, isActive: true } },
      },
    });
    const page = rows.slice(0, q.limit),
      ids = page.map((r) => r.id);
    const lines = await this.prisma.purchaseOrderItem.findMany({
      where: { organizationId: org, purchaseOrderId: { in: ids } },
      select: { id: true, purchaseOrderId: true, orderedQuantity: true },
    });
    const received = lines.length
      ? await this.prisma.goodsReceiptItem.groupBy({
          by: ['purchaseOrderItemId'],
          where: { organizationId: org, purchaseOrderItemId: { in: lines.map((l) => l.id) } },
          _sum: { receivedQuantity: true },
        })
      : [];
    const receivedMap = new Map(
      received.map((r) => [r.purchaseOrderItemId, r._sum.receivedQuantity ?? decimal(0)]),
    );
    const progress = new Map<string, { ordered: Prisma.Decimal; received: Prisma.Decimal }>();
    for (const line of lines) {
      const value = progress.get(line.purchaseOrderId) ?? {
        ordered: decimal(0),
        received: decimal(0),
      };
      value.ordered = decimal(value.ordered).plus(line.orderedQuantity);
      value.received = decimal(value.received).plus(receivedMap.get(line.id) ?? decimal(0));
      progress.set(line.purchaseOrderId, value);
    }
    const last = page.at(-1);
    return {
      items: page.map((row) => this.summary(row, progress.get(row.id))),
      nextCursor: rows.length > q.limit && last ? encodeCursor(last) : null,
    };
  }

  private summary(
    row: PurchaseOrder & {
      supplier: { id: string; name: string; isActive: boolean };
      destinationLocation: { id: string; name: string; isActive: boolean };
    },
    progress?: { ordered: Prisma.Decimal; received: Prisma.Decimal },
  ): PurchaseOrderListItem {
    return {
      id: row.id,
      sequenceNumber: row.sequenceNumber,
      number: `PO-${String(row.sequenceNumber).padStart(6, '0')}`,
      status: row.status,
      currencyCode: row.currencyCode,
      supplier: row.supplier,
      destinationLocation: row.destinationLocation,
      subtotal: row.subtotal.toFixed(4),
      total: row.total.toFixed(4),
      orderedQuantity: (progress?.ordered ?? decimal(0)).toFixed(6),
      receivedQuantity: (progress?.received ?? decimal(0)).toFixed(6),
      createdAt: row.createdAt.toISOString(),
      orderedAt: row.orderedAt?.toISOString() ?? null,
    };
  }

  async get(org: string, id: string): Promise<PurchaseOrderResponse> {
    return this.prisma.$transaction(
      async (tx) => {
        const row = await tx.purchaseOrder.findFirst({
          where: { organizationId: org, id },
          include: {
            supplier: { select: { id: true, name: true, isActive: true } },
            destinationLocation: { select: { id: true, name: true, isActive: true } },
          },
        });
        if (!row) throw new NotFoundException();
        const items = await tx.purchaseOrderItem.findMany({
          where: { organizationId: org, purchaseOrderId: id },
          orderBy: { id: 'asc' },
        });
        const sums = items.length
          ? await tx.goodsReceiptItem.groupBy({
              by: ['purchaseOrderItemId'],
              where: { organizationId: org, purchaseOrderItemId: { in: items.map((i) => i.id) } },
              _sum: { receivedQuantity: true },
            })
          : [];
        const received = new Map(
          sums.map((r) => [r.purchaseOrderItemId, r._sum.receivedQuantity ?? decimal(0)]),
        );
        const receipts = await tx.goodsReceipt.findMany({
          where: { organizationId: org, purchaseOrderId: id },
          orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
          include: {
            items: true,
            inventoryTransaction: { include: { entries: { select: { variantId: true } } } },
          },
        });
        const lineMap = new Map(items.map((i) => [i.id, i]));
        let ordered = decimal(0),
          got = decimal(0);
        for (const item of items) {
          ordered = ordered.plus(item.orderedQuantity);
          got = got.plus(received.get(item.id) ?? decimal(0));
        }
        return {
          ...this.summary(row, { ordered, received: got }),
          note: row.note,
          createdBy: { id: row.createdByUserId },
          updatedAt: row.updatedAt.toISOString(),
          completedAt: row.completedAt?.toISOString() ?? null,
          cancelledAt: row.cancelledAt?.toISOString() ?? null,
          items: items.map((i) => ({
            id: i.id,
            variantId: i.variantId,
            orderedQuantity: i.orderedQuantity.toFixed(6),
            receivedQuantity: (received.get(i.id) ?? decimal(0)).toFixed(6),
            remainingQuantity: decimal(i.orderedQuantity)
              .minus(received.get(i.id) ?? decimal(0))
              .toFixed(6),
            unitCost: i.unitCost.toFixed(4),
            lineTotal: i.lineTotal.toFixed(4),
            snapshotItemName: i.snapshotItemName,
            snapshotVariantName: i.snapshotVariantName,
            snapshotSku: i.snapshotSku,
            snapshotUnit: i.snapshotUnit,
          })),
          receipts: receipts.map((receipt) => this.receiptResponse(receipt, lineMap)),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async receipt(org: string, id: string): Promise<GoodsReceiptResponse> {
    const row = await this.prisma.goodsReceipt.findFirst({
      where: { organizationId: org, id },
      include: {
        items: { include: { purchaseOrderItem: true } },
        inventoryTransaction: { include: { entries: { select: { variantId: true } } } },
      },
    });
    if (!row) throw new NotFoundException();
    return this.receiptResponse(
      row,
      new Map(row.items.map((i) => [i.purchaseOrderItemId, i.purchaseOrderItem])),
    );
  }

  private receiptResponse(
    row: Awaited<ReturnType<PrismaService['goodsReceipt']['findFirstOrThrow']>> & {
      items: {
        id: string;
        purchaseOrderItemId: string;
        variantId: string;
        receivedQuantity: Prisma.Decimal;
        snapshotUnit: GoodsReceiptResponse['items'][number]['snapshotUnit'];
      }[];
      inventoryTransaction: { id: string; entries: { variantId: string }[] } | null;
    },
    lines: Map<
      string,
      { snapshotItemName: string; snapshotVariantName: string | null; snapshotSku: string | null }
    >,
  ): GoodsReceiptResponse {
    const tracked = new Set(row.inventoryTransaction?.entries.map((e) => e.variantId) ?? []);
    return {
      id: row.id,
      sequenceNumber: row.sequenceNumber,
      number: `GR-${String(row.sequenceNumber).padStart(6, '0')}`,
      purchaseOrderId: row.purchaseOrderId,
      receivedAt: row.receivedAt.toISOString(),
      createdBy: { id: row.createdByUserId },
      note: row.note,
      inventoryTransactionId: row.inventoryTransaction?.id ?? null,
      items: row.items.map((i) => {
        const line = lines.get(i.purchaseOrderItemId)!;
        return {
          id: i.id,
          purchaseOrderItemId: i.purchaseOrderItemId,
          variantId: i.variantId,
          snapshotItemName: line.snapshotItemName,
          snapshotVariantName: line.snapshotVariantName,
          snapshotSku: line.snapshotSku,
          receivedQuantity: i.receivedQuantity.toFixed(6),
          snapshotUnit: i.snapshotUnit,
          inventoryTracked: tracked.has(i.variantId),
        };
      }),
    };
  }
}
