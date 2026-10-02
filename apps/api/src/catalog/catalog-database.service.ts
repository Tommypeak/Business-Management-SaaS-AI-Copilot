import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type CatalogTransaction = Prisma.TransactionClient;

@Injectable()
export class CatalogDatabase {
  constructor(readonly prisma: PrismaService) {}

  async write<T>(
    organizationId: string,
    action: (tx: CatalogTransaction) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // Serialize catalog writes per tenant. Category cycles and field/option
          // validation cannot race another catalog write. No user SQL interpolation.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`catalog:${organizationId}`}::text, 0))`;
          if (
            !(await tx.organization.findUnique({
              where: { id: organizationId },
              select: { id: true },
            }))
          )
            throw new NotFoundException();
          return action(tx);
        },
        { maxWait: 5000, timeout: 10000 },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = JSON.stringify(error.meta ?? {});
        const code = target.includes('CatalogVariant_organizationId_sku_key')
          ? 'SKU_ALREADY_EXISTS'
          : target.includes('CatalogVariant_organizationId_barcode_key')
            ? 'BARCODE_ALREADY_EXISTS'
            : 'CATALOG_VALUE_ALREADY_EXISTS';
        throw new ConflictException({ statusCode: 409, code, message: code });
      }
      throw error;
    }
  }
}

export async function requireItem(tx: CatalogTransaction, organizationId: string, id: string) {
  const item = await tx.catalogItem.findFirst({ where: { id, organizationId } });
  if (!item) throw new NotFoundException();
  return item;
}
