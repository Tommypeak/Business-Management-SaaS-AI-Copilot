import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Permission } from '@saas/types';
import type { OrganizationContext } from '../auth/auth-context.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { InventoryCommandsService } from '../inventory/commands.service.js';
import {
  inventoryConflict,
  inventoryLock,
  type InventoryTx,
} from '../inventory/inventory-locks.js';
import { activeCustomer } from './customers.service.js';
import type {
  CompleteOrderDto,
  CreateOrderDto,
  OrderItemDto,
  OrderMetadataDto,
} from './sales.dto.js';
import { calculate, decimal } from './totals.js';
import { cleanText, normalizePayment, PaymentsService, requestHash } from './payments.service.js';
import { lockedOrder, runSalesTransaction } from './sales-transaction.js';
import { OrdersQueryService } from './orders-query.service.js';
@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryCommandsService,
    private readonly payments: PaymentsService,
    private readonly queries: OrdersQueryService,
  ) {}
  private async items(
    tx: InventoryTx,
    org: string,
    inputs: OrderItemDto[],
    locationId?: string | null,
  ) {
    const variants = await this.inventory.lockResources(
      tx,
      org,
      inputs.map((i) => i.variantId),
      locationId ? [locationId] : [],
    );
    const rows = inputs.map((input) => {
      const variant = variants.find((v) => v.id === input.variantId)!;
      return {
        organizationId: org,
        variantId: variant.id,
        quantity: decimal(input.quantity),
        unitPrice: decimal(variant.sellingPrice),
        discountAmount: decimal(input.discountAmount),
        snapshotItemName: variant.item.name,
        snapshotVariantName: variant.name,
        snapshotSku: variant.sku,
        snapshotUnit: variant.unit,
      };
    });
    const totals = calculate(rows);
    return {
      data: rows.map((row, i) => ({ ...row, lineTotal: totals.lines[i]! })),
      totals: {
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        total: totals.total,
      },
    };
  }
  async create(org: string, actor: string, key: string, input: CreateOrderDto) {
    const normalized = {
      customerId: input.customerId ?? null,
      locationId: input.locationId ?? null,
      note: cleanText(input.note),
      items: input.items
        .map((i) => ({
          variantId: i.variantId,
          quantity: decimal(i.quantity).toFixed(6),
          discountAmount: decimal(i.discountAmount).toFixed(4),
        }))
        .sort((a, b) => a.variantId.localeCompare(b.variantId)),
    };
    const hash = requestHash(normalized);
    const id = await runSalesTransaction(this.prisma, async (tx) => {
      await inventoryLock(tx, `sales:create-key:${org}:${key}`);
      const existing = await tx.salesOrder.findUnique({
        where: {
          organizationId_creationIdempotencyKey: {
            organizationId: org,
            creationIdempotencyKey: key,
          },
        },
      });
      if (existing) {
        if (existing.creationRequestHash !== hash) inventoryConflict('IDEMPOTENCY_KEY_CONFLICT');
        return existing.id;
      }
      if (normalized.customerId) await activeCustomer(tx, org, normalized.customerId);
      const lines = await this.items(tx, org, input.items, input.locationId);
      const organization = await tx.organization.findUniqueOrThrow({ where: { id: org } });
      const sequence = await tx.salesSequence.upsert({
        where: { organizationId: org },
        create: { organizationId: org, lastNumber: 1 },
        update: { lastNumber: { increment: 1 } },
      });
      const order = await tx.salesOrder.create({
        data: {
          organizationId: org,
          createdByUserId: actor,
          sequenceNumber: sequence.lastNumber,
          currencyCode: organization.defaultCurrency,
          customerId: normalized.customerId,
          locationId: normalized.locationId,
          note: normalized.note,
          ...lines.totals,
          creationIdempotencyKey: key,
          creationRequestHash: hash,
        },
      });
      if (lines.data.length)
        await tx.salesOrderItem.createMany({
          data: lines.data.map((row) => ({ ...row, salesOrderId: order.id })),
        });
      return order.id;
    });
    return this.queries.get(org, id);
  }
  async update(org: string, id: string, input: OrderMetadataDto) {
    await runSalesTransaction(this.prisma, async (tx) => {
      const order = await lockedOrder(tx, org, id);
      if (order.status !== 'DRAFT') inventoryConflict('ORDER_NOT_DRAFT');
      if (input.customerId) await activeCustomer(tx, org, input.customerId);
      if (input.locationId) await this.inventory.lockResources(tx, org, [], [input.locationId]);
      await tx.salesOrder.update({
        where: { id_organizationId: { id, organizationId: org } },
        data: { ...input, ...(input.note !== undefined ? { note: cleanText(input.note) } : {}) },
      });
    });
    return this.queries.get(org, id);
  }
  async replace(org: string, id: string, inputs: OrderItemDto[]) {
    await runSalesTransaction(this.prisma, async (tx) => {
      const order = await lockedOrder(tx, org, id);
      if (order.status !== 'DRAFT') inventoryConflict('ORDER_NOT_DRAFT');
      const lines = await this.items(tx, org, inputs);
      await tx.salesOrderItem.deleteMany({ where: { organizationId: org, salesOrderId: id } });
      if (lines.data.length)
        await tx.salesOrderItem.createMany({
          data: lines.data.map((row) => ({ ...row, salesOrderId: id })),
        });
      await tx.salesOrder.update({
        where: { id_organizationId: { id, organizationId: org } },
        data: lines.totals,
      });
    });
    return this.queries.get(org, id);
  }
  async cancel(org: string, id: string) {
    await runSalesTransaction(this.prisma, async (tx) => {
      const order = await lockedOrder(tx, org, id);
      if (order.status !== 'DRAFT') inventoryConflict('ORDER_NOT_DRAFT');
      await tx.salesOrder.update({
        where: { id_organizationId: { id, organizationId: org } },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
    });
    return this.queries.get(org, id);
  }
  async complete(
    context: OrganizationContext,
    actor: string,
    id: string,
    key: string,
    input: CompleteOrderDto,
  ) {
    const org = context.organizationId;
    if (input.payments.length && !context.permissions.includes(Permission.SALES_PAYMENTS_MANAGE))
      throw new ForbiddenException();
    const payments = input.payments.map(normalizePayment),
      hash = requestHash([id, payments]);
    await runSalesTransaction(this.prisma, async (tx) => {
      await inventoryLock(tx, `sales:complete-key:${org}:${key}`);
      const order = await lockedOrder(tx, org, id);
      const existing = await tx.salesOrder.findUnique({
        where: {
          organizationId_completionIdempotencyKey: {
            organizationId: org,
            completionIdempotencyKey: key,
          },
        },
      });
      if (existing) {
        if (existing.completionRequestHash !== hash) inventoryConflict('IDEMPOTENCY_KEY_CONFLICT');
        return;
      }
      if (order.status !== 'DRAFT') inventoryConflict('ORDER_NOT_DRAFT');
      if (!order.locationId)
        throw new BadRequestException('Location is required to complete a sale');
      const lines = await tx.salesOrderItem.findMany({
        where: { organizationId: org, salesOrderId: id },
        orderBy: { variantId: 'asc' },
      });
      if (!lines.length) throw new BadRequestException('At least one item is required');
      const variants = await this.inventory.lockResources(
        tx,
        org,
        lines.map((l) => l.variantId),
        [order.locationId],
      );
      const totals = calculate(lines),
        entries = [];
      for (const line of lines) {
        const variant = variants.find((v) => v.id === line.variantId)!;
        if (variant.unit !== line.snapshotUnit) inventoryConflict('ORDER_UNIT_CHANGED');
        if (variant.item.type === 'PRODUCT' && variant.item.trackInventory) {
          entries.push({
            locationId: order.locationId,
            variantId: line.variantId,
            delta: decimal(line.quantity).negated(),
          });
          await tx.salesOrderItem.update({
            where: { id: line.id, organizationId: org },
            data: { stockDeducted: true },
          });
        }
      }
      await this.inventory.recordSale(tx, org, actor, id, entries);
      await tx.salesOrder.update({
        where: { id_organizationId: { id, organizationId: org } },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          completionIdempotencyKey: key,
          completionRequestHash: hash,
          subtotal: totals.subtotal,
          discountTotal: totals.discountTotal,
          total: totals.total,
        },
      });
      for (const payment of payments) await this.payments.record(tx, org, actor, id, payment);
    });
    return this.queries.get(org, id);
  }
}
