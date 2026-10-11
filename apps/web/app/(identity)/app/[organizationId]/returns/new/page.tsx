import Link from 'next/link';
import { Permission } from '@saas/types';
import { api } from '../../../../../../lib/api';
import { returnsApi } from '../../../../../../lib/returns';
import { salesApi } from '../../../../../../lib/sales';
import { Pagination, selectedQuery } from '../../inventory/navigation';
import { ReturnItemsForm } from '../forms';
export default async function NewReturn({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId: org } = await params,
    organization = await api.organization(org),
    p = organization.currentMembership.permissions,
    search = await searchParams;
  if (!p.includes(Permission.RETURNS_MANAGE) || !p.includes(Permission.RETURNS_VIEW))
    return <p>You do not have permission to create returns.</p>;
  const id = typeof search.salesOrderId === 'string' ? search.salesOrderId : undefined;
  if (id) {
    const eligibility = await returnsApi.eligibility(org, id),
      locations = p.includes(Permission.LOCATIONS_VIEW) ? await api.locations(org) : [];
    return (
      <div className="space-y-5">
        <Link className="underline" href={`/app/${org}/returns`}>
          All returns
        </Link>
        <h2 className="text-2xl font-semibold">New return · {eligibility.salesOrder.number}</h2>
        <p>
          Customer: {eligibility.salesOrder.customer?.name ?? 'Walk-in'} · Original location:{' '}
          {eligibility.salesOrder.location?.name ?? 'Unassigned'}
        </p>
        <ReturnItemsForm org={org} eligibility={eligibility} locations={locations} />
      </div>
    );
  }
  const query = selectedQuery(search, ['q', 'cursor']);
  query.set('status', 'COMPLETED');
  const sales = p.includes(Permission.SALES_VIEW)
    ? await salesApi.orders(org, query.toString())
    : null;
  return (
    <div className="space-y-5">
      <h2 className="text-2xl font-semibold">Choose a completed sale</h2>
      <form className="panel flex flex-wrap gap-3">
        <label className="field">
          Sale number / customer
          <input name="q" maxLength={100} defaultValue={query.get('q') ?? ''} />
        </label>
        <button className="button">Search</button>
      </form>
      {sales ? (
        <>
          <div className="table-scroll">
            <table className="catalog-table">
              <thead>
                <tr>
                  <th>Sale</th>
                  <th>Customer</th>
                  <th>Location</th>
                  <th>Select</th>
                </tr>
              </thead>
              <tbody>
                {sales.items.map((s) => (
                  <tr key={s.id}>
                    <td>SO-{String(s.sequenceNumber).padStart(6, '0')}</td>
                    <td>{s.customer?.name ?? 'Walk-in'}</td>
                    <td>{s.location?.name ?? 'Unassigned'}</td>
                    <td>
                      <Link
                        className="underline"
                        href={`/app/${org}/returns/new?salesOrderId=${s.id}`}
                      >
                        Return items
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!sales.items.length && <p>No completed sales found.</p>}
          <Pagination
            base={`/app/${org}/returns/new`}
            query={query}
            nextCursor={sales.nextCursor}
          />
        </>
      ) : (
        <form className="panel">
          <label className="field">
            Known completed sale ID
            <input name="salesOrderId" required />
          </label>
          <button className="button">Open sale</button>
        </form>
      )}
    </div>
  );
}
