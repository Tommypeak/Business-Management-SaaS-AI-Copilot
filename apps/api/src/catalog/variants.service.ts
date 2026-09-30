import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CatalogOptionResponse, CatalogVariantResponse, PageResponse } from '@saas/types';
import {
  Prisma,
  type CatalogVariant,
  type VariantOptionValue,
} from '../generated/prisma/client.js';
import type { ListQueryDto } from '../common/list-query.dto.js';
import { protectVariant } from '../inventory/inventory-locks.js';
import {
  CatalogDatabase,
  requireItem,
  type CatalogTransaction,
} from './catalog-database.service.js';
import type {
  VariantDto,
  UpdateVariantDto,
  OptionDto,
  UpdateOptionDto,
  OptionValueDto,
  UpdateOptionValueDto,
} from './catalog.dto.js';

export function variantResponse(
  row: CatalogVariant & { optionValues: VariantOptionValue[] },
): CatalogVariantResponse {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    barcode: row.barcode,
    sellingPrice: row.sellingPrice.toFixed(4),
    costPrice: row.costPrice?.toFixed(4) ?? null,
    unit: row.unit,
    isDefault: row.isDefault,
    isActive: row.isActive,
    optionValueIds: row.optionValues.map((value) => value.optionValueId).sort(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class VariantsService {
  constructor(private readonly db: CatalogDatabase) {}
  async list(
    organizationId: string,
    catalogItemId: string,
    query: ListQueryDto,
  ): Promise<PageResponse<CatalogVariantResponse>> {
    await requireItem(this.db.prisma, organizationId, catalogItemId);
    const rows = await this.db.prisma.catalogVariant.findMany({
      where: {
        organizationId,
        catalogItemId,
        ...(query.cursor ? { id: { gt: query.cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: query.limit + 1,
      include: { optionValues: { where: { organizationId, catalogItemId } } },
    });
    return {
      items: rows.slice(0, query.limit).map(variantResponse),
      nextCursor: rows.length > query.limit ? rows[query.limit - 1]!.id : null,
    };
  }
  async assignOptions(
    tx: CatalogTransaction,
    organizationId: string,
    catalogItemId: string,
    variantId: string,
    ids: string[],
  ) {
    const values = await tx.catalogOptionValue.findMany({
      where: {
        organizationId,
        catalogItemId,
        id: { in: ids },
        isActive: true,
        option: { isActive: true },
      },
      take: 10,
    });
    if (values.length !== ids.length) throw new NotFoundException('Option value unavailable');
    if (new Set(values.map((value) => value.optionId)).size !== values.length)
      throw new BadRequestException('Only one value per option is allowed');
    await tx.variantOptionValue.deleteMany({ where: { organizationId, catalogItemId, variantId } });
    if (values.length)
      await tx.variantOptionValue.createMany({
        data: values.map((value) => ({
          organizationId,
          catalogItemId,
          variantId,
          optionId: value.optionId,
          optionValueId: value.id,
        })),
      });
  }
  async insert(
    tx: CatalogTransaction,
    organizationId: string,
    catalogItemId: string,
    input: VariantDto,
    isDefault: boolean,
  ) {
    if (isDefault && input.isActive === false)
      throw new BadRequestException('Default variant must remain active; archive the item instead');
    const variant = await tx.catalogVariant.create({
      data: {
        organizationId,
        catalogItemId,
        name: input.name,
        sku: input.sku,
        barcode: input.barcode,
        sellingPrice: new Prisma.Decimal(input.sellingPrice),
        costPrice: input.costPrice == null ? null : new Prisma.Decimal(input.costPrice),
        unit: input.unit,
        isDefault,
        isActive: input.isActive,
      },
    });
    await this.assignOptions(
      tx,
      organizationId,
      catalogItemId,
      variant.id,
      input.optionValueIds ?? [],
    );
    return variantResponse(
      await tx.catalogVariant.findFirstOrThrow({
        where: { id: variant.id, organizationId, catalogItemId },
        include: { optionValues: true },
      }),
    );
  }
  create(organizationId: string, catalogItemId: string, input: VariantDto) {
    return this.db.write(organizationId, async (tx) => {
      const item = await requireItem(tx, organizationId, catalogItemId);
      if (!item.isActive)
        throw new ConflictException('Restore the catalog item before adding variants');
      if ((await tx.catalogVariant.count({ where: { organizationId, catalogItemId } })) >= 100)
        throw new ConflictException('Maximum 100 variants per item');
      return this.insert(tx, organizationId, catalogItemId, input, false);
    });
  }
  update(organizationId: string, catalogItemId: string, id: string, input: UpdateVariantDto) {
    return this.db.write(organizationId, async (tx) => {
      await requireItem(tx, organizationId, catalogItemId);
      const variant = await tx.catalogVariant.findFirst({
        where: { organizationId, catalogItemId, id },
      });
      if (!variant) throw new NotFoundException();
      await protectVariant(
        tx,
        organizationId,
        id,
        input.isActive === false,
        input.unit !== undefined && input.unit !== variant.unit,
      );
      if (variant.isDefault && input.isActive === false)
        throw new BadRequestException(
          'Default variant must remain active; archive the item instead',
        );
      await tx.catalogVariant.update({
        where: { id, organizationId, catalogItemId },
        data: {
          name: input.name,
          sku: input.sku,
          barcode: input.barcode,
          unit: input.unit,
          isActive: input.isActive,
          sellingPrice:
            input.sellingPrice === undefined ? undefined : new Prisma.Decimal(input.sellingPrice),
          costPrice:
            input.costPrice === undefined
              ? undefined
              : input.costPrice === null
                ? null
                : new Prisma.Decimal(input.costPrice),
        },
      });
      if (input.optionValueIds !== undefined)
        await this.assignOptions(tx, organizationId, catalogItemId, id, input.optionValueIds);
      return variantResponse(
        await tx.catalogVariant.findFirstOrThrow({
          where: { id, organizationId, catalogItemId },
          include: { optionValues: { where: { organizationId, catalogItemId } } },
        }),
      );
    });
  }
  async options(organizationId: string, catalogItemId: string): Promise<CatalogOptionResponse[]> {
    await requireItem(this.db.prisma, organizationId, catalogItemId);
    const options = await this.db.prisma.catalogOption.findMany({
      where: { organizationId, catalogItemId },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      take: 10,
      include: {
        values: {
          where: { organizationId, catalogItemId },
          orderBy: [{ position: 'asc' }, { id: 'asc' }],
          take: 100,
        },
      },
    });
    return options.map(({ id, name, position, isActive, values }) => ({
      id,
      name,
      position,
      isActive,
      values: values.map(({ id, value, position, isActive }) => ({
        id,
        value,
        position,
        isActive,
      })),
    }));
  }
  createOption(organizationId: string, catalogItemId: string, input: OptionDto) {
    return this.db.write(organizationId, async (tx) => {
      await requireItem(tx, organizationId, catalogItemId);
      if ((await tx.catalogOption.count({ where: { organizationId, catalogItemId } })) >= 10)
        throw new ConflictException('Maximum 10 options per item');
      return tx.catalogOption.create({
        data: {
          organizationId,
          catalogItemId,
          name: input.name,
          position: input.position,
          isActive: input.isActive,
        },
        select: { id: true, name: true, position: true, isActive: true },
      });
    });
  }
  updateOption(organizationId: string, catalogItemId: string, id: string, input: UpdateOptionDto) {
    return this.db.write(organizationId, async (tx) => {
      if (!(await tx.catalogOption.findFirst({ where: { id, organizationId, catalogItemId } })))
        throw new NotFoundException();
      if (
        input.isActive === false &&
        (await tx.variantOptionValue.count({
          where: { organizationId, catalogItemId, optionId: id },
        }))
      )
        throw new ConflictException('Option is used by variants');
      return tx.catalogOption.update({
        where: { id, organizationId, catalogItemId },
        data: { name: input.name, position: input.position, isActive: input.isActive },
        select: { id: true, name: true, position: true, isActive: true },
      });
    });
  }
  createOptionValue(
    organizationId: string,
    catalogItemId: string,
    optionId: string,
    input: OptionValueDto,
  ) {
    return this.db.write(organizationId, async (tx) => {
      if (
        !(await tx.catalogOption.findFirst({
          where: { id: optionId, organizationId, catalogItemId, isActive: true },
        }))
      )
        throw new NotFoundException();
      if (
        (await tx.catalogOptionValue.count({
          where: { organizationId, catalogItemId, optionId },
        })) >= 100
      )
        throw new ConflictException('Maximum 100 values per option');
      return tx.catalogOptionValue.create({
        data: {
          organizationId,
          catalogItemId,
          optionId,
          value: input.value,
          position: input.position,
          isActive: input.isActive,
        },
        select: { id: true, value: true, position: true, isActive: true },
      });
    });
  }
  updateOptionValue(
    organizationId: string,
    catalogItemId: string,
    optionId: string,
    id: string,
    input: UpdateOptionValueDto,
  ) {
    return this.db.write(organizationId, async (tx) => {
      if (
        !(await tx.catalogOptionValue.findFirst({
          where: { id, organizationId, catalogItemId, optionId, option: { isActive: true } },
        }))
      )
        throw new NotFoundException();
      if (
        input.isActive === false &&
        (await tx.variantOptionValue.count({
          where: { organizationId, catalogItemId, optionValueId: id },
        }))
      )
        throw new ConflictException('Option value is used by variants');
      return tx.catalogOptionValue.update({
        where: { id, organizationId, catalogItemId, optionId },
        data: { value: input.value, position: input.position, isActive: input.isActive },
        select: { id: true, value: true, position: true, isActive: true },
      });
    });
  }
}
