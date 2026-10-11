import Link from 'next/link';
import { Permission } from '@saas/types';
import { api } from '../../../../../lib/api';
import { returnsApi } from '../../../../../lib/returns';
import { Pagination, selectedQuery } from '../inventory/navigation';
export default async function RefundsPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId: org } = await params,
    o = await api.organization(org),
    p = o.currentMembership.permissions;
  if (!p.includes(Permission.RETURNS_VIEW))
    return <p>You do not have permission to view customer refunds.</p>;
  const q = selectedQuery(await searchParams, [
      'salesOrderId',
      'customerId',
      'locationId',
      'cursor',
    ]),
    data = await returnsApi.refunds(org, q.toString());
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap justify-between gap-3">
        <h2 className="text-2xl font-semibold">Customer refunds</h2>
        {p.includes(Permission.REFUNDS_MANAGE) && (
          <Link className="button" href={`/app/${org}/refunds/new`}>
            Record payout
          </Link>
        )}
      </div>
      <p>
        These are actual customer cash outflows. Return credits are recorded separately in{' '}
        <Link className="underline" href={`/app/${org}/returns`}>
          Returns
        </Link>
        .
      </p>
      {!data.items.length ? (
        <div className="panel">No customer payouts recorded.</div>
      ) : (
        <div className="table-scroll">
          <table className="catalog-table">
            <thead>
              <tr>
                {[
                  'Refund',
                  'Sale',
                  'Customer',
                  'Payment date',
                  'Amount',
                  'Method',
                  'Reference',
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link className="underline" href={`/app/${org}/refunds/${r.id}`}>
                      {r.number}
                    </Link>
                  </td>
                  <td>{r.salesOrder.number}</td>
                  <td>{r.salesOrder.customer?.name ?? 'Walk-in'}</td>
                  <td>{r.paymentDate}</td>
                  <td>
                    {r.amount === null
                      ? 'Finance access required'
                      : `${r.amount} ${r.currencyCode}`}
                  </td>
                  <td>{r.paymentMethod}</td>
                  <td>{r.reference ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination base={`/app/${org}/refunds`} query={q} nextCursor={data.nextCursor} />
    </div>
  );
}
