import { NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { inventoryLock, type InventoryTx } from '../inventory/inventory-locks.js';
// Key -> order -> customer -> sorted Inventory resource gates -> sorted stock keys.
// Sequence upsert occurs only in creation. No inventory operation acquires a sales order lock.
export async function lockedOrder(tx: InventoryTx, org: string, id: string) {
  await inventoryLock(tx, `sales:order:${org.toLowerCase()}:${id.toLowerCase()}`);
  const row = await tx.salesOrder.findFirst({ where: { organizationId: org, id } });
  if (!row) throw new NotFoundException();
  return row;
}
export const runSalesTransaction = <T>(
  prisma: PrismaService,
  work: (tx: InventoryTx) => Promise<T>,
) =>
  prisma.$transaction(work, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: 10000,
    timeout: 20000,
  });
