import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  inventoryConflict,
  inventoryLock,
  type InventoryTx,
} from '../inventory/inventory-locks.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { PaymentDto } from './sales.dto.js';
import { decimal } from './totals.js';
import { lockedOrder, runSalesTransaction } from './sales-transaction.js';
import { paymentResponse } from './orders-query.service.js';
export const cleanText = (value: string | null | undefined) => value?.trim() || null;
export const requestHash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function normalizePayment(input: PaymentDto) {
  const amount = decimal(input.amount);
  if (!amount.gt(0)) throw new BadRequestException('Payment amount must be positive');
  return {
    method: input.method,
    amount: amount.toFixed(4),
    reference: cleanText(input.reference),
    note: cleanText(input.note),
  };
}
@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}
  async record(
    tx: InventoryTx,
    org: string,
    actor: string,
    orderId: string,
    input: ReturnType<typeof normalizePayment>,
    key: string = randomUUID(),
  ) {
    const order = await tx.salesOrder.findUniqueOrThrow({
      where: { id_organizationId: { id: orderId, organizationId: org } },
    });
    if (order.status !== 'COMPLETED') inventoryConflict('ORDER_NOT_COMPLETED');
    const paid = await tx.salesPayment.aggregate({
      where: { organizationId: org, salesOrderId: orderId },
      _sum: { amount: true },
      _count: true,
    });
    if (paid._count >= 1000) inventoryConflict('PAYMENT_LIMIT_REACHED');
    if (
      decimal(paid._sum.amount ?? 0)
        .plus(input.amount)
        .gt(order.total)
    )
      inventoryConflict('PAYMENT_EXCEEDS_OUTSTANDING');
    return tx.salesPayment.create({
      data: {
        organizationId: org,
        salesOrderId: orderId,
        createdByUserId: actor,
        ...input,
        idempotencyKey: key,
        requestHash: requestHash([orderId, input]),
      },
    });
  }
  async add(org: string, actor: string, orderId: string, key: string, input: PaymentDto) {
    const payment = normalizePayment(input),
      hash = requestHash([orderId, payment]);
    const row = await runSalesTransaction(this.prisma, async (tx) => {
      await inventoryLock(tx, `sales:payment-key:${org}:${key}`);
      await lockedOrder(tx, org, orderId);
      const existing = await tx.salesPayment.findUnique({
        where: { organizationId_idempotencyKey: { organizationId: org, idempotencyKey: key } },
      });
      if (existing) {
        if (existing.requestHash !== hash) inventoryConflict('IDEMPOTENCY_KEY_CONFLICT');
        return existing;
      }
      return this.record(tx, org, actor, orderId, payment, key);
    });
    return paymentResponse(row);
  }
}
