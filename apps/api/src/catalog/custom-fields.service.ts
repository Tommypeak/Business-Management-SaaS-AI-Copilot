import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CustomFieldDefinitionResponse, CustomFieldValue, PageResponse } from '@saas/types';
import type { CustomFieldDefinition, CustomFieldOption } from '../generated/prisma/client.js';
import type { ListQueryDto } from '../common/list-query.dto.js';
import { CatalogDatabase, type CatalogTransaction } from './catalog-database.service.js';
import type {
  CustomValueDto,
  FieldDto,
  FieldOptionDto,
  UpdateFieldDto,
  UpdateFieldOptionDto,
} from './catalog.dto.js';

const optionsInclude = {
  options: { orderBy: [{ position: 'asc' as const }, { id: 'asc' as const }], take: 100 },
};
function serialize(
  field: CustomFieldDefinition & { options: CustomFieldOption[] },
): CustomFieldDefinitionResponse {
  return {
    id: field.id,
    name: field.name,
    key: field.key,
    type: field.type,
    isRequired: field.isRequired,
    isActive: field.isActive,
    options: field.options.map(({ id, label, value, position, isActive }) => ({
      id,
      label,
      value,
      position,
      isActive,
    })),
  };
}

@Injectable()
export class CustomFieldsService {
  constructor(private readonly db: CatalogDatabase) {}
  async list(
    organizationId: string,
    query: ListQueryDto,
  ): Promise<PageResponse<CustomFieldDefinitionResponse>> {
    const rows = await this.db.prisma.customFieldDefinition.findMany({
      where: { organizationId, ...(query.cursor ? { id: { gt: query.cursor } } : {}) },
      orderBy: { id: 'asc' },
      take: query.limit + 1,
      include: optionsInclude,
    });
    return {
      items: rows.slice(0, query.limit).map(serialize),
      nextCursor: rows.length > query.limit ? rows[query.limit - 1]!.id : null,
    };
  }
  private async required(tx: CatalogTransaction, organizationId: string, id?: string) {
    const missing = await tx.catalogItem.count({
      where: {
        organizationId,
        isActive: true,
        ...(id ? { customFields: { none: { organizationId, fieldDefinitionId: id } } } : {}),
      },
    });
    if (missing)
      throw new ConflictException(
        'Populate this optional field on all active items before making it required',
      );
  }
  create(organizationId: string, input: FieldDto) {
    return this.db.write(organizationId, async (tx) => {
      if ((await tx.customFieldDefinition.count({ where: { organizationId } })) >= 1000)
        throw new ConflictException(
          'Maximum 1000 custom field definitions including archived fields',
        );
      if (
        (await tx.customFieldDefinition.count({ where: { organizationId, isActive: true } })) >= 100
      )
        throw new ConflictException('Maximum 100 active custom fields');
      if (input.isRequired) await this.required(tx, organizationId);
      const choice = ['SELECT', 'MULTI_SELECT'].includes(input.type);
      if (choice && !input.options?.some((option) => option.isActive !== false))
        throw new BadRequestException('Choice fields require active options');
      if (!choice && input.options?.length)
        throw new BadRequestException('Only choice fields can have options');
      const field = await tx.customFieldDefinition.create({
        data: {
          organizationId,
          name: input.name,
          key: input.key,
          type: input.type,
          isRequired: input.isRequired,
        },
      });
      if (input.options?.length)
        await tx.customFieldOption.createMany({
          data: input.options.map((option) => ({
            organizationId,
            fieldDefinitionId: field.id,
            label: option.label,
            value: option.value,
            position: option.position,
            isActive: option.isActive,
          })),
        });
      return serialize(
        await tx.customFieldDefinition.findFirstOrThrow({
          where: { id: field.id, organizationId },
          include: optionsInclude,
        }),
      );
    });
  }
  update(organizationId: string, id: string, input: UpdateFieldDto) {
    return this.db.write(organizationId, async (tx) => {
      const field = await tx.customFieldDefinition.findFirst({ where: { id, organizationId } });
      if (!field) throw new NotFoundException();
      if (
        !field.isActive &&
        input.isActive === true &&
        (await tx.customFieldDefinition.count({ where: { organizationId, isActive: true } })) >= 100
      )
        throw new ConflictException('Maximum 100 active custom fields');
      if ((input.isRequired ?? field.isRequired) && (input.isActive ?? field.isActive))
        await this.required(tx, organizationId, id);
      return serialize(
        await tx.customFieldDefinition.update({
          where: { id, organizationId },
          data: { name: input.name, isRequired: input.isRequired, isActive: input.isActive },
          include: optionsInclude,
        }),
      );
    });
  }
  createOption(organizationId: string, fieldDefinitionId: string, input: FieldOptionDto) {
    return this.db.write(organizationId, async (tx) => {
      const field = await tx.customFieldDefinition.findFirst({
        where: { id: fieldDefinitionId, organizationId, isActive: true },
      });
      if (!field) throw new NotFoundException();
      if (!['SELECT', 'MULTI_SELECT'].includes(field.type))
        throw new BadRequestException('Only choice fields can have options');
      if (
        (await tx.customFieldOption.count({ where: { organizationId, fieldDefinitionId } })) >= 100
      )
        throw new ConflictException('Maximum 100 options per field');
      return tx.customFieldOption.create({
        data: {
          organizationId,
          fieldDefinitionId,
          label: input.label,
          value: input.value,
          position: input.position,
          isActive: input.isActive,
        },
        select: { id: true, label: true, value: true, position: true, isActive: true },
      });
    });
  }
  updateOption(
    organizationId: string,
    fieldDefinitionId: string,
    id: string,
    input: UpdateFieldOptionDto,
  ) {
    return this.db.write(organizationId, async (tx) => {
      const option = await tx.customFieldOption.findFirst({
        where: { id, fieldDefinitionId, organizationId, definition: { isActive: true } },
      });
      if (!option) throw new NotFoundException();
      if (input.isActive === false) {
        const used = await tx.catalogItemCustomFieldValue.count({
          where: {
            organizationId,
            fieldDefinitionId,
            OR: [{ value: { equals: id } }, { value: { array_contains: [id] } }],
          },
        });
        if (used) throw new ConflictException('Option is used by catalog items');
        if (
          (await tx.customFieldOption.count({
            where: { organizationId, fieldDefinitionId, isActive: true, id: { not: id } },
          })) === 0
        )
          throw new ConflictException('Choice field must retain an active option');
      }
      return tx.customFieldOption.update({
        where: { id, organizationId, fieldDefinitionId },
        data: { label: input.label, position: input.position, isActive: input.isActive },
        select: { id: true, label: true, value: true, position: true, isActive: true },
      });
    });
  }

