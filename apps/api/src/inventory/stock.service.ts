import { Injectable, NotFoundException } from '@nestjs/common';
import type { InventoryStockRow, PageResponse } from '@saas/types';
import { PrismaService } from '../prisma/prisma.service.js';
import type { StockQueryDto } from './inventory.dto.js';

@Injectable()
export class InventoryStockService {
  constructor(private readonly prisma: PrismaService) {}
  async list(org: string, query: StockQueryDto): Promise<PageResponse<InventoryStockRow>> {
    const location = query.locationId
      ? await this.prisma.location.findFirst({
          where: { organizationId: org, id: query.locationId },
          select: { id: true, name: true, isActive: true },
        })
      : null;
    if (query.locationId && !location) throw new NotFoundException();
    if (
      query.categoryId &&
      !(await this.prisma.catalogCategory.findFirst({
        where: { organizationId: org, id: query.categoryId },
        select: { id: true },
      }))
    )
      throw new NotFoundException();
    if (
      query.itemId &&
      !(await this.prisma.catalogItem.findFirst({
        where: { organizationId: org, id: query.itemId },
        select: { id: true },
      }))
    )
      throw new NotFoundException();
    const q = query.q?.replace(/[\\%_]/g, '\\$&');
    const rows = await this.prisma.catalogVariant.findMany({
      where: {
        organizationId: org,
        ...(query.cursor ? { id: { gt: query.cursor } } : {}),
        item: { organizationId: org, id: query.itemId, categoryId: query.categoryId },
        AND: [
          {
            OR: [
              { isActive: true, item: { isActive: true, type: 'PRODUCT', trackInventory: true } },
              { inventoryBalances: { some: { organizationId: org, quantity: { not: 0 } } } },
            ],
          },
          ...(q
            ? [
                {
                  OR: [
                    { name: { contains: q, mode: 'insensitive' as const } },
                    { sku: { contains: q, mode: 'insensitive' as const } },
                    { barcode: { contains: q, mode: 'insensitive' as const } },
                    { item: { name: { contains: q, mode: 'insensitive' as const } } },
                  ],
                },
              ]
            : []),
        ],
      },
      orderBy: { id: 'asc' },
      take: query.limit + 1,
      include: { item: { select: { id: true, name: true, trackInventory: true, isActive: true } } },
    });
    const page = rows.slice(0, query.limit);
    // SUM executes in PostgreSQL, only for this bounded page. No per-row queries.
    const totals = page.length
      ? await this.prisma.inventoryBalance.groupBy({
          by: ['variantId'],
          where: {
            organizationId: org,
            locationId: query.locationId,
            variantId: { in: page.map((row) => row.id) },
          },
          _sum: { quantity: true },
        })
      : [];
    const quantities = new Map(
      totals.map((row) => [row.variantId, row._sum.quantity?.toFixed(6) ?? '0.000000']),
    );
    return {
      items: page.map((row) => ({
        variantId: row.id,
        itemId: row.item.id,
        itemName: row.item.name,
        variantName: row.name,
        sku: row.sku,
        barcode: row.barcode,
        unit: row.unit,
        quantity: quantities.get(row.id) ?? '0.000000',
        isActive: row.isActive && row.item.isActive,
        trackInventory: row.item.trackInventory,
        location,
      })),
      nextCursor: rows.length > query.limit ? page.at(-1)!.id : null,
    };
  }
}
