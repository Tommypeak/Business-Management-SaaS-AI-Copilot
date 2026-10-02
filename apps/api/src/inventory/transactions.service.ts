import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { InventoryTransactionResponse, PageResponse } from '@saas/types';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { HistoryQueryDto } from './inventory.dto.js';

const include = {
  entries: {
    orderBy: { id: 'asc' as const },
    take: 100,
    include: { location: true, variant: { include: { item: true } } },
  },
  reversals: { select: { id: true }, take: 1 },
};
type Row = Prisma.InventoryTransactionGetPayload<{ include: typeof include }>;
// Date-only and datetime-local filters are UTC, independent of the server timezone.
function filterDate(value: string): Date {
  const date = new Date(
    value.includes('T') && !/(Z|[+-]\d{2}:?\d{2})$/i.test(value) ? `${value}Z` : value,
  );
  if (!Number.isFinite(date.getTime())) throw new BadRequestException('Invalid date filter');
  return date;
}
function serialize(row: Row): InventoryTransactionResponse {
  return {
    id: row.id,
    type: row.type,
    salesOrderId: row.salesOrderId,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
    createdBy: { id: row.createdByUserId },
    note: row.note,
    reversesTransactionId: row.reversesTransactionId,
    reversedByTransactionId: row.reversals[0]?.id ?? null,
    entries: row.entries.map((entry) => ({
      id: entry.id,
      location: {
        id: entry.location.id,
        name: entry.location.name,
        isActive: entry.location.isActive,
      },
      variant: {
        id: entry.variant.id,
        name: entry.variant.name,
        sku: entry.variant.sku,
        itemId: entry.variant.catalogItemId,
        itemName: entry.variant.item.name,
        isActive: entry.variant.isActive && entry.variant.item.isActive,
      },
      unit: entry.variant.unit,
      quantityDelta: entry.quantityDelta.toFixed(6),
    })),
  };
}
@Injectable()
export class InventoryTransactionsService {
  constructor(private readonly prisma: PrismaService) {}
  async get(org: string, id: string): Promise<InventoryTransactionResponse> {
    const row = await this.prisma.inventoryTransaction.findFirst({
      where: { organizationId: org, id },
      include,
    });
    if (!row) throw new NotFoundException();
    return serialize(row);
  }
  async list(
    org: string,
    query: HistoryQueryDto,
  ): Promise<PageResponse<InventoryTransactionResponse>> {
    const and: Prisma.InventoryTransactionWhereInput[] = [];
    const from = query.from ? filterDate(query.from) : undefined;
    const to = query.to ? filterDate(query.to) : undefined;
    if (from && to && from > to) throw new BadRequestException('from must not exceed to');
    if (query.cursor) {
      try {
        const cursor: unknown = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'));
        if (
          !cursor ||
          typeof cursor !== 'object' ||
          !('id' in cursor) ||
          typeof cursor.id !== 'string' ||
          !isUUID(cursor.id) ||
          !('at' in cursor) ||
          typeof cursor.at !== 'string' ||
          !Number.isFinite(Date.parse(cursor.at))
        )
          throw new Error();
        const at = new Date(cursor.at);
        and.push({ OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: cursor.id } }] });
      } catch {
        throw new BadRequestException('Invalid history cursor');
      }
    }
    const rows = await this.prisma.inventoryTransaction.findMany({
      where: {
        organizationId: org,
        type: query.type,
        createdAt: {
          ...(from ? { gte: from } : {}),
          ...(to ? { lte: to } : {}),
        },
        ...(query.locationId || query.variantId
          ? {
              entries: {
                some: {
                  organizationId: org,
                  locationId: query.locationId,
                  variantId: query.variantId,
                },
              },
            }
          : {}),
        AND: and,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      include,
    });
    const last = rows[query.limit - 1];
    return {
      items: rows.slice(0, query.limit).map(serialize),
      nextCursor:
        rows.length > query.limit && last
          ? Buffer.from(JSON.stringify({ id: last.id, at: last.createdAt.toISOString() })).toString(
              'base64url',
            )
          : null,
    };
  }
}
