import Link from 'next/link';
import { Permission, SALES_RETURN_STATUSES } from '@saas/types';
import { api } from '../../../../../lib/api';
import { returnsApi } from '../../../../../lib/returns';
import { Pagination, selectedQuery } from '../inventory/navigation';
export default async function ReturnsPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId: org } = await params,
    organization = await api.organization(org),
    permissions = organization.currentMembership.permissions;
  if (!permissions.includes(Permission.RETURNS_VIEW))
    return <p>You do not have permission to view returns.</p>;
  const query = selectedQuery(await searchParams, [
      'status',
      'salesOrderId',
      'customerId',
      'locationId',
      'from',
      'to',
      'cursor',
    ]),
    data = await returnsApi.list(org, query.toString());
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Customer operations</p>
          <h2 className="text-2xl font-semibold">Returns</h2>
        </div>
        {permissions.includes(Permission.RETURNS_MANAGE) && (
          <Link className="button" href={`/app/${org}/returns/new`}>
            New return
          </Link>
        )}
      </div>
      <p>
        Return credits and restock movements are posted together. Customer payouts are recorded in{' '}
        <Link className="underline" href={`/app/${org}/refunds`}>
          Refunds
        </Link>
        .
      </p>
      <form className="panel grid gap-4 sm:grid-cols-3">
        <label className="field">
          Status
          <select name="status" defaultValue={query.get('status') ?? ''}>
            <option value="">All statuses</option>
            {SALES_RETURN_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Posted from ({organization.timezone})
          <input name="from" type="date" defaultValue={query.get('from') ?? ''} />
        </label>
        <label className="field">
          Posted to ({organization.timezone})
          <input name="to" type="date" defaultValue={query.get('to') ?? ''} />
        </label>
        <button className="button">Apply filters</button>
      </form>
      {!data.items.length ? (
        <div className="panel">No returns match these filters.</div>
      ) : (
        <div className="table-scroll">
          <table className="catalog-table">
            <thead>
              <tr>
                {['Return', 'Status', 'Original sale', 'Customer', 'Credit', 'Created'].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link className="underline" href={`/app/${org}/returns/${r.id}`}>
                      {r.number}
                    </Link>
                  </td>
                  <td>{r.status}</td>
                  <td>
                    {permissions.includes(Permission.SALES_VIEW) ? (
                      <Link className="underline" href={`/app/${org}/sales/${r.salesOrder.id}`}>
                        {r.salesOrder.number}
                      </Link>
                    ) : (
                      r.salesOrder.number
                    )}
                  </td>
                  <td>{r.salesOrder.customer?.name ?? 'Walk-in'}</td>
                  <td>
                    {r.totalRefundableAmount === null
                      ? 'Finance access required'
                      : `${r.totalRefundableAmount} ${r.currencyCode}`}
                  </td>
                  <td>
                    {new Date(r.createdAt).toLocaleString('en-GB', {
                      timeZone: organization.timezone,
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination base={`/app/${org}/returns`} query={query} nextCursor={data.nextCursor} />
    </div>
  );
}
