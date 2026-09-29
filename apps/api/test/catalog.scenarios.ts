import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import type {
  CatalogCategoryResponse,
  CatalogItemResponse,
  CatalogListResponse,
  CatalogVariantResponse,
  CustomFieldDefinitionResponse,
  OrganizationResponse,
  PageResponse,
  UserResponse,
} from '@saas/types';

interface Context {
  app: NestFastifyApplication;
  prisma: PrismaService;
  admin: PrismaClient;
  schema: string;
  token: (subject: string) => Promise<string>;
  legacyOrganizationId: string;
}
const organizationInput = {
  name: 'Catalog tenant',
  businessType: 'MIXED',
  defaultCurrency: 'USD',
  timezone: 'UTC',
};
const variantInput = {
  sellingPrice: '1234567890.1234',
  costPrice: '0.0100',
  unit: 'PIECE',
} as const;
const productInput = {
  type: 'PRODUCT',
  name: 'Shirt',
  trackInventory: true,
  defaultVariant: variantInput,
};

// Registered within the existing Stage 2 suite: same real app, PostgreSQL and JWKS.
export function registerCatalogTests(context: () => Context) {
  let owner: string, outsider: string, member: string, adminToken: string;
  let org: string, foreignOrg: string;
  let item: CatalogItemResponse, foreign: CatalogItemResponse;
  let category: CatalogCategoryResponse, foreignCategory: CatalogCategoryResponse;
  let field: CustomFieldDefinitionResponse, foreignField: CustomFieldDefinitionResponse;
  let optionId: string, valueId: string;
  const path = (tenant: string, suffix: string) =>
    `/api/v1/organizations/${tenant}/catalog/${suffix}`;
  const call = (method: 'GET' | 'POST' | 'PATCH', url: string, bearer: string, payload?: object) =>
    context().app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${bearer}` },
      ...(payload ? { payload } : {}),
    });
  async function ok<T>(
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    bearer: string,
    payload?: object,
  ): Promise<T> {
    const response = await call(method, url, bearer, payload);
    assert.equal(response.statusCode, method === 'POST' ? 201 : 200, response.body);
    return response.json<T>();
  }

  void test('catalog migration backfills pre-existing system roles and is idempotent', async () => {
    const { prisma, legacyOrganizationId, schema, admin } = context();
    for (const key of ['OWNER', 'ADMIN', 'MEMBER']) {
      const role = await prisma.role.findUniqueOrThrow({
        where: { organizationId_key: { organizationId: legacyOrganizationId, key } },
        include: { permissions: true },
      });
      assert.deepEqual(
        role.permissions.map((permission) => permission.permissionCode).sort(),
        key === 'MEMBER' ? ['catalog.view'] : ['catalog.manage', 'catalog.view'],
      );
    }
    assert.match(schema, /^stage2_[a-f0-9]{32}$/);
    const sql = readFileSync(
      'prisma/migrations/20260929182020_universal_catalog/migration.sql',
      'utf8',
    )
      .split('-- Existing system roles')[1]!
      .split('INSERT INTO')[1]!;
    const repeated = `INSERT INTO${sql}`
      .replaceAll('"RolePermission"', `"${schema}"."RolePermission"`)
      .replaceAll('"Role"', `"${schema}"."Role"`);
    const before = await prisma.rolePermission.count();
    await admin.$executeRawUnsafe(repeated);
    assert.equal(await prisma.rolePermission.count(), before);
  });

  void test('OWNER creates PRODUCT with one active default variant and exact decimal JSON', async () => {
    [owner, outsider, member, adminToken] = await Promise.all([
      context().token('catalog-owner'),
      context().token('catalog-outsider'),
      context().token('catalog-member'),
      context().token('catalog-admin'),
    ]);
    org = (
      await ok<OrganizationResponse>('POST', '/api/v1/organizations', owner, organizationInput)
    ).id;
    foreignOrg = (
      await ok<OrganizationResponse>('POST', '/api/v1/organizations', outsider, organizationInput)
    ).id;
    for (const [bearer, key] of [
      [member, 'MEMBER'],
      [adminToken, 'ADMIN'],
    ] as const) {
      const user = await ok<UserResponse>('GET', '/api/v1/me', bearer);
      const role = await context().prisma.role.findUniqueOrThrow({
        where: { organizationId_key: { organizationId: org, key } },
      });
      const membership = await context().prisma.organizationMembership.create({
        data: { organizationId: org, userId: user.id },
      });
      await context().prisma.membershipRole.create({
        data: { organizationId: org, membershipId: membership.id, roleId: role.id },
      });
    }
    category = await ok('POST', path(org, 'categories'), owner, { name: 'Clothes' });
    foreignCategory = await ok('POST', path(foreignOrg, 'categories'), outsider, {
      name: 'Private category',
    });
    field = await ok('POST', path(org, 'custom-fields'), owner, {
      name: 'Material',
      key: 'material',
      type: 'TEXT',
    });
    foreignField = await ok('POST', path(foreignOrg, 'custom-fields'), outsider, {
      name: 'Country',
      key: 'country',
      type: 'SELECT',
      options: [{ label: 'Private', value: 'private' }],
    });
    item = await ok('POST', path(org, 'items'), owner, {
      ...productInput,
      categoryId: category.id,
      defaultVariant: { ...variantInput, sku: '  ts-blk-m  ', barcode: '  0012345  ' },
    });
    foreign = await ok('POST', path(foreignOrg, 'items'), outsider, {
      ...productInput,
      categoryId: foreignCategory.id,
      defaultVariant: { ...variantInput, sku: 'TS-BLK-M', barcode: '0012345' },
    });
    assert.equal(item.variants.length, 1);
    assert.equal(item.defaultVariant.isDefault, true);
    assert.equal(item.defaultVariant.isActive, true);
    assert.equal(item.defaultVariant.sku, 'TS-BLK-M');
    assert.equal(item.defaultVariant.barcode, '0012345');
    assert.equal(item.defaultVariant.sellingPrice, '1234567890.1234');
    assert.equal(item.defaultVariant.costPrice, '0.0100');
    assert.equal(item.currencyCode, 'USD');
    const row = await context().prisma.catalogVariant.findUniqueOrThrow({
      where: { id: item.defaultVariant.id },
    });
    assert.equal(row.sellingPrice.toFixed(4), '1234567890.1234');
  });

  void test('item and default variant are rolled back after a forced database failure', async () => {
    const { admin, prisma, schema } = context();
    assert.match(schema, /^stage2_[a-f0-9]{32}$/);
    const before = await prisma.catalogItem.count();
    await admin.$executeRawUnsafe(
      `CREATE FUNCTION "${schema}".reject_variant() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced variant failure'; END $$`,
    );
    await admin.$executeRawUnsafe(
      `CREATE TRIGGER reject_variant BEFORE INSERT ON "${schema}"."CatalogVariant" FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_variant()`,
    );
    try {
      const response = await call('POST', path(org, 'items'), owner, productInput);
      assert.equal(response.statusCode, 500);
      assert.ok(!response.body.includes('forced variant failure'));
      assert.equal(await prisma.catalogItem.count(), before);
    } finally {
      await admin.$executeRawUnsafe(`DROP TRIGGER reject_variant ON "${schema}"."CatalogVariant"`);
      await admin.$executeRawUnsafe(`DROP FUNCTION "${schema}".reject_variant()`);
    }
  });

  void test('SERVICE inventory rule and decimal validation apply to create and PATCH', async () => {
    for (const defaultVariant of [[], [variantInput], null, 'invalid'])
      assert.equal(
        (await call('POST', path(org, 'items'), owner, { ...productInput, defaultVariant }))
          .statusCode,
        400,
      );
    assert.equal(
      (await call('POST', path(org, 'items'), owner, { ...productInput, type: 'SERVICE' }))
        .statusCode,
      400,
    );
    const service = await ok<CatalogItemResponse>('POST', path(org, 'items'), owner, {
      ...productInput,
      type: 'SERVICE',
      trackInventory: false,
      defaultVariant: { ...variantInput, unit: 'HOUR' },
    });
    assert.equal(
      (await call('PATCH', path(org, `items/${service.id}`), owner, { trackInventory: true }))
        .statusCode,
      400,
    );
    assert.equal(
      (await call('PATCH', path(org, `items/${item.id}`), owner, { type: 'SERVICE' })).statusCode,
      400,
    );
    for (const money of [-1, 1.1, '-1', 'NaN', 'Infinity', '1e3', '0.00001', '1000000000000000']) {
      assert.equal(
        (
          await call('POST', path(org, 'items'), owner, {
            ...productInput,
            defaultVariant: { ...variantInput, sellingPrice: money },
          })
        ).statusCode,
        400,
        String(money),
      );
    }
    assert.equal(
      (
        await call(
          'PATCH',
          path(org, `items/${item.id}/variants/${item.defaultVariant.id}`),
          owner,
          { costPrice: '-0.1' },
        )
      ).statusCode,
      400,
    );
  });

  void test('SKU/barcode uniqueness is normalized, tenant-scoped and safe under concurrent writes', async () => {
    for (const [key, value, code] of [
      ['sku', ' ts-blk-m ', 'SKU_ALREADY_EXISTS'],
      ['barcode', '0012345', 'BARCODE_ALREADY_EXISTS'],
    ]) {
      const response = await call('POST', path(org, 'items'), owner, {
        ...productInput,
        defaultVariant: { ...variantInput, [key!]: value },
      });
      assert.equal(response.statusCode, 409);
      assert.equal(response.json<{ code: string }>().code, code);
      assert.ok(!response.body.includes('Prisma'));
    }
    const replies = await Promise.all(
      [0, 1].map(() =>
        call('POST', path(org, 'items'), owner, {
          ...productInput,
          defaultVariant: { ...variantInput, sku: 'RACE-SKU' },
        }),
      ),
    );
    assert.deepEqual(replies.map((response) => response.statusCode).sort(), [201, 409]);
    for (let n = 0; n < 2; n++)
      await ok('POST', path(org, 'items'), owner, {
        ...productInput,
        defaultVariant: { ...variantInput, sku: ' ', barcode: null },
      });
    assert.equal(foreign.defaultVariant.sku, item.defaultVariant.sku);
    assert.equal(foreign.defaultVariant.barcode, item.defaultVariant.barcode);
  });

  void test('MEMBER is read-only; ADMIN can manage the catalog through existing guards', async () => {
    await ok('GET', path(org, 'items'), member);
    await ok('GET', path(org, `items/${item.id}`), member);
    for (const resource of ['items', 'categories', 'custom-fields'])
      assert.equal((await call('POST', path(org, resource), member, {})).statusCode, 403);
    assert.equal(
      (await call('PATCH', path(org, `items/${item.id}`), member, { name: 'Hacked' })).statusCode,
      403,
    );
    assert.equal(
      (await call('POST', path(org, `items/${item.id}/variants`), member, variantInput)).statusCode,
      403,
    );
    await ok('POST', path(org, 'items'), adminToken, { ...productInput, name: 'Admin product' });
    await ok('PATCH', path(org, `items/${item.id}`), adminToken, { name: 'Updated shirt' });
  });

  void test('catalog IDOR and cross-tenant category/field/option assignments are denied', async () => {
    for (const resource of [
      'items',
      'categories',
      'custom-fields',
      `items/${foreign.id}`,
      `items/${foreign.id}/variants`,
    ])
      assert.equal((await call('GET', path(foreignOrg, resource), owner)).statusCode, 404);
    assert.equal((await call('GET', path(org, `items/${foreign.id}`), owner)).statusCode, 404);
    assert.equal(
      (await call('PATCH', path(org, `items/${foreign.id}`), owner, { name: 'Hacked' })).statusCode,
      404,
    );
    assert.equal(
      (await call('GET', path(org, `items/${foreign.id}/variants`), owner)).statusCode,
      404,
    );
    assert.equal(
      (
        await call(
          'PATCH',
          path(org, `items/${item.id}/variants/${foreign.defaultVariant.id}`),
          owner,
          { name: 'Hacked' },
        )
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await call('PATCH', path(org, `items/${item.id}`), owner, {
          categoryId: foreignCategory.id,
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await call('PATCH', path(org, `items/${item.id}`), owner, {
          customFields: [{ fieldId: foreignField.id, value: foreignField.options[0]!.id }],
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await call('PATCH', path(org, `categories/${foreignCategory.id}`), owner, {
          name: 'Hacked',
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await call('PATCH', path(org, `custom-fields/${foreignField.id}`), owner, {
          name: 'Hacked',
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await call(
          'PATCH',
          path(org, `custom-fields/${field.id}/options/${foreignField.options[0]!.id}`),
          owner,
          { label: 'Hacked' },
        )
      ).statusCode,
      404,
    );
    for (const q of ['TS-BLK-M', '0012345']) {
      const response = await ok<CatalogListResponse>('GET', path(org, `items?q=${q}`), owner);
      assert.ok(response.items.length > 0);
      assert.ok(response.items.every((entry) => entry.id !== foreign.id));
    }
    await ok(
      'PATCH',
      path(foreignOrg, `items/${foreign.id}/variants/${foreign.defaultVariant.id}`),
      outsider,
      { sku: 'ONLY-FOREIGN', barcode: '00000999' },
    );
    for (const q of ['ONLY-FOREIGN', '00000999'])
      assert.equal(
        (await ok<CatalogListResponse>('GET', path(org, `items?q=${q}`), owner)).items.length,
        0,
      );
  });

  void test('category hierarchy rejects self-parent, cycles, races and archived parents', async () => {
    const child = await ok<CatalogCategoryResponse>('POST', path(org, 'categories'), owner, {
      name: 'Men',
      parentId: category.id,
    });
    assert.equal(child.parentId, category.id);
    assert.equal(
      (
        await call('PATCH', path(org, `categories/${category.id}`), owner, {
          parentId: category.id,
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (await call('PATCH', path(org, `categories/${category.id}`), owner, { parentId: child.id }))
        .statusCode,
      400,
    );
    assert.equal(
      (
        await call('POST', path(org, 'categories'), owner, {
          name: 'Foreign parent',
          parentId: foreignCategory.id,
        })
      ).statusCode,
      404,
    );
    const left = await ok<CatalogCategoryResponse>('POST', path(org, 'categories'), owner, {
      name: 'Left',
    });
    const right = await ok<CatalogCategoryResponse>('POST', path(org, 'categories'), owner, {
      name: 'Right',
    });
    const race = await Promise.all([
      call('PATCH', path(org, `categories/${left.id}`), owner, { parentId: right.id }),
      call('PATCH', path(org, `categories/${right.id}`), owner, { parentId: left.id }),
    ]);
    assert.deepEqual(race.map((response) => response.statusCode).sort(), [200, 400]);
    assert.equal(
      (await call('PATCH', path(org, `categories/${category.id}`), owner, { isActive: false }))
        .statusCode,
      409,
    );
    await ok('PATCH', path(org, `categories/${child.id}`), owner, { isActive: false });
    await ok('PATCH', path(org, `categories/${category.id}`), owner, { isActive: false });
    assert.equal(
      (await call('POST', path(org, 'items'), owner, { ...productInput, categoryId: category.id }))
        .statusCode,
      404,
    );
    const retained = await ok<CatalogItemResponse>('GET', path(org, `items/${item.id}`), owner);
    assert.equal(retained.category?.isActive, false);
    const edited = await ok<CatalogItemResponse>('PATCH', path(org, `items/${item.id}`), owner, {
      categoryId: category.id,
      description: 'Keep the existing archived category',
    });
    assert.equal(edited.categoryId, category.id);
    const editedChild = await ok<CatalogCategoryResponse>(
      'PATCH',
      path(org, `categories/${child.id}`),
      owner,
      { name: 'Archived child', parentId: category.id, isActive: false },
    );
    assert.equal(editedChild.parentId, category.id);
    await ok('PATCH', path(org, `categories/${category.id}`), owner, { isActive: true });
  });

  void test('default variant cannot disappear, duplicate, or be archived; item archive remains safe', async () => {
    const { prisma } = context();
    assert.equal(
      (
        await call(
          'PATCH',
          path(org, `items/${item.id}/variants/${item.defaultVariant.id}`),
          owner,
          { isActive: false },
        )
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await call(
          'PATCH',
          path(org, `items/${item.id}/variants/${item.defaultVariant.id}`),
          owner,
          { isDefault: false },
        )
      ).statusCode,
      400,
    );
    await assert.rejects(prisma.catalogVariant.delete({ where: { id: item.defaultVariant.id } }));
    await assert.rejects(
      prisma.catalogVariant.create({
        data: { organizationId: org, catalogItemId: item.id, ...variantInput, isDefault: true },
      }),
    );
    await assert.rejects(
      prisma.catalogItem.create({
        data: { organizationId: org, type: 'PRODUCT', name: 'No default' },
      }),
    );
    await ok('PATCH', path(org, `items/${item.id}`), owner, { isActive: false });
    assert.equal(
      (await ok<CatalogItemResponse>('GET', path(org, `items/${item.id}`), owner)).defaultVariant
        .isActive,
      true,
    );
    assert.ok(
      !(await ok<CatalogListResponse>('GET', path(org, 'items'), owner)).items.some(
        (row) => row.id === item.id,
      ),
    );
    await ok('PATCH', path(org, `items/${item.id}`), owner, { isActive: true });
  });

  void test('variants enforce same-item option values, one value per option and safe archiving', async () => {
    optionId = (
      await ok<{ id: string }>('POST', path(org, `items/${item.id}/options`), owner, {
        name: 'Color',
      })
    ).id;
    valueId = (
      await ok<{ id: string }>(
        'POST',
        path(org, `items/${item.id}/options/${optionId}/values`),
        owner,
        { value: 'Black' },
      )
    ).id;
    const white = await ok<{ id: string }>(
      'POST',
      path(org, `items/${item.id}/options/${optionId}/values`),
      owner,
      { value: 'White' },
    );
    const variant = await ok<CatalogVariantResponse>(
      'POST',
      path(org, `items/${item.id}/variants`),
      owner,
      { ...variantInput, name: 'Black', sku: 'BLACK', optionValueIds: [valueId] },
    );
    assert.deepEqual(variant.optionValueIds, [valueId]);
    assert.equal(
      (
        await call('PATCH', path(org, `items/${item.id}/variants/${variant.id}`), owner, {
          optionValueIds: [valueId, white.id],
        })
      ).statusCode,
      400,
    );
    const other = await ok<CatalogItemResponse>('POST', path(org, 'items'), owner, productInput);
    assert.equal(
      (
        await call('POST', path(org, `items/${other.id}/variants`), owner, {
          ...variantInput,
          optionValueIds: [valueId],
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await call('POST', path(foreignOrg, `items/${foreign.id}/variants`), outsider, {
          ...variantInput,
          optionValueIds: [valueId],
        })
      ).statusCode,
      404,
    );
    await ok('PATCH', path(org, `items/${item.id}/variants/${variant.id}`), owner, {
      isActive: false,
    });
    assert.equal(
      (
        await call(
          'PATCH',
          path(org, `items/${item.id}/options/${optionId}/values/${valueId}`),
          owner,
          { isActive: false },
        )
      ).statusCode,
      409,
    );
    await ok('PATCH', path(org, `items/${item.id}/options/${optionId}/values/${white.id}`), owner, {
      isActive: false,
    });
    assert.equal(
      (
        await call('POST', path(org, `items/${item.id}/variants`), owner, {
          ...variantInput,
          optionValueIds: [white.id],
        })
      ).statusCode,
      404,
    );
  });

  void test('database composite constraints reject cross-tenant catalog references and cross-item options', async () => {
    const { prisma } = context();
    await assert.rejects(
      prisma.catalogItem.update({
        where: { id: item.id },
        data: { categoryId: foreignCategory.id },
      }),
    );
    await assert.rejects(
      prisma.catalogVariant.create({
        data: { ...variantInput, organizationId: foreignOrg, catalogItemId: item.id },
      }),
    );
    await assert.rejects(
      prisma.catalogItemCustomFieldValue.create({
        data: {
          organizationId: org,
          catalogItemId: item.id,
          fieldDefinitionId: foreignField.id,
          value: 'bad',
        },
      }),
    );
    await assert.rejects(
      prisma.variantOptionValue.create({
        data: {
          organizationId: foreignOrg,
          catalogItemId: foreign.id,
          variantId: foreign.defaultVariant.id,
          optionId,
          optionValueId: valueId,
        },
      }),
    );
  });

  void test('all custom field types are validated, including foreign options and required values', async () => {
    const tenant = (
      await ok<OrganizationResponse>('POST', '/api/v1/organizations', owner, organizationInput)
    ).id;
    const definitions: CustomFieldDefinitionResponse[] = [];
    for (const type of ['TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'SELECT', 'MULTI_SELECT'])
      definitions.push(
        await ok('POST', path(tenant, 'custom-fields'), owner, {
          name: type,
          key: type.toLowerCase(),
          type,
          isRequired: true,
          ...(type.includes('SELECT')
            ? {
                options: [
                  { label: 'One', value: 'one' },
                  { label: 'Two', value: 'two' },
                ],
              }
            : {}),
        }),
      );
    assert.equal((await call('POST', path(tenant, 'items'), owner, productInput)).statusCode, 400);
    const valid = [
      'Cotton',
      '1234567890.12345678',
      false,
      '2024-02-29',
      definitions[4]!.options[0]!.id,
      [definitions[5]!.options[0]!.id, definitions[5]!.options[1]!.id],
    ];
    const customFields = definitions.map((definition, index) => ({
      fieldId: definition.id,
      value: valid[index],
    }));
    const created = await ok<CatalogItemResponse>('POST', path(tenant, 'items'), owner, {
      ...productInput,
      customFields,
    });
    assert.equal(
      created.customFields.find((entry) => entry.fieldId === definitions[1]!.id)?.value,
      '1234567890.12345678',
    );
    const invalid = [
      12,
      Infinity,
      'false',
      '2024-02-30',
      definitions[5]!.options[0]!.id,
      [foreignField.options[0]!.id],
    ];
    for (let index = 0; index < definitions.length; index++)
      assert.equal(
        (
          await call('PATCH', path(tenant, `items/${created.id}`), owner, {
            customFields: [{ fieldId: definitions[index]!.id, value: invalid[index] }],
          })
        ).statusCode,
        400,
        definitions[index]!.type,
      );
    assert.equal(
      (
        await call('PATCH', path(tenant, `items/${created.id}`), owner, {
          customFields: [{ fieldId: definitions[0]!.id, value: null }],
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await call('PATCH', path(tenant, `custom-fields/${definitions[0]!.id}`), owner, {
          key: 'changed',
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await call('PATCH', path(tenant, `custom-fields/${definitions[0]!.id}`), owner, {
          type: 'BOOLEAN',
        })
      ).statusCode,
      400,
    );
    await ok('PATCH', path(tenant, `custom-fields/${definitions[0]!.id}`), owner, {
      isActive: false,
    });
    assert.equal(
      (
        await call('PATCH', path(tenant, `items/${created.id}`), owner, {
          customFields: [{ fieldId: definitions[0]!.id, value: 'New' }],
        })
      ).statusCode,
      404,
    );
    const archived = await ok<CatalogItemResponse>(
      'GET',
      path(tenant, `items/${created.id}`),
      owner,
    );
    assert.equal(
      archived.customFields.find((entry) => entry.fieldId === definitions[0]!.id)?.value,
      'Cotton',
    );
    assert.equal(
      (
        await call(
          'PATCH',
          path(
            tenant,
            `custom-fields/${definitions[4]!.id}/options/${definitions[4]!.options[0]!.id}`,
          ),
          owner,
          { isActive: false },
        )
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await call('POST', path(tenant, 'custom-fields'), owner, {
          name: 'New required',
          key: 'new_required',
          type: 'TEXT',
          isRequired: true,
        })
      ).statusCode,
      409,
    );
    const optional = await ok<CustomFieldDefinitionResponse>(
      'POST',
      path(tenant, 'custom-fields'),
      owner,
      { name: 'Optional', key: 'optional', type: 'TEXT' },
    );
    assert.equal(
      (
        await call('PATCH', path(tenant, `custom-fields/${optional.id}`), owner, {
          isRequired: true,
        })
      ).statusCode,
      409,
    );
    await ok('PATCH', path(tenant, `items/${created.id}`), owner, {
      customFields: [{ fieldId: optional.id, value: 'Populated' }],
    });
    await ok('PATCH', path(tenant, `custom-fields/${optional.id}`), owner, { isRequired: true });
  });

  void test('catalog search, filters and cursor pagination are scoped, deterministic and bounded', async () => {
    const seen = new Set<string>();
    for (const sort of ['name', 'createdAt', 'updatedAt']) {
      seen.clear();
      let cursor: string | null = null;
      do {
        const response: CatalogListResponse = await ok(
          'GET',
          path(org, `items?limit=2&sort=${sort}${cursor ? `&cursor=${cursor}` : ''}`),
          owner,
        );
        for (const row of response.items) {
          assert.ok(!seen.has(row.id));
          seen.add(row.id);
          assert.ok(!('customFields' in row));
          assert.ok(!('variants' in row));
        }
        cursor = response.nextCursor;
      } while (cursor);
      assert.equal(
        seen.size,
        await context().prisma.catalogItem.count({
          where: { organizationId: org, isActive: true },
        }),
      );
    }
    const filtered = await ok<CatalogListResponse>(
      'GET',
      path(org, `items?categoryId=${category.id}&type=PRODUCT&q=shirt`),
      owner,
    );
    assert.deepEqual(
      filtered.items.map((row) => row.id),
      [item.id],
    );
    assert.equal(
      (
        await ok<CatalogListResponse>(
          'GET',
          path(org, `items?categoryId=${foreignCategory.id}`),
          owner,
        )
      ).items.length,
      0,
    );
    for (const query of [
      'limit=1000000',
      'limit=-1',
      'sort=sql',
      'cursor=invalid',
      'isActive=banana',
      `q=${'x'.repeat(101)}`,
    ])
      assert.equal((await call('GET', path(org, `items?${query}`), owner)).statusCode, 400);
    for (const forbidden of ['organizationId', 'createdAt', 'updatedAt', 'ownerId'])
      assert.equal(
        (
          await call('POST', path(org, 'items'), owner, {
            ...productInput,
            [forbidden]: randomUUID(),
          })
        ).statusCode,
        400,
      );
    assert.equal(
      (await call('POST', path(org, 'items'), owner, { ...productInput, name: 'x'.repeat(201) }))
        .statusCode,
      400,
    );
    const list = await ok<PageResponse<CatalogVariantResponse>>(
      'GET',
      path(org, `items/${item.id}/variants?limit=1`),
      owner,
    );
    assert.equal(list.items.length, 1);
    assert.ok(list.nextCursor);
    for (const suffix of ['A', 'B'])
      await ok('POST', path(org, 'items'), owner, {
        ...productInput,
        name: `${'Я'.repeat(199)}${suffix}`,
      });
    const unicode = await ok<CatalogListResponse>(
      'GET',
      path(org, `items?sort=name&limit=1&q=${encodeURIComponent('Я')}`),
      owner,
    );
    assert.ok(unicode.nextCursor);
    const unicodeNext = await ok<CatalogListResponse>(
      'GET',
      path(
        org,
        `items?sort=name&limit=1&q=${encodeURIComponent('Я')}&cursor=${unicode.nextCursor}`,
      ),
      owner,
    );
    assert.equal(unicodeNext.items.length, 1);
    assert.notEqual(unicode.items[0]!.id, unicodeNext.items[0]!.id);
  });
}
