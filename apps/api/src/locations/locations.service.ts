import { Injectable, NotFoundException } from '@nestjs/common';
import type { LocationResponse, PageResponse } from '@saas/types';
import type { Location } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ListQueryDto } from '../common/list-query.dto.js';
import type { CreateLocationDto, UpdateLocationDto } from './location.dto.js';
import { inventoryConflict, inventoryLock, resourceKey } from '../inventory/inventory-locks.js';

function serialize(row: Location): LocationResponse {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    type: row.type,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}
  async list(organizationId: string, query: ListQueryDto): Promise<PageResponse<LocationResponse>> {
    const rows = await this.prisma.location.findMany({
      where: { organizationId, ...(query.cursor ? { id: { gt: query.cursor } } : {}) },
      orderBy: { id: 'asc' },
      take: query.limit + 1,
    });
    const items = rows.slice(0, query.limit).map(serialize);
    return { items, nextCursor: rows.length > query.limit ? items.at(-1)!.id : null };
  }
  async create(organizationId: string, input: CreateLocationDto): Promise<LocationResponse> {
    return serialize(
      await this.prisma.location.create({
        data: {
          organizationId,
          name: input.name,
          type: input.type,
          isActive: input.isActive ?? true,
        },
      }),
    );
  }
  async update(
    organizationId: string,
    locationId: string,
    input: UpdateLocationDto,
  ): Promise<LocationResponse> {
    return this.prisma.$transaction(async (tx) => {
      await inventoryLock(tx, resourceKey(organizationId, 'location', locationId));
      if (
        !(await tx.location.findFirst({
          where: { id: locationId, organizationId },
          select: { id: true },
        }))
      )
        throw new NotFoundException();
      if (
        input.isActive === false &&
        (await tx.inventoryBalance.findFirst({
          where: { organizationId, locationId, quantity: { not: 0 } },
          select: { id: true },
        }))
      )
        inventoryConflict('INVENTORY_STOCK_EXISTS');
      return serialize(
        await tx.location.update({
          where: { id: locationId, organizationId },
          data: { name: input.name, type: input.type, isActive: input.isActive },
        }),
      );
    });
  }
}
