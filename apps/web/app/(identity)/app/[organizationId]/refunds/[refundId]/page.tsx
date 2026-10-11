import Link from 'next/link';
import { Permission } from '@saas/types';
import { api } from '../../../../../../lib/api';
import { returnsApi } from '../../../../../../lib/returns';
export default async function RefundPage({
  params,
}: {
  params: Promise<{ organizationId: string; refundId: string }>;
}) {
  const { organizationId: org, refundId } = await params,
    o = await api.organization(org),
    p = o.currentMembership.permissions;
  if (!p.includes(Permission.RETURNS_VIEW))
    return <p>You do not have permission to view customer refunds.</p>;
  const r = await returnsApi.refund(org, refundId),
    money = (v: string | null) =>
      v === null ? 'Finance access required' : `${v} ${r.currencyCode}`;
  return (
    <div className="space-y-5">
      <Link className="underline" href={`/app/${org}/refunds`}>
        All customer refunds
      </Link>
      <h2 className="text-2xl font-semibold">{r.number} · Recorded payout</h2>
      <div className="panel space-y-2">
        <p>
          Original sale:{' '}
          {p.includes(Permission.SALES_VIEW) ? (
            <Link className="underline" href={`/app/${org}/sales/${r.salesOrder.id}`}>
              {r.salesOrder.number}
            </Link>
          ) : (
            r.salesOrder.number
          )}
        </p>
        <p>Customer: {r.salesOrder.customer?.name ?? 'Walk-in'}</p>
        <p>Amount: {money(r.amount)}</p>
        <p>
          Payment date: {r.paymentDate} · Method: {r.paymentMethod}
        </p>
        <p>Reference: {r.reference ?? '—'}</p>
        <p>Note: {r.note ?? '—'}</p>
        <p>
          Recorded: {r.createdAt} · Actor: {r.createdBy.id}
        </p>
      </div>
      <h3 className="font-semibold">Allocations</h3>
      <div className="table-scroll">
        <table className="catalog-table">
          <thead>
            <tr>
              <th>Posted return</th>
              <th>Allocated payout</th>
            </tr>
          </thead>
          <tbody>
            {r.allocations.map((a) => (
              <tr key={a.salesReturnId}>
                <td>
                  <Link className="underline" href={`/app/${org}/returns/${a.salesReturnId}`}>
                    {a.returnNumber}
                  </Link>
                </td>
                <td>{money(a.allocatedAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        This payout is immutable. Its business payment date is separate from the recording
        timestamp.
      </p>
    </div>
  );
}
