import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Permission } from '@saas/types';
import type { OrganizationContext } from '../auth/auth-context.js';
import { InventoryCommandsService } from '../inventory/commands.service.js';
import {
  inventoryConflict,
  inventoryLock,
  type InventoryTx,
} from '../inventory/inventory-locks.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { cleanText, requestHash } from '../sales/payments.service.js';
import { runSalesTransaction } from '../sales/sales-transaction.js';
import { decimal } from '../sales/totals.js';
import { position, quote, requireReturnPermission, returnOrder } from './return-calculation.js';
import { ReturnsQueryService } from './query.service.js';
import type {
  CancelReturnDto,
  CreateRefundDto,
  CreateReturnDto,
  PostReturnDto,
  ReturnItemDto,
  ReturnMetadataDto,
} from './returns.dto.js';
const normalizedItems = (items: ReturnItemDto[]) =>
  items
    .map((i) => ({
      ...i,
      quantity: decimal(i.quantity).toFixed(6),
      locationId: i.locationId ?? null,
    }))
    .sort((a, b) => a.salesOrderItemId.localeCompare(b.salesOrderItemId));
const responseContext = (ctx: OrganizationContext, finance: boolean): OrganizationContext => ({
  ...ctx,
  permissions: [
    ...ctx.permissions.filter((p) => p !== Permission.FINANCE_VIEW),
    ...(finance ? [Permission.FINANCE_VIEW] : []),
  ],
});
@Injectable()
export class ReturnsCommandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryCommandsService,
    private readonly queries: ReturnsQueryService,
  ) {}
  private async document(tx: InventoryTx, org: string, id: string) {
    const initial = await tx.salesReturn.findFirst({ where: { id, organizationId: org } });
    if (!initial) throw new NotFoundException();
    const order = await returnOrder(tx, org, initial.salesOrderId, this.prisma.sqlSchema);
    const doc = await tx.salesReturn.findFirstOrThrow({
      where: { id, organizationId: org },
      include: { items: { take: 100 } },
    });
    return { doc, order };
  }
  private async lines(
    tx: InventoryTx,
    org: string,
    returnId: string,
    order: Awaited<ReturnType<typeof returnOrder>>,
    inputs: ReturnItemDto[],
  ) {
    const calculated = await quote(tx, org, order, inputs);
    const locationIds = [...new Set(inputs.flatMap((i) => (i.locationId ? [i.locationId] : [])))];
    const count = await tx.location.count({
      where: { organizationId: org, id: { in: locationIds }, isActive: true },
    });
    if (count !== locationIds.length) throw new NotFoundException();
    await tx.salesReturnItem.createMany({
      data: calculated.lines.map((l) => ({
        organizationId: org,
        salesOrderId: order.id,
        salesReturnId: returnId,
        salesOrderItemId: l.source.id,
        quantity: l.quantity,
        restockDisposition: l.input.restockDisposition,
        locationId: l.input.locationId ?? null,
        refundAmount: l.credit,
        snapshotItemName: l.source.snapshotItemName,
        snapshotVariantName: l.source.snapshotVariantName,
        snapshotSku: l.source.snapshotSku,
        snapshotUnit: l.source.snapshotUnit,
        snapshotItemType: l.source.snapshotItemType,
      })),
    });
    return calculated;
  }
  async create(ctx: OrganizationContext, actor: string, key: string, input: CreateReturnDto) {
    const org = ctx.organizationId,
      items = normalizedItems(input.items),
      metadata = { reason: cleanText(input.reason), note: cleanText(input.note) },
      hash = requestHash([input.salesOrderId, metadata, items]);
    const result = await runSalesTransaction(this.prisma, async (tx) => {
      await inventoryLock(tx, `returns:create-key:${org}:${key}`);
      const finance = await requireReturnPermission(tx, org, actor, Permission.RETURNS_MANAGE);
      const existing = await tx.salesReturn.findUnique({
        where: {
          organizationId_creationIdempotencyKey: {
            organizationId: org,
            creationIdempotencyKey: key,
          },
        },
      });
      if (existing) {
        if (existing.creationRequestHash !== hash) inventoryConflict('IDEMPOTENCY_KEY_CONFLICT');
        return { id: existing.id, finance };
      }
      const order = await returnOrder(tx, org, input.salesOrderId, this.prisma.sqlSchema);
      const sequence = await tx.salesReturnSequence.upsert({
        where: { organizationId: org },
        create: { organizationId: org, lastNumber: 1 },
        update: { lastNumber: { increment: 1 } },
      });
      const row = await tx.salesReturn.create({
        data: {
          organizationId: org,
          salesOrderId: order.id,
          sequenceNumber: sequence.lastNumber,
          currencyCode: order.currencyCode,
          createdByUserId: actor,
          creationIdempotencyKey: key,
          creationRequestHash: hash,
          ...metadata,
        },
      });
      const calc = await this.lines(tx, org, row.id, order, items);
      await tx.salesReturn.update({
        where: { id: row.id },
        data: { totalRefundableAmount: calc.total },
      });
      return { id: row.id, finance };
    });
    return this.queries.get(responseContext(ctx, result.finance), result.id);
  }
  async update(
    ctx: OrganizationContext,
    actor: string,
    id: string,
    input: ReturnMetadataDto | { items: ReturnItemDto[] },
  ) {
    const result = await runSalesTransaction(this.prisma, async (tx) => {
      const finance = await requireReturnPermission(
        tx,
        ctx.organizationId,
        actor,
        Permission.RETURNS_MANAGE,
      );
      const { doc, order } = await this.document(tx, ctx.organizationId, id);
      if (doc.status !== 'DRAFT') inventoryConflict('RETURN_NOT_DRAFT');
      if ('items' in input) {
        await tx.salesReturnItem.deleteMany({
          where: { organizationId: ctx.organizationId, salesReturnId: id },
        });
        const calc = await this.lines(
          tx,
          ctx.organizationId,
          id,
          order,
          normalizedItems(input.items),
        );
        await tx.salesReturn.update({
          where: { id },
          data: { totalRefundableAmount: calc.total, revision: { increment: 1 } },
        });
      } else {
        await tx.salesReturn.update({
          where: { id },
          data: {
            ...(input.reason !== undefined ? { reason: cleanText(input.reason) } : {}),
            ...(input.note !== undefined ? { note: cleanText(input.note) } : {}),
            revision: { increment: 1 },
          },
        });
      }
      return finance;
    });
    return this.queries.get(responseContext(ctx, result), id);
  }
  async post(
    ctx: OrganizationContext,
    actor: string,
    id: string,
    key: string,
    input: PostReturnDto,
  ) {
    const org = ctx.organizationId,
      hash = requestHash([
        id,
        input.revision ?? null,
        input.expectedCredit === undefined ? null : decimal(input.expectedCredit).toFixed(4),
      ]);
    const finance = await runSalesTransaction(this.prisma, async (tx) => {
      await inventoryLock(tx, `returns:post-key:${org}:${key}`);
      const finance = await requireReturnPermission(tx, org, actor, Permission.RETURNS_MANAGE);
      if (!finance && input.expectedCredit !== undefined) throw new ForbiddenException();
      const used = await tx.salesReturn.findUnique({
        where: {
          organizationId_postingIdempotencyKey: { organizationId: org, postingIdempotencyKey: key },
        },
      });
      if (used) {
        if (used.id !== id || used.postingRequestHash !== hash)
          inventoryConflict('IDEMPOTENCY_KEY_CONFLICT');
        return finance;
      }
      const { doc, order } = await this.document(tx, org, id);
      if (doc.status !== 'DRAFT') inventoryConflict('RETURN_NOT_DRAFT');
      if (input.revision !== undefined && input.revision !== doc.revision)
        inventoryConflict('RETURN_CHANGED');
      const calc = await quote(
        tx,
        org,
        order,
        doc.items.map((i) => ({
          salesOrderItemId: i.salesOrderItemId,
          quantity: i.quantity.toFixed(6),
          restockDisposition: i.restockDisposition,
          locationId: i.locationId,
        })),
      );
      if (input.expectedCredit !== undefined && !calc.total.eq(input.expectedCredit))
        inventoryConflict('RETURN_QUOTE_CHANGED');
      const physical = calc.lines.filter((l) => l.restocked);
      const variants = await this.inventory.lockResources(
        tx,
        org,
        physical.map((l) => l.source.variantId),
        calc.lines.flatMap((l) => (l.input.locationId ? [l.input.locationId] : [])),
        true,
      );
      for (const line of physical)
        if (variants.find((v) => v.id === line.source.variantId)?.unit !== line.source.snapshotUnit)
          inventoryConflict('RETURN_UNIT_CHANGED');
      for (const line of calc.lines)
        await tx.salesReturnItem.update({
          where: {
            salesReturnId_salesOrderItemId: { salesReturnId: id, salesOrderItemId: line.source.id },
          },
          data: { refundAmount: line.credit, stockRestocked: line.restocked },
        });
      await this.inventory.recordSaleReturn(
        tx,
        org,
        actor,
        id,
        physical.map((l) => ({
          locationId: l.input.locationId!,
          variantId: l.source.variantId,
          delta: l.quantity,
        })),
      );
      await tx.salesReturn.update({
        where: { id },
        data: {
          status: 'POSTED',
          postedAt: new Date(),
          postedByUserId: actor,
          totalRefundableAmount: calc.total,
          postingIdempotencyKey: key,
          postingRequestHash: hash,
          revision: { increment: 1 },
        },
      });
      return finance;
    });
    return this.queries.get(responseContext(ctx, finance), id);
  }
  async cancel(
    ctx: OrganizationContext,
    actor: string,
    id: string,
    key: string,
    input: CancelReturnDto,
  ) {
    const org = ctx.organizationId,
      reason = cleanText(input.reason),
      hash = requestHash([id, reason]);
    const finance = await runSalesTransaction(this.prisma, async (tx) => {
      await inventoryLock(tx, `returns:cancel-key:${org}:${key}`);
      const finance = await requireReturnPermission(tx, org, actor, Permission.RETURNS_MANAGE);
      const used = await tx.salesReturn.findUnique({
        where: {
          organizationId_cancellationIdempotencyKey: {
            organizationId: org,
            cancellationIdempotencyKey: key,
          },
        },
      });
      if (used) {
        if (used.id !== id || used.cancellationRequestHash !== hash)
          inventoryConflict('IDEMPOTENCY_KEY_CONFLICT');
        return finance;
      }
      const { doc } = await this.document(tx, org, id);
      if (doc.status !== 'DRAFT') inventoryConflict('RETURN_NOT_DRAFT');
      await tx.salesReturn.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelledByUserId: actor,
          cancelReason: reason,
          cancellationIdempotencyKey: key,
          cancellationRequestHash: hash,
          revision: { increment: 1 },
        },
      });
      return finance;
    });
    return this.queries.get(responseContext(ctx, finance), id);
  }
  async refund(ctx: OrganizationContext, actor: string, key: string, input: CreateRefundDto) {
    const org = ctx.organizationId,
      amount = decimal(input.amount);
    const allocations = input.allocations
      .map((a) => ({ ...a, allocatedAmount: decimal(a.allocatedAmount).toFixed(4) }))
      .sort((a, b) => a.salesReturnId.localeCompare(b.salesReturnId));
    if (
      !amount.gt(0) ||
      allocations.some((a) => !decimal(a.allocatedAmount).gt(0)) ||
      !allocations.reduce((sum, a) => sum.plus(a.allocatedAmount), decimal(0)).eq(amount)
    )
      throw new BadRequestException('Positive allocations must equal refund amount');
    const normalized = {
        salesOrderId: input.salesOrderId,
        amount: amount.toFixed(4),
        paymentMethod: input.paymentMethod,
        paymentDate: input.paymentDate,
        reference: cleanText(input.reference),
        note: cleanText(input.note),
      },
      hash = requestHash([normalized, allocations]);
    const result = await runSalesTransaction(this.prisma, async (tx) => {
      await inventoryLock(tx, `refunds:key:${org}:${key}`);
      const finance = await requireReturnPermission(tx, org, actor, Permission.REFUNDS_MANAGE);
      const existing = await tx.customerRefund.findUnique({
        where: { organizationId_idempotencyKey: { organizationId: org, idempotencyKey: key } },
      });
      if (existing) {
        if (existing.requestHash !== hash) inventoryConflict('IDEMPOTENCY_KEY_CONFLICT');
        return { id: existing.id, finance };
      }
      const order = await returnOrder(tx, org, input.salesOrderId, this.prisma.sqlSchema),
        pos = await position(tx, org, order.id, order.total);
      if (amount.gt(pos.cash)) inventoryConflict('REFUND_EXCEEDS_COLLECTED_AMOUNT');
      const returns = await tx.salesReturn.findMany({
        where: {
          organizationId: org,
          salesOrderId: order.id,
          status: 'POSTED',
          id: { in: allocations.map((a) => a.salesReturnId) },
        },
        take: 100,
      });
      if (returns.length !== allocations.length) throw new NotFoundException();
      const prior = await tx.refundAllocation.groupBy({
        by: ['salesReturnId'],
        where: {
          organizationId: org,
          salesReturnId: { in: allocations.map((a) => a.salesReturnId) },
        },
        _sum: { allocatedAmount: true },
      });
      for (const a of allocations) {
        const credit = returns.find((r) => r.id === a.salesReturnId)!;
        const old =
          prior.find((r) => r.salesReturnId === a.salesReturnId)?._sum.allocatedAmount ?? 0;
        if (decimal(old).plus(a.allocatedAmount).gt(credit.totalRefundableAmount))
          inventoryConflict('REFUND_EXCEEDS_RETURN_CREDIT');
      }
      const sequence = await tx.customerRefundSequence.upsert({
        where: { organizationId: org },
        create: { organizationId: org, lastNumber: 1 },
        update: { lastNumber: { increment: 1 } },
      });
      const refund = await tx.customerRefund.create({
        data: {
          ...normalized,
          paymentDate: new Date(`${input.paymentDate}T00:00:00.000Z`),
          organizationId: org,
          sequenceNumber: sequence.lastNumber,
          currencyCode: order.currencyCode,
          createdByUserId: actor,
          idempotencyKey: key,
          requestHash: hash,
        },
      });
      await tx.refundAllocation.createMany({
        data: allocations.map((a) => ({
          ...a,
          organizationId: org,
          salesOrderId: order.id,
          customerRefundId: refund.id,
        })),
      });
      return { id: refund.id, finance };
    });
    return this.queries.refund(responseContext(ctx, result.finance), result.id);
  }
}
