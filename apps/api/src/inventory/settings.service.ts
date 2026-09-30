import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { inventoryConflict, inventoryLock, resourceKey } from './inventory-locks.js';
import type { InventorySettingsDto } from './inventory.dto.js';

@Injectable()
export class InventorySettingsService {
  constructor(private readonly prisma: PrismaService) {}
  get(org: string) {
    return this.prisma.inventorySettings.findUniqueOrThrow({
      where: { organizationId: org },
      select: { allowNegativeStock: true },
    });
  }
  update(org: string, input: InventorySettingsDto) {
    return this.prisma.$transaction(async (tx) => {
      await inventoryLock(tx, resourceKey(org, 'settings'));
      if (
        !input.allowNegativeStock &&
        (await tx.inventoryBalance.findFirst({
          where: { organizationId: org, quantity: { lt: 0 } },
          select: { id: true },
        }))
      )
        inventoryConflict('INVENTORY_NEGATIVE_STOCK_EXISTS');
      return tx.inventorySettings.update({
        where: { organizationId: org },
        data: { allowNegativeStock: input.allowNegativeStock },
        select: { allowNegativeStock: true },
      });
    });
  }
}
