import { createHash } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { InventoryCommandsService } from '../inventory/commands.service.js';
import {
  inventoryConflict,
  inventoryLock,
  type InventoryTx,
} from '../inventory/inventory-locks.js';
import { decimal, money } from '../sales/totals.js';
import { runSalesTransaction } from '../sales/sales-transaction.js';
import { cleanText } from '../sales/payments.service.js';
import type {
  CreatePurchaseDto,
  CreateReceiptDto,
  PurchaseItemDto,
  UpdatePurchaseDto,
} from './purchasing.dto.js';
import { activeSupplier } from './suppliers.service.js';
import { PurchasingQueryService } from './query.service.js';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const maxQuantity = decimal('9999999999999.999999');
function quantity(value: string) {
  const result = decimal(value);
  if (!result.isFinite() || !result.gt(0) || result.gt(maxQuantity))
    throw new BadRequestException('Quantity must be positive numeric(19,6)');
  return result;
}
function cost(value: string) {
  const result = decimal(value);
  if (!result.isFinite() || result.lt(0))
    throw new BadRequestException('Unit cost must be non-negative');
  return money(result);
}
function normalizedItems(items: PurchaseItemDto[]) {
  return items
    .map((i) => ({
      variantId: i.variantId,
      orderedQuantity: quantity(i.orderedQuantity).toFixed(6),
      unitCost: cost(i.unitCost).toFixed(4),
    }))
    .sort((a, b) => a.variantId.localeCompare(b.variantId));
}
async function lockedPurchase(tx: InventoryTx, org: string, id: string) {
  await inventoryLock(tx, `purchasing:order:${org}:${id}`);
  const row = await tx.purchaseOrder.findFirst({ where: { organizationId: org, id } });
  if (!row) throw new NotFoundException();
  return row;
}
@Injectable()
export class PurchasingOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryCommandsService,
    private readonly queries: PurchasingQueryService,
  ) {}

  private async lines(
    tx: InventoryTx,
    org: string,
    inputs: PurchaseItemDto[],
    locationId?: string,
  ) {
    if (new Set(inputs.map((i) => i.variantId)).size !== inputs.length)
      throw new BadRequestException('Duplicate variantId');
    const variants = await this.inventory.lockResources(
      tx,
      org,
      inputs.map((i) => i.variantId),
      locationId ? [locationId] : [],
    );
    if (variants.some((v) => v.item.type !== 'PRODUCT'))
      throw new BadRequestException('Only PRODUCT variants can be purchased');
    const byId = new Map(variants.map((v) => [v.id, v]));
    let subtotal = decimal(0);
    const data = inputs.map((input) => {
      const v = byId.get(input.variantId)!;
      const orderedQuantity = quantity(input.orderedQuantity),
        unitCost = cost(input.unitCost);
      const lineTotal = money(orderedQuantity.times(unitCost));
      subtotal = subtotal.plus(lineTotal);
      return {
        organizationId: org,
        variantId: v.id,
        orderedQuantity,
        unitCost,
        lineTotal,
        snapshotItemName: v.item.name,
        snapshotVariantName: v.name,
        snapshotSku: v.sku,
        snapshotUnit: v.unit,
      };
    });
    return { data, subtotal: money(subtotal) };
  }

  async create(org: string, actor: string, key: string, input: CreatePurchaseDto) {
    const normalized = {
      supplierId: input.supplierId,
      destinationLocationId: input.destinationLocationId,
      note: cleanText(input.note),
      items: normalizedItems(input.items),
    };
    const requestHash = hash(normalized);
    const id = await runSalesTransaction(this.prisma, async (tx) => {
      await inventoryLock(tx, `purchasing:create-key:${org}:${key}`);
      const existing = await tx.purchaseOrder.findUnique({
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
      await activeSupplier(tx, org, input.supplierId);
      const variants = await this.lines(tx, org, input.items, input.destinationLocationId);
      const organization = await tx.organization.findUniqueOrThrow({ where: { id: org } });
      const sequence = await tx.purchaseSequence.upsert({
        where: { organizationId: org },
        create: { organizationId: org, lastNumber: 1 },
        update: { lastNumber: { increment: 1 } },
      });
      const order = await tx.purchaseOrder.create({
        data: {
          organizationId: org,
          createdByUserId: actor,
          sequenceNumber: sequence.lastNumber,
          supplierId: input.supplierId,
          destinationLocationId: input.destinationLocationId,
          currencyCode: organization.defaultCurrency,
          note: normalized.note,
          subtotal: variants.subtotal,
          total: variants.subtotal,
          creationIdempotencyKey: key,
          creationRequestHash: requestHash,
        },
      });
      if (variants.data.length)
        await tx.purchaseOrderItem.createMany({
          data: variants.data.map((line) => ({ ...line, purchaseOrderId: order.id })),
        });
      return order.id;
    });
    return this.queries.get(org, id);
  }

  async update(org: string, id: string, input: UpdatePurchaseDto) {
    await runSalesTransaction(this.prisma, async (tx) => {
      const row = await lockedPurchase(tx, org, id);
      if (row.status !== 'DRAFT') inventoryConflict('PURCHASE_ORDER_NOT_EDITABLE');
      if (input.supplierId) await activeSupplier(tx, org, input.supplierId);
      if (input.destinationLocationId)
        await this.inventory.lockResources(tx, org, [], [input.destinationLocationId]);
      await tx.purchaseOrder.update({
        where: { id_organizationId: { id, organizationId: org } },
        data: {
          supplierId: input.supplierId,
          destinationLocationId: input.destinationLocationId,
          ...(input.note !== undefined ? { note: cleanText(input.note) } : {}),
        },
      });
    });
    return this.queries.get(org, id);
  }

  async replace(org: string, id: string, items: PurchaseItemDto[]) {
    await runSalesTransaction(this.prisma, async (tx) => {
      const row = await lockedPurchase(tx, org, id);
      if (row.status !== 'DRAFT') inventoryConflict('PURCHASE_ORDER_NOT_EDITABLE');
      const lines = await this.lines(tx, org, items);
      await tx.purchaseOrderItem.deleteMany({
        where: { organizationId: org, purchaseOrderId: id },
      });
      if (lines.data.length)
        await tx.purchaseOrderItem.createMany({
          data: lines.data.map((line) => ({ ...line, purchaseOrderId: id })),
        });
      await tx.purchaseOrder.update({
        where: { id_organizationId: { id, organizationId: org } },
        data: { subtotal: lines.subtotal, total: lines.subtotal },
      });
    });
    return this.queries.get(org, id);
  }

  async order(org: string, id: string, key: string) {
    const commandHash = hash(['ORDER', id]);
    await runSalesTransaction(this.prisma, async (tx) => {
      await inventoryLock(tx, `purchasing:order-key:${org}:${key}`);
      const row = await lockedPurchase(tx, org, id);
      const existing = await tx.purchaseOrder.findUnique({
        where: {
          organizationId_orderingIdempotencyKey: {
            organizationId: org,
            orderingIdempotencyKey: key,
          },
        },
      });
      if (existing) {
        if (existing.id !== id || existing.orderingRequestHash !== commandHash)
          inventoryConflict('IDEMPOTENCY_KEY_CONFLICT');
        return;
      }
      if (row.status !== 'DRAFT') inventoryConflict('PURCHASE_ORDER_ALREADY_ORDERED');
      await activeSupplier(tx, org, row.supplierId);
      const lines = await tx.purchaseOrderItem.findMany({
        where: { organizationId: org, purchaseOrderId: id },
      });
      if (!lines.length) throw new BadRequestException('At least one item is required');
      const variants = await this.inventory.lockResources(
        tx,
        org,
        lines.map((l) => l.variantId),
        [row.destinationLocationId],
      );
      const byId = new Map(variants.map((v) => [v.id, v]));
      let subtotal = decimal(0);
      for (const line of lines) {
        const v = byId.get(line.variantId)!;
        if (v.item.type !== 'PRODUCT' || v.unit !== line.snapshotUnit)
          inventoryConflict('PURCHASE_VARIANT_INVALID');
        const expected = money(decimal(line.orderedQuantity).times(line.unitCost));
        if (!expected.eq(line.lineTotal)) inventoryConflict('PURCHASE_TOTAL_MISMATCH');
        subtotal = subtotal.plus(expected);
      }
      if (!money(subtotal).eq(row.subtotal) || !row.total.eq(row.subtotal))
        inventoryConflict('PURCHASE_TOTAL_MISMATCH');
      await tx.purchaseOrder.update({
        where: { id_organizationId: { id, organizationId: org } },
        data: {
          status: 'ORDERED',
          orderedAt: new Date(),
          orderingIdempotencyKey: key,
          orderingRequestHash: commandHash,
        },
      });
    });
    return this.queries.get(org, id);
  }

  async cancel(org: string, id: string) {
    await runSalesTransaction(this.prisma, async (tx) => {
      const row = await lockedPurchase(tx, org, id);
      if (
        !['DRAFT', 'ORDERED'].includes(row.status) ||
        (await tx.goodsReceipt.count({ where: { organizationId: org, purchaseOrderId: id } }))
      )
        inventoryConflict('PURCHASE_ORDER_NOT_CANCELLABLE');
      await tx.purchaseOrder.update({
        where: { id_organizationId: { id, organizationId: org } },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
    });
    return this.queries.get(org, id);
  }

  async receive(org: string, actor: string, id: string, key: string, input: CreateReceiptDto) {
    if (new Set(input.items.map((i) => i.purchaseOrderItemId)).size !== input.items.length)
      throw new BadRequestException('Duplicate purchaseOrderItemId');
    const normalized = {
      orderId: id,
      note: cleanText(input.note),
      items: input.items
        .map((i) => ({
          purchaseOrderItemId: i.purchaseOrderItemId,
          quantity: quantity(i.quantity).toFixed(6),
        }))
        .sort((a, b) => a.purchaseOrderItemId.localeCompare(b.purchaseOrderItemId)),
    };
    const requestHash = hash(normalized);
    const receiptId = await runSalesTransaction(this.prisma, async (tx) => {
      await inventoryLock(tx, `purchasing:receipt-key:${org}:${key}`);
      const existing = await tx.goodsReceipt.findUnique({
        where: { organizationId_idempotencyKey: { organizationId: org, idempotencyKey: key } },
      });
      if (existing) {
        if (existing.requestHash !== requestHash) inventoryConflict('IDEMPOTENCY_KEY_CONFLICT');
        return existing.id;
      }
      const row = await lockedPurchase(tx, org, id);
      if (row.status !== 'ORDERED' && row.status !== 'PARTIALLY_RECEIVED')
        inventoryConflict('PURCHASE_ORDER_NOT_RECEIVABLE');
      const lines = await tx.purchaseOrderItem.findMany({
        where: { organizationId: org, purchaseOrderId: id },
      });
      const byId = new Map(lines.map((line) => [line.id, line]));
      if (normalized.items.some((i) => !byId.has(i.purchaseOrderItemId)))
        throw new NotFoundException();
      const variants = await this.inventory.lockResources(
        tx,
        org,
        lines.map((l) => l.variantId),
        [row.destinationLocationId],
      );
      const variantMap = new Map(variants.map((v) => [v.id, v]));
      if (
        lines.some(
          (line) =>
            variantMap.get(line.variantId)?.item.type !== 'PRODUCT' ||
            variantMap.get(line.variantId)?.unit !== line.snapshotUnit,
        )
      )
        inventoryConflict('PURCHASE_VARIANT_INVALID');
      const sums = await tx.goodsReceiptItem.groupBy({
        by: ['purchaseOrderItemId'],
        where: { organizationId: org, purchaseOrderItemId: { in: lines.map((l) => l.id) } },
        _sum: { receivedQuantity: true },
      });
      const received = new Map(
        sums.map((sum) => [sum.purchaseOrderItemId, sum._sum.receivedQuantity ?? decimal(0)]),
      );
      for (const item of normalized.items) {
        const line = byId.get(item.purchaseOrderItemId)!;
        if (
          decimal(received.get(line.id) ?? 0)
            .plus(item.quantity)
            .gt(line.orderedQuantity)
        )
          inventoryConflict('RECEIPT_EXCEEDS_REMAINING_QUANTITY');
      }
      const sequence = await tx.goodsReceiptSequence.upsert({
        where: { organizationId: org },
        create: { organizationId: org, lastNumber: 1 },
        update: { lastNumber: { increment: 1 } },
      });
      const receipt = await tx.goodsReceipt.create({
        data: {
          organizationId: org,
          purchaseOrderId: id,
          sequenceNumber: sequence.lastNumber,
          createdByUserId: actor,
          note: normalized.note,
          idempotencyKey: key,
          requestHash,
        },
      });
      await tx.goodsReceiptItem.createMany({
        data: normalized.items.map((item) => {
          const line = byId.get(item.purchaseOrderItemId)!;
          return {
            organizationId: org,
            goodsReceiptId: receipt.id,
            purchaseOrderItemId: line.id,
            variantId: line.variantId,
            receivedQuantity: decimal(item.quantity),
            snapshotUnit: line.snapshotUnit,
          };
        }),
      });
      const entries = normalized.items.flatMap((item) => {
        const line = byId.get(item.purchaseOrderItemId)!;
        return variantMap.get(line.variantId)!.item.trackInventory
          ? [
              {
                locationId: row.destinationLocationId,
                variantId: line.variantId,
                delta: decimal(item.quantity),
              },
            ]
          : [];
      });
      await this.inventory.recordPurchaseReceipt(tx, org, actor, receipt.id, entries);
      const complete = lines.every((line) => {
        const now =
          normalized.items.find((i) => i.purchaseOrderItemId === line.id)?.quantity ?? '0';
        return decimal(received.get(line.id) ?? 0)
          .plus(now)
          .eq(line.orderedQuantity);
      });
      await tx.purchaseOrder.update({
        where: { id_organizationId: { id, organizationId: org } },
        data: {
          status: complete ? 'RECEIVED' : 'PARTIALLY_RECEIVED',
          completedAt: complete ? new Date() : null,
        },
      });
      return receipt.id;
    });
    return this.queries.receipt(org, receiptId);
  }
}
