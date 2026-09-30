import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Permission, type AdjustmentReason, type InventoryTransactionType } from '@saas/types';
import type { OrganizationContext } from '../auth/auth-context.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { InventoryTransactionsService } from './transactions.service.js';
import {
  inventoryConflict,
  inventoryLock,
  resourceKey,
  stockKey,
  type InventoryTx,
} from './inventory-locks.js';
import type { AdjustmentDto, NoteDto, OpeningBalanceDto, TransferDto } from './inventory.dto.js';

type Entry = { locationId: string; variantId: string; delta: Prisma.Decimal };
const maximum = new Prisma.Decimal('9999999999999.999999');
const normalizedNote = (value: string | null | undefined) => value?.trim() || null;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function quantity(value: string) {
  const result = new Prisma.Decimal(value);
  if (!result.isFinite() || !result.gt(0) || result.gt(maximum))
    throw new BadRequestException('Quantity must be a positive numeric(19,6) decimal');
  return result;
}
@Injectable()
export class InventoryCommandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: InventoryTransactionsService,
  ) {}
  opening(org: string, actor: string, key: string, input: OpeningBalanceDto) {
    const amount = quantity(input.quantity);
    return this.execute(
      org,
      actor,
      key,
      'OPENING_BALANCE',
      input.note,
      null,
      hash([
        'OPENING_BALANCE',
        input.locationId,
        input.variantId,
        amount.toFixed(6),
        normalizedNote(input.note),
      ]),
      [{ locationId: input.locationId, variantId: input.variantId, delta: amount }],
    );
  }
  adjustment(org: string, actor: string, key: string, input: AdjustmentDto) {
    const amount = quantity(input.quantity);
    return this.execute(
      org,
      actor,
      key,
      'ADJUSTMENT',
      input.note,
      input.reason,
      hash([
        'ADJUSTMENT',
        input.locationId,
        input.variantId,
        input.direction,
        amount.toFixed(6),
        input.reason,
        normalizedNote(input.note),
      ]),
      [
        {
          locationId: input.locationId,
          variantId: input.variantId,
          delta: input.direction === 'INCREASE' ? amount : amount.negated(),
        },
      ],
    );
  }
  transfer(org: string, actor: string, key: string, input: TransferDto) {
    if (input.sourceLocationId === input.destinationLocationId)
      throw new BadRequestException('Choose different source and destination locations');
    const amount = quantity(input.quantity);
    return this.execute(
      org,
      actor,
      key,
      'TRANSFER',
      input.note,
      null,
      hash([
        'TRANSFER',
        input.sourceLocationId,
        input.destinationLocationId,
        input.variantId,
        amount.toFixed(6),
        normalizedNote(input.note),
      ]),
      [
        { locationId: input.sourceLocationId, variantId: input.variantId, delta: amount.negated() },
        { locationId: input.destinationLocationId, variantId: input.variantId, delta: amount },
      ],
    );
  }
  async reverse(
    context: OrganizationContext,
    actor: string,
    key: string,
    id: string,
    input: NoteDto,
  ) {
    const org = context.organizationId;
    const original = await this.prisma.inventoryTransaction.findFirst({
      where: { organizationId: org, id },
      include: { entries: { take: 2 } },
    });
    if (!original) throw new NotFoundException();
    const permission =
      original.type === 'TRANSFER' ? Permission.INVENTORY_TRANSFER : Permission.INVENTORY_ADJUST;
    if (!context.permissions.includes(permission)) throw new ForbiddenException();
    if (original.type === 'REVERSAL') inventoryConflict('INVENTORY_REVERSAL_NOT_ALLOWED');
    return this.execute(
      org,
      actor,
      key,
      'REVERSAL',
      input.note,
      null,
      hash(['REVERSAL', original.id, normalizedNote(input.note)]),
      original.entries.map((entry) => ({
        locationId: entry.locationId,
        variantId: entry.variantId,
        delta: entry.quantityDelta.negated(),
      })),
      original.id,
    );
  }
  private async execute(
    org: string,
    actor: string,
    key: string,
    type: InventoryTransactionType,
    note: string | null | undefined,
    reason: AdjustmentReason | null,
    requestHash: string,
    entries: Entry[],
    reversesTransactionId?: string,
  ) {
    const id = await this.prisma.$transaction(
      async (tx) => {
        await inventoryLock(tx, `inventory:idempotency:${org.toLowerCase()}:${key}`);
        const existing = await tx.inventoryTransaction.findUnique({
          where: { organizationId_idempotencyKey: { organizationId: org, idempotencyKey: key } },
        });
        if (existing) {
          if (existing.requestHash !== requestHash) inventoryConflict('IDEMPOTENCY_KEY_CONFLICT');
          return existing.id;
        }
        await this.resources(tx, org, entries);
        for (const lock of [
          ...new Set(entries.map((entry) => stockKey(org, entry.locationId, entry.variantId))),
        ].sort())
          await inventoryLock(tx, lock);
        if (
          reversesTransactionId &&
          (await tx.inventoryTransaction.findFirst({
            where: { organizationId: org, reversesTransactionId },
            select: { id: true },
          }))
        )
          inventoryConflict('INVENTORY_TRANSACTION_ALREADY_REVERSED');
        const settings = await tx.inventorySettings.findUniqueOrThrow({
          where: { organizationId: org },
        });
        const balances: Array<Entry & { quantity: Prisma.Decimal }> = [];
        for (const entry of entries) {
          const where = {
            organizationId: org,
            locationId: entry.locationId,
            variantId: entry.variantId,
          };
          if (
            type === 'OPENING_BALANCE' &&
            (await tx.inventoryLedgerEntry.findFirst({ where, select: { id: true } }))
          )
            inventoryConflict('OPENING_BALANCE_ALREADY_INITIALIZED');
          const balance = await tx.inventoryBalance.findUnique({
            where: { organizationId_locationId_variantId: where },
          });
          const next = (balance?.quantity ?? new Prisma.Decimal(0)).plus(entry.delta);
          if (next.abs().gt(maximum)) inventoryConflict('INVENTORY_QUANTITY_OVERFLOW');
          if (!settings.allowNegativeStock && next.lt(0)) inventoryConflict('INSUFFICIENT_STOCK');
          balances.push({ ...entry, quantity: next });
        }
        const transaction = await tx.inventoryTransaction.create({
          data: {
            organizationId: org,
            type,
            createdByUserId: actor,
            idempotencyKey: key,
            requestHash,
            note: normalizedNote(note),
            reason,
            reversesTransactionId,
          },
        });
        for (const entry of balances) {
          const where = {
            organizationId: org,
            locationId: entry.locationId,
            variantId: entry.variantId,
          };
          await tx.inventoryLedgerEntry.create({
            data: { ...where, transactionId: transaction.id, quantityDelta: entry.delta },
          });
          await tx.inventoryBalance.upsert({
            where: { organizationId_locationId_variantId: where },
            create: { ...where, quantity: entry.quantity },
            update: { quantity: entry.quantity },
          });
        }
        return transaction.id;
      },
      {
        maxWait: 10000,
        timeout: 15000,
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      },
    );
    return this.transactions.get(org, id);
  }
  private async resources(tx: InventoryTx, org: string, entries: Entry[]) {
    const variantIds = [...new Set(entries.map((entry) => entry.variantId))];
    const locationIds = [...new Set(entries.map((entry) => entry.locationId))];
    const initial = await tx.catalogVariant.findMany({
      where: { organizationId: org, id: { in: variantIds } },
      select: { catalogItemId: true },
    });
    const keys = [
      resourceKey(org, 'settings'),
      ...initial.map((row) => resourceKey(org, 'item', row.catalogItemId)),
      ...variantIds.map((id) => resourceKey(org, 'variant', id)),
      ...locationIds.map((id) => resourceKey(org, 'location', id)),
    ];
    for (const key of [...new Set(keys)].sort()) await inventoryLock(tx, key, true);
    const variants = await tx.catalogVariant.findMany({
      where: { organizationId: org, id: { in: variantIds } },
      include: { item: true },
    });
    const locations = await tx.location.findMany({
      where: { organizationId: org, id: { in: locationIds } },
    });
    if (variants.length !== variantIds.length || locations.length !== locationIds.length)
      throw new NotFoundException();
    if (variants.some((variant) => variant.item.type !== 'PRODUCT' || !variant.item.trackInventory))
      inventoryConflict('INVENTORY_TRACKING_DISABLED');
    if (
      variants.some((variant) => !variant.isActive || !variant.item.isActive) ||
      locations.some((location) => !location.isActive)
    )
      inventoryConflict('INVENTORY_RESOURCE_INACTIVE');
  }
}