  private value(
    field: CustomFieldDefinition & { options: CustomFieldOption[] },
    value: unknown,
  ): CustomFieldValue {
    const invalid = (): never => {
      throw new BadRequestException(`Invalid value for custom field ${field.key}`);
    };
    switch (field.type) {
      case 'TEXT':
        return typeof value === 'string' && value.trim().length > 0 && value.length <= 2000
          ? value.trim()
          : invalid();
      case 'NUMBER':
        return typeof value === 'string' && /^-?(0|[1-9]\d{0,29})(\.\d{1,8})?$/.test(value)
          ? value
          : invalid();
      case 'BOOLEAN':
        return typeof value === 'boolean' ? value : invalid();
      case 'DATE': {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return invalid();
        const date = new Date(`${value}T00:00:00Z`);
        return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
          ? value
          : invalid();
      }
      case 'SELECT':
        return typeof value === 'string' &&
          field.options.some((option) => option.id === value && option.isActive)
          ? value
          : invalid();
      case 'MULTI_SELECT': {
        const allowed = new Set(
          field.options.filter((option) => option.isActive).map((option) => option.id),
        );
        if (
          !Array.isArray(value) ||
          !value.length ||
          value.length > 100 ||
          !value.every((entry: unknown) => typeof entry === 'string' && allowed.has(entry)) ||
          new Set(value).size !== value.length
        )
          return invalid();
        return [...(value as string[])];
      }
    }
  }
  async saveValues(
    tx: CatalogTransaction,
    organizationId: string,
    catalogItemId: string,
    input: CustomValueDto[],
    requireFields: boolean,
  ) {
    if (new Set(input.map((entry) => entry.fieldId)).size !== input.length)
      throw new BadRequestException('Duplicate custom field assignment');
    const fields = await tx.customFieldDefinition.findMany({
      where: { organizationId, isActive: true },
      include: optionsInclude,
      take: 100,
    });
    for (const entry of input) {
      const field = fields.find((candidate) => candidate.id === entry.fieldId);
      if (!field) throw new NotFoundException('Custom field unavailable');
      if (entry.value === null) {
        await tx.catalogItemCustomFieldValue.deleteMany({
          where: { organizationId, catalogItemId, fieldDefinitionId: field.id },
        });
      } else {
        const value = this.value(field, entry.value);
        await tx.catalogItemCustomFieldValue.upsert({
          where: {
            catalogItemId_fieldDefinitionId: { catalogItemId, fieldDefinitionId: field.id },
            organizationId,
          },
          create: { organizationId, catalogItemId, fieldDefinitionId: field.id, value },
          update: { value },
        });
      }
    }
    if (requireFields) {
      const values = await tx.catalogItemCustomFieldValue.findMany({
        where: {
          organizationId,
          catalogItemId,
          fieldDefinitionId: {
            in: fields.filter((field) => field.isRequired).map((field) => field.id),
          },
        },
        select: { fieldDefinitionId: true },
        take: 100,
      });
      if (
        fields.some(
          (field) =>
            field.isRequired && !values.some((value) => value.fieldDefinitionId === field.id),
        )
      )
        throw new BadRequestException('Required custom fields are missing');
    }
  }
}
