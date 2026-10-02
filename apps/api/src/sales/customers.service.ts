import { Injectable, NotFoundException } from '@nestjs/common';
import type { CustomerResponse, PageResponse } from '@saas/types';
import type { Customer } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  inventoryLock,
  inventoryConflict,
  type InventoryTx,
} from '../inventory/inventory-locks.js';
import type { CustomerDto, CustomerQueryDto, UpdateCustomerDto } from './sales.dto.js';
import { decodeCursor, encodeCursor } from './pagination.js';
const serialize = (row: Customer): CustomerResponse => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
export async function activeCustomer(tx: InventoryTx, org: string, id: string) {
  await inventoryLock(tx, `sales:customer:${org}:${id}`, true);
  const row = await tx.customer.findFirst({ where: { organizationId: org, id } });
  if (!row) throw new NotFoundException();
  if (!row.isActive) inventoryConflict('CUSTOMER_INACTIVE');
}
@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}
  async get(org: string, id: string) {
    const row = await this.prisma.customer.findFirst({ where: { organizationId: org, id } });
    if (!row) throw new NotFoundException();
    return serialize(row);
  }
  async list(org: string, q: CustomerQueryDto): Promise<PageResponse<CustomerResponse>> {
    const cursor = decodeCursor(q.cursor);
    const rows = await this.prisma.customer.findMany({
      where: {
        organizationId: org,
        type: q.type,
        isActive: q.isActive === undefined ? undefined : q.isActive === 'true',
        AND: [
          ...(q.q
            ? [
                {
                  OR: ['name', 'email', 'phone'].map((field) => ({
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
  async create(org: string, input: CustomerDto) {
    return serialize(
      await this.prisma.customer.create({ data: { organizationId: org, ...input } }),
    );
  }
  async update(org: string, id: string, input: UpdateCustomerDto) {
    await this.prisma.$transaction(async (tx) => {
      await inventoryLock(tx, `sales:customer:${org}:${id}`);
      if (
        !(await tx.customer.findFirst({ where: { organizationId: org, id }, select: { id: true } }))
      )
        throw new NotFoundException();
      await tx.customer.update({
        where: { id_organizationId: { id, organizationId: org } },
        data: input,
      });
    });
    return this.get(org, id);
  }
}
