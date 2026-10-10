import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type {
  CatalogItemResponse,
  SalesOrderResponse,
  SalesAnalyticsSummary,
  SalesTrendResponse,
  TopSellingVariant,
  InventoryAnalyticsSummary,
  InventoryMovementPoint,
  InventoryLocationSummary,
  PurchasingAnalyticsSummary,
  PurchaseOrderResponse,
  ReceivingLine,
  FinanceSummaryResponse,
  FinanceAnalyticsSummary,
  CashFlowTrendResponse,
  BusinessActivity,
} from '@saas/types';
import type { PrismaService } from '../src/prisma/prisma.service.js';

interface Context {
  app: NestFastifyApplication;
  prisma: PrismaService;
  token: (subject: string) => Promise<string>;
  legacyOrganizationId: string;
}
export function registerAnalyticsTests(context: () => Context) {
  let org: string,
    otherOrg: string,
    owner: string,
    other: string,
    member: string,
    analyst: string,
    location: string,
    secondLocation: string,
    foreignLocation: string,
    person: string;
  let product: CatalogItemResponse, service: CatalogItemResponse, tracked: CatalogItemResponse;
  const base = (id = org) => `/api/v1/organizations/${id}`;
  const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object, bearer = owner) =>
    context().app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${bearer}`, 'idempotency-key': randomUUID() },
      ...(payload ? { payload } : {}),
    });
  async function ok<T>(
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    payload?: object,
    bearer = owner,
  ): Promise<T> {
    const r = await call(method, url, payload, bearer);
    assert.equal(r.statusCode, method === 'POST' ? 201 : 200, r.body);
    return r.json<T>();
  }
  const get = <T>(
    path: string,
    query = 'from=2026-01-02&to=2026-01-02',
    bearer = owner,
    tenant = org,
  ) => ok<T>('GET', `${base(tenant)}/analytics/${path}?${query}`, undefined, bearer);
  const item = (
    name: string,
    type = 'PRODUCT',
    unit = 'PIECE',
    trackInventory = false,
    tenant = org,
    bearer = owner,
  ) =>
    ok<CatalogItemResponse>(
      'POST',
      `${base(tenant)}/catalog/items`,
      { name, type, trackInventory, defaultVariant: { unit, sellingPrice: '100.0000' } },
      bearer,
    );
  async function sale(
    variantId: string,
    quantity: string,
    at: string | null,
    legacy = false,
    tenant = org,
    bearer = owner,
    loc = location,
  ) {
    const order = await ok<SalesOrderResponse>(
      'POST',
      `${base(tenant)}/sales/orders`,
      { locationId: loc, items: [{ variantId, quantity }] },
      bearer,
    );
    if (legacy)
      await context().prisma.salesOrderItem.updateMany({
        where: { salesOrderId: order.id },
        data: { snapshotItemType: null },
      });
    if (at)
      await context().prisma.salesOrder.update({
        where: { id: order.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(at),
          completionIdempotencyKey: randomUUID(),
          completionRequestHash: 'a'.repeat(64),
        },
      });
    return order;
  }

  void test('analytics backfills permissions and keeps custom analytics-only roles non-financial', async () => {
    [owner, other, member, analyst] = await Promise.all([
      context().token('analytics-owner'),
      context().token('analytics-other'),
      context().token('analytics-member'),
      context().token('analytics-analyst'),
    ]);
    const input = {
      name: 'Analytics A',
      businessType: 'MIXED',
      defaultCurrency: 'USD',
      timezone: 'America/New_York',
    };
    org = (await ok<{ id: string }>('POST', '/api/v1/organizations', input)).id;
    otherOrg = (
      await ok<{ id: string }>(
        'POST',
        '/api/v1/organizations',
        { ...input, name: 'Analytics B' },
        other,
      )
    ).id;
    person = (await ok<{ id: string }>('GET', '/api/v1/me')).id;
    for (const tenant of [org, context().legacyOrganizationId])
      for (const key of ['OWNER', 'ADMIN', 'MEMBER']) {
        const role = await context().prisma.role.findUniqueOrThrow({
          where: { organizationId_key: { organizationId: tenant, key } },
          include: { permissions: true },
        });
        assert.equal(
          role.permissions.some((p) => p.permissionCode === 'analytics.view'),
          key !== 'MEMBER',
        );
      }
    for (const [bearer, key] of [
      [member, 'MEMBER'],
      [analyst, 'ANALYST'],
    ] as const) {
      const user = await ok<{ id: string }>('GET', '/api/v1/me', undefined, bearer);
      const role =
        key === 'MEMBER'
          ? await context().prisma.role.findUniqueOrThrow({
              where: { organizationId_key: { organizationId: org, key } },
            })
          : await context().prisma.role.create({
              data: {
                organizationId: org,
                key,
                name: 'Analyst',
                permissions: { create: { permissionCode: 'analytics.view' } },
              },
            });
      const membership = await context().prisma.organizationMembership.create({
        data: { organizationId: org, userId: user.id },
      });
      await context().prisma.membershipRole.create({
        data: { organizationId: org, membershipId: membership.id, roleId: role.id },
      });
    }
    location = (
      await ok<{ id: string }>('POST', `${base()}/locations`, { name: 'Store A', type: 'STORE' })
    ).id;
    secondLocation = (
      await ok<{ id: string }>('POST', `${base()}/locations`, {
        name: 'Store B',
        type: 'WAREHOUSE',
      })
    ).id;
    foreignLocation = (
      await ok<{ id: string }>(
        'POST',
        `${base(otherOrg)}/locations`,
        { name: 'Foreign', type: 'STORE' },
        other,
      )
    ).id;
    product = await item('Original product');
    service = await item('Consulting', 'SERVICE', 'HOUR');
    tracked = await item('Tracked', 'PRODUCT', 'PIECE', true);
    for (const path of [
      'overview',
      'inventory/summary',
      'inventory/movements',
      'inventory/locations',
      'purchasing/receiving',
      'activity',
    ]) {
      await get(path, undefined, analyst);
      assert.equal(
        (await call('GET', `${base()}/analytics/${path}`, undefined, member)).statusCode,
        403,
      );
    }
    for (const path of [
      'sales/summary',
      'sales/trend',
      'sales/top-variants',
      'purchasing/summary',
      'finance/summary',
      'finance/cash-flow',
    ])
      assert.equal(
        (await call('GET', `${base()}/analytics/${path}`, undefined, analyst)).statusCode,
        403,
      );
    assert.deepEqual(await get('activity', undefined, analyst), []);
  });

  void test('analytics empty aggregates, nullable AOV and previous zero are honest', async () => {
    const summary = await get<SalesAnalyticsSummary>('sales/summary');
    assert.equal(summary.sales.currentValue, '0.0000');
    assert.equal(summary.sales.percentageChange, null);
    assert.equal(summary.averageOrderValue, null);
    assert.equal((await get<SalesTrendResponse>('sales/trend')).points[0]?.salesAmount, '0.0000');
    assert.equal((await get<InventoryAnalyticsSummary>('inventory/summary')).zeroStock, 1);
    assert.equal(
      (await get<PurchasingAnalyticsSummary>('purchasing/summary')).receivingProgressPercentage,
      null,
    );
  });

  void test('sales aggregate exact completed totals, equal-day comparison, snapshots and unknown legacy types', async () => {
    await sale(product.defaultVariant.id, '1', '2026-01-01T17:00:00Z');
    await sale(product.defaultVariant.id, '2', '2026-01-02T16:00:00Z');
    await sale(service.defaultVariant.id, '1', '2026-01-02T17:00:00Z');
    await sale(product.defaultVariant.id, '1', '2026-01-02T18:00:00Z', true);
    await sale(product.defaultVariant.id, '99', null);
    const cancel = await sale(product.defaultVariant.id, '99', null);
    await ok('POST', `${base()}/sales/orders/${cancel.id}/cancel`, {});
    await ok('PATCH', `${base()}/catalog/items/${product.id}`, { name: 'Renamed product' });
    await sale(product.defaultVariant.id, '1', '2026-01-02T19:00:00Z');
    await ok('PATCH', `${base()}/catalog/items/${product.id}`, { isActive: false });
    const s = await get<SalesAnalyticsSummary>('sales/summary');
    assert.deepEqual(s.sales, {
      currentValue: '500.0000',
      previousValue: '100.0000',
      absoluteChange: '400.0000',
      percentageChange: '400.00',
    });
    assert.equal(s.orders.currentValue, '4.0000');
    assert.equal(s.averageOrderValue, '125.0000');
    assert.deepEqual(Object.fromEntries(s.byType.map((r) => [r.type, r.amount])), {
      PRODUCT: '300.0000',
      SERVICE: '100.0000',
      UNKNOWN: '100.0000',
    });
    const top = await get<TopSellingVariant[]>('sales/top-variants');
    assert.equal(top.find((r) => r.type === 'PRODUCT')?.itemName, 'Renamed product');
    assert.equal(top.find((r) => r.type === 'UNKNOWN')?.itemName, 'Original product');
    assert.equal(top.find((r) => r.type === 'PRODUCT')?.quantitySold, '3.000000');
    assert.equal(
      (
        await get<TopSellingVariant[]>(
          'sales/top-variants',
          'from=2026-01-02&to=2026-01-02&itemType=SERVICE',
        )
      )[0]?.unit,
      'HOUR',
    );
    const row = await context().prisma.salesOrderItem.findFirstOrThrow({
      where: { organizationId: org, snapshotItemType: 'PRODUCT', order: { status: 'COMPLETED' } },
    });
    await assert.rejects(
      context().prisma.salesOrderItem.update({
        where: { id: row.id },
        data: { snapshotItemType: 'SERVICE' },
      }),
    );
  });

  void test('timestamp dates respect DST start/end, exclusive upper bounds and ISO calendar buckets', async () => {
    for (const at of [
      '2026-03-08T04:59:59Z',
      '2026-03-08T05:00:00Z',
      '2026-03-09T03:59:59Z',
      '2026-03-09T04:00:00Z',
    ])
      await sale(service.defaultVariant.id, '1', at);
    const day = await get<SalesTrendResponse>('sales/trend', 'from=2026-03-08&to=2026-03-08');
    assert.equal(day.points[0]?.ordersCount, 2);
    assert.deepEqual(day.context.previous, { from: '2026-03-07', to: '2026-03-07' });
    for (const at of [
      '2026-11-01T03:59:59Z',
      '2026-11-01T04:00:00Z',
      '2026-11-02T04:59:59Z',
      '2026-11-02T05:00:00Z',
    ])
      await sale(service.defaultVariant.id, '1', at);
    assert.equal(
      (await get<SalesTrendResponse>('sales/trend', 'from=2026-11-01&to=2026-11-01')).points[0]
        ?.ordersCount,
      2,
    );
    const week = await get<SalesTrendResponse>(
      'sales/trend',
      'from=2026-03-08&to=2026-03-09&granularity=WEEK',
    );
    assert.deepEqual(
      week.points.map((p) => p.bucket),
      ['2026-03-02', '2026-03-09'],
    );
    const month = await get<SalesTrendResponse>(
      'sales/trend',
      'from=2026-01-31&to=2026-03-01&granularity=MONTH',
    );
    assert.deepEqual(
      month.points.map((p) => p.bucket),
      ['2026-01-01', '2026-02-01', '2026-03-01'],
    );
  });

  void test('inventory counts absent balances, negative locations, archived stock and separate units; transfers/reversals remain ledger facts', async () => {
    await ok('PATCH', `${base()}/inventory/settings`, { allowNegativeStock: true });
    await ok('POST', `${base()}/inventory/opening-balances`, {
      variantId: tracked.defaultVariant.id,
      locationId: location,
      quantity: '10',
    });
    const transfer = await ok<{ id: string }>('POST', `${base()}/inventory/transfers`, {
      variantId: tracked.defaultVariant.id,
      sourceLocationId: location,
      destinationLocationId: secondLocation,
      quantity: '12',
    });
    let s = await get<InventoryAnalyticsSummary>('inventory/summary', '');
    assert.equal(s.negativeStock, 0);
    assert.equal(s.negativeLocationBalances, 1);
    assert.equal(
      (await get<InventoryAnalyticsSummary>('inventory/summary', `locationId=${location}`))
        .negativeStock,
      1,
    );
    let movements = await get<{ points: InventoryMovementPoint[] }>('inventory/movements', '');
    assert.equal(movements.points.find((p) => p.type === 'TRANSFER')?.net, '0.000000');
    await ok('POST', `${base()}/inventory/transactions/${transfer.id}/reverse`, {});
    const kg = await item('Bulk', 'PRODUCT', 'KILOGRAM', true);
    await item('No ledger', 'PRODUCT', 'LITER', true);
    await ok('POST', `${base()}/inventory/opening-balances`, {
      variantId: kg.defaultVariant.id,
      locationId: location,
      quantity: '2.123456',
    });
    // Legacy flags can predate the current mutation guard; archived stock must remain visible.
    await context().prisma.catalogItem.update({
      where: { id: tracked.id },
      data: { isActive: false },
    });
    s = await get<InventoryAnalyticsSummary>('inventory/summary', '');
    assert.equal(s.archivedNonZeroVariants, 1);
    assert.equal(s.trackedVariants, 3);
    assert.equal(s.zeroStock, 1);
    assert.equal(s.negativeLocationBalances, 0);
    movements = await get('inventory/movements', '');
    assert.deepEqual([...new Set(movements.points.map((p) => p.unit))].sort(), [
      'KILOGRAM',
      'PIECE',
    ]);
    assert.ok(movements.points.some((p) => p.type === 'REVERSAL'));
    const locations = await get<InventoryLocationSummary[]>('inventory/locations', '');
    assert.equal(locations.find((p) => p.locationId === secondLocation)?.zeroStock, 2);
    assert.equal(s.topMovingVariants[0]?.variantId, tracked.defaultVariant.id);
  });

  void test('purchasing uses ordered cohorts, completed line ratios and receipt event counts', async () => {
    const supplier = await ok<{ id: string }>('POST', `${base()}/suppliers`, {
      name: 'Analytics supplier',
    });
    // Purchasing accepts products only; an untracked product avoids inventory noise.
    const purchasable = await item('Purchase product');
    const create = () =>
      ok<PurchaseOrderResponse>('POST', `${base()}/purchasing/orders`, {
        supplierId: supplier.id,
        destinationLocationId: location,
        items: [{ variantId: purchasable.defaultVariant.id, orderedQuantity: '4', unitCost: '25' }],
      });
    const partial = await create(),
      complete = await create();
    await create();
    const cancelled = await create();
    await ok('POST', `${base()}/purchasing/orders/${cancelled.id}/cancel`, {});
    for (const [order, quantity] of [
      [partial, '1'],
      [complete, '4'],
    ] as const) {
      await ok('POST', `${base()}/purchasing/orders/${order.id}/order`, {});
      await ok('POST', `${base()}/purchasing/orders/${order.id}/receipts`, {
        items: [{ purchaseOrderItemId: order.items[0]!.id, quantity }],
      });
    }
    const s = await get<PurchasingAnalyticsSummary>('purchasing/summary', '');
    assert.equal(s.purchaseOrdersCount, 2);
    assert.equal(s.orderedAmount.currentValue, '200.0000');
    assert.equal(s.partiallyReceivedOrders, 1);
    assert.equal(s.fullyReceivedOrders, 1);
    assert.equal(s.openOrders, 1);
    assert.equal(s.goodsReceiptsCount, 2);
    assert.equal(s.receivingProgressPercentage, '50.00');
    assert.equal(s.topSuppliers[0]?.amount, '200.0000');
    const lines = await get<ReceivingLine[]>('purchasing/receiving', '');
    assert.equal(
      lines.find((r) => r.purchaseOrderId === partial.id)?.remainingQuantity,
      '3.000000',
    );
    assert.equal(
      (await get<PurchasingAnalyticsSummary>('purchasing/summary', `locationId=${secondLocation}`))
        .purchaseOrdersCount,
      0,
    );
  });

  void test('finance reuses Stage8, supplier cash is payment-date based, location supplier amounts null and liabilities current', async () => {
    const order = await sale(service.defaultVariant.id, '10', '2026-02-02T17:00:00Z');
    await context().prisma.salesPayment.create({
      data: {
        organizationId: org,
        salesOrderId: order.id,
        amount: '1000',
        method: 'CASH',
        createdByUserId: person,
        createdAt: new Date('2026-02-02T17:00:00Z'),
        idempotencyKey: randomUUID(),
        requestHash: 'b'.repeat(64),
      },
    });
    const category = await ok<{ id: string }>('POST', `${base()}/expense-categories`, {
      name: 'Analytics rent',
    });
    const expense = await ok<{ id: string }>('POST', `${base()}/expenses`, {
      categoryId: category.id,
      locationId: location,
      expenseDate: '2026-02-02',
      amount: '200',
      paymentMethod: 'CASH',
    });
    await ok('POST', `${base()}/expenses/${expense.id}/post`, {});
    const supplier = await ok<{ id: string }>('POST', `${base()}/suppliers`, {
      name: 'Cash supplier',
    });
    const bill = await ok<{ id: string }>('POST', `${base()}/accounts-payable/bills`, {
      supplierId: supplier.id,
      supplierInvoiceNumber: 'Analytics-1',
      issueDate: '2026-02-01',
      dueDate: '2026-02-28',
      amount: '500',
    });
    await ok('POST', `${base()}/accounts-payable/bills/${bill.id}/post`, {});
    const query = 'from=2026-02-02&to=2026-02-02';
    assert.equal(
      (await get<CashFlowTrendResponse>('finance/cash-flow', query)).points[0]?.netCashFlow,
      '800.0000',
    );
    await ok('POST', `${base()}/accounts-payable/bills/${bill.id}/payments`, {
      amount: '300',
      method: 'BANK_TRANSFER',
      paymentDate: '2026-02-02',
    });
    const s = await get<FinanceAnalyticsSummary>('finance/summary', query);
    const legacy = await ok<FinanceSummaryResponse>('GET', `${base()}/finance/summary?${query}`);
    assert.deepEqual(s.summary, legacy);
    assert.equal(s.summary.netCashFlow, '500.0000');
    const flow = await get<CashFlowTrendResponse>('finance/cash-flow', query);
    assert.deepEqual(flow.points[0], {
      bucket: '2026-02-02',
      customerPayments: '1000.0000',
      operatingExpenses: '200.0000',
      supplierPayments: '300.0000',
      netCashFlow: '500.0000',
    });
    const loc = await get<CashFlowTrendResponse>(
      'finance/cash-flow',
      `${query}&locationId=${location}`,
    );
    assert.equal(loc.points[0]?.supplierPayments, null);
    assert.equal(loc.points[0]?.netCashFlow, '800.0000');
    assert.equal(
      (await get<FinanceAnalyticsSummary>('finance/summary', `${query}&locationId=${location}`))
        .comparisons.supplierPayments,
      null,
    );
    const empty = await get<FinanceAnalyticsSummary>(
      'finance/summary',
      'from=2025-01-01&to=2025-01-01',
    );
    assert.equal(empty.summary.outstandingPayablesCurrent, '200.0000');
    assert.equal(empty.summary.outstandingPayablesCurrent, s.summary.outstandingPayablesCurrent);
    const activity = await get<BusinessActivity[]>('activity', 'limit=50');
    assert.ok(activity.some((r) => r.kind === 'EXPENSE' && r.businessDate === '2026-02-02'));
    assert.ok(
      activity.some((r) => r.kind === 'SUPPLIER_PAYMENT' && r.businessDate === '2026-02-02'),
    );
    const role = await context().prisma.role.findUniqueOrThrow({
      where: { organizationId_key: { organizationId: org, key: 'ANALYST' } },
    });
    await context().prisma.rolePermission.createMany({
      data: ['finance.view', 'expenses.view'].map((permissionCode) => ({
        organizationId: org,
        roleId: role.id,
        permissionCode,
      })),
    });
    assert.equal(
      (await get<FinanceAnalyticsSummary>('finance/summary', query, analyst)).summary.netCashFlow,
      '500.0000',
    );
    const restrictedActivity = await get<BusinessActivity[]>('activity', 'limit=50', analyst);
    assert.ok(restrictedActivity.some((r) => r.kind === 'EXPENSE'));
    assert.ok(!restrictedActivity.some((r) => r.kind === 'SUPPLIER_PAYMENT'));
    const inventoryActivity = await get<BusinessActivity[]>('activity', 'kind=INVENTORY&limit=1');
    assert.equal(inventoryActivity.length, 1);
    assert.equal(inventoryActivity[0]?.kind, 'INVENTORY');
  });

  void test('analytics enforces tenant boundaries, validates bounded queries and rejects mixed currencies', async () => {
    const stockBefore = await get<InventoryAnalyticsSummary>('inventory/summary', '');
    const purchasingBefore = await get<PurchasingAnalyticsSummary>('purchasing/summary', '');
    const financeBefore = await get<FinanceAnalyticsSummary>(
      'finance/summary',
      'from=2026-02-02&to=2026-02-02',
    );
    const foreignStock = await item('Foreign inventory', 'PRODUCT', 'PIECE', true, otherOrg, other);
    await ok(
      'POST',
      `${base(otherOrg)}/inventory/opening-balances`,
      { variantId: foreignStock.defaultVariant.id, locationId: foreignLocation, quantity: '9999' },
      other,
    );
    const supplier = await ok<{ id: string }>(
      'POST',
      `${base(otherOrg)}/suppliers`,
      { name: 'Foreign supplier' },
      other,
    );
    const po = await ok<PurchaseOrderResponse>(
      'POST',
      `${base(otherOrg)}/purchasing/orders`,
      {
        supplierId: supplier.id,
        destinationLocationId: foreignLocation,
        items: [
          { variantId: foreignStock.defaultVariant.id, orderedQuantity: '100', unitCost: '100' },
        ],
      },
      other,
    );
    await ok('POST', `${base(otherOrg)}/purchasing/orders/${po.id}/order`, {}, other);
    await ok(
      'POST',
      `${base(otherOrg)}/purchasing/orders/${po.id}/receipts`,
      { items: [{ purchaseOrderItemId: po.items[0]!.id, quantity: '100' }] },
      other,
    );
    const category = await ok<{ id: string }>(
      'POST',
      `${base(otherOrg)}/expense-categories`,
      { name: 'Foreign cost' },
      other,
    );
    const expense = await ok<{ id: string }>(
      'POST',
      `${base(otherOrg)}/expenses`,
      {
        categoryId: category.id,
        expenseDate: '2026-02-02',
        amount: '50000',
        paymentMethod: 'CASH',
      },
      other,
    );
    await ok('POST', `${base(otherOrg)}/expenses/${expense.id}/post`, {}, other);
    const bill = await ok<{ id: string }>(
      'POST',
      `${base(otherOrg)}/accounts-payable/bills`,
      { supplierId: supplier.id, issueDate: '2026-02-02', dueDate: '2026-02-02', amount: '60000' },
      other,
    );
    await ok('POST', `${base(otherOrg)}/accounts-payable/bills/${bill.id}/post`, {}, other);
    await ok(
      'POST',
      `${base(otherOrg)}/accounts-payable/bills/${bill.id}/payments`,
      { amount: '60000', method: 'CASH', paymentDate: '2026-02-02' },
      other,
    );
    assert.deepEqual(await get<InventoryAnalyticsSummary>('inventory/summary', ''), stockBefore);
    assert.deepEqual(
      await get<PurchasingAnalyticsSummary>('purchasing/summary', ''),
      purchasingBefore,
    );
    assert.deepEqual(
      await get<FinanceAnalyticsSummary>('finance/summary', 'from=2026-02-02&to=2026-02-02'),
      financeBefore,
    );
    const foreign = await item('Foreign product', 'PRODUCT', 'PIECE', false, otherOrg, other);
    await sale(
      foreign.defaultVariant.id,
      '999',
      '2026-01-02T17:00:00Z',
      false,
      otherOrg,
      other,
      foreignLocation,
    );
    assert.equal(
      (await get<SalesAnalyticsSummary>('sales/summary')).sales.currentValue,
      '500.0000',
    );
    assert.equal((await call('GET', `${base(otherOrg)}/analytics/overview`)).statusCode, 404);
    assert.equal(
      (await call('GET', `${base()}/analytics/overview?locationId=${foreignLocation}`)).statusCode,
      404,
    );
    for (const query of [
      'from=2026-02-30&to=2026-03-01',
      'from=2026-01-01',
      'from=2026-02-02&to=2026-02-01',
      'from=2024-01-01&to=2026-01-01',
      'granularity=hour',
      'limit=51',
      'limit=0',
      'locationId=1%27',
      'organizationId=' + otherOrg,
      'itemType=ANY',
    ])
      assert.equal(
        (await call('GET', `${base()}/analytics/overview?${query}`)).statusCode,
        400,
        query,
      );
    assert.equal(
      (
        await get<TopSellingVariant[]>(
          'sales/top-variants',
          'from=2026-01-02&to=2026-01-02&limit=1',
        )
      ).length,
      1,
    );
    await ok('PATCH', base(), { defaultCurrency: 'EUR' });
    const draft = await sale(service.defaultVariant.id, '1', null);
    await context().prisma.salesOrder.update({
      where: { id: draft.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date('2026-01-02T17:00:00Z'),
        completionIdempotencyKey: randomUUID(),
        completionRequestHash: 'c'.repeat(64),
      },
    });
    assert.equal(
      (await call('GET', `${base()}/analytics/sales/summary?from=2026-01-02&to=2026-01-02`))
        .statusCode,
      409,
    );
    assert.equal(
      (await call('GET', `${base()}/analytics/sales/trend?from=2026-01-02&to=2026-01-02`))
        .statusCode,
      409,
    );
  });

  void test('finance comparison distinguishes an empty period from historical source currency', async () => {
    const isolated = (
      await ok<{ id: string }>('POST', '/api/v1/organizations', {
        name: 'Currency fixture',
        businessType: 'MIXED',
        defaultCurrency: 'EUR',
        timezone: 'UTC',
      })
    ).id;
    const category = await ok<{ id: string }>('POST', `${base(isolated)}/expense-categories`, {
      name: 'Historic cost',
    });
    const expense = await ok<{ id: string }>('POST', `${base(isolated)}/expenses`, {
      categoryId: category.id,
      expenseDate: '2026-01-02',
      amount: '0.1234',
      paymentMethod: 'CASH',
    });
    await ok('POST', `${base(isolated)}/expenses/${expense.id}/post`, {});
    await ok('PATCH', base(isolated), { defaultCurrency: 'USD' });
    const current = await get<FinanceAnalyticsSummary>(
      'finance/summary',
      'from=2026-01-02&to=2026-01-02',
      owner,
      isolated,
    );
    assert.equal(current.summary.currencyCode, 'EUR');
    assert.equal(current.comparisons.expenses.currentValue, '0.1234');
    assert.equal(current.comparisons.expenses.percentageChange, null);
    const previous = await get<FinanceAnalyticsSummary>(
      'finance/summary',
      'from=2026-01-03&to=2026-01-03',
      owner,
      isolated,
    );
    assert.equal(previous.summary.currencyCode, 'EUR');
    assert.equal(previous.comparisons.expenses.previousValue, '0.1234');
    assert.equal(previous.comparisons.expenses.percentageChange, '-100.00');
    const second = await ok<{ id: string }>('POST', `${base(isolated)}/expenses`, {
      categoryId: category.id,
      expenseDate: '2026-01-02',
      amount: '1',
      paymentMethod: 'CASH',
    });
    await ok('POST', `${base(isolated)}/expenses/${second.id}/post`, {});
    assert.equal(
      (
        await call(
          'GET',
          `${base(isolated)}/analytics/finance/cash-flow?from=2026-01-02&to=2026-01-02`,
        )
      ).statusCode,
      409,
    );
  });
}
