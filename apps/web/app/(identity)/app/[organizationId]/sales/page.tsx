import Link from 'next/link';
import { PAYMENT_STATUSES, Permission, SALES_STATUSES } from '@saas/types';
import { api } from '../../../../../lib/api';
import { salesApi } from '../../../../../lib/sales';
import { Pagination, selectedQuery } from '../inventory/navigation';
import { SalesTable } from './table';
export default async function SalesPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId: org } = await params,
    organization = await api.organization(org),
    permissions = organization.currentMembership.permissions;
  if (!permissions.includes(Permission.SALES_VIEW))
    return <p>You do not have permission to view sales.</p>;
  const query = selectedQuery(await searchParams, [
    'q',
    'status',
    'paymentStatus',
    'locationId',
    'customerId',
    'from',
    'to',
    'cursor',
  ]);
  const [page, locations] = await Promise.all([
    salesApi.orders(org, query.toString()),
    permissions.includes(Permission.LOCATIONS_VIEW) ? api.locations(org) : Promise.resolve([]),
  ]);
  const base = `/app/${org}/sales`;
  return (
    <div className="space-y-5">
      <h2 className="text-xl font-semibold">Sales</h2>
      {permissions.includes(Permission.SALES_CREATE) && (
        <Link className="button inline-block" href={`${base}/new`}>
          New sale
        </Link>
      )}
      <form action={base} className="panel grid gap-4 sm:grid-cols-3">
        <label className="field">
          Search
          <input
            name="q"
            maxLength={100}
            defaultValue={query.get('q') ?? ''}
            placeholder="Order number or customer"
          />
        </label>
        <label className="field">
          Status
          <select name="status" defaultValue={query.get('status') ?? ''}>
            <option value="">All</option>
            {SALES_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Payment status
          <select name="paymentStatus" defaultValue={query.get('paymentStatus') ?? ''}>
            <option value="">All</option>
            {PAYMENT_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Location
          <select name="locationId" defaultValue={query.get('locationId') ?? ''}>
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
        {query.has('customerId') && (
          <input type="hidden" name="customerId" value={query.get('customerId')!} />
        )}
        <button className="button">Apply filters</button>
      </form>
      <SalesTable org={org} orders={page.items} />
      <Pagination base={base} query={query} nextCursor={page.nextCursor} />
    </div>
  );
}
