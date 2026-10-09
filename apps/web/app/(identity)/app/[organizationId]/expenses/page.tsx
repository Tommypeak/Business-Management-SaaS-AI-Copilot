import Link from 'next/link';
import { EXPENSE_STATUSES, PAYMENT_METHODS, Permission } from '@saas/types';
import { api } from '../../../../../lib/api';
import { expensesApi } from '../../../../../lib/expenses';
import { Pagination, selectedQuery } from '../inventory/navigation';

export default async function ExpensesPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId: org } = await params;
  const organization = await api.organization(org);
  const permissions = organization.currentMembership.permissions;
  if (!permissions.includes(Permission.EXPENSES_VIEW))
    return <p>You do not have permission to view expenses.</p>;
  const query = selectedQuery(await searchParams, [
    'q',
    'status',
    'categoryId',
    'locationId',
    'paymentMethod',
    'from',
    'to',
    'cursor',
  ]);
  const [page, categories, locations] = await Promise.all([
    expensesApi.expenses(org, query.toString()),
    expensesApi.allCategories(org),
    permissions.includes(Permission.LOCATIONS_VIEW) ? api.locations(org) : Promise.resolve([]),
  ]);
  const base = `/app/${org}/expenses`;
  return (
    <div className="space-y-5">
      <h2 className="text-xl font-semibold">Expenses</h2>
      {permissions.includes(Permission.EXPENSES_MANAGE) && (
        <div className="flex gap-4">
          <Link className="button" href={`${base}/new`}>
            New expense
          </Link>
          <Link className="underline" href={`${base}/categories`}>
            Manage categories
          </Link>
        </div>
      )}
      <form action={base} className="panel grid gap-4 sm:grid-cols-3">
        <label className="field">
          Search
          <input
            name="q"
            maxLength={100}
            defaultValue={query.get('q') ?? ''}
            placeholder="EXP number, payee or description"
          />
        </label>
        <label className="field">
          Status
          <select name="status" defaultValue={query.get('status') ?? ''}>
            <option value="">All</option>
            {EXPENSE_STATUSES.map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Category
          <select name="categoryId" defaultValue={query.get('categoryId') ?? ''}>
            <option value="">All</option>
            {categories.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Location
          <select name="locationId" defaultValue={query.get('locationId') ?? ''}>
            <option value="">All</option>
            {locations.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Payment method
          <select name="paymentMethod" defaultValue={query.get('paymentMethod') ?? ''}>
            <option value="">All</option>
            {PAYMENT_METHODS.map((method) => (
              <option key={method}>{method}</option>
            ))}
          </select>
        </label>
        <label className="field">
          From
          <input name="from" type="date" defaultValue={query.get('from') ?? ''} />
        </label>
        <label className="field">
          To
          <input name="to" type="date" defaultValue={query.get('to') ?? ''} />
        </label>
        <button className="button">Apply filters</button>
      </form>
      <table className="catalog-table">
        <thead>
          <tr>
            {[
              'Expense',
              'Date',
              'Category',
              'Payee',
              'Location',
              'Payment method',
              'Amount',
              'Status',
            ].map((label) => (
              <th key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {page.items.map((row) => (
            <tr key={row.id}>
              <td>
                <Link className="underline" href={`${base}/${row.id}`}>
                  {row.number}
                </Link>
              </td>
              <td>{row.expenseDate}</td>
              <td>
                {row.category.name}
                {row.category.isActive ? '' : ' (archived)'}
              </td>
              <td>{row.payeeName ?? '—'}</td>
              <td>{row.location?.name ?? 'Company-wide'}</td>
              <td>{row.paymentMethod}</td>
              <td>
                {row.amount} {row.currencyCode}
              </td>
              <td>{row.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pagination base={base} query={query} nextCursor={page.nextCursor} />
    </div>
  );
}
