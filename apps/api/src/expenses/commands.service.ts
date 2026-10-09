import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  inventoryConflict,
  inventoryLock,
  resourceKey,
  type InventoryTx,
} from '../inventory/inventory-locks.js';
import { runSalesTransaction } from '../sales/sales-transaction.js';
import { cleanText } from '../sales/payments.service.js';
import { decimal, money } from '../sales/totals.js';
import { activeCategory } from './categories.service.js';
import { ExpensesQueryService } from './query.service.js';
import type { CreateExpenseDto, UpdateExpenseDto, VoidExpenseDto } from './expenses.dto.js';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const date = (value: string) => new Date(`${value}T00:00:00.000Z`);
const expenseKey = (org: string, id: string) => `expenses:expense:${org}:${id}`;
const commandKey = (org: string, kind: string, key: string) => `expenses:${kind}-key:${org}:${key}`;

function amount(value: string) {
  const result = money(decimal(value));
  if (!result.gt(0)) throw new BadRequestException('Expense amount must be positive');
  return result.toFixed(4);
}
function normalized(input: CreateExpenseDto) {
  return {
    categoryId: input.categoryId,
    locationId: input.locationId ?? null,
    expenseDate: input.expenseDate,
    amount: amount(input.amount),
    paymentMethod: input.paymentMethod,
    payeeName: cleanText(input.payeeName),
    description: cleanText(input.description),
    note: cleanText(input.note),
  };
}
async function activeLocation(tx: InventoryTx, org: string, id: string | null) {
  if (!id) return;
  await inventoryLock(tx, resourceKey(org, 'location', id), true);
  const row = await tx.location.findFirst({ where: { organizationId: org, id } });
  if (!row) throw new NotFoundException();
  if (!row.isActive) inventoryConflict('EXPENSE_LOCATION_INACTIVE');
}
async function lockedExpense(tx: InventoryTx, org: string, id: string) {
  await inventoryLock(tx, expenseKey(org, id));
  const row = await tx.expense.findFirst({ where: { organizationId: org, id } });
  if (!row) throw new NotFoundException();
  return row;
}

