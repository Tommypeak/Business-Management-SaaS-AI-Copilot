import Link from 'next/link';
import { Permission } from '@saas/types';
import { api } from '../../../../../../lib/api';
import { returnsApi } from '../../../../../../lib/returns';
import { RefundForm } from '../../returns/forms';
import { Pagination, selectedQuery } from '../../inventory/navigation';
export default async function NewRefund({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId: org } = await params,
    o = await api.organization(org),
    p = o.currentMembership.permissions,
    search = await searchParams;
  if (!p.includes(Permission.REFUNDS_MANAGE) || !p.includes(Permission.RETURNS_VIEW))
    return <p>You do not have permission to record customer payouts.</p>;
  const id = typeof search.salesOrderId === 'string' ? search.salesOrderId : undefined;
  if (id) {
    const [eligibility, returns] = await Promise.all([
      returnsApi.eligibility(org, id),
      returnsApi.list(
        org,
        new URLSearchParams({ status: 'POSTED', salesOrderId: id, limit: '100' }).toString(),
      ),
    ]);
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en', {
        timeZone: o.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
        .formatToParts(new Date())
        .map((p) => [p.type, p.value]),
    );
    const today = `${parts.year}-${parts.month}-${parts.day}`;
    return (
      <div className="space-y-5">
        <Link className="underline" href={`/app/${org}/refunds`}>
          All customer refunds
        </Link>
        <h2 className="text-2xl font-semibold">
          Customer payout · {eligibility.salesOrder.number}
        </h2>
        <div className="panel">
          <p>Collected cash: {eligibility.collectedAmount ?? 'Finance access required'}</p>
          <p>Already refunded: {eligibility.refundedAmount ?? 'Finance access required'}</p>
          <p>Unused return credit: {eligibility.unusedReturnCredit ?? 'Finance access required'}</p>
          <strong>
            Available payout: {eligibility.availableRefundAmount ?? 'Finance access required'}{' '}
            {eligibility.financeVisible ? eligibility.currencyCode : ''}
          </strong>
        </div>
        {returns.items.length ? (
          <RefundForm org={org} salesOrderId={id} returns={returns.items} today={today} />
        ) : (
          <p>Post a return before recording a payout.</p>
        )}
        {returns.nextCursor && (
          <p>The first 100 posted returns are shown. Each payout supports up to 100 allocations.</p>
        )}
      </div>
    );
  }
  const q = selectedQuery(search, ['cursor']);
  q.set('status', 'POSTED');
  const returns = await returnsApi.list(org, q.toString());
  return (
    <div className="space-y-5">
      <h2 className="text-2xl font-semibold">Select a sale with a posted return</h2>
      {returns.items.length ? (
        returns.items.map((r) => (
          <div className="panel" key={r.id}>
            <Link
              className="underline"
              href={`/app/${org}/refunds/new?salesOrderId=${r.salesOrder.id}`}
            >
              {r.number} · {r.salesOrder.number} · {r.salesOrder.customer?.name ?? 'Walk-in'}
            </Link>
          </div>
        ))
      ) : (
        <p>No posted returns found.</p>
      )}
      <Pagination base={`/app/${org}/refunds/new`} query={q} nextCursor={returns.nextCursor} />
    </div>
  );
}
