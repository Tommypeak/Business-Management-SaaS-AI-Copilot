import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  Permission,
  type CatalogItemResponse,
  type CustomerRefundResponse,
  type FinanceSummaryResponse,
  type CashFlowTrendResponse,
  type ReturnsAnalyticsSummary,
  type LocationResponse,
  type OrganizationResponse,
  type PageResponse,
  type ReturnEligibilityResponse,
  type SalesOrderResponse,
  type SalesReturnResponse,
  type UserResponse,
} from '@saas/types';
import { Prisma } from '../src/generated/prisma/client.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { InventoryCommandsService } from '../src/inventory/commands.service.js';
import { AiToolsService } from '../src/ai/ai-tools.service.js';
interface Context {
  app: NestFastifyApplication;
  prisma: PrismaService;
  token: (subject: string) => Promise<string>;
  legacyOrganizationId: string;
}
export function registerReturnsTests(context: () => Context) {
  let org: string,
    foreignOrg: string,
    owner: string,
    member: string,
    outsider: string,
    location: LocationResponse;
  const base = () => `/api/v1/organizations/${org}`;
  const call = (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    path: string,
    payload?: object,
    key: string | null = randomUUID(),
    bearer = owner,
  ) =>
    context().app.inject({
      method,
      url: path,
      headers: { authorization: `Bearer ${bearer}`, ...(key ? { 'idempotency-key': key } : {}) },
      ...(payload ? { payload } : {}),
    });
  async function ok<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    path: string,
    payload?: object,
    key?: string,
    bearer = owner,
  ) {
    const res = await call(method, path, payload, key, bearer);
    assert.equal(res.statusCode, method === 'POST' ? 201 : 200, res.body);
    return res.json<T>();
  }
  async function fixture(
    q = '10',
    price = '100',
    paid = '1000',
    tracked = true,
    type = 'PRODUCT',
    discount = '0',
  ) {
    const item = await ok<CatalogItemResponse>('POST', `${base()}/catalog/items`, {
      name: `Return ${randomUUID()}`,
      type,
      trackInventory: tracked,
      defaultVariant: { unit: 'PIECE', sellingPrice: price },
    });
    if (tracked)
      await ok('POST', `${base()}/inventory/opening-balances`, {
        locationId: location.id,
        variantId: item.defaultVariant.id,
        quantity: q,
      });
    const draft = await ok<SalesOrderResponse>('POST', `${base()}/sales/orders`, {
      locationId: location.id,
      items: [{ variantId: item.defaultVariant.id, quantity: q, discountAmount: discount }],
    });
    const order = await ok<SalesOrderResponse>(
      'POST',
      `${base()}/sales/orders/${draft.id}/complete`,
      { payments: paid === '0' ? [] : [{ amount: paid, method: 'CASH' }] },
    );
    return { item, order };
  }
  const input = (order: SalesOrderResponse, q: string, restock = true) => ({
    salesOrderId: order.id,
    items: [
      {
        salesOrderItemId: order.items[0]!.id,
        quantity: q,
        restockDisposition: restock ? 'RESTOCK' : 'NO_RESTOCK',
        ...(restock ? { locationId: location.id } : {}),
      },
    ],
  });
  const create = (order: SalesOrderResponse, q: string, restock = true, key?: string) =>
    ok<SalesReturnResponse>('POST', `${base()}/returns`, input(order, q, restock), key);
  const post = (r: SalesReturnResponse, key?: string) =>
    ok<SalesReturnResponse>('POST', `${base()}/returns/${r.id}/post`, {}, key);
  const payout = (
    order: SalesOrderResponse,
    r: SalesReturnResponse,
    amount: string,
    key?: string,
  ) =>
    ok<CustomerRefundResponse>(
      'POST',
      `${base()}/refunds`,
      {
        salesOrderId: order.id,
        amount,
        paymentMethod: 'CASH',
        paymentDate: '2026-10-11',
        allocations: [{ salesReturnId: r.id, allocatedAmount: amount }],
      },
      key,
    );
  const balance = (variantId: string) =>
    context().prisma.inventoryBalance.findUniqueOrThrow({
      where: {
        organizationId_locationId_variantId: {
          organizationId: org,
          locationId: location.id,
          variantId,
        },
      },
    });
  void test('returns permissions backfill and initialize; MEMBER gets operational view only', async () => {
    [owner, member, outsider] = await Promise.all([
      context().token('returns-owner'),
      context().token('returns-member'),
      context().token('returns-outsider'),
    ]);
    const metadata = {
      name: 'Returns isolated',
      businessType: 'MIXED',
      defaultCurrency: 'USD',
      timezone: 'UTC',
    };
    org = (await ok<OrganizationResponse>('POST', '/api/v1/organizations', metadata)).id;
    foreignOrg = (
      await ok<OrganizationResponse>('POST', '/api/v1/organizations', metadata, undefined, outsider)
    ).id;
    for (const tenant of [org, context().legacyOrganizationId])
      for (const role of ['OWNER', 'ADMIN', 'MEMBER']) {
        const row = await context().prisma.role.findUniqueOrThrow({
          where: { organizationId_key: { organizationId: tenant, key: role } },
          include: { permissions: true },
        });
        assert.deepEqual(
          row.permissions
            .map((p) => p.permissionCode)
            .filter((p) => p.startsWith('returns.') || p.startsWith('refunds.'))
            .sort(),
          (role === 'MEMBER'
            ? [Permission.RETURNS_VIEW]
            : [Permission.RETURNS_VIEW, Permission.RETURNS_MANAGE, Permission.REFUNDS_MANAGE]
          ).sort(),
        );
      }
    const user = await ok<UserResponse>('GET', '/api/v1/me', undefined, undefined, member);
    const role = await context().prisma.role.findUniqueOrThrow({
      where: { organizationId_key: { organizationId: org, key: 'MEMBER' } },
    });
    const membership = await context().prisma.organizationMembership.create({
      data: { organizationId: org, userId: user.id },
    });
    await context().prisma.membershipRole.create({
      data: { organizationId: org, membershipId: membership.id, roleId: role.id },
    });
    location = await ok<LocationResponse>('POST', `${base()}/locations`, {
      name: 'Returns warehouse',
      type: 'WAREHOUSE',
    });
  });
  void test('partial/full tracked return preserves sale and payments; cumulative decimal rounding and inventory source', async () => {
    const { order, item } = await fixture('3', '0.3333', '0.9999');
    const before = await context().prisma.salesOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: { items: true, payments: true },
    });
    const draft = await create(order, '1');
    assert.equal((await balance(item.defaultVariant.id)).quantity.toFixed(6), '0.000000');
    const first = await post(draft);
    assert.equal(first.totalRefundableAmount, '0.3333');
    assert.equal(first.items[0]?.stockRestocked, true);
    assert.equal((await balance(item.defaultVariant.id)).quantity.toFixed(6), '1.000000');
    const tx = await context().prisma.inventoryTransaction.findUniqueOrThrow({
      where: { salesReturnId: first.id },
    });
    assert.equal(tx.type, 'SALE_RETURN');
    assert.equal(tx.salesOrderId, null);
    const full = await post(await create(order, '2'));
    assert.equal(full.totalRefundableAmount, '0.6666');
    assert.deepEqual(
      await context().prisma.salesOrder.findUniqueOrThrow({
        where: { id: order.id },
        include: { items: true, payments: true },
      }),
      before,
    );
    assert.equal((await call('POST', `${base()}/returns`, input(order, '0.1'))).statusCode, 409);
    assert.equal(
      (await call('POST', `${base()}/inventory/transactions/${tx.id}/reverse`, {})).statusCode,
      409,
    );
  });
  void test('refund policy: O=1000 P=600 C=800 permits 400, rejects 300, permits remaining 200', async () => {
    const { order } = await fixture('10', '100', '600');
    const r = await post(await create(order, '8', false));
    const first = await payout(order, r, '400');
    assert.equal(first.amount, '400.0000');
    const over = await call('POST', `${base()}/refunds`, {
      salesOrderId: order.id,
      amount: '300',
      paymentMethod: 'CASH',
      paymentDate: '2026-10-11',
      allocations: [{ salesReturnId: r.id, allocatedAmount: '300' }],
    });
    assert.equal(over.statusCode, 409, over.body);
    await payout(order, r, '200');
    const eligibility = await ok<ReturnEligibilityResponse>(
      'GET',
      `${base()}/sales/orders/${order.id}/return-eligibility`,
    );
    assert.equal(eligibility.refundedAmount, '600.0000');
    assert.equal(eligibility.availableRefundAmount, '0.0000');
    assert.equal(eligibility.netOutstandingAmount, '200.0000');
  });
  void test('refund allocations span posted returns in one order, respect each credit and cash cap', async () => {
    const { order } = await fixture();
    const a = await post(await create(order, '2', false)),
      b = await post(await create(order, '3', false));
    const refund = await ok<CustomerRefundResponse>('POST', `${base()}/refunds`, {
      salesOrderId: order.id,
      amount: '450',
      paymentMethod: 'CARD',
      paymentDate: '2026-10-10',
      allocations: [
        { salesReturnId: a.id, allocatedAmount: '150' },
        { salesReturnId: b.id, allocatedAmount: '300' },
      ],
    });
    assert.equal(refund.allocations.length, 2);
    assert.equal(refund.paymentDate, '2026-10-10');
    assert.equal(
      (
        await call('POST', `${base()}/refunds`, {
          salesOrderId: order.id,
          amount: '51',
          paymentMethod: 'CASH',
          paymentDate: '2026-10-11',
          allocations: [{ salesReturnId: a.id, allocatedAmount: '51' }],
        })
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await call('POST', `${base()}/refunds`, {
          salesOrderId: order.id,
          amount: '1',
          paymentMethod: 'CASH',
          paymentDate: '2026-02-30',
          allocations: [{ salesReturnId: a.id, allocatedAmount: '1' }],
        })
      ).statusCode,
      400,
    );
  });
  void test('create, post, cancel and refund idempotency survive retries; conflicting payload rejected', async () => {
    const { order } = await fixture();
    const key = randomUUID(),
      r = await create(order, '2', false, key);
    assert.equal((await create(order, '2', false, key)).id, r.id);
    assert.equal(
      (await call('POST', `${base()}/returns`, input(order, '3', false), key)).statusCode,
      409,
    );
    const postKey = randomUUID(),
      posted = await post(r, postKey);
    assert.equal((await post(r, postKey)).id, r.id);
    const payKey = randomUUID(),
      refund = await payout(order, posted, '100', payKey);
    assert.equal((await payout(order, posted, '100', payKey)).id, refund.id);
    const cancel = await create(order, '1', false),
      cancelKey = randomUUID();
    await ok('POST', `${base()}/returns/${cancel.id}/cancel`, { reason: 'Duplicate' }, cancelKey);
    await ok('POST', `${base()}/returns/${cancel.id}/cancel`, { reason: 'Duplicate' }, cancelKey);
    assert.equal((await call('POST', `${base()}/returns/${cancel.id}/post`, {})).statusCode, 409);
    assert.equal(
      (await call('PATCH', `${base()}/returns/${posted.id}`, { note: 'edit' })).statusCode,
      409,
    );
  });
  void test('concurrent drafts do not reserve; competing posts/refunds commit at most the valid quantity/cash', async () => {
    const { order } = await fixture('1', '100', '100');
    const a = await create(order, '1'),
      b = await create(order, '1');
    const responses = await Promise.all(
      [a, b].map((r) => call('POST', `${base()}/returns/${r.id}/post`, {})),
    );
    assert.deepEqual(responses.map((r) => r.statusCode).sort(), [201, 409]);
    const winner = responses.find((r) => r.statusCode === 201)!.json<SalesReturnResponse>();
    const payload = {
      salesOrderId: order.id,
      amount: '75',
      paymentMethod: 'CASH',
      paymentDate: '2026-10-11',
      allocations: [{ salesReturnId: winner.id, allocatedAmount: '75' }],
    };
    const refunds = await Promise.all([
      call('POST', `${base()}/refunds`, payload),
      call('POST', `${base()}/refunds`, payload),
    ]);
    assert.deepEqual(refunds.map((r) => r.statusCode).sort(), [201, 409]);
  });
  void test('direct SQL writers serialize competing return posts and refund allocations', async () => {
    const { order } = await fixture('1', '100', '100');
    const drafts = await Promise.all([create(order, '1', false), create(order, '1', false)]);
    const posts = await Promise.allSettled(
      drafts.map((draft) =>
        context().prisma.salesReturn.update({
          where: { id: draft.id },
          data: {
            status: 'POSTED',
            postedAt: new Date(),
            postedByUserId: draft.createdBy.id,
            postingIdempotencyKey: randomUUID(),
            postingRequestHash: '0'.repeat(64),
          },
        }),
      ),
    );
    assert.equal(posts.filter((result) => result.status === 'fulfilled').length, 1);
    const posted = posts.find((result) => result.status === 'fulfilled');
    assert.ok(posted?.status === 'fulfilled');
    const refunds = await Promise.allSettled(
      [999990, 999991].map((sequenceNumber) =>
        context().prisma.$transaction(async (tx) => {
          const refund = await tx.customerRefund.create({
            data: {
              organizationId: org,
              salesOrderId: order.id,
              sequenceNumber,
              amount: '75',
              currencyCode: order.currencyCode,
              paymentMethod: 'CASH',
              paymentDate: new Date('2026-10-11'),
              createdByUserId: posted.value.createdByUserId,
              idempotencyKey: randomUUID(),
              requestHash: '0'.repeat(64),
            },
          });
          await tx.refundAllocation.create({
            data: {
              organizationId: org,
              salesOrderId: order.id,
              customerRefundId: refund.id,
              salesReturnId: posted.value.id,
              allocatedAmount: '75',
            },
          });
        }),
      ),
    );
    assert.equal(refunds.filter((result) => result.status === 'fulfilled').length, 1);
    const total = await context().prisma.customerRefund.aggregate({
      where: { organizationId: org, salesOrderId: order.id },
      _sum: { amount: true },
      _count: true,
    });
    assert.equal(total._count, 1);
    assert.equal(total._sum.amount?.toFixed(4), '75.0000');
  });
  void test('concurrent same-key create, post and payout replay returns one document and movement', async () => {
    const { order, item } = await fixture('1', '100', '100');
    const createKey = randomUUID();
    const created = await Promise.all([
      create(order, '1', true, createKey),
      create(order, '1', true, createKey),
    ]);
    assert.equal(created[0].id, created[1].id);
    const postKey = randomUUID();
    const posted = await Promise.all([post(created[0], postKey), post(created[0], postKey)]);
    assert.equal(posted[0].inventoryTransactionId, posted[1].inventoryTransactionId);
    assert.equal((await balance(item.defaultVariant.id)).quantity.toFixed(6), '1.000000');
    const refundKey = randomUUID();
    const refunds = await Promise.all([
      payout(order, posted[0], '100', refundKey),
      payout(order, posted[0], '100', refundKey),
    ]);
    assert.equal(refunds[0].id, refunds[1].id);
    assert.equal(
      await context().prisma.customerRefund.count({
        where: { organizationId: org, salesOrderId: order.id },
      }),
      1,
    );
  });
  void test('services and untracked products never create stock; service RESTOCK rejected', async () => {
    const service = await fixture('1', '100', '100', false, 'SERVICE');
    assert.equal(
      (await call('POST', `${base()}/returns`, input(service.order, '1', true))).statusCode,
      409,
    );
    const r = await post(await create(service.order, '1', false));
    assert.equal(r.inventoryTransactionId, null);
    const untracked = await fixture('1', '100', '100', false);
    await context().prisma.catalogItem.update({
      where: { id: untracked.item.id },
      data: { trackInventory: true },
    });
    const product = await post(await create(untracked.order, '1'));
    assert.equal(product.inventoryTransactionId, null);
    assert.equal(product.items[0]?.stockRestocked, false);
  });
  void test('archived historic product can restock using original snapshot without reactivating it', async () => {
    const { order, item } = await fixture('1', '100', '100');
    await context().prisma.catalogItem.update({
      where: { id: item.id },
      data: { isActive: false },
    });
    const r = await post(await create(order, '1'));
    assert.equal(r.items[0]?.stockRestocked, true);
    assert.equal(
      (await context().prisma.catalogItem.findUniqueOrThrow({ where: { id: item.id } })).isActive,
      false,
    );
  });
  void test('tenant isolation, missing auth, MEMBER financial masking and denied mutations', async () => {
    const { order } = await fixture();
    const r = await post(await create(order, '1', false));
    const refund = await payout(order, r, '50');
    const masked = await ok<SalesReturnResponse>(
      'GET',
      `${base()}/returns/${r.id}`,
      undefined,
      undefined,
      member,
    );
    assert.equal(masked.totalRefundableAmount, null);
    assert.equal(masked.items[0]?.refundAmount, null);
    assert.equal(masked.refunds, null);
    assert.equal(masked.availableRefundAmount, null);
    const eligibility = await ok<ReturnEligibilityResponse>(
      'GET',
      `${base()}/sales/orders/${order.id}/return-eligibility`,
      undefined,
      undefined,
      member,
    );
    assert.equal(eligibility.collectedAmount, null);
    assert.equal(eligibility.items[0]?.originalLineAmount, null);
    const maskedRefund = await ok<CustomerRefundResponse>(
      'GET',
      `${base()}/refunds/${refund.id}`,
      undefined,
      undefined,
      member,
    );
    assert.equal(maskedRefund.amount, null);
    assert.equal(maskedRefund.allocations[0]?.allocatedAmount, null);
    assert.equal(
      (await call('POST', `${base()}/returns`, input(order, '1', false), undefined, member))
        .statusCode,
      403,
    );
    assert.equal(
      (await call('GET', `${base()}/returns/${r.id}`, undefined, undefined, outsider)).statusCode,
      404,
    );
    assert.equal(
      (
        await call(
          'GET',
          `/api/v1/organizations/${foreignOrg}/returns/${r.id}`,
          undefined,
          undefined,
          outsider,
        )
      ).statusCode,
      404,
    );
    assert.equal(
      (await context().app.inject({ method: 'GET', url: `${base()}/returns` })).statusCode,
      401,
    );
    const list = await ok<PageResponse<SalesReturnResponse>>('GET', `${base()}/returns?limit=1`);
    assert.equal(list.items.length, 1);
    assert.ok(list.nextCursor);
    assert.equal((await call('GET', `${base()}/returns?from=invalid`)).statusCode, 400);
  });
  void test('failed restock rolls back line facts, status, transaction and projection', async () => {
    const { order, item } = await fixture('1', '100', '100');
    const r = await create(order, '1');
    const writer = context().app.get(InventoryCommandsService),
      original = writer.recordSaleReturn.bind(writer);
    writer.recordSaleReturn = () => Promise.reject(new Error('Injected failure'));
    try {
      assert.equal((await call('POST', `${base()}/returns/${r.id}/post`, {})).statusCode, 500);
    } finally {
      writer.recordSaleReturn = original;
    }
    const unchanged = await ok<SalesReturnResponse>('GET', `${base()}/returns/${r.id}`);
    assert.equal(unchanged.status, 'DRAFT');
    assert.equal(unchanged.items[0]?.stockRestocked, false);
    assert.equal(unchanged.inventoryTransactionId, null);
    assert.equal((await balance(item.defaultVariant.id)).quantity.toFixed(6), '0.000000');
    await post(unchanged);
  });
  void test('direct SQL rejects posted mutations, overrefund, wrong allocation and append; balances remain ledger sums', async () => {
    const { order, item } = await fixture('1', '100', '100');
    const r = await post(await create(order, '1'));
    const refund = await payout(order, r, '50'),
      schema = context().prisma.sqlSchema;
    const sqlReject = (sql: Prisma.Sql) => assert.rejects(context().prisma.$executeRaw(sql));
    await sqlReject(
      Prisma.sql`UPDATE ${schema}."SalesReturn" SET note='tamper' WHERE id=${r.id}::uuid`,
    );
    await sqlReject(
      Prisma.sql`UPDATE ${schema}."SalesReturnItem" SET quantity=2 WHERE "salesReturnId"=${r.id}::uuid`,
    );
    await sqlReject(
      Prisma.sql`UPDATE ${schema}."CustomerRefund" SET amount=0 WHERE id=${refund.id}::uuid`,
    );
    await sqlReject(
      Prisma.sql`DELETE FROM ${schema}."RefundAllocation" WHERE "customerRefundId"=${refund.id}::uuid`,
    );
    await assert.rejects(
      context().prisma.$transaction(async (tx) => {
        const actor = await tx.salesReturn.findUniqueOrThrow({ where: { id: r.id } });
        const row = await tx.customerRefund.create({
          data: {
            organizationId: org,
            salesOrderId: order.id,
            sequenceNumber: 999999,
            amount: '51',
            currencyCode: 'USD',
            paymentMethod: 'CASH',
            paymentDate: new Date('2026-10-11'),
            createdByUserId: actor.createdByUserId,
            idempotencyKey: randomUUID(),
            requestHash: '0'.repeat(64),
          },
        });
        await tx.refundAllocation.create({
          data: {
            organizationId: org,
            salesOrderId: order.id,
            customerRefundId: row.id,
            salesReturnId: r.id,
            allocatedAmount: '1',
          },
        });
      }),
    );
    const ledger = await context().prisma.inventoryLedgerEntry.aggregate({
      where: { organizationId: org, locationId: location.id, variantId: item.defaultVariant.id },
      _sum: { quantityDelta: true },
    });
    assert.equal(
      (await balance(item.defaultVariant.id)).quantity.toFixed(6),
      ledger._sum.quantityDelta?.toFixed(6),
    );
  });
  void test('discount is proportional with cumulative rounding; stale quote and revision are rejected', async () => {
    const { order } = await fixture('3', '1', '1', false, 'PRODUCT', '2');
    const a = await create(order, '1', false),
      b = await create(order, '1', false),
      c = await create(order, '1', false);
    assert.equal((await post(a)).totalRefundableAmount, '0.3333');
    const stale = await call('POST', `${base()}/returns/${b.id}/post`, {
      revision: b.revision,
      expectedCredit: b.currentQuoteAmount,
    });
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.json<{ code: string }>().code, 'RETURN_QUOTE_CHANGED');
    assert.equal((await post(b)).totalRefundableAmount, '0.3334');
    await ok('PATCH', `${base()}/returns/${c.id}`, { note: 'Reviewed' });
    assert.equal(
      (await call('POST', `${base()}/returns/${c.id}/post`, { revision: c.revision })).statusCode,
      409,
    );
    assert.equal(
      (await post(await ok<SalesReturnResponse>('GET', `${base()}/returns/${c.id}`)))
        .totalRefundableAmount,
      '0.3333',
    );
  });
  void test('unpaid and zero-price returns do not authorize refunds; legacy unknown type supports NO_RESTOCK only', async () => {
    const unpaid = await fixture('1', '100', '0', false);
    const r = await post(await create(unpaid.order, '1', false));
    assert.equal(
      (
        await call('POST', `${base()}/refunds`, {
          salesOrderId: unpaid.order.id,
          amount: '1',
          paymentMethod: 'CASH',
          paymentDate: '2026-10-11',
          allocations: [{ salesReturnId: r.id, allocatedAmount: '1' }],
        })
      ).statusCode,
      409,
    );
    const zero = await fixture('1', '0', '0', false);
    assert.equal(
      (await post(await create(zero.order, '1', false))).totalRefundableAmount,
      '0.0000',
    );
    const item = await ok<CatalogItemResponse>('POST', `${base()}/catalog/items`, {
      name: 'Legacy return snapshot',
      type: 'PRODUCT',
      trackInventory: false,
      defaultVariant: { unit: 'PIECE', sellingPrice: '100' },
    });
    const draft = await ok<SalesOrderResponse>('POST', `${base()}/sales/orders`, {
      locationId: location.id,
      items: [{ variantId: item.defaultVariant.id, quantity: '1' }],
    });
    await context().prisma.salesOrderItem.update({
      where: { id: draft.items[0]!.id },
      data: { snapshotItemType: null },
    });
    const completed = await ok<SalesOrderResponse>(
      'POST',
      `${base()}/sales/orders/${draft.id}/complete`,
      { payments: [{ method: 'CASH', amount: '100' }] },
    );
    assert.equal((await call('POST', `${base()}/returns`, input(completed, '1'))).statusCode, 409);
    const legacy = await post(await create(completed, '1', false));
    assert.equal(legacy.items[0]?.snapshotItemType, null);
    assert.equal(legacy.inventoryTransactionId, null);
  });
  void test('direct SQL rejects fake snapshots, cumulative overreturn, missing restock, missing allocation and appended payouts', async () => {
    const { order } = await fixture('2', '100', '200'),
      draft = await create(order, '1'),
      schema = context().prisma.sqlSchema;
    await assert.rejects(
      context().prisma.$executeRaw(
        Prisma.sql`UPDATE ${schema}."SalesReturnItem" SET "snapshotItemName"='fake' WHERE "salesReturnId"=${draft.id}::uuid`,
      ),
    );
    await assert.rejects(
      context().prisma.$executeRaw(
        Prisma.sql`UPDATE ${schema}."SalesReturnItem" SET quantity=3 WHERE "salesReturnId"=${draft.id}::uuid`,
      ),
    );
    await assert.rejects(
      context().prisma.$transaction(async (tx) => {
        await tx.salesReturnItem.updateMany({
          where: { salesReturnId: draft.id },
          data: { stockRestocked: true },
        });
        await tx.salesReturn.update({
          where: { id: draft.id },
          data: {
            status: 'POSTED',
            postedAt: new Date(),
            postedByUserId: draft.createdBy.id,
            postingIdempotencyKey: randomUUID(),
            postingRequestHash: '0'.repeat(64),
          },
        });
      }),
    );
    const r = await post(draft),
      refund = await payout(order, r, '50');
    await assert.rejects(
      context().prisma.refundAllocation.create({
        data: {
          organizationId: org,
          salesOrderId: order.id,
          customerRefundId: refund.id,
          salesReturnId: r.id,
          allocatedAmount: '1',
        },
      }),
    );
    await assert.rejects(
      context().prisma.customerRefund.create({
        data: {
          organizationId: org,
          salesOrderId: order.id,
          sequenceNumber: 999998,
          amount: '1',
          currencyCode: 'USD',
          paymentMethod: 'CASH',
          paymentDate: new Date('2026-10-11'),
          createdByUserId: draft.createdBy.id,
          idempotencyKey: randomUUID(),
          requestHash: '0'.repeat(64),
        },
      }),
    );
    const next = await create(order, '1', false),
      other = await create(order, '1', false);
    await post(next);
    await assert.rejects(
      context().prisma.salesReturn.update({
        where: { id: other.id },
        data: {
          status: 'POSTED',
          postedAt: new Date(),
          postedByUserId: other.createdBy.id,
          postingIdempotencyKey: randomUUID(),
          postingRequestHash: '0'.repeat(64),
        },
      }),
    );
  });
  void test('fresh Finance, return analytics and read-only AI distinguish credits, payouts, dates and financial access', async () => {
    const oldOrg = org,
      oldLocation = location;
    try {
      org = (
        await ok<OrganizationResponse>('POST', '/api/v1/organizations', {
          name: 'Return finance isolated',
          businessType: 'MIXED',
          defaultCurrency: 'USD',
          timezone: 'UTC',
        })
      ).id;
      location = await ok<LocationResponse>('POST', `${base()}/locations`, {
        name: 'Finance location',
        type: 'WAREHOUSE',
      });
      const today = new Date().toISOString().slice(0, 10),
        { order } = await fixture('10', '100', '700');
      const r = await post(await create(order, '2', false));
      await ok('POST', `${base()}/refunds`, {
        salesOrderId: order.id,
        amount: '150',
        paymentMethod: 'CASH',
        paymentDate: '2020-01-01',
        allocations: [{ salesReturnId: r.id, allocatedAmount: '150' }],
      });
      const summary = await ok<FinanceSummaryResponse>(
        'GET',
        `${base()}/finance/summary?from=${today}&to=${today}`,
      );
      assert.equal(summary.salesAmount, '1000.0000');
      assert.equal(summary.postedReturnCredits, '200.0000');
      assert.equal(summary.adjustedSalesAmount, '800.0000');
      assert.equal(summary.customerRefundsPaid, '0.0000');
      assert.equal(summary.netCashFlow, '700.0000');
      assert.equal(summary.outstandingReceivablesCurrent, '250.0000');
      const historic = await ok<FinanceSummaryResponse>(
        'GET',
        `${base()}/finance/summary?from=2020-01-01&to=2020-01-01`,
      );
      assert.equal(historic.customerRefundsPaid, '150.0000');
      assert.equal(historic.netCashFlow, '-150.0000');
      const analytics = await ok<ReturnsAnalyticsSummary>(
        'GET',
        `${base()}/analytics/returns/summary?from=${today}&to=${today}`,
      );
      assert.equal(analytics.returnsCount, 1);
      assert.equal(analytics.postedReturnCredits, '200.0000');
      assert.equal(analytics.customerRefundsPaid, '0.0000');
      assert.equal(analytics.topReturnedVariants[0]?.quantityReturned, '2.000000');
      assert.equal(analytics.topReturnedVariants[0]?.unit, 'PIECE');
      const cash = await ok<CashFlowTrendResponse>(
        'GET',
        `${base()}/analytics/finance/cash-flow?from=2020-01-01&to=2020-01-01`,
      );
      assert.equal(cash.points[0]?.customerRefunds, '150.0000');
      assert.equal(cash.points[0]?.netCashFlow, '-150.0000');
      await ok('PATCH', `${base()}/ai/settings`, { enabled: true, disclosureVersion: 'v1' });
      const ownerUser = await ok<UserResponse>('GET', '/api/v1/me');
      const gateway = context().app.get(AiToolsService),
        args = JSON.stringify({ from: today, to: today });
      const tool = await gateway.execute(
        org,
        ownerUser.id,
        'get_customer_returns_summary',
        args,
        randomUUID(),
      );
      assert.deepEqual(JSON.parse(JSON.stringify(tool.data)), analytics);
      const analyst = await ok<UserResponse>('GET', '/api/v1/me', undefined, undefined, member);
      const role = await context().prisma.role.create({
        data: {
          organizationId: org,
          key: 'RETURN_AI_ONLY',
          name: 'Return AI only',
          permissions: {
            create: [Permission.AI_USE, Permission.RETURNS_VIEW, Permission.ANALYTICS_VIEW].map(
              (permissionCode) => ({ permissionCode }),
            ),
          },
        },
      });
      const membership = await context().prisma.organizationMembership.create({
        data: { organizationId: org, userId: analyst.id },
      });
      await context().prisma.membershipRole.create({
        data: { organizationId: org, membershipId: membership.id, roleId: role.id },
      });
      const masked = (
        await gateway.execute(org, analyst.id, 'get_customer_returns_summary', args, randomUUID())
      ).data as ReturnsAnalyticsSummary;
      assert.equal(masked.postedReturnCredits, null);
      assert.equal(masked.topReturnedVariants[0]?.returnCredits, null);
      assert.equal(masked.returnsCount, 1);
      await assert.rejects(
        gateway.execute(
          org,
          analyst.id,
          'get_customer_returns_summary',
          JSON.stringify({ organizationId: foreignOrg }),
          randomUUID(),
        ),
      );
      await assert.rejects(
        gateway.execute(org, analyst.id, 'post_customer_return', '{}', randomUUID()),
      );
      await ok('POST', `${base()}/sales/orders/${order.id}/payments`, {
        amount: '250',
        method: 'CASH',
      });
      assert.equal(
        (
          await call('POST', `${base()}/sales/orders/${order.id}/payments`, {
            amount: '1',
            method: 'CASH',
          })
        ).statusCode,
        409,
      );
      const timezone =
        new Date(r.postedAt!).getUTCHours() >= 10 ? 'Pacific/Kiritimati' : 'Pacific/Pago_Pago';
      await ok('PATCH', base(), { timezone });
      const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en', {
          timeZone: timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        })
          .formatToParts(new Date(r.postedAt!))
          .map((p) => [p.type, p.value]),
      );
      const localDay = `${parts.year}-${parts.month}-${parts.day}`;
      assert.notEqual(localDay, r.postedAt!.slice(0, 10));
      const localReturns = await ok<PageResponse<SalesReturnResponse>>(
        'GET',
        `${base()}/returns?from=${localDay}&to=${localDay}`,
      );
      assert.equal(localReturns.items.length, 1);
      assert.equal(localReturns.items[0]?.id, r.id);
      const localAnalytics = await ok<ReturnsAnalyticsSummary>(
        'GET',
        `${base()}/analytics/returns/summary?from=${localDay}&to=${localDay}`,
      );
      assert.equal(localAnalytics.returnsCount, 1);
    } finally {
      org = oldOrg;
      location = oldLocation;
    }
  });
}
