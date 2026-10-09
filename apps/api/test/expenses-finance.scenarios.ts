import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  Permission,
  type CatalogItemResponse,
  type ExpenseCategoryBreakdownResponse,
  type ExpenseCategoryResponse,
  type ExpenseListItem,
  type ExpenseResponse,
  type FinanceSummaryResponse,
  type OrganizationResponse,
  type PageResponse,
  type SalesOrderResponse,
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
export function registerExpensesFinanceTests(context: () => Context) {
  let org: string,
    foreignOrg: string,
    owner: string,
    outsider: string,
    member: string,
    admin: string;
  let category: ExpenseCategoryResponse, foreignCategory: ExpenseCategoryResponse;
  let location: string, foreignLocation: string;
  const base = (id = org) => `/api/v1/organizations/${id}`;
  const expenses = (suffix = '', id = org) => `${base(id)}/expenses${suffix}`;
  const categories = (suffix = '', id = org) => `${base(id)}/expense-categories${suffix}`;
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
  const input = (extra: object = {}) => ({
    categoryId: category.id,
    expenseDate: '2026-01-02',
    amount: '100.0000',
    paymentMethod: 'CASH',
    payeeName: 'Payee',
    ...extra,
  });
  const draft = (extra: object = {}, key?: string) =>
    ok<ExpenseResponse>('POST', expenses(), input(extra), key);

  void test('finance permissions backfill old roles and initialize new organizations', async () => {
    [owner, outsider, member, admin] = await Promise.all([
      context().token('expense-owner'),
      context().token('expense-outsider'),
      context().token('expense-member'),
      context().token('expense-admin'),
    ]);
    const organization = {
      name: 'Expense organization',
      businessType: 'MIXED',
      defaultCurrency: 'USD',
      timezone: 'Asia/Almaty',
    };
    org = (await ok<OrganizationResponse>('POST', '/api/v1/organizations', organization)).id;
    foreignOrg = (
      await ok<OrganizationResponse>(
        'POST',
        '/api/v1/organizations',
        organization,
        undefined,
        outsider,
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
            .filter((p) => p.startsWith('expenses.') || p.startsWith('finance.'))
            .sort(),
          roleKey === 'MEMBER'
            ? []
            : [
                Permission.EXPENSES_VIEW,
                Permission.EXPENSES_MANAGE,
                Permission.FINANCE_VIEW,
              ].sort(),
        );
      }
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
        name: 'Expense location',
        type: 'OFFICE',
      })
    ).id;
    foreignLocation = (
      await ok<{ id: string }>(
        'POST',
        `${base(foreignOrg)}/locations`,
        { name: 'Foreign office', type: 'OFFICE' },
        undefined,
        outsider,
      )
    ).id;
    category = await ok<ExpenseCategoryResponse>('POST', categories(), { name: 'Rent' });
    foreignCategory = await ok<ExpenseCategoryResponse>(
      'POST',
      categories('', foreignOrg),
      { name: 'Rent' },
      undefined,
      outsider,
    );
  });

  void test('categories normalize names, reject concurrent duplicates and archive without losing history', async () => {
    const responses = await Promise.all([
      call('POST', categories(), { name: ' rent ' }),
      call('POST', categories(), { name: 'RENT' }),
    ]);
    assert.deepEqual(
      responses.map((r) => r.statusCode),
      [409, 409],
    );
    assert.equal(responses[0]?.json<{ code: string }>().code, 'EXPENSE_CATEGORY_ALREADY_EXISTS');
    const marketing = await ok<ExpenseCategoryResponse>(
      'POST',
      categories(),
      { name: 'Marketing' },
      undefined,
      admin,
    );
    assert.equal(
      (
        await ok<ExpenseCategoryResponse>(
          'PATCH',
          categories(`/${marketing.id}`),
          {
            name: 'Digital   Marketing',
          },
          undefined,
          admin,
        )
      ).normalizedName,
      'digital marketing',
    );
    const historical = await draft({ categoryId: marketing.id });
    const pending = await draft({ categoryId: marketing.id });
    await ok('POST', expenses(`/${historical.id}/post`), {});
    await ok('PATCH', categories(`/${marketing.id}`), { isActive: false }, undefined, admin);
    assert.equal(
      (await ok<ExpenseResponse>('GET', expenses(`/${historical.id}`))).category.name,
      'Digital Marketing',
    );
    await reject(
      'POST',
      expenses(),
      input({ categoryId: marketing.id }),
      409,
      'EXPENSE_CATEGORY_INACTIVE',
    );
    assert.equal(
      (await ok<ExpenseResponse>('GET', expenses(`/${historical.id}`))).status,
      'POSTED',
    );
    await reject('POST', expenses(`/${pending.id}/post`), {}, 409, 'EXPENSE_CATEGORY_INACTIVE');
    await reject('POST', categories(), { name: 'Hidden' }, 403, undefined, undefined, member);
    await reject(
      'PATCH',
      categories(`/${category.id}`),
      { name: 'No' },
      403,
      undefined,
      undefined,
      member,
    );
    await reject('GET', categories(`/${foreignCategory.id}`), undefined, 404);
    await reject('PATCH', categories(`/${foreignCategory.id}`), { name: 'No' }, 404);
    await reject('POST', expenses(), input({ categoryId: foreignCategory.id }), 404);
    assert.equal(
      (
        await ok<PageResponse<ExpenseCategoryResponse>>('GET', categories('?isActive=true'))
      ).items.some((row) => row.id === marketing.id),
      false,
    );
  });

  void test('expense creation is decimal exact, sequential, concurrent and idempotent', async () => {
    const key = randomUUID(),
      body = input({ amount: '10.1234', payeeName: '  Example  ' });
    const first = await ok<ExpenseResponse>('POST', expenses(), body, key);
    assert.equal(first.amount, '10.1234');
    assert.equal(first.payeeName, 'Example');
    assert.equal(first.currencyCode, 'USD');
    assert.equal(first.expenseDate, '2026-01-02');
    await ok('PATCH', base(), { defaultCurrency: 'EUR' });
    const euro = await draft();
    assert.equal(euro.currencyCode, 'EUR');
    assert.equal((await ok<ExpenseResponse>('GET', expenses(`/${first.id}`))).currencyCode, 'USD');
    await ok('PATCH', base(), { defaultCurrency: 'USD' });
    assert.equal(
      (await ok<ExpenseResponse>('POST', expenses(), input({ ...body, amount: '10.1234' }), key))
        .id,
      first.id,
    );
    await reject('POST', expenses(), input({ amount: '11' }), 409, 'IDEMPOTENCY_KEY_CONFLICT', key);
    const results = await Promise.all(Array.from({ length: 8 }, () => draft()));
    assert.equal(new Set(results.map((row) => row.sequenceNumber)).size, 8);
    const replayKey = randomUUID();
    const [a, b] = await Promise.all([
      call('POST', expenses(), input(), replayKey),
      call('POST', expenses(), input(), replayKey),
    ]);
    assert.deepEqual([a.statusCode, b.statusCode], [201, 201]);
    assert.equal(a.json<ExpenseResponse>().id, b.json<ExpenseResponse>().id);
    for (const invalid of ['0', '-1', 'NaN', 'Infinity', '1.00001'])
      await reject('POST', expenses(), input({ amount: invalid }), 400);
    for (const invalid of ['2026-02-30', '2026-2-3', '2026-13-01'])
      await reject('POST', expenses(), input({ expenseDate: invalid }), 400);
    await reject('POST', expenses(), input({ status: 'POSTED' }), 400);
    await reject('POST', expenses(), input({ currencyCode: 'EUR' }), 400);
    await reject('POST', expenses(), input({ locationId: foreignLocation }), 404);
    const foreign = await ok<ExpenseResponse>(
      'POST',
      expenses('', foreignOrg),
      input({ categoryId: foreignCategory.id, locationId: foreignLocation }),
      undefined,
      outsider,
    );
    await reject('GET', expenses(`/${foreign.id}`), undefined, 404);
    await reject('PATCH', expenses(`/${foreign.id}`), { note: 'x' }, 404);
    await reject('POST', expenses(`/${foreign.id}/post`), {}, 404);
    await reject('POST', expenses(`/${foreign.id}/void`), { reason: 'x' }, 404);
    await assert.rejects(
      context().prisma.expense.create({
        data: {
          organizationId: org,
          categoryId: foreignCategory.id,
          expenseDate: new Date('2026-01-02T00:00:00.000Z'),
          amount: '1',
          currencyCode: 'USD',
          paymentMethod: 'CASH',
          createdByUserId: (await ok<UserResponse>('GET', '/api/v1/me')).id,
          creationIdempotencyKey: randomUUID(),
          creationRequestHash: '0'.repeat(64),
          sequenceNumber: 100000,
        },
      }),
    );
  });

  void test('draft editing, posting and voiding enforce resource state and immutable history', async () => {
    const created = await draft({ locationId: location });
    const edited = await ok<ExpenseResponse>('PATCH', expenses(`/${created.id}`), {
      amount: '250.0001',
      paymentMethod: 'BANK_TRANSFER',
      description: 'Office rent',
    });
    assert.equal(edited.amount, '250.0001');
    await reject('PATCH', expenses(`/${created.id}`), { status: 'POSTED' }, 400);
    await ok('PATCH', `${base()}/locations/${location}`, { isActive: false });
    await reject('POST', expenses(`/${created.id}/post`), {}, 409, 'EXPENSE_LOCATION_INACTIVE');
    await ok('PATCH', `${base()}/locations/${location}`, { isActive: true });
    const key = randomUUID();
    const [a, b] = await Promise.all([
      call('POST', expenses(`/${created.id}/post`), {}, key),
      call('POST', expenses(`/${created.id}/post`), {}, key),
    ]);
    assert.deepEqual([a.statusCode, b.statusCode], [201, 201]);
    assert.equal(a.json<ExpenseResponse>().status, 'POSTED');
    assert.equal(b.json<ExpenseResponse>().postedAt, a.json<ExpenseResponse>().postedAt);
    const competing = await draft();
    const differentKeys = await Promise.all([
      call('POST', expenses(`/${competing.id}/post`), {}, randomUUID()),
      call('POST', expenses(`/${competing.id}/post`), {}, randomUUID()),
    ]);
    assert.deepEqual(differentKeys.map((r) => r.statusCode).sort(), [201, 409]);
    await reject(
      'POST',
      expenses(`/${competing.id}/post`),
      {},
      409,
      'IDEMPOTENCY_KEY_CONFLICT',
      key,
    );
    await reject('POST', expenses(`/${created.id}/post`), {}, 409, 'EXPENSE_ALREADY_POSTED');
    await reject('PATCH', expenses(`/${created.id}`), { amount: '5' }, 409, 'EXPENSE_NOT_EDITABLE');
    await reject('POST', expenses(`/${created.id}/void`), {}, 400);
    const voidKey = randomUUID();
    const [v1, v2] = await Promise.all([
      call('POST', expenses(`/${created.id}/void`), { reason: 'Wrong entry' }, voidKey),
      call('POST', expenses(`/${created.id}/void`), { reason: 'Wrong entry' }, voidKey),
    ]);
    assert.deepEqual([v1.statusCode, v2.statusCode], [201, 201]);
    assert.equal(v1.json<ExpenseResponse>().voidedAt, v2.json<ExpenseResponse>().voidedAt);
    const voided = v1.json<ExpenseResponse>();
    assert.equal(voided.amount, '250.0001');
    assert.equal(voided.description, 'Office rent');
    await reject(
      'POST',
      expenses(`/${created.id}/void`),
      { reason: 'Different' },
      409,
      'IDEMPOTENCY_KEY_CONFLICT',
      voidKey,
    );
    await reject(
      'POST',
      expenses(`/${created.id}/void`),
      { reason: 'Again' },
      409,
      'EXPENSE_NOT_VOIDABLE',
    );
    await reject('PATCH', expenses(`/${created.id}`), { note: 'No' }, 409, 'EXPENSE_NOT_EDITABLE');
    const unposted = await draft();
    await reject(
      'POST',
      expenses(`/${unposted.id}/void`),
      { reason: 'Not posted' },
      409,
      'EXPENSE_NOT_VOIDABLE',
    );
    await assert.rejects(
      context().prisma.expense.update({
        where: { id: created.id },
        data: { amount: '1' },
      }),
    );
  });

  void test('ADMIN can create, post and void; MEMBER cannot mutate expenses', async () => {
    const expense = await ok<ExpenseResponse>('POST', expenses(), input(), undefined, admin);
    assert.equal(
      (await ok<ExpenseResponse>('POST', expenses(`/${expense.id}/post`), {}, undefined, admin))
        .status,
      'POSTED',
    );
    assert.equal(
      (
        await ok<ExpenseResponse>(
          'POST',
          expenses(`/${expense.id}/void`),
          { reason: 'Admin correction' },
          undefined,
          admin,
        )
      ).status,
      'VOIDED',
    );
    await reject(
      'PATCH',
      expenses(`/${expense.id}`),
      { note: 'x' },
      403,
      undefined,
      undefined,
      member,
    );
    await reject(
      'POST',
      expenses(`/${expense.id}/void`),
      { reason: 'x' },
      403,
      undefined,
      undefined,
      member,
    );
  });

  void test('expense list filters, bounded cursor and RBAC are tenant scoped', async () => {
    const page = await ok<PageResponse<ExpenseListItem>>('GET', expenses('?q=Payee&limit=3'));
    assert.ok(page.items.every((row) => row.payeeName === 'Payee'));
    const seen = new Set<string>();
    let cursor: string | null = null;
    do {
      const result: PageResponse<ExpenseListItem> = await ok<PageResponse<ExpenseListItem>>(
        'GET',
        expenses(`?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
      );
      for (const row of result.items) {
        assert.ok(!seen.has(row.id));
        seen.add(row.id);
      }
      cursor = result.nextCursor;
    } while (cursor);
    assert.equal(
      seen.size,
      await context().prisma.expense.count({ where: { organizationId: org } }),
    );
    await reject('GET', expenses('?limit=101'), undefined, 400);
    await reject('GET', expenses('?cursor=bad'), undefined, 400);
    await reject('GET', expenses('?from=2026-02-01&to=2026-01-01'), undefined, 400);
    for (const url of [
      expenses(),
      expenses(`/${[...seen][0]}`),
      categories(),
      finance('/summary'),
      finance('/expenses-by-category'),
    ])
      await reject('GET', url, undefined, 403, undefined, undefined, member);
    await reject('POST', expenses(), input(), 403, undefined, undefined, member);
    await reject('POST', expenses(`/${[...seen][0]}/post`), {}, 403, undefined, undefined, member);
    assert.equal(
      (await ok<PageResponse<ExpenseListItem>>('GET', expenses(), undefined, undefined, admin))
        .items.length > 0,
      true,
    );
    await reject('GET', finance('/summary', foreignOrg), undefined, 404);
  });

  void test('finance summary, timezone boundaries, location and category breakdown use exact SQL sums', async () => {
    const financeOwner = await context().token('finance-dataset-owner');
    const financeOrg = (
      await ok<OrganizationResponse>(
        'POST',
        '/api/v1/organizations',
        {
          name: 'Finance dataset',
          businessType: 'RETAIL',
          defaultCurrency: 'USD',
          timezone: 'Asia/Almaty',
        },
        undefined,
        financeOwner,
      )
    ).id;
    const person = await ok<UserResponse>('GET', '/api/v1/me', undefined, undefined, financeOwner);
    const fbase = base(financeOrg);
    const [a, b] = await Promise.all([
      ok<{ id: string }>(
        'POST',
        `${fbase}/locations`,
        { name: 'A', type: 'STORE' },
        undefined,
        financeOwner,
      ),
      ok<{ id: string }>(
        'POST',
        `${fbase}/locations`,
        { name: 'B', type: 'STORE' },
        undefined,
        financeOwner,
      ),
    ]);
    const rent = await ok<ExpenseCategoryResponse>(
      'POST',
      categories('', financeOrg),
      { name: 'Rent' },
      undefined,
      financeOwner,
    );
    const marketing = await ok<ExpenseCategoryResponse>(
      'POST',
      categories('', financeOrg),
      { name: 'Marketing' },
      undefined,
      financeOwner,
    );
    const item = await ok<CatalogItemResponse>(
      'POST',
      `${fbase}/catalog/items`,
      {
        name: 'Consulting product',
        type: 'PRODUCT',
        trackInventory: false,
        defaultVariant: { unit: 'PIECE', sellingPrice: '1000.0000' },
      },
      undefined,
      financeOwner,
    );
    async function sale(
      locationId: string,
      quantity: string,
      completedAt: string,
      payment: string,
      paymentAt: string,
    ) {
      const order = await ok<SalesOrderResponse>(
        'POST',
        `${fbase}/sales/orders`,
        {
          locationId,
          items: [{ variantId: item.defaultVariant.id, quantity }],
        },
        undefined,
        financeOwner,
      );
      await context().prisma.salesOrder.update({
        where: { id: order.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(completedAt),
          completionIdempotencyKey: randomUUID(),
          completionRequestHash: 'a'.repeat(64),
        },
      });
      await context().prisma.salesPayment.create({
        data: {
          organizationId: financeOrg,
          salesOrderId: order.id,
          amount: payment,
          method: 'CASH',
          createdByUserId: person.id,
          createdAt: new Date(paymentAt),
          idempotencyKey: randomUUID(),
          requestHash: 'b'.repeat(64),
        },
      });
      return order.id;
    }
    const orderA = await sale(
      a.id,
      '1',
      '2026-01-01T18:30:00.000Z',
      '600',
      '2026-01-01T19:30:00.000Z',
    );
    async function recorded(
      categoryId: string,
      amount: string,
      locationId: string | null,
      status: 'POSTED' | 'DRAFT' | 'VOIDED' = 'POSTED',
    ) {
      const expense = await ok<ExpenseResponse>(
        'POST',
        expenses('', financeOrg),
        {
          categoryId,
          expenseDate: '2026-01-02',
          amount,
          paymentMethod: 'CARD',
          locationId,
        },
        undefined,
        financeOwner,
      );
      if (status !== 'DRAFT') {
        await ok('POST', expenses(`/${expense.id}/post`, financeOrg), {}, undefined, financeOwner);
        if (status === 'VOIDED')
          await ok(
            'POST',
            expenses(`/${expense.id}/void`, financeOrg),
            { reason: 'Correction' },
            undefined,
            financeOwner,
          );
      }
      return expense;
    }
    await recorded(rent.id, '200', a.id);
    await recorded(rent.id, '50', a.id, 'DRAFT');
    await recorded(rent.id, '80', a.id, 'VOIDED');
    const range = '?from=2026-01-01&to=2026-01-02';
    const first = await ok<FinanceSummaryResponse>(
      'GET',
      finance(`/summary${range}`, financeOrg),
      undefined,
      undefined,
      financeOwner,
    );
    assert.deepEqual(
      [
        first.salesAmount,
        first.paymentsCollected,
        first.expensesPaid,
        first.netCashFlow,
        first.outstandingReceivablesCurrent,
      ],
      ['1000.0000', '600.0000', '200.0000', '400.0000', '400.0000'],
    );
    const jan1 = await ok<FinanceSummaryResponse>(
      'GET',
      finance('/summary?from=2026-01-01&to=2026-01-01', financeOrg),
      undefined,
      undefined,
      financeOwner,
    );
    const jan2 = await ok<FinanceSummaryResponse>(
      'GET',
      finance('/summary?from=2026-01-02&to=2026-01-02', financeOrg),
      undefined,
      undefined,
      financeOwner,
    );
    assert.equal(jan1.salesAmount, '1000.0000');
    assert.equal(jan1.paymentsCollected, '0.0000');
    assert.equal(jan2.salesAmount, '0.0000');
    assert.equal(jan2.paymentsCollected, '600.0000');
    await context().prisma.salesPayment.create({
      data: {
        organizationId: financeOrg,
        salesOrderId: orderA,
        amount: '250',
        method: 'CARD',
        createdByUserId: person.id,
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
        idempotencyKey: randomUUID(),
        requestHash: 'c'.repeat(64),
      },
    });
    assert.equal(
      (
        await ok<FinanceSummaryResponse>(
          'GET',
          finance(`/summary${range}`, financeOrg),
          undefined,
          undefined,
          financeOwner,
        )
      ).outstandingReceivablesCurrent,
      '150.0000',
    );
    await sale(b.id, '0.5', '2026-01-01T20:00:00.000Z', '200', '2026-01-01T20:30:00.000Z');
    await recorded(marketing.id, '50', b.id);
    await recorded(rent.id, '25', null);
    const all = await ok<FinanceSummaryResponse>(
      'GET',
      finance(`/summary${range}`, financeOrg),
      undefined,
      undefined,
      financeOwner,
    );
    assert.deepEqual(
      [
        all.salesAmount,
        all.paymentsCollected,
        all.expensesPaid,
        all.netCashFlow,
        all.outstandingReceivablesCurrent,
      ],
      ['1500.0000', '1050.0000', '275.0000', '775.0000', '450.0000'],
    );
    const onlyA = await ok<FinanceSummaryResponse>(
      'GET',
      finance(`/summary${range}&locationId=${a.id}`, financeOrg),
      undefined,
      undefined,
      financeOwner,
    );
    assert.deepEqual(
      [
        onlyA.salesAmount,
        onlyA.paymentsCollected,
        onlyA.expensesPaid,
        onlyA.netCashFlow,
        onlyA.outstandingReceivablesCurrent,
      ],
      ['1000.0000', '850.0000', '200.0000', '650.0000', '150.0000'],
    );
    const breakdown = await ok<ExpenseCategoryBreakdownResponse[]>(
      'GET',
      finance(`/expenses-by-category${range}`, financeOrg),
      undefined,
      undefined,
      financeOwner,
    );
    assert.deepEqual(
      breakdown.map((row) => [row.categoryName, row.amount, row.count]),
      [
        ['Rent', '225.0000', 2],
        ['Marketing', '50.0000', 1],
      ],
    );
    const onlyABreakdown = await ok<ExpenseCategoryBreakdownResponse[]>(
      'GET',
      finance(`/expenses-by-category${range}&locationId=${a.id}`, financeOrg),
      undefined,
      undefined,
      financeOwner,
    );
    assert.deepEqual(
      onlyABreakdown.map((row) => [row.categoryName, row.amount]),
      [['Rent', '200.0000']],
    );
    await reject(
      'GET',
      finance(`/summary${range}&locationId=${foreignLocation}`, financeOrg),
      undefined,
      404,
      undefined,
      undefined,
      financeOwner,
    );
    await reject(
      'GET',
      finance('/summary?from=2026-02-30', financeOrg),
      undefined,
      400,
      undefined,
      undefined,
      financeOwner,
    );
    await reject(
      'GET',
      finance('/summary?from=2026-02-01&to=2026-01-01', financeOrg),
      undefined,
      400,
      undefined,
      undefined,
      financeOwner,
    );
    await ok('PATCH', base(financeOrg), { defaultCurrency: 'EUR' }, undefined, financeOwner);
    await recorded(rent.id, '1', a.id);
    await reject(
      'GET',
      finance(`/summary${range}`, financeOrg),
      undefined,
      409,
      'FINANCE_MIXED_CURRENCY',
      undefined,
      financeOwner,
    );
    await reject(
      'GET',
      finance(`/expenses-by-category${range}`, financeOrg),
      undefined,
      409,
      'FINANCE_MIXED_CURRENCY',
      undefined,
      financeOwner,
    );
  });
}
