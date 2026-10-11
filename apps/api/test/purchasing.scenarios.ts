import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  Permission,
  type CatalogItemResponse,
  type GoodsReceiptResponse,
  type OrganizationResponse,
  type PageResponse,
  type PurchaseOrderListItem,
  type PurchaseOrderResponse,
  type SupplierResponse,
  type UserResponse,
} from '@saas/types';
import { Prisma, type PrismaClient } from '../src/generated/prisma/client.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
interface Context {
  app: NestFastifyApplication;
  prisma: PrismaService;
  admin: PrismaClient;
  schema: string;
  token: (subject: string) => Promise<string>;
  legacyOrganizationId: string;
}
type Method = 'GET' | 'POST' | 'PATCH' | 'PUT';
export function registerPurchasingTests(context: () => Context) {
  let org: string,
    foreignOrg: string,
    owner: string,
    outsider: string,
    member: string,
    admin: string;
  let location: string,
    otherLocation: string,
    supplier: SupplierResponse,
    tracked: CatalogItemResponse,
    untracked: CatalogItemResponse;
  const base = (id = org) => `/api/v1/organizations/${id}`;
  const route = (suffix = '', id = org) => `${base(id)}/purchasing/orders${suffix}`;
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
    const response = await call(method, url, payload, key, bearer);
    assert.equal(response.statusCode, method === 'POST' ? 201 : 200, response.body);
    return response.json<T>();
  }
  async function reject(
    method: Method,
    url: string,
    payload: object | undefined,
    status: number,
    code?: string,
    key?: string,
    bearer = owner,
  ) {
    const response = await call(method, url, payload, key, bearer);
    assert.equal(response.statusCode, status, response.body);
    if (code) assert.equal(response.json<{ code: string }>().code, code);
  }
  const line = (item: CatalogItemResponse, orderedQuantity = '10', unitCost = '10.1234') => ({
    variantId: item.defaultVariant.id,
    orderedQuantity,
    unitCost,
  });
  const draft = (items: object[] = [], extra: object = {}, key?: string) =>
    ok<PurchaseOrderResponse>(
      'POST',
      route(),
      { supplierId: supplier.id, destinationLocationId: location, items, ...extra },
      key,
    );
  const order = (id: string, key?: string) =>
    ok<PurchaseOrderResponse>('POST', route(`/${id}/order`), {}, key);
  const receipt = (
    id: string,
    items: { purchaseOrderItemId: string; quantity: string }[],
    key?: string,
  ) => ok<GoodsReceiptResponse>('POST', route(`/${id}/receipts`), { items }, key);
  const stock = async (variantId: string) =>
    (
      await context().prisma.inventoryBalance.findUnique({
        where: {
          organizationId_locationId_variantId: {
            organizationId: org,
            locationId: location,
            variantId,
          },
        },
      })
    )?.quantity.toFixed(6) ?? '0.000000';

  void test('purchasing permissions backfill old roles; owner, admin and member setup', async () => {
    [owner, outsider, member, admin] = await Promise.all([
      context().token('purchase-owner'),
      context().token('purchase-outsider'),
      context().token('purchase-member'),
      context().token('purchase-admin'),
    ]);
    const input = {
      name: 'Purchasing organization',
      businessType: 'MIXED',
      defaultCurrency: 'USD',
      timezone: 'UTC',
    };
    org = (await ok<OrganizationResponse>('POST', '/api/v1/organizations', input)).id;
    foreignOrg = (
      await ok<OrganizationResponse>('POST', '/api/v1/organizations', input, undefined, outsider)
    ).id;
    for (const tenant of [context().legacyOrganizationId, org])
      for (const roleKey of ['OWNER', 'ADMIN', 'MEMBER']) {
        const role = await context().prisma.role.findUniqueOrThrow({
          where: { organizationId_key: { organizationId: tenant, key: roleKey } },
          include: { permissions: true },
        });
        const expected = Object.values(Permission)
          .filter(
            (p) =>
              (p.startsWith('purchasing.') || p.startsWith('suppliers.')) &&
              (roleKey !== 'MEMBER' || p.endsWith('.view')),
          )
          .sort();
        assert.deepEqual(
          role.permissions
            .map((p) => p.permissionCode)
            .filter((p) => p.startsWith('purchasing.') || p.startsWith('suppliers.'))
            .sort(),
          expected,
        );
      }
    for (const [bearer, roleKey] of [
      [member, 'MEMBER'],
      [admin, 'ADMIN'],
    ] as const) {
      const user = await ok<UserResponse>('GET', '/api/v1/me', undefined, undefined, bearer);
      const role = await context().prisma.role.findUniqueOrThrow({
        where: { organizationId_key: { organizationId: org, key: roleKey } },
      });
      const membership = await context().prisma.organizationMembership.create({
        data: { organizationId: org, userId: user.id },
      });
      await context().prisma.membershipRole.create({
        data: { organizationId: org, membershipId: membership.id, roleId: role.id },
      });
    }
    location = (
      await ok<{ id: string }>('POST', `${base()}/locations`, {
        name: 'Receiving warehouse',
        type: 'WAREHOUSE',
      })
    ).id;
    otherLocation = (
      await ok<{ id: string }>(
        'POST',
        `${base(foreignOrg)}/locations`,
        { name: 'Foreign warehouse', type: 'WAREHOUSE' },
        undefined,
        outsider,
      )
    ).id;
    supplier = await ok<SupplierResponse>('POST', `${base()}/suppliers`, {
      name: 'Supplier A',
      contactName: 'Alex',
    });
    tracked = await ok<CatalogItemResponse>('POST', `${base()}/catalog/items`, {
      name: 'Tracked purchase',
      type: 'PRODUCT',
      trackInventory: true,
      defaultVariant: { unit: 'PIECE', sellingPrice: '25', costPrice: '12' },
    });
    untracked = await ok<CatalogItemResponse>('POST', `${base()}/catalog/items`, {
      name: 'Untracked purchase',
      type: 'PRODUCT',
      trackInventory: false,
      defaultVariant: { unit: 'PIECE', sellingPrice: '25' },
    });
  });

  void test('supplier archive, tenant isolation and member write denial', async () => {
    assert.equal(
      (
        await ok<SupplierResponse>(
          'GET',
          `${base()}/suppliers/${supplier.id}`,
          undefined,
          undefined,
          member,
        )
      ).id,
      supplier.id,
    );
    await reject(
      'POST',
      `${base()}/suppliers`,
      { name: 'Forbidden' },
      403,
      undefined,
      undefined,
      member,
    );
    await reject(
      'PATCH',
      `${base()}/suppliers/${supplier.id}`,
      { name: 'Forbidden' },
      403,
      undefined,
      undefined,
      member,
    );
    await reject(
      'GET',
      `${base(foreignOrg)}/suppliers/${supplier.id}`,
      undefined,
      404,
      undefined,
      undefined,
      outsider,
    );
    await reject(
      'POST',
      route('', foreignOrg),
      { supplierId: supplier.id, destinationLocationId: otherLocation },
      404,
      undefined,
      undefined,
      outsider,
    );
    const archived = await ok<SupplierResponse>(
      'PATCH',
      `${base()}/suppliers/${supplier.id}`,
      { isActive: false },
      undefined,
      admin,
    );
    assert.equal(archived.isActive, false);
    await reject(
      'POST',
      route(),
      { supplierId: supplier.id, destinationLocationId: location },
      409,
      'PURCHASE_SUPPLIER_INACTIVE',
    );
    supplier = await ok<SupplierResponse>('PATCH', `${base()}/suppliers/${supplier.id}`, {
      isActive: true,
    });
  });

  void test('draft totals, currency snapshot, creation retry and concurrent sequence', async () => {
    const key = randomUUID(),
      payload = {
        supplierId: supplier.id,
        destinationLocationId: location,
        items: [line(tracked, '2.500000')],
      };
    const created = await ok<PurchaseOrderResponse>('POST', route(), payload, key);
    assert.equal(created.status, 'DRAFT');
    assert.equal(created.total, '25.3085');
    assert.equal(created.currencyCode, 'USD');
    assert.equal(created.items[0]?.unitCost, '10.1234');
    assert.equal(
      (
        await ok<PurchaseOrderResponse>(
          'POST',
          route(),
          { ...payload, items: [line(tracked, '2.5', '10.1234')] },
          key,
        )
      ).id,
      created.id,
    );
    await reject(
      'POST',
      route(),
      { ...payload, note: 'other' },
      409,
      'IDEMPOTENCY_KEY_CONFLICT',
      key,
    );
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        call('POST', route(), { supplierId: supplier.id, destinationLocationId: location }),
      ),
    );
    assert.ok(
      responses.every((r) => r.statusCode === 201),
      responses.map((r) => r.body).join('\n'),
    );
    assert.equal(
      new Set(responses.map((r) => r.json<PurchaseOrderResponse>().sequenceNumber)).size,
      8,
    );
    await reject(
      'POST',
      route(),
      { supplierId: supplier.id, destinationLocationId: otherLocation },
      404,
    );
    await reject(
      'POST',
      route(),
      { supplierId: supplier.id, destinationLocationId: location, total: '0' },
      400,
    );
  });

  void test('purchase DTO rejects services, duplicates and client-controlled fields', async () => {
    const service = await ok<CatalogItemResponse>('POST', `${base()}/catalog/items`, {
      name: 'Service only',
      type: 'SERVICE',
      trackInventory: false,
      defaultVariant: { unit: 'SERVICE', sellingPrice: '1' },
    });
    await reject(
      'POST',
      route(),
      { supplierId: supplier.id, destinationLocationId: location, items: [line(service)] },
      400,
    );
    await reject(
      'POST',
      route(),
      {
        supplierId: supplier.id,
        destinationLocationId: location,
        items: [line(tracked), line(tracked)],
      },
      400,
    );
    for (const field of [
      'status',
      'subtotal',
      'total',
      'createdByUserId',
      'sequenceNumber',
      'organizationId',
    ])
      await reject(
        'POST',
        route(),
        { supplierId: supplier.id, destinationLocationId: location, [field]: '0' },
        400,
      );
    const foreign = await ok<CatalogItemResponse>(
      'POST',
      `${base(foreignOrg)}/catalog/items`,
      {
        name: 'Foreign purchase variant',
        type: 'PRODUCT',
        trackInventory: true,
        defaultVariant: { unit: 'PIECE', sellingPrice: '1' },
      },
      undefined,
      outsider,
    );
    await reject(
      'POST',
      route(),
      { supplierId: supplier.id, destinationLocationId: location, items: [line(foreign)] },
      404,
    );
  });

  void test('purchase list filters and deterministic bounded cursor are tenant scoped', async () => {
    const first = await draft([line(untracked)]);
    const match = await ok<PageResponse<PurchaseOrderListItem>>(
      'GET',
      route(`?q=${encodeURIComponent(first.number)}`),
    );
    assert.ok(match.items.some((row) => row.id === first.id));
    const supplierSearch = await ok<PageResponse<PurchaseOrderListItem>>(
      'GET',
      route('?q=Supplier%20A'),
    );
    assert.ok(supplierSearch.items.some((row) => row.id === first.id));
    const seen = new Set<string>();
    let cursor: string | null = null;
    do {
      const page: PageResponse<PurchaseOrderListItem> = await ok<
        PageResponse<PurchaseOrderListItem>
      >('GET', route(`?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`));
      for (const row of page.items) {
        assert.ok(!seen.has(row.id));
        seen.add(row.id);
      }
      cursor = page.nextCursor;
    } while (cursor);
    assert.equal(
      seen.size,
      await context().prisma.purchaseOrder.count({ where: { organizationId: org } }),
    );
    const filtered = await ok<PageResponse<PurchaseOrderListItem>>(
      'GET',
      route(`?supplierId=${supplier.id}&destinationLocationId=${location}&status=DRAFT`),
    );
    assert.ok(
      filtered.items.every(
        (row) =>
          row.supplier.id === supplier.id &&
          row.destinationLocation.id === location &&
          row.status === 'DRAFT',
      ),
    );
    for (const query of ['limit=101', 'limit=0', 'cursor=garbage', 'from=2030-01-01&to=2020-01-01'])
      await reject('GET', route(`?${query}`), undefined, 400);
  });

  void test('ordering validates state, locks commercial data and preserves snapshots', async () => {
    const empty = await draft();
    await reject('POST', route(`/${empty.id}/order`), {}, 400);
    const created = await draft([line(tracked)]);
    const key = randomUUID();
    const ordered = await order(created.id, key);
    assert.equal(ordered.status, 'ORDERED');
    assert.equal((await order(created.id, key)).id, created.id);
    await reject('POST', route(`/${empty.id}/order`), {}, 409, 'IDEMPOTENCY_KEY_CONFLICT', key);
    await reject(
      'PATCH',
      route(`/${created.id}`),
      { supplierId: supplier.id },
      409,
      'PURCHASE_ORDER_NOT_EDITABLE',
    );
    await reject(
      'PUT',
      route(`/${created.id}/items`),
      { items: [line(tracked, '2')] },
      409,
      'PURCHASE_ORDER_NOT_EDITABLE',
    );
    await ok('PATCH', `${base()}/catalog/items/${tracked.id}`, { name: 'Renamed later' });
    await ok(
      'PATCH',
      `${base()}/catalog/items/${tracked.id}/variants/${tracked.defaultVariant.id}`,
      { sku: 'NEW-SKU', costPrice: '20' },
    );
    const history = await ok<PurchaseOrderResponse>('GET', route(`/${created.id}`));
    assert.equal(history.items[0]?.snapshotItemName, 'Tracked purchase');
    assert.equal(history.items[0]?.snapshotSku, null);
  });

  void test('partial receiving, idempotency, over-receipt, inventory and immutable history', async () => {
    const created = await draft([line(tracked), line(untracked, '5', '2')]);
    await order(created.id);
    const trackedLine = created.items.find((i) => i.variantId === tracked.defaultVariant.id)!;
    const untrackedLine = created.items.find((i) => i.variantId === untracked.defaultVariant.id)!;
    const key = randomUUID(),
      command = [
        { purchaseOrderItemId: trackedLine.id, quantity: '3' },
        { purchaseOrderItemId: untrackedLine.id, quantity: '2' },
      ];
    const [a, b] = await Promise.all([
      call('POST', route(`/${created.id}/receipts`), { items: command }, key),
      call('POST', route(`/${created.id}/receipts`), { items: command }, key),
    ]);
    assert.equal(a.statusCode, 201, a.body);
    assert.equal(b.statusCode, 201, b.body);
    assert.equal(a.json<GoodsReceiptResponse>().id, b.json<GoodsReceiptResponse>().id);
    assert.equal(await stock(tracked.defaultVariant.id), '3.000000');
    assert.equal(await stock(untracked.defaultVariant.id), '0.000000');
    const partial = await ok<PurchaseOrderResponse>('GET', route(`/${created.id}`));
    assert.equal(partial.status, 'PARTIALLY_RECEIVED');
    assert.equal(partial.items.find((i) => i.id === trackedLine.id)?.remainingQuantity, '7.000000');
    await reject(
      'POST',
      route(`/${created.id}/receipts`),
      { items: [{ purchaseOrderItemId: trackedLine.id, quantity: '8' }] },
      409,
      'RECEIPT_EXCEEDS_REMAINING_QUANTITY',
    );
    await reject(
      'POST',
      route(`/${created.id}/receipts`),
      { items: [{ purchaseOrderItemId: trackedLine.id, quantity: '4' }] },
      409,
      'IDEMPOTENCY_KEY_CONFLICT',
      key,
    );
    const second = await receipt(created.id, [
      { purchaseOrderItemId: trackedLine.id, quantity: '7' },
      { purchaseOrderItemId: untrackedLine.id, quantity: '3' },
    ]);
    assert.notEqual(second.id, a.json<GoodsReceiptResponse>().id);
    const done = await ok<PurchaseOrderResponse>('GET', route(`/${created.id}`));
    assert.equal(done.status, 'RECEIVED');
    assert.equal(done.receivedQuantity, '15.000000');
    assert.equal(await stock(tracked.defaultVariant.id), '10.000000');
    const tx = await context().prisma.inventoryTransaction.findUniqueOrThrow({
      where: { goodsReceiptId: second.id },
      include: { entries: true },
    });
    assert.equal(tx.type, 'PURCHASE_RECEIPT');
    assert.equal(tx.entries.length, 1);
    assert.equal(tx.entries[0]?.quantityDelta.toFixed(6), '7.000000');
    await reject(
      'POST',
      route(`/${created.id}/receipts`),
      { items: [{ purchaseOrderItemId: trackedLine.id, quantity: '1' }] },
      409,
      'PURCHASE_ORDER_NOT_RECEIVABLE',
    );
    await assert.rejects(
      context().prisma.goodsReceiptItem.update({
        where: { id: second.items[0]!.id },
        data: { receivedQuantity: '1' },
      }),
    );
  });

  void test('two concurrent receipts cannot over-receive; cancellation rules', async () => {
    const created = await draft([line(tracked)]);
    await order(created.id);
    const item = created.items[0]!,
      payload = { items: [{ purchaseOrderItemId: item.id, quantity: '7' }] };
    const results = await Promise.all([
      call('POST', route(`/${created.id}/receipts`), payload),
      call('POST', route(`/${created.id}/receipts`), payload),
    ]);
    assert.deepEqual(results.map((r) => r.statusCode).sort(), [201, 409]);
    assert.equal(
      await context().prisma.goodsReceipt.count({
        where: { organizationId: org, purchaseOrderId: created.id },
      }),
      1,
    );
    await reject('POST', route(`/${created.id}/cancel`), {}, 409, 'PURCHASE_ORDER_NOT_CANCELLABLE');
    const draftOrder = await draft();
    assert.equal(
      (await ok<PurchaseOrderResponse>('POST', route(`/${draftOrder.id}/cancel`))).status,
      'CANCELLED',
    );
    await reject(
      'POST',
      route(`/${draftOrder.id}/receipts`),
      payload,
      409,
      'PURCHASE_ORDER_NOT_RECEIVABLE',
    );
    const ordered = await draft([line(untracked)]);
    await order(ordered.id);
    assert.equal(
      (await ok<PurchaseOrderResponse>('POST', route(`/${ordered.id}/cancel`))).status,
      'CANCELLED',
    );
  });

  void test('concurrent receipts for separate orders allocate distinct GR numbers', async () => {
    const [a, b] = await Promise.all([
      draft([line(untracked, '1')]),
      draft([line(untracked, '1')]),
    ]);
    await Promise.all([order(a.id), order(b.id)]);
    const [ra, rb] = await Promise.all([
      receipt(a.id, [{ purchaseOrderItemId: a.items[0]!.id, quantity: '1' }]),
      receipt(b.id, [{ purchaseOrderItemId: b.items[0]!.id, quantity: '1' }]),
    ]);
    assert.notEqual(ra.sequenceNumber, rb.sequenceNumber);
    assert.equal(ra.items[0]?.inventoryTracked, false);
    assert.equal(rb.inventoryTransactionId, null);
  });

  void test('ordered supplier may be archived; inactive location and variant block receipt', async () => {
    const item = await ok<CatalogItemResponse>('POST', `${base()}/catalog/items`, {
      name: 'Later variant',
      type: 'PRODUCT',
      trackInventory: false,
      defaultVariant: { unit: 'PIECE', sellingPrice: '1' },
    });
    const variant = await ok<{ id: string }>(
      'POST',
      `${base()}/catalog/items/${item.id}/variants`,
      { name: 'Optional', unit: 'PIECE', sellingPrice: '1' },
    );
    const destination = (
      await ok<{ id: string }>('POST', `${base()}/locations`, {
        name: 'Temporary receiving',
        type: 'WAREHOUSE',
      })
    ).id;
    const created = await draft([{ variantId: variant.id, orderedQuantity: '2', unitCost: '1' }], {
      destinationLocationId: destination,
    });
    await order(created.id);
    await ok('PATCH', `${base()}/suppliers/${supplier.id}`, { isActive: false });
    await ok('PATCH', `${base()}/locations/${destination}`, { isActive: false });
    const command = { items: [{ purchaseOrderItemId: created.items[0]!.id, quantity: '2' }] };
    await reject(
      'POST',
      route(`/${created.id}/receipts`),
      command,
      409,
      'INVENTORY_RESOURCE_INACTIVE',
    );
    await ok('PATCH', `${base()}/locations/${destination}`, { isActive: true });
    await ok('PATCH', `${base()}/catalog/items/${item.id}/variants/${variant.id}`, {
      isActive: false,
    });
    await reject(
      'POST',
      route(`/${created.id}/receipts`),
      command,
      409,
      'INVENTORY_RESOURCE_INACTIVE',
    );
    await ok('PATCH', `${base()}/catalog/items/${item.id}/variants/${variant.id}`, {
      isActive: true,
    });
    const received = await ok<GoodsReceiptResponse>(
      'POST',
      route(`/${created.id}/receipts`),
      command,
    );
    await ok('PATCH', `${base()}/locations/${destination}`, { isActive: false });
    await ok('PATCH', `${base()}/catalog/items/${item.id}/variants/${variant.id}`, {
      isActive: false,
    });
    assert.equal(
      (await ok<GoodsReceiptResponse>('GET', `${base()}/purchasing/receipts/${received.id}`))
        .items[0]?.snapshotItemName,
      'Later variant',
    );
    assert.equal(
      (await ok<PurchaseOrderResponse>('GET', route(`/${created.id}`))).supplier.isActive,
      false,
    );
    supplier = await ok<SupplierResponse>('PATCH', `${base()}/suppliers/${supplier.id}`, {
      isActive: true,
    });
  });

  void test('purchase RBAC and tenant IDOR cover every write and read route', async () => {
    const created = await draft([line(untracked)]);
    const actions: [Method, string, object][] = [
      ['POST', route(), { supplierId: supplier.id, destinationLocationId: location }],
      ['PATCH', route(`/${created.id}`), { note: 'x' }],
      ['PUT', route(`/${created.id}/items`), { items: [] }],
      ['POST', route(`/${created.id}/order`), {}],
      ['POST', route(`/${created.id}/cancel`), {}],
      [
        'POST',
        route(`/${created.id}/receipts`),
        { items: [{ purchaseOrderItemId: created.items[0]!.id, quantity: '1' }] },
      ],
    ];
    for (const [method, path, payload] of actions)
      await reject(method, path, payload, 403, undefined, undefined, member);
    assert.equal(
      (
        await ok<PurchaseOrderResponse>(
          'GET',
          route(`/${created.id}`),
          undefined,
          undefined,
          member,
        )
      ).id,
      created.id,
    );
    await reject(
      'GET',
      route(`/${created.id}`, foreignOrg),
      undefined,
      404,
      undefined,
      undefined,
      outsider,
    );
    await reject(
      'PATCH',
      route(`/${created.id}`, foreignOrg),
      { note: 'x' },
      404,
      undefined,
      undefined,
      outsider,
    );
    await reject(
      'POST',
      route(`/${created.id}/order`, foreignOrg),
      {},
      404,
      undefined,
      undefined,
      outsider,
    );
    await reject(
      'POST',
      route(`/${created.id}/receipts`, foreignOrg),
      { items: [{ purchaseOrderItemId: created.items[0]!.id, quantity: '1' }] },
      404,
      undefined,
      undefined,
      outsider,
    );
    const foreign = await ok<SupplierResponse>(
      'POST',
      `${base(foreignOrg)}/suppliers`,
      { name: 'Foreign' },
      undefined,
      outsider,
    );
    await reject('POST', route(), { supplierId: foreign.id, destinationLocationId: location }, 404);
    await assert.rejects(
      context().prisma.purchaseOrder.update({
        where: { id: created.id },
        data: { supplierId: foreign.id },
      }),
    );
    await ok('POST', route(`/${created.id}/order`), {}, undefined, admin);
    const received = await ok<GoodsReceiptResponse>(
      'POST',
      route(`/${created.id}/receipts`),
      { items: [{ purchaseOrderItemId: created.items[0]!.id, quantity: '1' }] },
      undefined,
      admin,
    );
    await reject(
      'GET',
      `${base(foreignOrg)}/purchasing/receipts/${received.id}`,
      undefined,
      404,
      undefined,
      undefined,
      outsider,
    );
    const role = await context().prisma.role.findUniqueOrThrow({
      where: { organizationId_key: { organizationId: org, key: 'ADMIN' } },
    });
    await context().prisma.rolePermission.delete({
      where: {
        roleId_permissionCode: { roleId: role.id, permissionCode: Permission.PURCHASING_RECEIVE },
      },
    });
    await reject(
      'POST',
      route(`/${created.id}/receipts`),
      { items: [{ purchaseOrderItemId: created.items[0]!.id, quantity: '1' }] },
      403,
      undefined,
      undefined,
      admin,
    );
    await context().prisma.rolePermission.create({
      data: { organizationId: org, roleId: role.id, permissionCode: Permission.PURCHASING_RECEIVE },
    });
  });

  void test('forced failure inside inventory writer rolls back receipt, ledger and status', async () => {
    const second = await ok<CatalogItemResponse>('POST', `${base()}/catalog/items`, {
      name: 'Rollback product',
      type: 'PRODUCT',
      trackInventory: true,
      defaultVariant: { unit: 'PIECE', sellingPrice: '1' },
    });
    const created = await draft([line(tracked, '1'), line(second, '1')]);
    await order(created.id);
    const items = created.items.slice().sort((a, b) => a.id.localeCompare(b.id));
    const failingVariant = items.at(-1)!.variantId;
    const { prisma, admin: db, schema } = context();
    assert.match(schema, /^stage2_[a-f0-9]{32}$/);
    assert.match(failingVariant, /^[a-f0-9-]{36}$/);
    const before = await prisma.inventoryLedgerEntry.count(),
      stockBefore = await stock(tracked.defaultVariant.id);
    await db.$executeRawUnsafe(
      `CREATE FUNCTION "${schema}".fail_purchase_projection() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."variantId"='${failingVariant}'::uuid THEN RAISE EXCEPTION 'forced purchase failure'; END IF; RETURN NEW; END; $$`,
    );
    await db.$executeRawUnsafe(
      `CREATE TRIGGER fail_purchase_projection BEFORE INSERT OR UPDATE ON "${schema}"."InventoryBalance" FOR EACH ROW EXECUTE FUNCTION "${schema}".fail_purchase_projection()`,
    );
    try {
      const response = await call('POST', route(`/${created.id}/receipts`), {
        items: items.map((i) => ({ purchaseOrderItemId: i.id, quantity: '1' })),
      });
      assert.equal(response.statusCode, 500);
      assert.ok(!response.body.includes('forced purchase failure'));
      assert.equal(await prisma.goodsReceipt.count({ where: { purchaseOrderId: created.id } }), 0);
      assert.equal(
        await prisma.goodsReceiptItem.count({
          where: { purchaseOrderItemId: { in: items.map((i) => i.id) } },
        }),
        0,
      );
      assert.equal(
        await prisma.inventoryTransaction.count({
          where: { goodsReceipt: { purchaseOrderId: created.id } },
        }),
        0,
      );
      assert.equal(await prisma.inventoryLedgerEntry.count(), before);
      assert.equal(await stock(tracked.defaultVariant.id), stockBefore);
      assert.equal(
        (await ok<PurchaseOrderResponse>('GET', route(`/${created.id}`))).status,
        'ORDERED',
      );
    } finally {
      await db.$executeRawUnsafe(
        `DROP TRIGGER fail_purchase_projection ON "${schema}"."InventoryBalance"`,
      );
      await db.$executeRawUnsafe(`DROP FUNCTION "${schema}".fail_purchase_projection()`);
    }
  });

  void test('direct SQL cannot reverse PURCHASE_RECEIPT and rolls back every attempted effect', async () => {
    const item = await ok<CatalogItemResponse>('POST', `${base()}/catalog/items`, {
      name: 'Receipt reversal SQL regression',
      type: 'PRODUCT',
      trackInventory: true,
      defaultVariant: { unit: 'PIECE', sellingPrice: '1' },
    });
    const created = await draft([line(item, '2', '1')]);
    await order(created.id);
    const received = await receipt(created.id, [
      { purchaseOrderItemId: created.items[0]!.id, quantity: '2' },
    ]);
    const { prisma } = context();
    const original = await prisma.inventoryTransaction.findUniqueOrThrow({
      where: { goodsReceiptId: received.id },
    });
    const before = {
      transactions: await prisma.inventoryTransaction.count(),
      entries: await prisma.inventoryLedgerEntry.count(),
      balance: await stock(item.defaultVariant.id),
      receipt: await prisma.goodsReceipt.findUniqueOrThrow({ where: { id: received.id } }),
    };
    const reversalId = randomUUID();
    await assert.rejects(
      prisma.$transaction(async (tx) => {
        // A write preceding the rejected raw INSERT must also roll back.
        await tx.inventoryBalance.updateMany({
          where: { organizationId: org, locationId: location, variantId: item.defaultVariant.id },
          data: { quantity: '0' },
        });
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO ${prisma.sqlSchema}."InventoryTransaction"
            (id,"organizationId",type,"createdByUserId","idempotencyKey","requestHash","reversesTransactionId")
          VALUES (${reversalId}::uuid,${org}::uuid,'REVERSAL',${original.createdByUserId}::uuid,
            ${randomUUID()}::uuid,${'0'.repeat(64)},${original.id}::uuid)`);
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO ${prisma.sqlSchema}."InventoryLedgerEntry"
            (id,"organizationId","transactionId","locationId","variantId","quantityDelta")
          VALUES (${randomUUID()}::uuid,${org}::uuid,${reversalId}::uuid,${location}::uuid,
            ${item.defaultVariant.id}::uuid,-2)`);
      }),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes('23514') &&
        error.message.includes('Inventory source cannot be reversed by a generic command'),
    );
    assert.equal(await prisma.inventoryTransaction.count(), before.transactions);
    assert.equal(await prisma.inventoryLedgerEntry.count(), before.entries);
    assert.equal(await stock(item.defaultVariant.id), before.balance);
    assert.deepEqual(
      await prisma.goodsReceipt.findUniqueOrThrow({ where: { id: received.id } }),
      before.receipt,
    );
    const sum = await prisma.inventoryLedgerEntry.aggregate({
      where: { organizationId: org, locationId: location, variantId: item.defaultVariant.id },
      _sum: { quantityDelta: true },
    });
    assert.equal(sum._sum.quantityDelta?.toFixed(6), before.balance);
    await reject(
      'POST',
      `${base()}/inventory/transactions/${original.id}/reverse`,
      {},
      409,
      'INVENTORY_REVERSAL_NOT_ALLOWED',
    );
  });

  void test('purchase receipts recover negative stock and preserve ledger projection', async () => {
    const item = await ok<CatalogItemResponse>('POST', `${base()}/catalog/items`, {
      name: 'Negative recovery',
      type: 'PRODUCT',
      trackInventory: true,
      defaultVariant: { unit: 'PIECE', sellingPrice: '1' },
    });
    await ok('PATCH', `${base()}/inventory/settings`, { allowNegativeStock: true });
    await ok('POST', `${base()}/inventory/adjustments`, {
      locationId: location,
      variantId: item.defaultVariant.id,
      quantity: '5',
      direction: 'DECREASE',
      reason: 'COUNT_CORRECTION',
    });
    assert.equal(await stock(item.defaultVariant.id), '-5.000000');
    const created = await draft([line(item, '10', '1')]);
    await order(created.id);
    await receipt(created.id, [{ purchaseOrderItemId: created.items[0]!.id, quantity: '10' }]);
    assert.equal(await stock(item.defaultVariant.id), '5.000000');
    const sum = await context().prisma.inventoryLedgerEntry.aggregate({
      where: { organizationId: org, locationId: location, variantId: item.defaultVariant.id },
      _sum: { quantityDelta: true },
    });
    assert.equal(sum._sum.quantityDelta?.toFixed(6), await stock(item.defaultVariant.id));
  });
}
