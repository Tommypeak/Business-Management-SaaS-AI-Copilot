import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type {
  CatalogItemResponse,
  CatalogItemSummary,
  CatalogListResponse,
  CustomFieldValue,
} from '@saas/types';
import { Prisma, type CatalogItem, type CatalogCategory } from '../generated/prisma/client.js';
import {
  CatalogDatabase,
  requireItem,
  type CatalogTransaction,
} from './catalog-database.service.js';
import { CustomFieldsService } from './custom-fields.service.js';
import { VariantsService, variantResponse } from './variants.service.js';
import type { CatalogQueryDto, CreateItemDto, UpdateItemDto } from './catalog.dto.js';

function basic(
  item: CatalogItem,
  category: Pick<CatalogCategory, 'id' | 'name' | 'isActive'> | null,
) {
  return {
    id: item.id,
    name: item.name,
    type: item.type,
    category,
    trackInventory: item.trackInventory,
    isActive: item.isActive,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

@Injectable()
export class CatalogService {
  constructor(
    private readonly db: CatalogDatabase,
    private readonly fields: CustomFieldsService,
    private readonly variants: VariantsService,
  ) {}
  private async category(
    tx: CatalogTransaction,
    organizationId: string,
    id: string | null | undefined,
  ) {
    if (
      id &&
      !(await tx.catalogCategory.findFirst({
        where: { organizationId, id, isActive: true },
        select: { id: true },
      }))
    )
      throw new NotFoundException('Category unavailable');
  }
  async create(organizationId: string, input: CreateItemDto): Promise<CatalogItemResponse> {
    const id = await this.db.write(organizationId, async (tx) => {
      if (input.type === 'SERVICE' && input.trackInventory)
        throw new BadRequestException('Services cannot track inventory');
      await this.category(tx, organizationId, input.categoryId);
      const item = await tx.catalogItem.create({
        data: {
          organizationId,
          type: input.type,
          name: input.name,
          description: input.description,
          categoryId: input.categoryId,
          trackInventory: input.trackInventory ?? false,
        },
      });
      await this.variants.insert(tx, organizationId, item.id, input.defaultVariant, true);
      await this.fields.saveValues(tx, organizationId, item.id, input.customFields ?? [], true);
      return item.id;
    });
    return this.get(organizationId, id);
  }
  async update(
    organizationId: string,
    id: string,
    input: UpdateItemDto,
  ): Promise<CatalogItemResponse> {
    await this.db.write(organizationId, async (tx) => {
      const item = await requireItem(tx, organizationId, id);
      if ((input.type ?? item.type) === 'SERVICE' && (input.trackInventory ?? item.trackInventory))
        throw new BadRequestException('Services cannot track inventory');
      if (input.categoryId !== undefined && input.categoryId !== item.categoryId)
        await this.category(tx, organizationId, input.categoryId);
      await tx.catalogItem.update({
        where: { id, organizationId },
        data: {
          type: input.type,
          name: input.name,
          description: input.description,
          categoryId: input.categoryId,
          trackInventory: input.trackInventory,
          isActive: input.isActive,
        },
      });
      await this.fields.saveValues(
        tx,
        organizationId,
        id,
        input.customFields ?? [],
        input.isActive ?? item.isActive,
      );
    });
    return this.get(organizationId, id);
  }
  async get(organizationId: string, id: string): Promise<CatalogItemResponse> {
    const item = await this.db.prisma.catalogItem.findFirst({
      where: { organizationId, id },
      include: {
        category: { select: { id: true, name: true, isActive: true } },
        organization: { select: { defaultCurrency: true } },
        variants: {
          where: { organizationId },
          take: 100,
          orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
          include: { optionValues: { where: { organizationId } } },
        },
        customFields: {
          where: { organizationId },
          take: 1000,
          orderBy: { fieldDefinitionId: 'asc' },
        },
      },
    });
    if (!item) throw new NotFoundException();
    const variants = item.variants.map(variantResponse);
    return {
      ...basic(item, item.category),
      description: item.description,
      categoryId: item.categoryId,
      currencyCode: item.organization.defaultCurrency,
      defaultVariant: variants.find((variant) => variant.isDefault)!,
      variants,
      options: await this.variants.options(organizationId, id),
      customFields: item.customFields.map((field) => ({
        fieldId: field.fieldDefinitionId,
        value: field.value as CustomFieldValue,
      })),
    };
  }
  async list(organizationId: string, query: CatalogQueryDto): Promise<CatalogListResponse> {
    const direction = query.sort === 'name' ? 'asc' : 'desc';
    const filters: Prisma.CatalogItemWhereInput[] = [];
    if (query.cursor) {
      try {
        const cursor: unknown = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'));
        if (
          !cursor ||
          typeof cursor !== 'object' ||
          !('id' in cursor) ||
          typeof cursor.id !== 'string' ||
          !isUUID(cursor.id) ||
          !('sort' in cursor) ||
          cursor.sort !== query.sort ||
          !('value' in cursor) ||
          typeof cursor.value !== 'string' ||
          Array.from(cursor.value).length > 200
        )
          throw new Error();
        const value = query.sort === 'name' ? cursor.value : new Date(cursor.value);
        if (value instanceof Date && !Number.isFinite(value.getTime())) throw new Error();
        const comparison = direction === 'asc' ? 'gt' : 'lt';
        filters.push({
          OR: [
            { [query.sort]: { [comparison]: value } },
            { [query.sort]: value, id: { [comparison]: cursor.id } },
          ],
        });
      } catch {
        throw new BadRequestException('Invalid catalog cursor');
      }
    }
    if (query.q) {
      const q = query.q.replace(/[\\%_]/g, '\\$&');
      filters.push({
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          {
            variants: {
              some: {
                organizationId,
                OR: [
                  { sku: { contains: q, mode: 'insensitive' } },
                  { barcode: { contains: q, mode: 'insensitive' } },
                ],
              },
            },
          },
        ],
      });
    }
    const rows = await this.db.prisma.catalogItem.findMany({
      where: {
        organizationId,
        isActive: query.isActive ?? true,
        type: query.type,
        categoryId: query.categoryId,
        AND: filters,
      },
      take: query.limit + 1,
      orderBy: [{ [query.sort]: direction }, { id: direction }],
      include: {
        category: { select: { id: true, name: true, isActive: true } },
        variants: {
          where: { organizationId, isDefault: true },
          take: 1,
          include: { optionValues: { where: { organizationId } } },
        },
      },
    });
    const organization = await this.db.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { defaultCurrency: true },
    });
    const items: CatalogItemSummary[] = rows.slice(0, query.limit).map((item) => ({
      ...basic(item, item.category),
      currencyCode: organization.defaultCurrency,
      defaultVariant: variantResponse(item.variants[0]!),
    }));
    const last = rows[query.limit - 1];
    const lastValue = last?.[query.sort];
    const nextCursor =
      rows.length > query.limit && last
        ? Buffer.from(
            JSON.stringify({
              sort: query.sort,
              id: last.id,
              value: lastValue instanceof Date ? lastValue.toISOString() : lastValue,
            }),
          ).toString('base64url')
        : null;
    return { items, nextCursor };
  }
}
