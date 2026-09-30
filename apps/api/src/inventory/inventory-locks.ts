import { ConflictException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';

export type InventoryTx = Prisma.TransactionClient;
export const resourceKey = (
  org: string,
  kind: 'item' | 'variant' | 'location' | 'settings',
  id = org,
) => `inventory:resource:${org.toLowerCase()}:${kind}:${id.toLowerCase()}`;
export const stockKey = (org: string, location: string, variant: string) =>
  `inventory:stock:${org.toLowerCase()}:${location.toLowerCase()}:${variant.toLowerCase()}`;
// Lock hierarchy: idempotency key -> shared resource gates (sorted) -> stock keys (sorted).
// Catalog/location/settings mutations take an exclusive gate, never a stock lock.
export async function inventoryLock(tx: InventoryTx, key: string, shared = false) {
  if (shared)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${key}::text, 0))`;
  else await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}::text, 0))`;
}
export function inventoryConflict(code: string): never {
  throw new ConflictException({ statusCode: 409, code, message: code });
}
export async function protectItem(
  tx: InventoryTx,
  org: string,
  itemId: string,
  stock: boolean,
  history: boolean,
) {
  await inventoryLock(tx, resourceKey(org, 'item', itemId));
  if (
    stock &&
    (await tx.inventoryBalance.findFirst({
      where: { organizationId: org, quantity: { not: 0 }, variant: { catalogItemId: itemId } },
      select: { id: true },
    }))
  )
    inventoryConflict('INVENTORY_STOCK_EXISTS');
  if (
    history &&
    (await tx.inventoryLedgerEntry.findFirst({
      where: { organizationId: org, variant: { catalogItemId: itemId } },
      select: { id: true },
    }))
  )
    inventoryConflict('INVENTORY_ITEM_TYPE_IMMUTABLE');
}
export async function protectVariant(
  tx: InventoryTx,
  org: string,
  variantId: string,
  stock: boolean,
  history: boolean,
) {
  await inventoryLock(tx, resourceKey(org, 'variant', variantId));
  // Per-location non-zero checks deliberately reject offsetting positive/negative stock too.
  if (
    stock &&
    (await tx.inventoryBalance.findFirst({
      where: { organizationId: org, variantId, quantity: { not: 0 } },
      select: { id: true },
    }))
  )
    inventoryConflict('INVENTORY_STOCK_EXISTS');
  if (
    history &&
    (await tx.inventoryLedgerEntry.findFirst({
      where: { organizationId: org, variantId },
      select: { id: true },
    }))
  )
    inventoryConflict('INVENTORY_UNIT_IMMUTABLE');
}
