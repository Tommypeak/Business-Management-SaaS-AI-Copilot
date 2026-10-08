import { Injectable, NotFoundException } from '@nestjs/common';
import type { PageResponse, SupplierResponse } from '@saas/types';
import type { Supplier } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  inventoryConflict,
  inventoryLock,
  type InventoryTx,
} from '../inventory/inventory-locks.js';
import { decodeCursor, encodeCursor } from '../sales/pagination.js';
import type { SupplierDto, SupplierQueryDto, UpdateSupplierDto } from './purchasing.dto.js';

const serialize = (row: Supplier): SupplierResponse => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
export async function activeSupplier(tx: InventoryTx, org: string, id: string) {
  await inventoryLock(tx, `purchasing:supplier:${org}:${id}`, true);
  const row = await tx.supplier.findFirst({ where: { organizationId: org, id } });
  if (!row) throw new NotFoundException();
  if (!row.isActive) inventoryConflict('PURCHASE_SUPPLIER_INACTIVE');
}
@Injectable()
export class SuppliersService {
  constructor(private readonly prisma: PrismaService) {}
  async get(org: string, id: string) {
    const row = await this.prisma.supplier.findFirst({ where: { organizationId: org, id } });
    if (!row) throw new NotFoundException();
    return serialize(row);
  }
  async list(org: string, q: SupplierQueryDto): Promise<PageResponse<SupplierResponse>> {
    const cursor = decodeCursor(q.cursor);
    const rows = await this.prisma.supplier.findMany({
      where: {
        organizationId: org,
        isActive: q.isActive === undefined ? undefined : q.isActive === 'true',
        AND: [
          ...(q.q
            ? [
                {
                  OR: ['name', 'contactName', 'email', 'phone', 'taxId'].map((field) => ({
                    [field]: { contains: q.q, mode: 'insensitive' as const },
                  })),
                },
              ]
            : []),
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
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    const last = rows[q.limit - 1];
    return {
      items: rows.slice(0, q.limit).map(serialize),
      nextCursor: rows.length > q.limit && last ? encodeCursor(last) : null,
    };
  }
  async create(org: string, input: SupplierDto) {
    return serialize(
      await this.prisma.supplier.create({ data: { organizationId: org, ...input } }),
    );
  }
  async update(org: string, id: string, input: UpdateSupplierDto) {
    await this.prisma.$transaction(async (tx) => {
      await inventoryLock(tx, `purchasing:supplier:${org}:${id}`);
      if (
        !(await tx.supplier.findFirst({ where: { organizationId: org, id }, select: { id: true } }))
      )
        throw new NotFoundException();
      await tx.supplier.update({
        where: { id_organizationId: { id, organizationId: org } },
        data: input,
      });
    });
    return this.get(org, id);
  }
}
