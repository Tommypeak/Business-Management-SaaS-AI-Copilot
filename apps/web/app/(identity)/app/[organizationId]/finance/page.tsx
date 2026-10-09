import { Permission } from '@saas/types';
import { api } from '../../../../../lib/api';
import { expensesApi } from '../../../../../lib/expenses';
import { selectedQuery } from '../inventory/navigation';

export default async function FinancePage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId: org } = await params;
  const organization = await api.organization(org);
  const permissions = organization.currentMembership.permissions;
  if (!permissions.includes(Permission.FINANCE_VIEW))
    return <p>You do not have permission to view Finance.</p>;
  const query = selectedQuery(await searchParams, ['from', 'to', 'locationId']);
  query.delete('limit');
  const [summary, breakdown, locations] = await Promise.all([
    expensesApi.summary(org, query.toString()),
    expensesApi.breakdown(org, query.toString()),
    permissions.includes(Permission.LOCATIONS_VIEW) ? api.locations(org) : Promise.resolve([]),
  ]);
  const cards = [
    ['Completed Sales', summary.salesAmount],
    ['Payments Collected', summary.paymentsCollected],
    ['Recorded Expenses', summary.expensesPaid],
    ['Net Cash Flow', summary.netCashFlow],
    ['Outstanding Receivables', summary.outstandingReceivablesCurrent],
  ];
  return (
    <div className="space-y-5">
      <h2 className="text-xl font-semibold">Finance</h2>
      <p>
        Business dates use {summary.timezone}. Outstanding receivables are current, regardless of
        the selected date range.
      </p>
      <form action={`/app/${org}/finance`} className="panel grid gap-4 sm:grid-cols-3">
        <label className="field">
          From
          <input name="from" type="date" defaultValue={query.get('from') ?? ''} />
        </label>
        <label className="field">
          To
          <input name="to" type="date" defaultValue={query.get('to') ?? ''} />
        </label>
        <label className="field">
          Location
          <select name="locationId" defaultValue={query.get('locationId') ?? ''}>
            <option value="">All locations</option>
            {locations.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <button className="button">Apply filters</button>
      </form>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(([label, amount]) => (
          <div className="panel" key={label}>
            <p>{label}</p>
            <p className="text-xl font-semibold">
              {amount} {summary.currencyCode}
            </p>
          </div>
        ))}
      </div>
      <div className="panel space-y-2">
        <h3 className="font-semibold">How to read this</h3>
        <p>
          Net Cash Flow is customer payments collected minus posted operating expenses. It is not
          accounting profit: inventory valuation, COGS, taxes and unpaid supplier obligations are
          not included. Purchase orders and goods receipts do not count as cash expenses.
        </p>
      </div>
      <h3 className="font-semibold">Expenses by category</h3>
      <table className="catalog-table">
        <thead>
          <tr>
            <th>Category</th>
            <th>Amount</th>
            <th>Count</th>
          </tr>
        </thead>
        <tbody>
          {breakdown.map((row) => (
            <tr key={row.categoryId}>
              <td>{row.categoryName}</td>
              <td>
                {row.amount} {summary.currencyCode}
              </td>
              <td>{row.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
