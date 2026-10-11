import Link from 'next/link';
import { Permission } from '@saas/types';
import { api } from '../../../../../../lib/api';
import { returnsApi } from '../../../../../../lib/returns';
import { ReturnCancelForm, ReturnItemsForm, ReturnMetadataForm, ReturnPostForm } from '../forms';
export default async function ReturnPage({
  params,
}: {
  params: Promise<{ organizationId: string; returnId: string }>;
}) {
  const { organizationId: org, returnId } = await params,
    organization = await api.organization(org),
    p = organization.currentMembership.permissions;
  if (!p.includes(Permission.RETURNS_VIEW))
    return <p>You do not have permission to view returns.</p>;
  const doc = await returnsApi.get(org, returnId),
    edit = doc.status === 'DRAFT' && p.includes(Permission.RETURNS_MANAGE);
  const eligibility = edit ? await returnsApi.eligibility(org, doc.salesOrder.id) : null,
    locations = edit && p.includes(Permission.LOCATIONS_VIEW) ? await api.locations(org) : [];
  const money = (v: string | null) =>
    v === null
      ? doc.financeVisible
        ? doc.status === 'DRAFT'
          ? 'Available after posting'
          : 'Not applicable'
        : 'Finance access required'
      : `${v} ${doc.currencyCode}`;
  return (
    <div className="space-y-5">
      <Link className="underline" href={`/app/${org}/returns`}>
        All returns
      </Link>
      <h2 className="text-2xl font-semibold">
        {doc.number} · {doc.status}
      </h2>
      <div className="panel space-y-2">
        <p>
          Original sale:{' '}
          {p.includes(Permission.SALES_VIEW) ? (
            <Link className="underline" href={`/app/${org}/sales/${doc.salesOrder.id}`}>
              {doc.salesOrder.number}
            </Link>
          ) : (
            doc.salesOrder.number
          )}
        </p>
        <p>
          Customer: {doc.salesOrder.customer?.name ?? 'Walk-in'} · Original location:{' '}
          {doc.salesOrder.location?.name ?? 'Unassigned'}
        </p>
        <p>Reason: {doc.reason ?? '—'}</p>
        <p>Note: {doc.note ?? '—'}</p>
        <p>
          Created: {doc.createdAt} · Actor: {doc.createdBy.id}
        </p>
        {doc.postedAt && (
          <p>
            Posted: {doc.postedAt} · Actor: {doc.postedBy?.id}
          </p>
        )}
        {doc.cancelledAt && (
          <p>
            Cancelled: {doc.cancelledAt} · {doc.cancelReason ?? '—'}
          </p>
        )}
      </div>
      <div className="table-scroll">
        <table className="catalog-table">
          <thead>
            <tr>
              {[
                'Historic item',
                'Quantity',
                'Disposition',
                'Destination',
                'Credit',
                'Stock restocked',
              ].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {doc.items.map((i) => (
              <tr key={i.id}>
                <td>
                  {i.snapshotItemName} {i.snapshotVariantName}
                  <small className="block">
                    {i.snapshotSku ?? 'No SKU'} · {i.snapshotItemType ?? 'Unknown historic type'}
                  </small>
                </td>
                <td>
                  {i.quantity} {i.snapshotUnit}
                </td>
                <td>{i.restockDisposition}</td>
                <td>{i.location?.name ?? '—'}</td>
                <td>{money(i.refundAmount)}</td>
                <td>{i.stockRestocked ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          ['Return credit', doc.totalRefundableAmount],
          ['Refunded for this return', doc.refundedForReturn],
          ['Available payout now', doc.availableRefundAmount],
        ].map(([label, v]) => (
          <div className="panel" key={label}>
            <p>{label}</p>
            <strong>{money(v ?? null)}</strong>
          </div>
        ))}
      </div>
      {doc.inventoryTransactionId && p.includes(Permission.INVENTORY_VIEW) && (
        <Link
          className="underline"
          href={`/app/${org}/inventory/history/${doc.inventoryTransactionId}`}
        >
          Open restock inventory transaction
        </Link>
      )}
      {edit && eligibility && (
        <>
          <ReturnMetadataForm org={org} doc={doc} />
          <ReturnItemsForm org={org} doc={doc} eligibility={eligibility} locations={locations} />
          {doc.quoteValid && <ReturnPostForm org={org} doc={doc} />}
          {!doc.quoteValid && (
            <p role="alert" className="panel">
              This draft needs an updated quote. Review the available quantities and save the items
              before posting; another return may have used the remaining quantity.
            </p>
          )}
          <ReturnCancelForm org={org} id={doc.id} />
        </>
      )}
      {doc.status === 'POSTED' && p.includes(Permission.REFUNDS_MANAGE) && (
        <Link className="button" href={`/app/${org}/refunds/new?salesOrderId=${doc.salesOrder.id}`}>
          Record customer payout
        </Link>
      )}
      {doc.refunds && (
        <section className="panel space-y-2">
          <h3>Recorded payouts</h3>
          {doc.refunds.length ? (
            doc.refunds.map((r) => (
              <p key={r.id}>
                <Link className="underline" href={`/app/${org}/refunds/${r.id}`}>
                  {r.number}
                </Link>{' '}
                · {money(r.amount)} · {r.paymentDate} · {r.paymentMethod}
              </p>
            ))
          ) : (
            <p>No payout recorded for this return.</p>
          )}
          {doc.refundsTruncated && (
            <Link href={`/app/${org}/refunds?salesOrderId=${doc.salesOrder.id}`}>
              View all payouts
            </Link>
          )}
        </section>
      )}
    </div>
  );
}
