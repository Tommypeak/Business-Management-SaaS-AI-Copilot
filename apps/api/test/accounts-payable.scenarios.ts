import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  Permission,
  type AccountsPayableSummaryResponse,
  type FinanceSummaryResponse,
  type OrganizationResponse,
  type PageResponse,
  type SupplierBillListItem,
  type SupplierBillResponse,
  type SupplierPaymentResponse,
  type UserResponse,
} from '@saas/types';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';

interface Context {
  app: NestFastifyApplication;
  prisma: PrismaService;
  admin: PrismaClient;
  schema: string;
  token: (subject: string) => Promise<string>;
  legacyOrganizationId: string;
}
type Method = 'GET' | 'POST' | 'PATCH';
export function registerAccountsPayableTests(context: () => Context) {
  let org: string, otherOrg: string, owner: string, other: string, admin: string, member: string;
  let supplier: string, secondSupplier: string, foreignSupplier: string;
  let location: string, po: string, draftPo: string, otherSupplierPo: string, foreignPo: string;
  const base = (id = org) => `/api/v1/organizations/${id}`;
  const ap = (suffix = '', id = org) => `${base(id)}/accounts-payable${suffix}`;
  const finance = (suffix = '', id = org) => `${base(id)}/finance${suffix}`;
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
    const result = await call(method, url, payload, key, bearer);
    assert.equal(result.statusCode, method === 'POST' ? 201 : 200, result.body);
    return result.json<T>();
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
    const result = await call(method, url, payload, key, bearer);
    assert.equal(result.statusCode, status, result.body);
    if (code) assert.equal(result.json<{ code: string }>().code, code);
  }
  const input = (extra: object = {}) => ({
    supplierId: supplier,
    supplierInvoiceNumber: 'INV-2026-1',
    issueDate: '2026-01-02',
    dueDate: '2026-01-30',
    amount: '100.0000',
    description: 'Supplies',
    ...extra,
  });
  const draft = (extra: object = {}, key?: string) =>
    ok<SupplierBillResponse>('POST', ap('/bills'), input(extra), key);
  const post = (id: string, key?: string) =>
    ok<SupplierBillResponse>('POST', ap(`/bills/${id}/post`), {}, key);
  const payment = (id: string, amount: string, extra: object = {}, key?: string) =>
    ok<SupplierPaymentResponse>(
      'POST',
      ap(`/bills/${id}/payments`),
      {
        amount,
        method: 'BANK_TRANSFER',
        paymentDate: '2026-01-02',
        reference: 'Transfer',
        ...extra,
      },
      key,
    );
  const poFixture = (
    tenant: string,
    supplierId: string,
    locationId: string,
    actor: string,
    number: number,
    status: 'DRAFT' | 'ORDERED' = 'ORDERED',
  ) =>
    context().prisma.purchaseOrder.create({
      data: {
        organizationId: tenant,
        supplierId,
        destinationLocationId: locationId,
        sequenceNumber: number,
        status,
        currencyCode: 'USD',
        subtotal: '100',
        total: '100',
        createdByUserId: actor,
        creationIdempotencyKey: randomUUID(),
        creationRequestHash: 'a'.repeat(64),
        ...(status === 'ORDERED'
          ? {
              orderedAt: new Date('2026-01-01T00:00:00Z'),
              orderingIdempotencyKey: randomUUID(),
              orderingRequestHash: 'b'.repeat(64),
            }
          : {}),
      },
    });

  void test('AP permissions backfill old roles and initialize new organizations', async () => {
    [owner, other, admin, member] = await Promise.all([
      context().token('ap-owner'),
      context().token('ap-other'),
      context().token('ap-admin'),
      context().token('ap-member'),
    ]);
    const organization = {
      name: 'AP organization',
      businessType: 'MIXED',
      defaultCurrency: 'USD',
      timezone: 'Pacific/Kiritimati',
    };
    org = (await ok<OrganizationResponse>('POST', '/api/v1/organizations', organization)).id;
    otherOrg = (
      await ok<OrganizationResponse>(
        'POST',
        '/api/v1/organizations',
        organization,
        undefined,
        other,
      )
    ).id;
    for (const tenant of [context().legacyOrganizationId, org]) {
      for (const roleKey of ['OWNER', 'ADMIN', 'MEMBER']) {
        const role = await context().prisma.role.findUniqueOrThrow({
          where: { organizationId_key: { organizationId: tenant, key: roleKey } },
          include: { permissions: true },
        });
        assert.deepEqual(
          role.permissions
            .map((p) => p.permissionCode)
            .filter((p) => p.startsWith('accountsPayable.'))
            .sort(),
          roleKey === 'MEMBER'
            ? []
            : [
                Permission.ACCOUNTS_PAYABLE_VIEW,
                Permission.ACCOUNTS_PAYABLE_MANAGE,
                Permission.ACCOUNTS_PAYABLE_PAYMENTS_MANAGE,
              ].sort(),
        );
      }
    }
    for (const [bearer, roleKey] of [
      [admin, 'ADMIN'],
      [member, 'MEMBER'],
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
        name: 'Warehouse',
        type: 'WAREHOUSE',
      })
    ).id;
    const foreignLocation = (
      await ok<{ id: string }>(
        'POST',
        `${base(otherOrg)}/locations`,
        { name: 'Other warehouse', type: 'WAREHOUSE' },
        undefined,
        other,
      )
    ).id;
    supplier = (await ok<{ id: string }>('POST', `${base()}/suppliers`, { name: 'Vendor A' })).id;
    secondSupplier = (await ok<{ id: string }>('POST', `${base()}/suppliers`, { name: 'Vendor B' }))
      .id;
    foreignSupplier = (
      await ok<{ id: string }>(
        'POST',
        `${base(otherOrg)}/suppliers`,
        { name: 'Foreign Vendor' },
        undefined,
        other,
      )
    ).id;
    const actor = (await ok<UserResponse>('GET', '/api/v1/me')).id;
    const foreignActor = (await ok<UserResponse>('GET', '/api/v1/me', undefined, undefined, other))
      .id;
    po = (await poFixture(org, supplier, location, actor, 9001)).id;
    draftPo = (await poFixture(org, supplier, location, actor, 9002, 'DRAFT')).id;
    otherSupplierPo = (await poFixture(org, secondSupplier, location, actor, 9003)).id;
    foreignPo = (await poFixture(otherOrg, foreignSupplier, foreignLocation, foreignActor, 9004))
      .id;
  });

  void test('Bill creation has exact money, tenant sequence, currency snapshot and idempotency', async () => {
    const key = randomUUID();
    const first = await draft({ amount: '100.1234', supplierInvoiceNumber: ' Inv   One ' }, key);
    const replay = await draft({ amount: '100.1234', supplierInvoiceNumber: 'Inv One' }, key);
    assert.equal(first.id, replay.id);
    const concurrentKey = randomUUID();
    const concurrent = await Promise.all([
      draft({ supplierInvoiceNumber: 'REPLAY' }, concurrentKey),
      draft({ supplierInvoiceNumber: 'REPLAY' }, concurrentKey),
    ]);
    assert.equal(concurrent[0]?.id, concurrent[1]?.id);
    assert.equal(first.number, 'BILL-000001');
    assert.equal(first.amount, '100.1234');
    assert.equal(first.currencyCode, 'USD');
    await reject(
      'POST',
      ap('/bills'),
      input({ amount: '101' }),
      409,
      'IDEMPOTENCY_KEY_CONFLICT',
      key,
    );
    await ok('PATCH', base(), { defaultCurrency: 'EUR' });
    assert.equal(
      (await ok<SupplierBillResponse>('GET', ap(`/bills/${first.id}`))).currencyCode,
      'USD',
    );
    const linked = await draft({ purchaseOrderId: po, supplierInvoiceNumber: null });
    assert.equal(linked.currencyCode, 'USD');
    const plain = await draft({ supplierInvoiceNumber: null });
    assert.equal(plain.currencyCode, 'EUR');
    const created = await Promise.all(
      Array.from({ length: 5 }, (_, n) => draft({ supplierInvoiceNumber: `PAR-${n}` })),
    );
    assert.equal(new Set(created.map((row) => row.sequenceNumber)).size, 5);
    await reject('POST', ap('/bills'), input({ amount: '0' }), 400);
    await reject('POST', ap('/bills'), input({ amount: '1.00001' }), 400);
    await reject('POST', ap('/bills'), input({ amount: '9999999999999999' }), 400);
    await reject('POST', ap('/bills'), input({ dueDate: '2025-12-31' }), 400);
    await reject('POST', ap('/bills'), input({ issueDate: '2026-02-30' }), 400);
    await reject('POST', ap('/bills'), input({ status: 'POSTED' }), 400);
    await reject('POST', ap('/bills'), input({ currencyCode: 'JPY' }), 400);
    await reject('POST', ap('/bills'), input({ supplierId: foreignSupplier }), 404);
    await reject('POST', ap('/bills'), input({ purchaseOrderId: foreignPo }), 404);
    await reject(
      'POST',
      ap('/bills'),
      input({ purchaseOrderId: otherSupplierPo }),
      409,
      'BILL_PURCHASE_ORDER_SUPPLIER_MISMATCH',
    );
  });

  void test('Draft PO can be linked but not posted; invoice uniqueness and immutability apply', async () => {
    const linked = await draft({ purchaseOrderId: draftPo, supplierInvoiceNumber: 'DRAFT-PO' });
    await reject(
      'POST',
      ap(`/bills/${linked.id}/post`),
      {},
      409,
      'BILL_PURCHASE_ORDER_NOT_ELIGIBLE',
    );
    await ok('PATCH', ap(`/bills/${linked.id}`), {
      purchaseOrderId: po,
      amount: '125.0001',
      dueDate: null,
    });
    const posted = await post(linked.id);
    assert.equal(posted.status, 'POSTED');
    assert.ok(posted.postedAt);
    assert.equal(posted.purchaseOrder?.id, po);
    await reject('PATCH', ap(`/bills/${linked.id}`), { amount: '130' }, 409, 'BILL_NOT_EDITABLE');
    const duplicate = await draft({ purchaseOrderId: po, supplierInvoiceNumber: ' draft-po ' });
    await reject('POST', ap(`/bills/${duplicate.id}/post`), {}, 409, 'BILL_INVOICE_ALREADY_EXISTS');
    const racing = await Promise.all([
      draft({ supplierInvoiceNumber: 'Race Invoice' }),
      draft({ supplierInvoiceNumber: ' race   invoice ' }),
    ]);
    const posting = await Promise.all(
      racing.map((bill) => call('POST', ap(`/bills/${bill.id}/post`), {})),
    );
    assert.deepEqual(posting.map((row) => row.statusCode).sort(), [201, 409]);
    await reject(
      'PATCH',
      ap(`/bills/${duplicate.id}`),
      { supplierId: secondSupplier },
      409,
      'BILL_PURCHASE_ORDER_SUPPLIER_MISMATCH',
    );
    await reject('PATCH', ap(`/bills/${duplicate.id}`), { organizationId: otherOrg }, 400);
    await reject('PATCH', ap(`/bills/${duplicate.id}`), { status: 'POSTED' }, 400);
  });

  void test('Posting and voiding are concurrent, idempotent and preserve history', async () => {
    const bill = await draft({ supplierInvoiceNumber: 'VOID-ME' });
    const postKey = randomUUID();
    const posted = await Promise.all([
      call('POST', ap(`/bills/${bill.id}/post`), {}, postKey),
      call('POST', ap(`/bills/${bill.id}/post`), {}, postKey),
    ]);
    assert.deepEqual(
      posted.map((row) => row.statusCode),
      [201, 201],
    );
    assert.equal(
      posted[0].json<SupplierBillResponse>().postedAt,
      posted[1].json<SupplierBillResponse>().postedAt,
    );
    await reject('POST', ap(`/bills/${bill.id}/void`), {}, 400);
    const key = randomUUID();
    const voided = await Promise.all([
      call('POST', ap(`/bills/${bill.id}/void`), { reason: 'Incorrect invoice' }, key),
      call('POST', ap(`/bills/${bill.id}/void`), { reason: 'Incorrect invoice' }, key),
    ]);
    assert.deepEqual(
      voided.map((row) => row.statusCode),
      [201, 201],
    );
    assert.equal(
      voided[0].json<SupplierBillResponse>().voidedAt,
      voided[1].json<SupplierBillResponse>().voidedAt,
    );
    assert.equal(voided[0].json<SupplierBillResponse>().amount, '100.0000');
    await reject(
      'POST',
      ap(`/bills/${bill.id}/void`),
      { reason: 'Different' },
      409,
      'IDEMPOTENCY_KEY_CONFLICT',
      key,
    );
    await reject('POST', ap(`/bills/${bill.id}/post`), {}, 409);
    await reject(
      'POST',
      ap(`/bills/${bill.id}/payments`),
      { amount: '1', method: 'CASH', paymentDate: '2026-01-02' },
      409,
      'BILL_NOT_PAYABLE',
    );
    await reject('PATCH', ap(`/bills/${bill.id}`), { note: 'tamper' }, 409, 'BILL_NOT_EDITABLE');
    const unposted = await draft({ supplierInvoiceNumber: 'UNPOSTED' });
    await reject(
      'POST',
      ap(`/bills/${unposted.id}/void`),
      { reason: 'No' },
      409,
      'BILL_NOT_VOIDABLE',
    );
  });

  void test('Payments are partial/full, immutable, bounded by outstanding and idempotent', async () => {
    const bill = await draft({ supplierInvoiceNumber: 'PAYMENTS', amount: '100' });
    await post(bill.id);
    const key = randomUUID();
    const first = await payment(bill.id, '30', {}, key);
    const replay = await payment(bill.id, '30.0000', {}, key);
    assert.equal(first.id, replay.id);
    assert.equal(first.paymentDate, '2026-01-02');
    await reject(
      'POST',
      ap(`/bills/${bill.id}/payments`),
      { amount: '40', method: 'BANK_TRANSFER', paymentDate: '2026-01-02', reference: 'Transfer' },
      409,
      'IDEMPOTENCY_KEY_CONFLICT',
      key,
    );
    await reject(
      'POST',
      ap(`/bills/${bill.id}/payments`),
      { amount: '30', method: 'CASH', paymentDate: '2026-01-02', reference: 'Transfer' },
      409,
      'IDEMPOTENCY_KEY_CONFLICT',
      key,
    );
    await reject(
      'POST',
      ap(`/bills/${bill.id}/payments`),
      { amount: '30', method: 'BANK_TRANSFER', paymentDate: '2026-01-03', reference: 'Transfer' },
      409,
      'IDEMPOTENCY_KEY_CONFLICT',
      key,
    );
    let detail = await ok<SupplierBillResponse>('GET', ap(`/bills/${bill.id}`));
    assert.deepEqual(
      [detail.paidAmount, detail.outstandingAmount, detail.paymentStatus],
      ['30.0000', '70.0000', 'PARTIALLY_PAID'],
    );
    await reject('POST', ap(`/bills/${bill.id}/void`), { reason: 'No' }, 409, 'BILL_HAS_PAYMENTS');
    await reject(
      'POST',
      ap(`/bills/${bill.id}/payments`),
      { amount: '70.0001', method: 'CASH', paymentDate: '2026-01-02' },
      409,
      'SUPPLIER_PAYMENT_EXCEEDS_OUTSTANDING',
    );
    await payment(bill.id, '70');
    detail = await ok<SupplierBillResponse>('GET', ap(`/bills/${bill.id}`));
    assert.deepEqual(
      [detail.paidAmount, detail.outstandingAmount, detail.paymentStatus],
      ['100.0000', '0.0000', 'PAID'],
    );
    await reject(
      'POST',
      ap(`/bills/${bill.id}/payments`),
      { amount: '1', method: 'CASH', paymentDate: '2026-01-02' },
      409,
      'SUPPLIER_PAYMENT_EXCEEDS_OUTSTANDING',
    );
    const list = await ok<PageResponse<SupplierPaymentResponse>>(
      'GET',
      ap(`/bills/${bill.id}/payments?limit=1`),
    );
    assert.equal(list.items.length, 1);
    assert.ok(list.nextCursor);
    assert.equal(
      (
        await ok<PageResponse<SupplierPaymentResponse>>(
          'GET',
          ap(`/bills/${bill.id}/payments?limit=1&cursor=${encodeURIComponent(list.nextCursor)}`),
        )
      ).items.length,
      1,
    );
    const stored = await context().prisma.supplierPayment.findFirstOrThrow({
      where: { organizationId: org, id: first.id },
    });
    await assert.rejects(
      context().prisma.supplierPayment.update({ where: { id: first.id }, data: { amount: '31' } }),
    );
    await assert.rejects(context().prisma.supplierPayment.delete({ where: { id: first.id } }));
    assert.equal(stored.amount.toFixed(4), '30.0000');
    const actor = (await ok<UserResponse>('GET', '/api/v1/me')).id;
    await assert.rejects(
      context().prisma.supplierPayment.create({
        data: {
          organizationId: org,
          supplierBillId: bill.id,
          createdByUserId: actor,
          amount: '1',
          method: 'CASH',
          paymentDate: new Date('2026-01-02T00:00:00Z'),
          idempotencyKey: randomUUID(),
          requestHash: 'c'.repeat(64),
        },
      }),
    );
    await assert.rejects(
      context().prisma.supplierBill.update({
        where: { id: bill.id },
        data: {
          status: 'VOIDED',
          voidedAt: new Date(),
          voidedByUserId: actor,
          voidReason: 'Improper',
          voidIdempotencyKey: randomUUID(),
          voidRequestHash: 'd'.repeat(64),
        },
      }),
    );
  });

  void test('Concurrent different payments cannot overpay; concurrent replay creates one payment', async () => {
    const bill = await post((await draft({ supplierInvoiceNumber: 'RACE' })).id);
    const results = await Promise.all([
      call('POST', ap(`/bills/${bill.id}/payments`), {
        amount: '70',
        method: 'CASH',
        paymentDate: '2026-01-02',
      }),
      call('POST', ap(`/bills/${bill.id}/payments`), {
        amount: '70',
        method: 'CASH',
        paymentDate: '2026-01-02',
      }),
    ]);
    assert.deepEqual(results.map((row) => row.statusCode).sort(), [201, 409]);
    assert.equal(
      (await ok<SupplierBillResponse>('GET', ap(`/bills/${bill.id}`))).outstandingAmount,
      '30.0000',
    );
    const key = randomUUID();
    const replays = await Promise.all([
      call(
        'POST',
        ap(`/bills/${bill.id}/payments`),
        { amount: '10', method: 'CARD', paymentDate: '2026-01-03' },
        key,
      ),
      call(
        'POST',
        ap(`/bills/${bill.id}/payments`),
        { amount: '10.0000', method: 'CARD', paymentDate: '2026-01-03' },
        key,
      ),
    ]);
    assert.deepEqual(
      replays.map((row) => row.statusCode),
      [201, 201],
    );
    assert.equal(
      replays[0].json<SupplierPaymentResponse>().id,
      replays[1].json<SupplierPaymentResponse>().id,
    );
    assert.equal(
      (await ok<SupplierBillResponse>('GET', ap(`/bills/${bill.id}`))).paidAmount,
      '80.0000',
    );
  });

  void test('AP summary, overdue, list filters and timezone use PostgreSQL totals', async () => {
    const financeOrg = (
      await ok<OrganizationResponse>('POST', '/api/v1/organizations', {
        name: 'AP summary organization',
        businessType: 'MIXED',
        defaultCurrency: 'USD',
        timezone: 'Pacific/Kiritimati',
      })
    ).id;
    const s = (
      await ok<{ id: string }>('POST', `${base(financeOrg)}/suppliers`, { name: 'Summary Vendor' })
    ).id;
    const create = async (amount: string, dueDate: string | null, invoiceNumber: string) => {
      const bill = await ok<SupplierBillResponse>('POST', ap('/bills', financeOrg), {
        supplierId: s,
        supplierInvoiceNumber: invoiceNumber,
        issueDate: '2020-01-01',
        dueDate,
        amount,
      });
      return ok<SupplierBillResponse>('POST', ap(`/bills/${bill.id}/post`, financeOrg), {});
    };
    const a = await create('100', '2020-01-02', 'A');
    const b = await create('200', '2020-01-02', 'B');
    const c = await create('300', null, 'C');
    const d = await create('400', '2020-01-02', 'D');
    await ok('POST', ap(`/bills/${d.id}/void`, financeOrg), { reason: 'Wrong bill' });
    await ok('POST', ap(`/bills/${b.id}/payments`, financeOrg), {
      amount: '50',
      method: 'CASH',
      paymentDate: '2026-01-02',
    });
    await ok('POST', ap(`/bills/${c.id}/payments`, financeOrg), {
      amount: '300',
      method: 'CASH',
      paymentDate: '2026-01-02',
    });
    const summary = await ok<AccountsPayableSummaryResponse>('GET', ap('/summary', financeOrg));
    assert.deepEqual(
      [
        summary.totalOutstanding,
        summary.overdueOutstanding,
        summary.unpaidBillsCount,
        summary.partiallyPaidBillsCount,
        summary.overdueBillsCount,
      ],
      ['250.0000', '250.0000', 1, 1, 2],
    );
    const expectedDay = Object.fromEntries(
      new Intl.DateTimeFormat('en', {
        timeZone: 'Pacific/Kiritimati',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
        .formatToParts(new Date())
        .map((part) => [part.type, part.value]),
    );
    assert.equal(summary.asOf, `${expectedDay.year}-${expectedDay.month}-${expectedDay.day}`);
    const overdue = await ok<PageResponse<SupplierBillListItem>>(
      'GET',
      ap('/bills?overdue=true&limit=1', financeOrg),
    );
    assert.equal(overdue.items.length, 1);
    assert.ok(overdue.nextCursor);
    assert.equal(
      (
        await ok<PageResponse<SupplierBillListItem>>(
          'GET',
          ap(
            `/bills?overdue=true&limit=1&cursor=${encodeURIComponent(overdue.nextCursor)}`,
            financeOrg,
          ),
        )
      ).items.length,
      1,
    );
    assert.equal(
      (
        await ok<PageResponse<SupplierBillListItem>>(
          'GET',
          ap('/bills?paymentStatus=PARTIALLY_PAID', financeOrg),
        )
      ).items[0]?.id,
      b.id,
    );
    assert.equal(
      (
        await ok<PageResponse<SupplierBillListItem>>(
          'GET',
          ap('/bills?q=Summary%20Vendor', financeOrg),
        )
      ).items.length,
      4,
    );
    assert.equal(
      (await ok<PageResponse<SupplierBillListItem>>('GET', ap('/bills?q=BILL-000001', financeOrg)))
        .items[0]?.id,
      a.id,
    );
    const notOverdue = await ok<PageResponse<SupplierBillListItem>>(
      'GET',
      ap('/bills?overdue=false', financeOrg),
    );
    assert.ok(notOverdue.items.some((bill) => bill.id === c.id));
    const yesterday = new Date(`${summary.asOf}T00:00:00.000Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayDate = yesterday.toISOString().slice(0, 10);
    const dueToday = await create('11', summary.asOf, 'DUE-TODAY');
    const dueYesterday = await create('12', yesterdayDate, 'DUE-YESTERDAY');
    const todayDetail = await ok<SupplierBillResponse>(
      'GET',
      ap(`/bills/${dueToday.id}`, financeOrg),
    );
    const yesterdayDetail = await ok<SupplierBillResponse>(
      'GET',
      ap(`/bills/${dueYesterday.id}`, financeOrg),
    );
    assert.equal(todayDetail.isOverdue, false);
    assert.equal(yesterdayDetail.isOverdue, true);
  });

  void test('Finance counts supplier payment cash once, excludes Bill posting and keeps location unallocated', async () => {
    const flowOrg = (
      await ok<OrganizationResponse>('POST', '/api/v1/organizations', {
        name: 'AP finance organization',
        businessType: 'MIXED',
        defaultCurrency: 'USD',
        timezone: 'UTC',
      })
    ).id;
    const s = (
      await ok<{ id: string }>('POST', `${base(flowOrg)}/suppliers`, { name: 'Cash Vendor' })
    ).id;
    const loc = (
      await ok<{ id: string }>('POST', `${base(flowOrg)}/locations`, {
        name: 'Branch',
        type: 'STORE',
      })
    ).id;
    const bill = await ok<SupplierBillResponse>('POST', ap('/bills', flowOrg), {
      supplierId: s,
      issueDate: '2026-01-02',
      amount: '100',
    });
    const before = await ok<FinanceSummaryResponse>(
      'GET',
      finance('/summary?from=2026-01-02&to=2026-01-02', flowOrg),
    );
    await ok('POST', ap(`/bills/${bill.id}/post`, flowOrg), {});
    const posted = await ok<FinanceSummaryResponse>(
      'GET',
      finance('/summary?from=2026-01-02&to=2026-01-02', flowOrg),
    );
    assert.equal(before.netCashFlow, posted.netCashFlow);
    assert.equal(posted.supplierPaymentsPaid, '0.0000');
    assert.equal(posted.outstandingPayablesCurrent, '100.0000');
    const category = await ok<{ id: string }>('POST', `${base(flowOrg)}/expense-categories`, {
      name: 'Operating',
    });
    const expense = await ok<{ id: string }>('POST', `${base(flowOrg)}/expenses`, {
      categoryId: category.id,
      expenseDate: '2026-01-02',
      amount: '20',
      paymentMethod: 'CASH',
    });
    await ok('POST', `${base(flowOrg)}/expenses/${expense.id}/post`, {});
    await ok('POST', ap(`/bills/${bill.id}/payments`, flowOrg), {
      amount: '100',
      method: 'CASH',
      paymentDate: '2026-01-02',
    });
    const summary = await ok<FinanceSummaryResponse>(
      'GET',
      finance('/summary?from=2026-01-02&to=2026-01-02', flowOrg),
    );
    assert.deepEqual(
      [
        summary.expensesPaid,
        summary.supplierPaymentsPaid,
        summary.netCashFlow,
        summary.outstandingPayablesCurrent,
      ],
      ['20.0000', '100.0000', '-120.0000', '0.0000'],
    );
    const otherDate = await ok<FinanceSummaryResponse>(
      'GET',
      finance('/summary?from=2026-01-03&to=2026-01-03', flowOrg),
    );
    assert.equal(otherDate.supplierPaymentsPaid, '0.0000');
    assert.equal(otherDate.outstandingPayablesCurrent, '0.0000');
    const filtered = await ok<FinanceSummaryResponse>(
      'GET',
      finance(`/summary?from=2026-01-02&to=2026-01-02&locationId=${loc}`, flowOrg),
    );
    assert.equal(filtered.supplierPaymentsPaid, null);
    assert.equal(filtered.outstandingPayablesCurrent, null);
    assert.equal(filtered.supplierPaymentsLocationScoped, false);
    assert.equal(filtered.netCashFlow, '0.0000');
  });

  void test('Archived supplier can be paid on an existing Bill; tenant and RBAC routes stay isolated', async () => {
    const unposted = await draft({ supplierInvoiceNumber: 'ARCHIVED-DRAFT' });
    const bill = await post((await draft({ supplierInvoiceNumber: 'ARCHIVE' })).id);
    await ok('PATCH', `${base()}/suppliers/${supplier}`, { isActive: false });
    await payment(bill.id, '10');
    await reject('POST', ap(`/bills/${unposted.id}/post`), {}, 409, 'PURCHASE_SUPPLIER_INACTIVE');
    await reject(
      'POST',
      ap('/bills'),
      input({ supplierInvoiceNumber: 'NEW' }),
      409,
      'PURCHASE_SUPPLIER_INACTIVE',
    );
    const foreign = await ok<SupplierBillResponse>(
      'POST',
      ap('/bills', otherOrg),
      {
        supplierId: foreignSupplier,
        issueDate: '2026-01-02',
        amount: '200',
      },
      undefined,
      other,
    );
    await reject('GET', ap(`/bills/${foreign.id}`), undefined, 404);
    await reject('PATCH', ap(`/bills/${foreign.id}`), { note: 'x' }, 404);
    await reject('POST', ap(`/bills/${foreign.id}/post`), {}, 404);
    await reject('POST', ap(`/bills/${foreign.id}/void`), { reason: 'x' }, 404);
    await reject(
      'POST',
      ap(`/bills/${foreign.id}/payments`),
      { amount: '1', method: 'CASH', paymentDate: '2026-01-02' },
      404,
    );
    await reject('GET', ap('/summary', otherOrg), undefined, 404);
    await assert.rejects(
      context().prisma.supplierBill.update({
        where: { id: unposted.id },
        data: { supplierId: foreignSupplier },
      }),
    );
    await assert.rejects(
      context().prisma.supplierBill.update({
        where: { id: unposted.id },
        data: { purchaseOrderId: foreignPo },
      }),
    );
    await assert.rejects(
      context().prisma.supplierBill.update({
        where: { id: unposted.id },
        data: { purchaseOrderId: otherSupplierPo },
      }),
    );
    const actor = (await ok<UserResponse>('GET', '/api/v1/me')).id;
    await assert.rejects(
      context().prisma.supplierPayment.create({
        data: {
          organizationId: org,
          supplierBillId: foreign.id,
          amount: '1',
          method: 'CASH',
          paymentDate: new Date('2026-01-02T00:00:00.000Z'),
          createdByUserId: actor,
          idempotencyKey: randomUUID(),
          requestHash: 'c'.repeat(64),
        },
      }),
    );
    await reject('GET', ap('/bills'), undefined, 403, undefined, undefined, member);
    await reject('GET', ap('/summary'), undefined, 403, undefined, undefined, member);
    await reject(
      'POST',
      ap('/bills'),
      input({ supplierId: secondSupplier }),
      403,
      undefined,
      undefined,
      member,
    );
    await reject('POST', ap(`/bills/${bill.id}/post`), {}, 403, undefined, undefined, member);
    await reject(
      'POST',
      ap(`/bills/${bill.id}/payments`),
      { amount: '1', method: 'CASH', paymentDate: '2026-01-02' },
      403,
      undefined,
      undefined,
      member,
    );
    const adminBill = await ok<SupplierBillResponse>(
      'POST',
      ap('/bills'),
      input({ supplierId: secondSupplier, supplierInvoiceNumber: 'ADMIN' }),
      undefined,
      admin,
    );
    const adminPosted = await ok<SupplierBillResponse>(
      'POST',
      ap(`/bills/${adminBill.id}/post`),
      {},
      undefined,
      admin,
    );
    assert.equal(adminPosted.status, 'POSTED');
    await ok(
      'POST',
      ap(`/bills/${adminBill.id}/payments`),
      { amount: '1', method: 'CASH', paymentDate: '2026-01-02' },
      undefined,
      admin,
    );
    const adminRole = await context().prisma.role.findUniqueOrThrow({
      where: { organizationId_key: { organizationId: org, key: 'ADMIN' } },
    });
    await context().prisma.rolePermission.delete({
      where: {
        roleId_permissionCode: {
          roleId: adminRole.id,
          permissionCode: Permission.ACCOUNTS_PAYABLE_PAYMENTS_MANAGE,
        },
      },
    });
    const manageOnlyBill = await ok<SupplierBillResponse>(
      'POST',
      ap('/bills'),
      input({ supplierId: secondSupplier, supplierInvoiceNumber: 'MANAGE-ONLY' }),
      undefined,
      admin,
    );
    await reject(
      'POST',
      ap(`/bills/${manageOnlyBill.id}/payments`),
      { amount: '1', method: 'CASH', paymentDate: '2026-01-02' },
      403,
      undefined,
      undefined,
      admin,
    );
    assert.equal(
      (await ok<SupplierBillResponse>('GET', ap(`/bills/${bill.id}`))).supplier.isActive,
      false,
    );
  });
}