@Injectable()
export class ExpensesCommandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queries: ExpensesQueryService,
  ) {}

  async create(org: string, actor: string, key: string, input: CreateExpenseDto) {
    const payload = normalized(input),
      requestHash = hash(payload);
    const id = await runSalesTransaction(this.prisma, async (tx) => {
      await inventoryLock(tx, commandKey(org, 'create', key));
      const existing = await tx.expense.findUnique({
        where: {
          organizationId_creationIdempotencyKey: {
            organizationId: org,
            creationIdempotencyKey: key,
          },
        },
      });
      if (existing) {
        if (existing.creationRequestHash !== requestHash)
          inventoryConflict('IDEMPOTENCY_KEY_CONFLICT');
        return existing.id;
      }
      await activeCategory(tx, org, payload.categoryId);
      await activeLocation(tx, org, payload.locationId);
      const organization = await tx.organization.findUniqueOrThrow({ where: { id: org } });
      const sequence = await tx.expenseSequence.upsert({
        where: { organizationId: org },
        create: { organizationId: org, lastNumber: 1 },
        update: { lastNumber: { increment: 1 } },
      });
      const expense = await tx.expense.create({
        data: {
          organizationId: org,
          createdByUserId: actor,
          sequenceNumber: sequence.lastNumber,
          categoryId: payload.categoryId,
          locationId: payload.locationId,
          expenseDate: date(payload.expenseDate),
          amount: payload.amount,
          currencyCode: organization.defaultCurrency,
          paymentMethod: payload.paymentMethod,
          payeeName: payload.payeeName,
          description: payload.description,
          note: payload.note,
          creationIdempotencyKey: key,
          creationRequestHash: requestHash,
        },
      });
      return expense.id;
    });
    return this.queries.get(org, id);
  }

  async update(org: string, id: string, input: UpdateExpenseDto) {
    await runSalesTransaction(this.prisma, async (tx) => {
      const row = await lockedExpense(tx, org, id);
      if (row.status !== 'DRAFT') inventoryConflict('EXPENSE_NOT_EDITABLE');
      const categoryId = input.categoryId ?? row.categoryId;
      const locationId = input.locationId === undefined ? row.locationId : input.locationId;
      await activeCategory(tx, org, categoryId);
      await activeLocation(tx, org, locationId);
      await tx.expense.update({
        where: { id_organizationId: { id, organizationId: org } },
        data: {
          categoryId,
          locationId,
          ...(input.expenseDate === undefined ? {} : { expenseDate: date(input.expenseDate) }),
          ...(input.amount === undefined ? {} : { amount: amount(input.amount) }),
          ...(input.paymentMethod === undefined ? {} : { paymentMethod: input.paymentMethod }),
          ...(input.payeeName === undefined ? {} : { payeeName: cleanText(input.payeeName) }),
          ...(input.description === undefined ? {} : { description: cleanText(input.description) }),
          ...(input.note === undefined ? {} : { note: cleanText(input.note) }),
        },
      });
    });
    return this.queries.get(org, id);
  }

  async post(org: string, id: string, key: string) {
    const requestHash = hash(['POST', id]);
    await runSalesTransaction(this.prisma, async (tx) => {
      await inventoryLock(tx, commandKey(org, 'post', key));
      const existing = await tx.expense.findUnique({
        where: {
          organizationId_postingIdempotencyKey: {
            organizationId: org,
            postingIdempotencyKey: key,
          },
        },
      });
      if (existing) {
        if (existing.id !== id || existing.postingRequestHash !== requestHash)
          inventoryConflict('IDEMPOTENCY_KEY_CONFLICT');
        return;
      }
      const row = await lockedExpense(tx, org, id);
      if (row.status !== 'DRAFT') inventoryConflict('EXPENSE_ALREADY_POSTED');
      await activeCategory(tx, org, row.categoryId);
      await activeLocation(tx, org, row.locationId);
      if (
        !row.amount.isFinite() ||
        !row.amount.gt(0) ||
        !Number.isFinite(row.expenseDate.getTime()) ||
        !Intl.supportedValuesOf('currency').includes(row.currencyCode)
      )
        inventoryConflict('EXPENSE_NOT_POSTABLE');
      await tx.expense.update({
        where: { id_organizationId: { id, organizationId: org } },
        data: {
          status: 'POSTED',
          postedAt: new Date(),
          postingIdempotencyKey: key,
          postingRequestHash: requestHash,
        },
      });
    });
    return this.queries.get(org, id);
  }

  async void(org: string, actor: string, id: string, key: string, input: VoidExpenseDto) {
    const reason = cleanText(input.reason)!;
    const requestHash = hash(['VOID', id, reason]);
    await runSalesTransaction(this.prisma, async (tx) => {
      await inventoryLock(tx, commandKey(org, 'void', key));
      const existing = await tx.expense.findUnique({
        where: {
          organizationId_voidIdempotencyKey: {
            organizationId: org,
            voidIdempotencyKey: key,
          },
        },
      });
      if (existing) {
        if (existing.id !== id || existing.voidRequestHash !== requestHash)
          inventoryConflict('IDEMPOTENCY_KEY_CONFLICT');
        return;
      }
      const row = await lockedExpense(tx, org, id);
      if (row.status !== 'POSTED') inventoryConflict('EXPENSE_NOT_VOIDABLE');
      await tx.expense.update({
        where: { id_organizationId: { id, organizationId: org } },
        data: {
          status: 'VOIDED',
          voidedAt: new Date(),
          voidedByUserId: actor,
          voidReason: reason,
          voidIdempotencyKey: key,
          voidRequestHash: requestHash,
        },
      });
    });
    return this.queries.get(org, id);
  }
}
