import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { ExpenseListItem, ExpenseResponse, PageResponse } from '@saas/types';
import type { Expense } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { validBusinessDate, type ExpenseQueryDto } from './expenses.dto.js';

type ExpenseRow = Expense & {
  category: { id: string; name: string; isActive: boolean };
  location: { id: string; name: string; isActive: boolean } | null;
};
type ExpenseCursor = { date: Date; createdAt: Date; id: string };
function decode(value?: string): ExpenseCursor | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object') throw new Error();
    const data = parsed as Record<string, unknown>;
    if (
      !validBusinessDate(data.date) ||
      typeof data.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(data.createdAt)) ||
      typeof data.id !== 'string' ||
      !isUUID(data.id)
    )
      throw new Error();
    return {
      date: new Date(`${data.date}T00:00:00.000Z`),
      createdAt: new Date(data.createdAt),
      id: data.id,
    };
  } catch {
    throw new BadRequestException('Invalid cursor');
  }
}
const encode = (row: Expense) =>
  Buffer.from(
    JSON.stringify({
      date: row.expenseDate.toISOString().slice(0, 10),
      createdAt: row.createdAt.toISOString(),
      id: row.id,
    }),
  ).toString('base64url');
const date = (value?: string) => (value ? new Date(`${value}T00:00:00.000Z`) : undefined);

function summary(row: ExpenseRow): ExpenseListItem {
  return {
    id: row.id,
    sequenceNumber: row.sequenceNumber,
    number: `EXP-${String(row.sequenceNumber).padStart(6, '0')}`,
    status: row.status,
    category: row.category,
    location: row.location,
    expenseDate: row.expenseDate.toISOString().slice(0, 10),
    amount: row.amount.toFixed(4),
    currencyCode: row.currencyCode,
    paymentMethod: row.paymentMethod,
    payeeName: row.payeeName,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class ExpensesQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(org: string, q: ExpenseQueryDto): Promise<PageResponse<ExpenseListItem>> {
    if (q.from && q.to && q.from > q.to) throw new BadRequestException('from must not exceed to');
    const cursor = decode(q.cursor);
    const number = q.q?.replace(/^EXP-/i, '').replace(/^0+(?=\d)/, '');
    const rows = await this.prisma.expense.findMany({
      where: {
        organizationId: org,
        status: q.status,
        categoryId: q.categoryId,
        locationId: q.locationId,
        paymentMethod: q.paymentMethod,
        expenseDate: { gte: date(q.from), lte: date(q.to) },
        AND: [
          ...(cursor
            ? [
                {
                  OR: [
                    { expenseDate: { lt: cursor.date } },
                    { expenseDate: cursor.date, createdAt: { lt: cursor.createdAt } },
                    {
                      expenseDate: cursor.date,
                      createdAt: cursor.createdAt,
                      id: { lt: cursor.id },
                    },
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
                    { payeeName: { contains: q.q, mode: 'insensitive' as const } },
                    { description: { contains: q.q, mode: 'insensitive' as const } },
                    { note: { contains: q.q, mode: 'insensitive' as const } },
                  ],
                },
              ]
            : []),
        ],
      },
      include: {
        category: { select: { id: true, name: true, isActive: true } },
        location: { select: { id: true, name: true, isActive: true } },
      },
      orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    const last = rows[q.limit - 1];
    return {
      items: rows.slice(0, q.limit).map(summary),
      nextCursor: rows.length > q.limit && last ? encode(last) : null,
    };
  }

  async get(org: string, id: string): Promise<ExpenseResponse> {
    const row = await this.prisma.expense.findFirst({
      where: { organizationId: org, id },
      include: {
        category: { select: { id: true, name: true, isActive: true } },
        location: { select: { id: true, name: true, isActive: true } },
      },
    });
    if (!row) throw new NotFoundException();
    return {
      ...summary(row),
      note: row.note,
      createdBy: { id: row.createdByUserId },
      updatedAt: row.updatedAt.toISOString(),
      postedAt: row.postedAt?.toISOString() ?? null,
      voidedAt: row.voidedAt?.toISOString() ?? null,
      voidedBy: row.voidedByUserId ? { id: row.voidedByUserId } : null,
      voidReason: row.voidReason,
    };
  }
}
