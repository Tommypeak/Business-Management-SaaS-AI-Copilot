import Link from 'next/link';
import { Permission, PURCHASE_STATUSES } from '@saas/types';
import { api } from '../../../../../lib/api';
import { purchasingApi } from '../../../../../lib/purchasing';
import { Pagination, selectedQuery } from '../inventory/navigation';
export default async function PurchasingPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId: org } = await params,
    organization = await api.organization(org),
    permissions = organization.currentMembership.permissions;
  if (!permissions.includes(Permission.PURCHASING_VIEW))
    return <p>You do not have permission to view purchasing.</p>;
  const query = selectedQuery(await searchParams, [
    'q',
    'status',
    'supplierId',
    'destinationLocationId',
    'from',
    'to',
    'cursor',
  ]);
  const [page, locations] = await Promise.all([
    purchasingApi.orders(org, query.toString()),
    permissions.includes(Permission.LOCATIONS_VIEW) ? api.locations(org) : Promise.resolve([]),
  ]);
  const base = `/app/${org}/purchasing`;
  return (
    <div className="space-y-5">
      <h2 className="text-xl font-semibold">Purchasing</h2>
      {permissions.includes(Permission.PURCHASING_CREATE) && (
        <Link className="button inline-block" href={`${base}/new`}>
          New purchase
        </Link>
      )}
      <form action={base} className="panel grid gap-4 sm:grid-cols-3">
        <label className="field">
          Search
          <input
            name="q"
            maxLength={100}
            defaultValue={query.get('q') ?? ''}
            placeholder="PO number or supplier"
          />
        </label>
        <label className="field">
          Status
          <select name="status" defaultValue={query.get('status') ?? ''}>
            <option value="">All</option>
            {PURCHASE_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Destination
          <select
            name="destinationLocationId"
            defaultValue={query.get('destinationLocationId') ?? ''}
          >
            <option value="">All</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          From (UTC)
          <input name="from" type="datetime-local" defaultValue={query.get('from') ?? ''} />
        </label>
        <label className="field">
          To (UTC)
          <input name="to" type="datetime-local" defaultValue={query.get('to') ?? ''} />
        </label>
        {query.has('supplierId') && (
          <input type="hidden" name="supplierId" value={query.get('supplierId')!} />
        )}
        <button className="button">Apply filters</button>
      </form>
      <table className="catalog-table">
        <thead>
          <tr>
            {[
              'PO',
              'Supplier',
              'Destination',
              'Status',
              'Created / ordered',
              'Total',
              'Received',
            ].map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {page.items.map((o) => (
            <tr key={o.id}>
              <td>
                <Link className="underline" href={`${base}/${o.id}`}>
                  {o.number}
                </Link>
              </td>
              <td>{o.supplier.name}</td>
              <td>{o.destinationLocation.name}</td>
              <td>{o.status}</td>
              <td>
                {o.createdAt}
                <br />
                {o.orderedAt ?? '—'}
              </td>
              <td>
                {o.total} {o.currencyCode}
              </td>
              <td>
                {o.receivedQuantity} / {o.orderedQuantity}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pagination base={base} query={query} nextCursor={page.nextCursor} />
    </div>
  );
}
