import { Injectable, NotFoundException } from '@nestjs/common';
import type { ExpenseCategoryResponse, PageResponse } from '@saas/types';
import { Prisma, type ExpenseCategory } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  inventoryConflict,
  inventoryLock,
  type InventoryTx,
} from '../inventory/inventory-locks.js';
import { decodeCursor, encodeCursor } from '../sales/pagination.js';
import { runSalesTransaction } from '../sales/sales-transaction.js';
import { cleanText } from '../sales/payments.service.js';
import type { CategoryDto, CategoryQueryDto, UpdateCategoryDto } from './expenses.dto.js';

export const categoryKey = (org: string, id: string) => `expenses:category:${org}:${id}`;
export const normalizedCategoryName = (name: string) =>
  name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();

const serialize = (row: ExpenseCategory): ExpenseCategoryResponse => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
function duplicate(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
    inventoryConflict('EXPENSE_CATEGORY_ALREADY_EXISTS');
  throw error;
}
export async function activeCategory(tx: InventoryTx, org: string, id: string) {
  await inventoryLock(tx, categoryKey(org, id), true);
  const row = await tx.expenseCategory.findFirst({ where: { organizationId: org, id } });
  if (!row) throw new NotFoundException();
  if (!row.isActive) inventoryConflict('EXPENSE_CATEGORY_INACTIVE');
  return row;
}

@Injectable()
export class ExpenseCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async get(org: string, id: string): Promise<ExpenseCategoryResponse> {
    const row = await this.prisma.expenseCategory.findFirst({ where: { organizationId: org, id } });
    if (!row) throw new NotFoundException();
    return serialize(row);
  }

  async list(org: string, q: CategoryQueryDto): Promise<PageResponse<ExpenseCategoryResponse>> {
    const cursor = decodeCursor(q.cursor);
    const rows = await this.prisma.expenseCategory.findMany({
      where: {
        organizationId: org,
        isActive: q.isActive === undefined ? undefined : q.isActive === 'true',
        ...(q.q ? { name: { contains: q.q, mode: 'insensitive' } } : {}),
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
      items: rows.slice(0, q.limit).map(serialize),
      nextCursor: rows.length > q.limit && last ? encodeCursor(last) : null,
    };
  }

  async create(org: string, input: CategoryDto): Promise<ExpenseCategoryResponse> {
    try {
      return serialize(
        await this.prisma.expenseCategory.create({
          data: {
            organizationId: org,
            name: input.name,
            normalizedName: normalizedCategoryName(input.name),
            description: cleanText(input.description),
          },
        }),
      );
    } catch (error) {
      duplicate(error);
    }
  }

  async update(
    org: string,
    id: string,
    input: UpdateCategoryDto,
  ): Promise<ExpenseCategoryResponse> {
    try {
      await runSalesTransaction(this.prisma, async (tx) => {
        await inventoryLock(tx, categoryKey(org, id));
        const existing = await tx.expenseCategory.findFirst({ where: { organizationId: org, id } });
        if (!existing) throw new NotFoundException();
        await tx.expenseCategory.update({
          where: { id_organizationId: { id, organizationId: org } },
          data: {
            ...(input.name === undefined
              ? {}
              : { name: input.name, normalizedName: normalizedCategoryName(input.name) }),
            ...(input.description === undefined
              ? {}
              : { description: cleanText(input.description) }),
            ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
          },
        });
      });
    } catch (error) {
      duplicate(error);
    }
    return this.get(org, id);
  }
}
