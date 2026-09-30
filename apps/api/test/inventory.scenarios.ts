import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type {
  CatalogItemResponse,
  CatalogVariantResponse,
  InventoryStockRow,
  InventoryTransactionResponse,
  LocationResponse,
  OrganizationResponse,
  PageResponse,
  UserResponse,
} from '@saas/types';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { Prisma } from '../src/generated/prisma/client.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { inventoryLock, stockKey } from '../src/inventory/inventory-locks.js';

interface Context {
  app: NestFastifyApplication;
  prisma: PrismaService;
  admin: PrismaClient;
  schema: string;
  token: (subject: string) => Promise<string>;
  legacyOrganizationId: string;
}
export function registerInventoryTests(context: () => Context) {
  let org: string,
    foreignOrg: string,
    owner: string,
    outsider: string,
    member: string,
    adminToken: string;
  let source: LocationResponse,
    destination: LocationResponse,
    foreignLocation: LocationResponse,
    foreignItem: CatalogItemResponse;
  const base = (tenant = org) => `/api/v1/organizations/${tenant}`;
  const route = (path: string, tenant = org) => `${base(tenant)}/inventory/${path}`;
  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: object,
    key: string | null = randomUUID(),
    bearer = owner,
  ) =>
    context().app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${bearer}`, ...(key ? { 'idempotency-key': key } : {}) },
      ...(payload ? { payload } : {}),
    });
  async function ok<T>(
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    payload?: object,
    key?: string,
    bearer = owner,
  ): Promise<T> {
    const response = await call(method, url, payload, key, bearer);
    assert.equal(response.statusCode, method === 'POST' ? 201 : 200, response.body);
    return response.json<T>();
  }
  async function conflict(
    url: string,
    payload: object,
    code: string,
    method: 'POST' | 'PATCH' = 'POST',
  ) {
    const response = await call(method, url, payload);
    assert.equal(response.statusCode, 409, response.body);
    assert.equal(response.json<{ code: string }>().code, code);
  }
  const createItem = (
    name = 'Inventory product',
    extra: object = {},
    tenant = org,
    bearer = owner,
  ) =>
    ok<CatalogItemResponse>(
      'POST',
      `${base(tenant)}/catalog/items`,
      {
        name,
        type: 'PRODUCT',
        trackInventory: true,
        defaultVariant: { unit: 'KILOGRAM', sellingPrice: '1.0000' },
        ...extra,
      },
      undefined,
      bearer,
    );
  const command = (variantId: string, quantity: string, locationId = source.id) => ({
    variantId,
    locationId,
    quantity,
  });
  const adjust = (
    variantId: string,
    quantity: string,
    direction = 'INCREASE',
    locationId = source.id,
  ) => ({ ...command(variantId, quantity, locationId), direction, reason: 'COUNT_CORRECTION' });
  const transfer = (
    variantId: string,
    quantity: string,
    from = source.id,
    to = destination.id,
  ) => ({ variantId, quantity, sourceLocationId: from, destinationLocationId: to });
  async function stock(item: CatalogItemResponse, locationId?: string) {
    const page = await ok<PageResponse<InventoryStockRow>>(
      'GET',
      route(`stock?itemId=${item.id}${locationId ? `&locationId=${locationId}` : ''}`),
    );
    return page.items.find((row) => row.variantId === item.defaultVariant.id)?.quantity;
  }
  async function consistent() {
    const { prisma } = context();
    const sums = await prisma.inventoryLedgerEntry.groupBy({
      by: ['organizationId', 'locationId', 'variantId'],
      _sum: { quantityDelta: true },
    });
    const balances = await prisma.inventoryBalance.findMany();
    assert.equal(balances.length, sums.length);
    for (const row of sums) {
      const balance = balances.find(
        (b) =>
          b.organizationId === row.organizationId &&
          b.locationId === row.locationId &&
          b.variantId === row.variantId,
      );
      assert.ok(balance);
      assert.equal(balance.quantity.toFixed(6), row._sum.quantityDelta!.toFixed(6));
    }
  }
  void test('inventory settings/permissions backfill old organizations and initialize new ones', async () => {
    const { prisma, admin, schema, legacyOrganizationId } = context();
    assert.equal(
      (
        await prisma.inventorySettings.findUniqueOrThrow({
          where: { organizationId: legacyOrganizationId },
        })
      ).allowNegativeStock,
      false,
    );
    for (const key of ['OWNER', 'ADMIN', 'MEMBER']) {
      const role = await prisma.role.findUniqueOrThrow({
        where: { organizationId_key: { organizationId: legacyOrganizationId, key } },
        include: { permissions: true },
      });
      assert.deepEqual(
        role.permissions
          .map((p) => p.permissionCode)
          .filter((p) => p.startsWith('inventory.'))
          .sort(),
        key === 'MEMBER'
          ? ['inventory.view']
          : [
              'inventory.adjust',
              'inventory.settings.manage',
              'inventory.transfer',
              'inventory.view',
            ],
      );
    }
    const backfill = readFileSync(
      'prisma/migrations/20260930140000_inventory_ledger/migration.sql',
      'utf8',
    )
      .split('-- Stage 4 backfill:')[1]!
      .split('\n')
      .slice(1)
      .join('\n');
    assert.match(schema, /^stage2_[a-f0-9]{32}$/);
    for (const statement of backfill.split(';').filter((sql) => sql.trim())) {
      const qualified = statement.replace(
        /"(InventorySettings|Organization|RolePermission|Role)"/g,
        `"${schema}"."$1"`,
      );
      await admin.$executeRawUnsafe(qualified);
    }
    [owner, outsider, member, adminToken] = await Promise.all([
      context().token('stock-owner'),
      context().token('stock-outsider'),
      context().token('stock-member'),
      context().token('stock-admin'),
    ]);
    const input = {
      name: 'Inventory organization',
      businessType: 'MIXED',
      defaultCurrency: 'USD',
      timezone: 'UTC',
    };
    org = (await ok<OrganizationResponse>('POST', '/api/v1/organizations', input)).id;
    foreignOrg = (
      await ok<OrganizationResponse>('POST', '/api/v1/organizations', input, undefined, outsider)
    ).id;
    assert.equal(
      (await ok<{ allowNegativeStock: boolean }>('GET', route('settings'))).allowNegativeStock,
      false,
    );
    for (const [bearer, key] of [
      [member, 'MEMBER'],
      [adminToken, 'ADMIN'],
    ] as const) {
      const user = await ok<UserResponse>('GET', '/api/v1/me', undefined, undefined, bearer);
      const role = await prisma.role.findUniqueOrThrow({
        where: { organizationId_key: { organizationId: org, key } },
      });
      const membership = await prisma.organizationMembership.create({
        data: { organizationId: org, userId: user.id },
      });
      await prisma.membershipRole.create({
        data: { organizationId: org, membershipId: membership.id, roleId: role.id },
      });
    }
    source = await ok('POST', `${base()}/locations`, { name: 'Store', type: 'STORE' });
    destination = await ok('POST', `${base()}/locations`, { name: 'Office', type: 'OFFICE' });
    foreignLocation = await ok(
      'POST',
      `${base(foreignOrg)}/locations`,
      { name: 'Foreign store', type: 'STORE' },
      undefined,
      outsider,
    );
    foreignItem = await createItem('Foreign stock', {}, foreignOrg, outsider);
  });
  void test('opening/adjustment/transfer/reversal preserve ledger projection and exact decimals', async () => {
    const item = await createItem();
    const variant = item.defaultVariant.id;
    const before = await context().prisma.inventoryBalance.count();
    assert.equal(await stock(item), '0.000000');
    assert.equal(await context().prisma.inventoryBalance.count(), before);
    const opening = await ok<InventoryTransactionResponse>(
      'POST',
      route('opening-balances'),
      command(variant, '10.123456'),
    );
    assert.equal(opening.entries[0]!.quantityDelta, '10.123456');
    await consistent();
    const plus = await ok<InventoryTransactionResponse>(
      'POST',
      route('adjustments'),
      adjust(variant, '0.000001'),
    );
    assert.equal(await stock(item), '10.123457');
    await consistent();
    await ok('POST', route(`transactions/${plus.id}/reverse`), {});
    assert.equal(await stock(item), '10.123456');
    await ok('POST', route('adjustments'), adjust(variant, '0.123456', 'DECREASE'));
    assert.equal(await stock(item), '10.000000');
    const moved = await ok<InventoryTransactionResponse>(
      'POST',
      route('transfers'),
      transfer(variant, '3.250001'),
    );
    assert.equal(await stock(item, source.id), '6.749999');
    assert.equal(await stock(item, destination.id), '3.250001');
    assert.equal(await stock(item), '10.000000');
    assert.ok(
      moved.entries.reduce((sum, row) => sum.plus(row.quantityDelta), new Prisma.Decimal(0)).eq(0),
    );
    await consistent();
    const reversal = await ok<InventoryTransactionResponse>(
      'POST',
      route(`transactions/${moved.id}/reverse`),
      { note: 'Undo transfer' },
    );
    assert.equal(reversal.reversesTransactionId, moved.id);
    assert.equal(await stock(item, source.id), '10.000000');
    assert.equal(await stock(item, destination.id), '0.000000');
    const detail = await ok<InventoryTransactionResponse>('GET', route(`transactions/${moved.id}`));
    assert.equal(detail.reversedByTransactionId, reversal.id);
    assert.ok(!('requestHash' in detail));
    assert.ok(!('idempotencyKey' in detail));
    await consistent();
  });
  void test('negative stock policy applies atomically to adjustments, transfers, reversals and settings', async () => {
    const item = await createItem();
    const variant = item.defaultVariant.id;
    const initial = await ok<InventoryTransactionResponse>(
      'POST',
      route('opening-balances'),
      command(variant, '3'),
    );
    const count = await context().prisma.inventoryLedgerEntry.count();
    await conflict(route('adjustments'), adjust(variant, '4', 'DECREASE'), 'INSUFFICIENT_STOCK');
    await conflict(route('transfers'), transfer(variant, '4'), 'INSUFFICIENT_STOCK');
    assert.equal(await context().prisma.inventoryLedgerEntry.count(), count);
    assert.equal(await stock(item), '3.000000');
    await ok('POST', route('adjustments'), adjust(variant, '1', 'DECREASE'));
    await conflict(route(`transactions/${initial.id}/reverse`), {}, 'INSUFFICIENT_STOCK');
    await ok('PATCH', route('settings'), { allowNegativeStock: true });
    await ok('POST', route('adjustments'), adjust(variant, '3', 'DECREASE'));
    assert.equal(await stock(item), '-1.000000');
    await conflict(
      route('settings'),
      { allowNegativeStock: false },
      'INVENTORY_NEGATIVE_STOCK_EXISTS',
      'PATCH',
    );
    await ok('POST', route('adjustments'), adjust(variant, '1'));
    await ok('PATCH', route('settings'), { allowNegativeStock: false });
    await consistent();
  });
  void test(
    'idempotency normalizes decimal/note/UUID and concurrent retries have one ledger effect',
    { timeout: 30000 },
    async () => {
      const item = await createItem();
      const variant = item.defaultVariant.id;
      const key = randomUUID();
      const body = { ...adjust(variant, '1.0'), note: ' count ' };
      const responses = await Promise.all(
        Array.from({ length: 8 }, () => call('POST', route('adjustments'), body, key)),
      );
      assert.ok(
        responses.every((response) => response.statusCode === 201),
        responses.map((r) => r.body).join('\n'),
      );
      const ids = responses.map((response) => response.json<InventoryTransactionResponse>().id);
      assert.equal(new Set(ids).size, 1);
      assert.equal(await stock(item), '1.000000');
      const replay = await ok<InventoryTransactionResponse>(
        'POST',
        route('adjustments'),
        {
          reason: 'COUNT_CORRECTION',
          note: 'count',
          quantity: '1.000000',
          direction: 'INCREASE',
          variantId: variant.toUpperCase(),
          locationId: source.id.toUpperCase(),
        },
        key.toUpperCase(),
      );
      assert.equal(replay.id, ids[0]);
      const mismatch = await call('POST', route('adjustments'), adjust(variant, '2'), key);
      assert.equal(mismatch.statusCode, 409);
      assert.equal(mismatch.json<{ code: string }>().code, 'IDEMPOTENCY_KEY_CONFLICT');
      const foreign = await call(
        'POST',
        route('adjustments', foreignOrg),
        adjust(foreignItem.defaultVariant.id, '1', 'INCREASE', foreignLocation.id),
        key,
        outsider,
      );
      assert.equal(foreign.statusCode, 201);
      await consistent();
    },
  );
  void test(
    '20 concurrent increments have no lost update; concurrent decrements cannot overspend',
    { timeout: 45000 },
    async () => {
      const item = await createItem();
      const variant = item.defaultVariant.id;
      await ok('POST', route('opening-balances'), command(variant, '100'));
      const increments = await Promise.all(
        Array.from({ length: 20 }, () => call('POST', route('adjustments'), adjust(variant, '1'))),
      );
      assert.ok(
        increments.every((response) => response.statusCode === 201),
        increments.map((r) => r.body).join('\n'),
      );
      assert.equal(await stock(item), '120.000000');
      const small = await createItem();
      await ok('POST', route('opening-balances'), command(small.defaultVariant.id, '5'));
      const decreases = await Promise.all(
        Array.from({ length: 2 }, () =>
          call('POST', route('adjustments'), adjust(small.defaultVariant.id, '4', 'DECREASE')),
        ),
      );
      assert.deepEqual(decreases.map((r) => r.statusCode).sort(), [201, 409]);
      assert.equal(await stock(small), '1.000000');
      await consistent();
    },
  );
  void test(
    'opposite concurrent transfers use ordered stock locks and conserve totals',
    { timeout: 45000 },
    async () => {
      const item = await createItem();
      const variant = item.defaultVariant.id;
      await ok('POST', route('opening-balances'), command(variant, '100'));
      await ok('POST', route('opening-balances'), command(variant, '100', destination.id));
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          call(
            'POST',
            route('transfers'),
            index % 2 ? transfer(variant, '1') : transfer(variant, '1', destination.id, source.id),
          ),
        ),
      );
      assert.ok(
        results.every((response) => response.statusCode === 201),
        results.map((r) => r.body).join('\n'),
      );
      assert.equal(await stock(item, source.id), '100.000000');
      assert.equal(await stock(item, destination.id), '100.000000');
      assert.equal(await stock(item), '200.000000');
      await consistent();
    },
  );
  void test(
    'unrelated stock keys can progress while another key is locked',
    { timeout: 15000 },
    async () => {
      const first = await createItem();
      const other = await createItem();
      let release!: () => void;
      let acquired!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const ready = new Promise<void>((resolve) => {
        acquired = resolve;
      });
      const transaction = context().prisma.$transaction(
        async (tx) => {
          await inventoryLock(tx, stockKey(org, source.id, first.defaultVariant.id));
          acquired();
          await held;
        },
        { timeout: 12000 },
      );
      await ready;
      try {
        await ok('POST', route('adjustments'), adjust(other.defaultVariant.id, '1'));
        assert.equal(await stock(other), '1.000000');
      } finally {
        release();
        await transaction;
      }
    },
  );
  void test('opening uses ledger history and reversal cannot be repeated or reversed', async () => {
    const item = await createItem();
    const variant = item.defaultVariant.id;
    const initial = await ok<InventoryTransactionResponse>(
      'POST',
      route('opening-balances'),
      command(variant, '2'),
    );
    await conflict(
      route('opening-balances'),
      command(variant, '1'),
      'OPENING_BALANCE_ALREADY_INITIALIZED',
    );
    const key = randomUUID();
    const reversed = await ok<InventoryTransactionResponse>(
      'POST',
      route(`transactions/${initial.id}/reverse`),
      {},
      key,
    );
    assert.equal(
      (
        await ok<InventoryTransactionResponse>(
          'POST',
          route(`transactions/${initial.id}/reverse`),
          {},
          key,
        )
      ).id,
      reversed.id,
    );
    await conflict(
      route(`transactions/${initial.id}/reverse`),
      {},
      'INVENTORY_TRANSACTION_ALREADY_REVERSED',
    );
    await conflict(
      route(`transactions/${reversed.id}/reverse`),
      {},
      'INVENTORY_REVERSAL_NOT_ALLOWED',
    );
    assert.equal(await stock(item), '0.000000');
    await conflict(
      route('opening-balances'),
      command(variant, '1'),
      'OPENING_BALANCE_ALREADY_INITIALIZED',
    );
    const adjusted = await createItem();
    await ok('POST', route('adjustments'), adjust(adjusted.defaultVariant.id, '1'));
    await conflict(
      route('opening-balances'),
      command(adjusted.defaultVariant.id, '1'),
      'OPENING_BALANCE_ALREADY_INITIALIZED',
    );
  });
  void test('ledger and transactions are immutable in SQL and transfer failures roll back all writes', async () => {
    const { prisma, admin, schema } = context();
    const item = await createItem();
    const variant = item.defaultVariant.id;
    const initial = await ok<InventoryTransactionResponse>(
      'POST',
      route('opening-balances'),
      command(variant, '10'),
    );
    await assert.rejects(
      prisma.inventoryTransaction.update({ where: { id: initial.id }, data: { note: 'Changed' } }),
    );
    await assert.rejects(prisma.inventoryTransaction.delete({ where: { id: initial.id } }));
    await assert.rejects(
      prisma.inventoryLedgerEntry.update({
        where: { id: initial.entries[0]!.id },
        data: { quantityDelta: '999' },
      }),
    );
    await assert.rejects(
      prisma.inventoryLedgerEntry.delete({ where: { id: initial.entries[0]!.id } }),
    );
    await assert.rejects(
      prisma.inventoryLedgerEntry.create({
        data: {
          organizationId: org,
          transactionId: initial.id,
          locationId: destination.id,
          variantId: variant,
          quantityDelta: '1',
        },
      }),
    );
    for (const method of ['PATCH', 'DELETE'] as const)
      assert.equal((await call(method, route(`transactions/${initial.id}`), {})).statusCode, 404);
    const count = await prisma.inventoryTransaction.count();
    assert.match(schema, /^stage2_[a-f0-9]{32}$/);
    await admin.$executeRawUnsafe(
      `CREATE FUNCTION "${schema}".fail_inventory_destination() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."locationId" = '${destination.id}'::uuid THEN RAISE EXCEPTION 'forced projection failure'; END IF; RETURN NEW; END; $$`,
    );
    await admin.$executeRawUnsafe(
      `CREATE TRIGGER fail_inventory_destination BEFORE INSERT OR UPDATE ON "${schema}"."InventoryBalance" FOR EACH ROW EXECUTE FUNCTION "${schema}".fail_inventory_destination()`,
    );
    try {
      const response = await call('POST', route('transfers'), transfer(variant, '1'));
      assert.equal(response.statusCode, 500);
      assert.ok(!response.body.includes('forced projection failure'));
      assert.equal(await stock(item, source.id), '10.000000');
      assert.equal(await stock(item, destination.id), '0.000000');
      assert.equal(await prisma.inventoryTransaction.count(), count);
    } finally {
      await admin.$executeRawUnsafe(
        `DROP TRIGGER fail_inventory_destination ON "${schema}"."InventoryBalance"`,
      );
      await admin.$executeRawUnsafe(`DROP FUNCTION "${schema}".fail_inventory_destination()`);
    }
    await consistent();
  });
  void test('tracking/activity rules and catalog/location transitions preserve inventory meaning', async () => {
    const item = await createItem();
    const variant = item.defaultVariant.id;
    for (const extra of [{ trackInventory: false }, { type: 'SERVICE', trackInventory: false }]) {
      const untracked = await createItem('Untracked', extra);
      await conflict(
        route('adjustments'),
        adjust(untracked.defaultVariant.id, '1'),
        'INVENTORY_TRACKING_DISABLED',
      );
    }
    await ok('POST', route('opening-balances'), command(variant, '1'));
    for (const input of [{ trackInventory: false }, { isActive: false }])
      await conflict(
        `${base()}/catalog/items/${item.id}`,
        input,
        'INVENTORY_STOCK_EXISTS',
        'PATCH',
      );
    await conflict(
      `${base()}/catalog/items/${item.id}/variants/${variant}`,
      { unit: 'PIECE' },
      'INVENTORY_UNIT_IMMUTABLE',
      'PATCH',
    );
    await conflict(
      `${base()}/locations/${source.id}`,
      { isActive: false },
      'INVENTORY_STOCK_EXISTS',
      'PATCH',
    );
    const extra = await ok<CatalogVariantResponse>(
      'POST',
      `${base()}/catalog/items/${item.id}/variants`,
      { unit: 'PIECE', sellingPrice: '1' },
    );
    await ok('POST', route('opening-balances'), command(extra.id, '1'));
    await conflict(
      `${base()}/catalog/items/${item.id}/variants/${extra.id}`,
      { isActive: false },
      'INVENTORY_STOCK_EXISTS',
      'PATCH',
    );
    await ok('POST', route('adjustments'), adjust(extra.id, '1', 'DECREASE'));
    await ok('PATCH', `${base()}/catalog/items/${item.id}/variants/${extra.id}`, {
      isActive: false,
    });
    await conflict(route('adjustments'), adjust(extra.id, '1'), 'INVENTORY_RESOURCE_INACTIVE');
    await ok('POST', route('adjustments'), adjust(variant, '1', 'DECREASE'));
    await conflict(
      `${base()}/catalog/items/${item.id}`,
      { type: 'SERVICE', trackInventory: false },
      'INVENTORY_ITEM_TYPE_IMMUTABLE',
      'PATCH',
    );
    await ok('PATCH', `${base()}/catalog/items/${item.id}`, { trackInventory: false });
    await ok('PATCH', `${base()}/catalog/items/${item.id}`, {
      trackInventory: true,
      isActive: false,
    });
    await conflict(route('adjustments'), adjust(variant, '1'), 'INVENTORY_RESOURCE_INACTIVE');
    await ok('PATCH', `${base()}/catalog/items/${item.id}`, { isActive: true });
    const emptyLocation = await ok<LocationResponse>('POST', `${base()}/locations`, {
      name: 'Temporary',
      type: 'OTHER',
    });
    await ok('PATCH', `${base()}/locations/${emptyLocation.id}`, { isActive: false });
    await conflict(
      route('adjustments'),
      adjust(variant, '1', 'INCREASE', emptyLocation.id),
      'INVENTORY_RESOURCE_INACTIVE',
    );
  });
  void test('RBAC and tenant isolation protect reads, commands, transfers and reversals', async () => {
    const item = await createItem();
    const variant = item.defaultVariant.id;
    for (const endpoint of ['stock', 'transactions', 'settings']) {
      assert.equal((await call('GET', route(endpoint), undefined, null, member)).statusCode, 200);
      assert.equal((await call('GET', route(endpoint, foreignOrg))).statusCode, 404);
    }
    const initial = await ok<InventoryTransactionResponse>(
      'POST',
      route('adjustments'),
      adjust(variant, '1'),
      undefined,
      adminToken,
    );
    for (const [path, input] of [
      ['opening-balances', command(variant, '1')],
      ['adjustments', adjust(variant, '1')],
      ['transfers', transfer(variant, '1')],
      [`transactions/${initial.id}/reverse`, {}],
    ] as const)
      assert.equal((await call('POST', route(path), input, undefined, member)).statusCode, 403);
    assert.equal(
      (await call('PATCH', route('settings'), { allowNegativeStock: true }, null, member))
        .statusCode,
      403,
    );
    const foreignTransaction = await ok<InventoryTransactionResponse>(
      'POST',
      route('adjustments', foreignOrg),
      adjust(foreignItem.defaultVariant.id, '1', 'INCREASE', foreignLocation.id),
      undefined,
      outsider,
    );
    for (const path of [
      `transactions/${foreignTransaction.id}`,
      `stock?locationId=${foreignLocation.id}`,
      `stock?itemId=${foreignItem.id}`,
    ])
      assert.equal((await call('GET', route(path))).statusCode, 404);
    assert.equal(
      (await call('POST', route(`transactions/${foreignTransaction.id}/reverse`), {})).statusCode,
      404,
    );
    for (const input of [
      adjust(foreignItem.defaultVariant.id, '1'),
      adjust(variant, '1', 'INCREASE', foreignLocation.id),
    ])
      assert.equal((await call('POST', route('adjustments'), input)).statusCode, 404);
    assert.equal(
      (
        await call(
          'POST',
          route('transfers'),
          transfer(variant, '1', source.id, foreignLocation.id),
        )
      ).statusCode,
      404,
    );
    assert.equal(
      (await ok<PageResponse<InventoryStockRow>>('GET', route('stock?q=Foreign'))).items.length,
      0,
    );
    await assert.rejects(
      context().prisma.inventoryBalance.create({
        data: {
          organizationId: org,
          locationId: foreignLocation.id,
          variantId: variant,
          quantity: '1',
        },
      }),
    );
    await assert.rejects(
      context().prisma.inventoryBalance.create({
        data: {
          organizationId: org,
          locationId: source.id,
          variantId: foreignItem.defaultVariant.id,
          quantity: '1',
        },
      }),
    );
    await assert.rejects(
      context().prisma.inventoryLedgerEntry.create({
        data: {
          organizationId: org,
          transactionId: foreignTransaction.id,
          locationId: source.id,
          variantId: variant,
          quantityDelta: '1',
        },
      }),
    );
  });
  void test(
    'racing openings, overspending transfers and double reversals commit only once',
    { timeout: 30000 },
    async () => {
      const item = await createItem();
      const variant = item.defaultVariant.id;
      const openings = await Promise.all([
        call('POST', route('opening-balances'), command(variant, '5')),
        call('POST', route('opening-balances'), command(variant, '5')),
      ]);
      assert.deepEqual(openings.map((r) => r.statusCode).sort(), [201, 409]);
      const transfers = await Promise.all([
        call('POST', route('transfers'), transfer(variant, '4')),
        call('POST', route('transfers'), transfer(variant, '4')),
      ]);
      assert.deepEqual(transfers.map((r) => r.statusCode).sort(), [201, 409]);
      assert.equal(await stock(item, source.id), '1.000000');
      assert.equal(await stock(item, destination.id), '4.000000');
      const successful = transfers
        .find((r) => r.statusCode === 201)!
        .json<InventoryTransactionResponse>();
      const reversals = await Promise.all([
        call('POST', route(`transactions/${successful.id}/reverse`), {}),
        call('POST', route(`transactions/${successful.id}/reverse`), {}),
      ]);
      assert.deepEqual(reversals.map((r) => r.statusCode).sort(), [201, 409]);
      const key = randomUUID();
      const competing = await Promise.all([
        call('POST', route('adjustments'), adjust(variant, '1'), key),
        call('POST', route('adjustments'), adjust(variant, '2'), key),
      ]);
      assert.deepEqual(competing.map((r) => r.statusCode).sort(), [201, 409]);
      assert.equal(
        competing.find((r) => r.statusCode === 409)!.json<{ code: string }>().code,
        'IDEMPOTENCY_KEY_CONFLICT',
      );
      await consistent();
    },
  );
  void test(
    'catalog/location changes racing a movement cannot invalidate nonzero stock',
    { timeout: 30000 },
    async () => {
      for (const kind of ['tracking', 'item', 'variant', 'location']) {
        const item = await createItem();
        const variant =
          kind === 'variant'
            ? await ok<CatalogVariantResponse>(
                'POST',
                `${base()}/catalog/items/${item.id}/variants`,
                { sellingPrice: '1', unit: 'PIECE' },
              )
            : item.defaultVariant;
        const location = await ok<LocationResponse>('POST', `${base()}/locations`, {
          name: 'Race location',
          type: 'OTHER',
        });
        const url =
          kind === 'location'
            ? `${base()}/locations/${location.id}`
            : `${base()}/catalog/items/${item.id}${kind === 'variant' ? `/variants/${variant.id}` : ''}`;
        const results = await Promise.all([
          call('POST', route('adjustments'), adjust(variant.id, '1', 'INCREASE', location.id)),
          call('PATCH', url, kind === 'tracking' ? { trackInventory: false } : { isActive: false }),
        ]);
        assert.deepEqual(
          results.map((r) => r.statusCode).sort(),
          results[0].statusCode === 201 ? [201, 409] : [200, 409],
          results.map((r) => r.body).join('\n'),
        );
      }
      await consistent();
    },
  );
  void test('historical/inactive nonzero stock remains discoverable; zero stock can deactivate locations', async () => {
    const { prisma } = context();
    const item = await createItem('Legacy archived stock');
    const extra = await ok<CatalogVariantResponse>(
      'POST',
      `${base()}/catalog/items/${item.id}/variants`,
      { sellingPrice: '1', unit: 'PIECE' },
    );
    const location = await ok<LocationResponse>('POST', `${base()}/locations`, {
      name: 'Historical location',
      type: 'OTHER',
    });
    const movement = await ok<InventoryTransactionResponse>(
      'POST',
      route('adjustments'),
      adjust(extra.id, '1', 'INCREASE', location.id),
    );
    // Simulate pre-existing inconsistent activity flags; API mutations themselves reject these.
    await prisma.catalogItem.update({ where: { id: item.id }, data: { isActive: false } });
    await prisma.catalogVariant.update({ where: { id: extra.id }, data: { isActive: false } });
    await prisma.location.update({ where: { id: location.id }, data: { isActive: false } });
    const page = await ok<PageResponse<InventoryStockRow>>(
      'GET',
      route(`stock?itemId=${item.id}&locationId=${location.id}`),
    );
    const row = page.items.find((row) => row.variantId === extra.id)!;
    assert.equal(row.quantity, '1.000000');
    assert.equal(row.isActive, false);
    assert.equal(row.location?.isActive, false);
    assert.equal(
      (await ok<InventoryTransactionResponse>('GET', route(`transactions/${movement.id}`)))
        .entries[0]!.location.isActive,
      false,
    );
    await conflict(route(`transactions/${movement.id}/reverse`), {}, 'INVENTORY_RESOURCE_INACTIVE');
    await ok('PATCH', `${base()}/catalog/items/${item.id}`, { isActive: true });
    await ok('PATCH', `${base()}/catalog/items/${item.id}/variants/${extra.id}`, {
      isActive: true,
    });
    await ok('PATCH', `${base()}/locations/${location.id}`, { isActive: true });
    await ok('POST', route(`transactions/${movement.id}/reverse`), {});
    await ok('PATCH', `${base()}/locations/${location.id}`, { isActive: false });
    await conflict(
      `${base()}/catalog/items/${item.id}/variants/${extra.id}`,
      { unit: 'GRAM' },
      'INVENTORY_UNIT_IMMUTABLE',
      'PATCH',
    );
    await consistent();
  });
  void test('strict quantities, overflow, headers, mass assignment and bounded cursor reads', async () => {
    const item = await createItem();
    const variant = item.defaultVariant.id;
    for (const quantity of [
      '0',
      '-1',
      'NaN',
      'Infinity',
      '1e3',
      '0.0000001',
      '10000000000000',
      1.2,
    ])
      assert.equal(
        (await call('POST', route('adjustments'), { ...adjust(variant, '1'), quantity }))
          .statusCode,
        400,
      );
    for (const field of [
      'organizationId',
      'createdByUserId',
      'quantityDelta',
      'createdAt',
      'requestHash',
    ])
      assert.equal(
        (
          await call('POST', route('adjustments'), {
            ...adjust(variant, '1'),
            [field]: randomUUID(),
          })
        ).statusCode,
        400,
      );
    for (const key of [null, 'invalid'])
      assert.equal(
        (await call('POST', route('adjustments'), adjust(variant, '1'), key)).statusCode,
        400,
      );
    assert.equal(
      (
        await call('POST', route('adjustments'), {
          ...adjust(variant, '1'),
          note: 'x'.repeat(2001),
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (await call('POST', route('transfers'), transfer(variant, '1', source.id, source.id)))
        .statusCode,
      400,
    );
    await ok('POST', route('opening-balances'), command(variant, '9999999999999.999999'));
    await conflict(
      route('adjustments'),
      adjust(variant, '0.000001'),
      'INVENTORY_QUANTITY_OVERFLOW',
    );
    assert.equal(await stock(item), '9999999999999.999999');
    await ok(
      'POST',
      route('opening-balances'),
      command(variant, '9999999999999.999999', destination.id),
    );
    assert.equal(await stock(item), '19999999999999.999998');
    for (const query of [
      'stock?limit=1000000',
      'transactions?limit=0',
      'transactions?cursor=bad',
      'transactions?from=2026-02-30',
      'transactions?from=2026-02-01&to=2025-01-01',
    ])
      assert.equal((await call('GET', route(query))).statusCode, 400);
    const first = await ok<PageResponse<InventoryTransactionResponse>>(
      'GET',
      route('transactions?limit=2'),
    );
    assert.ok(first.nextCursor);
    const next = await ok<PageResponse<InventoryTransactionResponse>>(
      'GET',
      route(`transactions?limit=2&cursor=${first.nextCursor}`),
    );
    assert.ok(next.items.every((row) => !first.items.some((prior) => prior.id === row.id)));
    const filtered = await ok<PageResponse<InventoryTransactionResponse>>(
      'GET',
      route(`transactions?variantId=${variant}&locationId=${source.id}&type=OPENING_BALANCE`),
    );
    assert.equal(filtered.items.length, 1);
    await consistent();
  });
}
