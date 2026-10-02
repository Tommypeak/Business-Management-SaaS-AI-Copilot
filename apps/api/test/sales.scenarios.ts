import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  Permission,
  type CatalogItemResponse,
  type CustomerResponse,
  type LocationResponse,
  type OrganizationResponse,
  type PageResponse,
  type SalesOrderResponse,
  type SalesOrderListItem,
  type SalesPaymentResponse,
  type UserResponse,
  type InventoryTransactionResponse,
} from '@saas/types';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { lockedOrder } from '../src/sales/sales-transaction.js';
interface Context {
  app: NestFastifyApplication;
  prisma: PrismaService;
  admin: PrismaClient;
  schema: string;
  token: (subject: string) => Promise<string>;
  legacyOrganizationId: string;
}
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export function registerSalesTests(context: () => Context) {
  let org: string,
    foreignOrg: string,
    owner: string,
    outsider: string,
    member: string,
    adminToken: string;
  let location: LocationResponse,
    foreignLocation: LocationResponse,
    customer: CustomerResponse,
    foreignCustomer: CustomerResponse,
    foreignItem: CatalogItemResponse;
  const base = (tenant = org) => `/api/v1/organizations/${tenant}`;
  const orders = (suffix = '', tenant = org) => `${base(tenant)}/sales/orders${suffix}`;
  const call = (
    method: Method,
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
    method: Method,
    url: string,
    payload?: object,
    key?: string,
    bearer = owner,
  ): Promise<T> {
    const res = await call(method, url, payload, key, bearer);
    assert.equal(res.statusCode, method === 'POST' ? 201 : 200, res.body);
    return res.json<T>();
  }
  async function rejected(
    method: Method,
    url: string,
    payload: object,
    status: number,
    code?: string,
    key?: string,
    bearer = owner,
  ) {
    const res = await call(method, url, payload, key, bearer);
    assert.equal(res.statusCode, status, res.body);
    if (code) assert.equal(res.json<{ code: string }>().code, code);
  }
  const product = (price = '10', track = true, tenant = org, bearer = owner, type = 'PRODUCT') =>
    ok<CatalogItemResponse>(
      'POST',
      `${base(tenant)}/catalog/items`,
      {
        name: `Sales ${randomUUID()}`,
        type,
        trackInventory: track,
        defaultVariant: { unit: 'PIECE', sellingPrice: price },
      },
      undefined,
      bearer,
    );
  const line = (item: CatalogItemResponse, quantity = '1', discountAmount = '0') => ({
    variantId: item.defaultVariant.id,
    quantity,
    discountAmount,
  });
  const draft = (items: object[] = [], extra: object = {}, key?: string) =>
    ok<SalesOrderResponse>('POST', orders(), { locationId: location.id, items, ...extra }, key);
  const complete = (order: SalesOrderResponse, payments: object[] = [], key?: string) =>
    ok<SalesOrderResponse>('POST', orders(`/${order.id}/complete`), { payments }, key);
  const opening = (item: CatalogItemResponse, quantity: string) =>
    ok('POST', `${base()}/inventory/opening-balances`, {
      locationId: location.id,
      variantId: item.defaultVariant.id,
      quantity,
    });
  const stock = async (item: CatalogItemResponse) =>
    (
      await context().prisma.inventoryBalance.findUnique({
        where: {
          organizationId_locationId_variantId: {
            organizationId: org,
            locationId: location.id,
            variantId: item.defaultVariant.id,
          },
        },
      })
    )?.quantity.toFixed(6) ?? '0.000000';
  void test('sales permissions backfill existing organizations and initialize new organizations', async () => {
    [owner, outsider, member, adminToken] = await Promise.all([
      context().token('sales-owner'),
      context().token('sales-outsider'),
      context().token('sales-member'),
      context().token('sales-admin'),
    ]);
    const input = {
      name: 'Sales organization',
      businessType: 'MIXED',
      defaultCurrency: 'USD',
      timezone: 'UTC',
    };
    org = (await ok<OrganizationResponse>('POST', '/api/v1/organizations', input)).id;
    foreignOrg = (
      await ok<OrganizationResponse>('POST', '/api/v1/organizations', input, undefined, outsider)
    ).id;
    for (const tenant of [context().legacyOrganizationId, org])
      for (const key of ['OWNER', 'ADMIN', 'MEMBER']) {
        const role = await context().prisma.role.findUniqueOrThrow({
          where: { organizationId_key: { organizationId: tenant, key } },
          include: { permissions: true },
        });
        const expected = Object.values(Permission).filter(
          (p) =>
            (p.startsWith('sales.') || p.startsWith('customers.')) &&
            (key !== 'MEMBER' || p.endsWith('.view')),
        );
        assert.deepEqual(
          role.permissions
            .map((p) => p.permissionCode)
            .filter((p) => p.startsWith('sales.') || p.startsWith('customers.'))
            .sort(),
          expected.sort(),
        );
      }
    for (const [bearer, key] of [
      [member, 'MEMBER'],
      [adminToken, 'ADMIN'],
    ] as const) {
      const user = await ok<UserResponse>('GET', '/api/v1/me', undefined, undefined, bearer);
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
    location = await ok('POST', `${base()}/locations`, { name: 'Sales store', type: 'STORE' });
    foreignLocation = await ok(
      'POST',
      `${base(foreignOrg)}/locations`,
      { name: 'Other store', type: 'STORE' },
      undefined,
      outsider,
    );
    customer = await ok('POST', `${base()}/customers`, {
      type: 'INDIVIDUAL',
      name: 'Customer',
      email: 'shared@example.com',
      phone: '123',
    });
    foreignCustomer = await ok(
      'POST',
      `${base(foreignOrg)}/customers`,
      { type: 'BUSINESS', name: 'Foreign customer' },
      undefined,
      outsider,
    );
    foreignItem = await product('10', false, foreignOrg, outsider);
  });
  void test('customers: duplicates, search, archive, tenant isolation and MEMBER read-only', async () => {
    await ok(
      'POST',
      `${base()}/customers`,
      { type: 'BUSINESS', name: 'Business', email: 'shared@example.com', phone: '123' },
      undefined,
      adminToken,
    );
    const page = await ok<PageResponse<CustomerResponse>>(
      'GET',
      `${base()}/customers?q=shared%40example.com`,
    );
    assert.equal(page.items.length, 2);
    assert.equal(
      (await ok<PageResponse<CustomerResponse>>('GET', `${base()}/customers?q=Foreign`)).items
        .length,
      0,
    );
    await ok('GET', `${base()}/customers/${customer.id}`, undefined, undefined, member);
    for (const method of ['POST', 'PATCH'] as const)
      await rejected(
        method,
        `${base()}/customers${method === 'PATCH' ? `/${customer.id}` : ''}`,
        { type: 'INDIVIDUAL', name: 'Forbidden' },
        403,
        undefined,
        undefined,
        member,
      );
    for (const method of ['GET', 'PATCH'] as const)
      await rejected(method, `${base()}/customers/${foreignCustomer.id}`, {}, 404);
    const order = await draft([], { customerId: customer.id });
    await ok('PATCH', `${base()}/customers/${customer.id}`, { isActive: false });
    assert.equal(
      (await ok<SalesOrderResponse>('GET', orders(`/${order.id}`))).customer?.id,
      customer.id,
    );
    await rejected('POST', orders(), { customerId: customer.id }, 409, 'CUSTOMER_INACTIVE');
    await ok('PATCH', `${base()}/customers/${customer.id}`, { isActive: true });
    await rejected('GET', `${base()}/customers?limit=101`, {}, 400);
  });
  void test('draft creation is idempotent, canonical and has concurrent tenant-scoped sequence numbers', async () => {
    const key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => draft([], { note: 'test' }, key)),
    );
    assert.equal(new Set(results.map((r) => r.id)).size, 1);
    await rejected('POST', orders(), { note: 'different' }, 409, 'IDEMPOTENCY_KEY_CONFLICT', key);
    const concurrent = await Promise.all(Array.from({ length: 16 }, () => draft()));
    assert.equal(new Set(concurrent.map((r) => r.sequenceNumber)).size, 16);
    assert.equal(
      Math.max(...concurrent.map((r) => r.sequenceNumber)) -
        Math.min(...concurrent.map((r) => r.sequenceNumber)),
      15,
    );
    const foreign = await ok<SalesOrderResponse>('POST', orders('', foreignOrg), {}, key, outsider);
    assert.equal(foreign.sequenceNumber, 1);
    assert.equal(
      (await context().prisma.salesSequence.findUniqueOrThrow({ where: { organizationId: org } }))
        .lastNumber,
      concurrent.length + 2,
    );
  });
  void test('totals use exact decimal strings, HALF_UP per line and reject manipulated money', async () => {
    const item = await product('10.1234', false);
    const order = await draft([line(item, '2.500000', '1.0000')]);
    assert.equal(order.subtotal, '25.3085');
    assert.equal(order.discountTotal, '1.0000');
    assert.equal(order.total, '24.3085');
    assert.equal(order.items[0]?.unitPrice, '10.1234');
    const tiny = await product('0.0001', false);
    assert.equal((await draft([line(tiny, '0.500000')])).total, '0.0001');
    const large = await product('999999999999999.9999', false);
    assert.equal((await draft([line(large)])).total, '999999999999999.9999');
    await rejected('POST', orders(), { items: [line(large, '2')] }, 400);
    for (const quantity of ['0', '-1', 'NaN', 'Infinity', '1.0000001', '1e2'])
      await rejected('POST', orders(), { items: [line(item, quantity)] }, 400);
    for (const extra of [
      { total: '1' },
      { subtotal: '1' },
      { createdByUserId: randomUUID() },
      { organizationId: foreignOrg },
      { currencyCode: 'EUR' },
    ])
      await rejected('POST', orders(), { ...extra }, 400);
    for (const extra of [
      { unitPrice: '1' },
      { lineTotal: '1' },
      { discountAmount: '11' },
      { quantity: 1 },
    ])
      await rejected('POST', orders(), { items: [{ ...line(item), ...extra }] }, 400);
    await rejected('PUT', orders(`/${order.id}/items`), { items: [line(item), line(item)] }, 400);
    assert.equal((await call('POST', orders(), {}, null)).statusCode, 400);
  });
  void test('mixed completion creates one SALE with only tracked products and preserves snapshots', async () => {
    const tracked = await product('10'),
      plain = await product('20', false),
      service = await product('30', false, org, owner, 'SERVICE');
    await opening(tracked, '10');
    const order = await draft([line(tracked, '2'), line(plain), line(service)], {
      customerId: customer.id,
    });
    assert.equal(await stock(tracked), '10.000000');
    await ok(
      'PATCH',
      `${base()}/catalog/items/${tracked.id}/variants/${tracked.defaultVariant.id}`,
      { sellingPrice: '99', sku: 'NEW-SKU' },
    );
    const result = await complete(order, [{ method: 'CASH', amount: '70' }]);
    assert.equal(result.status, 'COMPLETED');
    assert.equal(result.paymentStatus, 'PAID');
    assert.equal(result.total, '70.0000');
    assert.equal(result.items.length, 3);
    assert.equal(await stock(tracked), '8.000000');
    const movement = await context().prisma.inventoryTransaction.findUniqueOrThrow({
      where: { salesOrderId: order.id },
      include: { entries: true },
    });
    assert.equal(movement.type, 'SALE');
    assert.equal(movement.entries.length, 1);
    assert.equal(movement.entries[0]?.quantityDelta.toFixed(6), '-2.000000');
    await rejected(
      'POST',
      `${base()}/inventory/transactions/${movement.id}/reverse`,
      {},
      409,
      'INVENTORY_REVERSAL_NOT_ALLOWED',
    );
    await ok('PATCH', `${base()}/catalog/items/${tracked.id}`, { name: 'Renamed' });
    const historical = await ok<SalesOrderResponse>('GET', orders(`/${order.id}`));
    assert.equal(
      historical.items.find((i) => i.variantId === tracked.defaultVariant.id)?.snapshotItemName,
      tracked.name,
    );
    assert.equal(
      historical.items.find((i) => i.variantId === tracked.defaultVariant.id)?.snapshotSku,
      null,
    );
    await ok('PATCH', `${base()}/customers/${customer.id}`, { isActive: false });
    assert.equal(
      (await ok<SalesOrderResponse>('GET', orders(`/${order.id}`))).customer?.isActive,
      false,
    );
    await ok('PATCH', `${base()}/customers/${customer.id}`, { isActive: true });
    for (const [method, suffix, payload] of [
      ['PATCH', '', { customerId: null }],
      ['PATCH', '', { locationId: null }],
      ['PUT', '/items', { items: [] }],
      ['POST', '/cancel', {}],
    ] as const)
      await rejected(method, orders(`/${order.id}${suffix}`), payload, 409, 'ORDER_NOT_DRAFT');
    await assert.rejects(
      context().prisma.salesOrder.update({ where: { id: order.id }, data: { total: '1' } }),
    );
    await assert.rejects(
      context().prisma.salesOrderItem.delete({ where: { id: result.items[0]!.id } }),
    );
    await assert.rejects(
      context().prisma.salesPayment.delete({ where: { id: result.payments[0]!.id } }),
    );
  });
  void test('insufficient stock and excessive initial payments roll back the entire completion', async () => {
    const item = await product();
    await opening(item, '2');
    const order = await draft([line(item, '3')]);
    const before = await context().prisma.inventoryLedgerEntry.count();
    await rejected(
      'POST',
      orders(`/${order.id}/complete`),
      { payments: [{ method: 'CASH', amount: '1' }] },
      409,
      'INSUFFICIENT_STOCK',
    );
    assert.equal((await ok<SalesOrderResponse>('GET', orders(`/${order.id}`))).status, 'DRAFT');
    assert.equal(await stock(item), '2.000000');
    const affordable = await draft([line(item)]);
    await rejected(
      'POST',
      orders(`/${affordable.id}/complete`),
      { payments: [{ method: 'CASH', amount: '11' }] },
      409,
      'PAYMENT_EXCEEDS_OUTSTANDING',
    );
    assert.equal(await context().prisma.inventoryLedgerEntry.count(), before);
    assert.equal(await stock(item), '2.000000');
    assert.equal(
      (await ok<SalesOrderResponse>('GET', orders(`/${affordable.id}`))).payments.length,
      0,
    );
  });
  void test('concurrent sales cannot oversell and completion replay creates a single movement/payment', async () => {
    const item = await product();
    await opening(item, '5');
    const a = await draft([line(item, '4')]),
      b = await draft([line(item, '4')]);
    const results = await Promise.all(
      [a, b].map((o) => call('POST', orders(`/${o.id}/complete`), {})),
    );
    assert.deepEqual(results.map((r) => r.statusCode).sort(), [201, 409]);
    assert.equal(
      results.find((r) => r.statusCode === 409)?.json<{ code: string }>().code,
      'INSUFFICIENT_STOCK',
    );
    assert.equal(await stock(item), '1.000000');
    const order = await draft([line(item)]),
      key = randomUUID(),
      payload = { payments: [{ method: 'CARD', amount: '10' }] };
    const replays = await Promise.all(
      Array.from({ length: 8 }, () =>
        ok<SalesOrderResponse>('POST', orders(`/${order.id}/complete`), payload, key),
      ),
    );
    assert.equal(new Set(replays.map((r) => r.payments[0]?.id)).size, 1);
    assert.equal(await stock(item), '0.000000');
    assert.equal(
      await context().prisma.inventoryTransaction.count({
        where: { organizationId: org, salesOrderId: order.id },
      }),
      1,
    );
    await rejected(
      'POST',
      orders(`/${order.id}/complete`),
      { payments: [] },
      409,
      'IDEMPOTENCY_KEY_CONFLICT',
      key,
    );
    await rejected(
      'POST',
      orders(`/${a.id}/complete`),
      payload,
      409,
      'IDEMPOTENCY_KEY_CONFLICT',
      key,
    );
  });
  void test('forced failure after the first stock update rolls back both variants, order and payments', async () => {
    const a = await product(),
      b = await product();
    await opening(a, '5');
    await opening(b, '5');
    const order = await draft([line(a), line(b)]);
    const { prisma, admin, schema } = context();
    const before = await prisma.inventoryLedgerEntry.count();
    assert.match(schema, /^stage2_[a-f0-9]{32}$/);
    const last = [a.defaultVariant.id, b.defaultVariant.id].sort().at(-1)!;
    assert.match(last, /^[a-f0-9-]{36}$/);
    await admin.$executeRawUnsafe(
      `CREATE FUNCTION "${schema}".fail_sales_projection() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."variantId"='${last}'::uuid THEN RAISE EXCEPTION 'forced sales failure'; END IF; RETURN NEW; END; $$`,
    );
    await admin.$executeRawUnsafe(
      `CREATE TRIGGER fail_sales_projection BEFORE UPDATE ON "${schema}"."InventoryBalance" FOR EACH ROW EXECUTE FUNCTION "${schema}".fail_sales_projection()`,
    );
    try {
      const res = await call('POST', orders(`/${order.id}/complete`), {
        payments: [{ method: 'CASH', amount: '20' }],
      });
      assert.equal(res.statusCode, 500);
      assert.ok(!res.body.includes('forced sales failure'));
      assert.equal(await stock(a), '5.000000');
      assert.equal(await stock(b), '5.000000');
      assert.equal(await prisma.inventoryLedgerEntry.count(), before);
      const result = await ok<SalesOrderResponse>('GET', orders(`/${order.id}`));
      assert.equal(result.status, 'DRAFT');
      assert.equal(result.payments.length, 0);
    } finally {
      await admin.$executeRawUnsafe(
        `DROP TRIGGER fail_sales_projection ON "${schema}"."InventoryBalance"`,
      );
      await admin.$executeRawUnsafe(`DROP FUNCTION "${schema}".fail_sales_projection()`);
    }
  });
  void test('partial/final payments, SQL immutability, concurrency and canonical idempotency', async () => {
    const item = await product('100', false),
      order = await complete(await draft([line(item)]));
    assert.equal(order.paymentStatus, 'UNPAID');
    const key = randomUUID();
    await ok<SalesPaymentResponse>(
      'POST',
      orders(`/${order.id}/payments`),
      { amount: '30', method: 'BANK_TRANSFER', reference: ' bank ' },
      key,
    );
    await ok(
      'POST',
      orders(`/${order.id}/payments`),
      { amount: '30.0000', method: 'BANK_TRANSFER', reference: 'bank' },
      key,
    );
    let updated = await ok<SalesOrderResponse>('GET', orders(`/${order.id}`));
    assert.equal(updated.paidAmount, '30.0000');
    assert.equal(updated.outstandingAmount, '70.0000');
    assert.equal(updated.paymentStatus, 'PARTIALLY_PAID');
    await rejected(
      'POST',
      orders(`/${order.id}/payments`),
      { amount: '31', method: 'BANK_TRANSFER', reference: 'bank' },
      409,
      'IDEMPOTENCY_KEY_CONFLICT',
      key,
    );
    await ok('POST', orders(`/${order.id}/payments`), { amount: '70', method: 'QR' });
    updated = await ok('GET', orders(`/${order.id}`));
    assert.equal(updated.paymentStatus, 'PAID');
    assert.equal(updated.outstandingAmount, '0.0000');
    await rejected(
      'POST',
      orders(`/${order.id}/payments`),
      { amount: '1', method: 'OTHER' },
      409,
      'PAYMENT_EXCEEDS_OUTSTANDING',
    );
    const racing = await complete(await draft([line(item)]));
    const results = await Promise.all(
      [1, 2].map(() =>
        call('POST', orders(`/${racing.id}/payments`), { amount: '70', method: 'CASH' }),
      ),
    );
    assert.deepEqual(results.map((r) => r.statusCode).sort(), [201, 409]);
    assert.equal(
      (await ok<SalesOrderResponse>('GET', orders(`/${racing.id}`))).outstandingAmount,
      '30.0000',
    );
    const replayKey = randomUUID();
    const replay = await Promise.all(
      Array.from({ length: 6 }, () =>
        ok<SalesPaymentResponse>(
          'POST',
          orders(`/${racing.id}/payments`),
          { amount: '30', method: 'OTHER' },
          replayKey,
        ),
      ),
    );
    assert.equal(new Set(replay.map((p) => p.id)).size, 1);
    await assert.rejects(
      context().prisma.salesPayment.update({ where: { id: replay[0]!.id }, data: { amount: '1' } }),
    );
  });
  void test('negative-stock policy, zero-total sales, draft cancellation and inactive resources', async () => {
    const tracked = await product();
    const order = await draft([line(tracked)]);
    await ok('PATCH', `${base()}/inventory/settings`, { allowNegativeStock: true });
    await complete(order);
    assert.equal(await stock(tracked), '-1.000000');
    await ok('POST', `${base()}/inventory/adjustments`, {
      locationId: location.id,
      variantId: tracked.defaultVariant.id,
      quantity: '1',
      direction: 'INCREASE',
      reason: 'FOUND',
    });
    await ok('PATCH', `${base()}/inventory/settings`, { allowNegativeStock: false });
    const free = await product('0', false);
    assert.equal((await complete(await draft([line(free)]))).paymentStatus, 'PAID');
    const cancelled = await draft([line(free)]);
    await ok('POST', orders(`/${cancelled.id}/cancel`), {});
    for (const suffix of ['/complete', '/cancel'])
      await rejected('POST', orders(`/${cancelled.id}${suffix}`), {}, 409, 'ORDER_NOT_DRAFT');
    await rejected(
      'POST',
      orders(`/${cancelled.id}/payments`),
      { amount: '1', method: 'CASH' },
      409,
      'ORDER_NOT_COMPLETED',
    );
    await rejected('POST', orders(`/${(await draft()).id}/complete`), {}, 400);
    await rejected(
      'POST',
      orders(`/${(await draft([line(free)], { locationId: null })).id}/complete`),
      {},
      400,
    );
    for (const target of ['item', 'variant', 'location'] as const) {
      const item = await product('1', false);
      if (target === 'variant') {
        item.defaultVariant = await ok('POST', `${base()}/catalog/items/${item.id}/variants`, {
          name: 'Secondary',
          sellingPrice: '1',
          unit: 'PIECE',
        });
      }
      const loc = await ok<LocationResponse>('POST', `${base()}/locations`, {
        name: 'Transient',
        type: 'STORE',
      });
      const draftOrder = await draft([line(item)], { locationId: loc.id });
      const path =
        target === 'location'
          ? `${base()}/locations/${loc.id}`
          : target === 'item'
            ? `${base()}/catalog/items/${item.id}`
            : `${base()}/catalog/items/${item.id}/variants/${item.defaultVariant.id}`;
      await ok('PATCH', path, { isActive: false });
      await rejected(
        'POST',
        orders(`/${draftOrder.id}/complete`),
        {},
        409,
        'INVENTORY_RESOURCE_INACTIVE',
      );
      await ok('PATCH', path, { isActive: true });
      await complete(draftOrder);
      await ok('PATCH', path, { isActive: false });
      assert.equal(
        (await ok<SalesOrderResponse>('GET', orders(`/${draftOrder.id}`))).status,
        'COMPLETED',
      );
    }
  });
  void test('tenant isolation protects all assignments, order operations, payments and composite SQL keys', async () => {
    const item = await product('1', false);
    const order = await draft([line(item)]);
    const foreignOrder = await ok<SalesOrderResponse>(
      'POST',
      orders('', foreignOrg),
      { locationId: foreignLocation.id, items: [line(foreignItem)] },
      undefined,
      outsider,
    );
    for (const input of [
      { customerId: foreignCustomer.id },
      { locationId: foreignLocation.id },
      { items: [line(foreignItem)] },
    ])
      await rejected('POST', orders(), input, 404);
    for (const input of [{ customerId: foreignCustomer.id }, { locationId: foreignLocation.id }])
      await rejected('PATCH', orders(`/${order.id}`), input, 404);
    await rejected('PUT', orders(`/${order.id}/items`), { items: [line(foreignItem)] }, 404);
    for (const [method, suffix, payload] of [
      ['GET', '', {}],
      ['PATCH', '', {}],
      ['PUT', '/items', { items: [] }],
      ['POST', '/complete', {}],
      ['POST', '/cancel', {}],
      ['GET', '/payments', {}],
      ['POST', '/payments', { amount: '1', method: 'CASH' }],
    ] as const)
      await rejected(method, orders(`/${foreignOrder.id}${suffix}`), payload, 404);
    await assert.rejects(
      context().prisma.salesOrder.update({
        where: { id: order.id },
        data: { customerId: foreignCustomer.id },
      }),
    );
    await assert.rejects(
      context().prisma.salesOrderItem.update({
        where: { id: order.items[0]!.id },
        data: { variantId: foreignItem.defaultVariant.id },
      }),
    );
    assert.equal(
      (
        await ok<PageResponse<SalesOrderListItem>>(
          'GET',
          orders(`?customerId=${foreignCustomer.id}`),
        )
      ).items.length,
      0,
    );
  });
  void test('MEMBER is read-only; ADMIN can complete and pay; completion requires payment permission separately', async () => {
    const item = await product('1', false),
      order = await draft([line(item)]);
    await ok('GET', orders(), undefined, undefined, member);
    await ok('GET', orders(`/${order.id}`), undefined, undefined, member);
    for (const [method, suffix, payload] of [
      ['POST', '', {}],
      ['PATCH', `/${order.id}`, {}],
      ['PUT', `/${order.id}/items`, { items: [] }],
      ['POST', `/${order.id}/complete`, {}],
      ['POST', `/${order.id}/cancel`, {}],
      ['POST', `/${order.id}/payments`, { method: 'CASH', amount: '1' }],
    ] as const)
      await rejected(method, orders(suffix), payload, 403, undefined, undefined, member);
    const role = await context().prisma.role.findUniqueOrThrow({
      where: { organizationId_key: { organizationId: org, key: 'ADMIN' } },
    });
    await context().prisma.rolePermission.delete({
      where: {
        roleId_permissionCode: {
          roleId: role.id,
          permissionCode: Permission.SALES_PAYMENTS_MANAGE,
        },
      },
    });
    await rejected(
      'POST',
      orders(`/${order.id}/complete`),
      { payments: [{ amount: '1', method: 'CASH' }] },
      403,
      undefined,
      undefined,
      adminToken,
    );
    await context().prisma.rolePermission.create({
      data: {
        organizationId: org,
        roleId: role.id,
        permissionCode: Permission.SALES_PAYMENTS_MANAGE,
      },
    });
    await ok('POST', orders(`/${order.id}/complete`), {}, undefined, adminToken);
    await ok(
      'POST',
      orders(`/${order.id}/payments`),
      { method: 'CASH', amount: '1' },
      undefined,
      adminToken,
    );
  });
  void test('uppercase UUIDs share locks and hashes; sale history includes every tracked line', async () => {
    const products = await Promise.all([product(), product(), product()]);
    for (const item of products) await opening(item, '2');
    const createKey = randomUUID();
    const created = await draft(
      products.map((item) => line(item)),
      {},
      createKey,
    );
    const replay = await ok<SalesOrderResponse>(
      'POST',
      orders('', org.toUpperCase()),
      {
        locationId: location.id.toUpperCase(),
        items: products
          .slice()
          .reverse()
          .map((item) => ({
            ...line(item, '1.000000'),
            variantId: item.defaultVariant.id.toUpperCase(),
          })),
      },
      createKey.toUpperCase(),
    );
    assert.equal(replay.id, created.id);
    const key = randomUUID();
    const results = await Promise.all([
      complete(created, [{ method: 'CASH', amount: '1' }], key),
      ok<SalesOrderResponse>(
        'POST',
        orders(`/${created.id.toUpperCase()}/complete`, org.toUpperCase()),
        { payments: [{ method: 'CASH', amount: '1.0000' }] },
        key.toUpperCase(),
      ),
    ]);
    assert.equal(results[0]?.payments[0]?.id, results[1]?.payments[0]?.id);
    const tx = await context().prisma.inventoryTransaction.findUniqueOrThrow({
      where: { salesOrderId: created.id },
    });
    const history = await ok<InventoryTransactionResponse>(
      'GET',
      `${base()}/inventory/transactions/${tx.id}`,
    );
    assert.equal(history.entries.length, 3);
    for (const item of products) assert.equal(await stock(item), '1.000000');
    await assert.rejects(
      context().prisma.inventoryLedgerEntry.create({
        data: {
          organizationId: org,
          transactionId: tx.id,
          locationId: foreignLocation.id,
          variantId: products[0].defaultVariant.id,
          quantityDelta: '-1',
        },
      }),
    );
    const paymentKey = randomUUID();
    const payment = await ok<SalesPaymentResponse>(
      'POST',
      orders(`/${created.id}/payments`),
      { amount: '1', method: 'CARD' },
      paymentKey,
    );
    assert.equal(
      (
        await ok<SalesPaymentResponse>(
          'POST',
          orders(`/${created.id.toUpperCase()}/payments`, org.toUpperCase()),
          { amount: '1.0000', method: 'CARD' },
          paymentKey.toUpperCase(),
        )
      ).id,
      payment.id,
    );
  });
  void test('order locks do not serialize other orders; mutation/completion and payment/cancellation are safe', async () => {
    const item = await product('10', false),
      a = await draft([line(item)]),
      b = await draft([line(item)]);
    let release!: () => void, acquired!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
      }),
      ready = new Promise<void>((resolve) => {
        acquired = resolve;
      });
    const held = context().prisma.$transaction(
      async (tx) => {
        await lockedOrder(tx, org, a.id);
        acquired();
        await gate;
      },
      { timeout: 15000 },
    );
    await ready;
    try {
      assert.equal((await complete(b)).status, 'COMPLETED');
    } finally {
      release();
      await held;
    }
    const [updated, completed] = await Promise.all([
      call('PUT', orders(`/${a.id}/items`), { items: [line(item, '2')] }),
      call('POST', orders(`/${a.id}/complete`), {}),
    ]);
    assert.equal(completed.statusCode, 201);
    assert.ok([200, 409].includes(updated.statusCode));
    const result = await ok<SalesOrderResponse>('GET', orders(`/${a.id}`));
    assert.equal(result.total, updated.statusCode === 200 ? '20.0000' : '10.0000');
    const empty = await draft([line(item)]);
    const [cancel, payment] = await Promise.all([
      call('POST', orders(`/${empty.id}/cancel`), {}),
      call('POST', orders(`/${empty.id}/payments`), { amount: '1', method: 'CASH' }),
    ]);
    assert.equal(cancel.statusCode, 201);
    assert.equal(payment.statusCode, 409);
    assert.equal((await ok<SalesOrderResponse>('GET', orders(`/${empty.id}`))).payments.length, 0);
  });
  void test('unit changes require an explicit draft refresh; payment validation and SQL source integrity', async () => {
    const item = await product('10', false),
      order = await draft([line(item)]);
    await ok('PATCH', `${base()}/catalog/items/${item.id}/variants/${item.defaultVariant.id}`, {
      unit: 'KILOGRAM',
    });
    await rejected('POST', orders(`/${order.id}/complete`), {}, 409, 'ORDER_UNIT_CHANGED');
    const refreshed = await ok<SalesOrderResponse>('PUT', orders(`/${order.id}/items`), {
      items: [line(item)],
    });
    await complete(refreshed);
    for (const amount of ['0', '-1', '0.00001', 'NaN', 'Infinity'])
      await rejected('POST', orders(`/${order.id}/payments`), { amount, method: 'CASH' }, 400);
    await rejected(
      'POST',
      orders(`/${order.id}/payments`),
      { amount: '1', method: 'CASH', currencyCode: 'EUR' },
      400,
    );
    const actor = (await context().prisma.salesOrder.findUniqueOrThrow({ where: { id: order.id } }))
      .createdByUserId;
    await assert.rejects(
      context().prisma.salesPayment.create({
        data: {
          organizationId: foreignOrg,
          salesOrderId: order.id,
          createdByUserId: actor,
          amount: '1',
          method: 'CASH',
          idempotencyKey: randomUUID(),
          requestHash: '0'.repeat(64),
        },
      }),
    );
    await assert.rejects(
      context().prisma.inventoryTransaction.create({
        data: {
          organizationId: foreignOrg,
          salesOrderId: order.id,
          type: 'SALE',
          createdByUserId: actor,
          idempotencyKey: randomUUID(),
          requestHash: '0'.repeat(64),
        },
      }),
    );
  });
  void test('currency/price snapshots and bounded deterministic list filters remain authoritative', async () => {
    const item = await product('2', false);
    const order = await draft([line(item)]);
    await ok('PATCH', `${base()}/catalog/items/${item.id}/variants/${item.defaultVariant.id}`, {
      sellingPrice: '3',
    });
    assert.equal((await ok<SalesOrderResponse>('GET', orders(`/${order.id}`))).total, '2.0000');
    const refreshed = await ok<SalesOrderResponse>('PUT', orders(`/${order.id}/items`), {
      items: [line(item)],
    });
    assert.equal(refreshed.total, '3.0000');
    await context().prisma.organization.update({
      where: { id: org },
      data: { defaultCurrency: 'EUR' },
    });
    assert.equal((await complete(refreshed)).currencyCode, 'USD');
    assert.equal((await draft()).currencyCode, 'EUR');
    const seen = new Set<string>();
    let cursor: string | null = null;
    do {
      const page: PageResponse<SalesOrderListItem> = await ok(
        'GET',
        orders(`?limit=7${cursor ? `&cursor=${cursor}` : ''}`),
      );
      for (const row of page.items) {
        assert.ok(!seen.has(row.id));
        seen.add(row.id);
      }
      cursor = page.nextCursor;
    } while (cursor);
    assert.equal(
      seen.size,
      await context().prisma.salesOrder.count({ where: { organizationId: org } }),
    );
    const paid = await ok<PageResponse<SalesOrderListItem>>('GET', orders('?paymentStatus=PAID'));
    assert.ok(paid.items.every((o) => o.paymentStatus === 'PAID'));
    const search = await ok<PageResponse<SalesOrderListItem>>(
      'GET',
      orders(`?q=SO-${String(order.sequenceNumber).padStart(6, '0')}`),
    );
    assert.ok(search.items.some((o) => o.id === order.id));
    for (const query of ['limit=101', 'limit=0', 'cursor=garbage', 'from=2030-01-01&to=2020-01-01'])
      await rejected('GET', orders(`?${query}`), {}, 400);
    const movement = await context().prisma.inventoryTransaction.findFirstOrThrow({
      where: { organizationId: org, type: 'SALE' },
    });
    const response = await ok<InventoryTransactionResponse>(
      'GET',
      `${base()}/inventory/transactions/${movement.id}`,
    );
    assert.equal(response.salesOrderId, movement.salesOrderId);
  });
}
