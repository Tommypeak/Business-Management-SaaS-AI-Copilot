import Link from 'next/link';
import { Permission } from '@saas/types';
import { api } from '../../../../../../lib/api';
import { salesApi } from '../../../../../../lib/sales';
import { returnsApi } from '../../../../../../lib/returns';
import { CancelForm, CompletionForm, ItemsForm, OrderMetadataForm, PaymentForm } from '../forms';
export default async function OrderPage({
  params,
}: {
  params: Promise<{ organizationId: string; orderId: string }>;
}) {
  const { organizationId: org, orderId } = await params,
    organization = await api.organization(org),
    permissions = organization.currentMembership.permissions;
  if (!permissions.includes(Permission.SALES_VIEW))
    return <p>You do not have permission to view sales.</p>;
  const order = await salesApi.order(org, orderId),
    draft = order.status === 'DRAFT',
    manage = permissions.includes(Permission.SALES_MANAGE),
    pay = permissions.includes(Permission.SALES_PAYMENTS_MANAGE);
  const eligibility =
    order.status === 'COMPLETED' && permissions.includes(Permission.RETURNS_VIEW)
      ? await returnsApi.eligibility(org, orderId)
      : null;
  const returns = eligibility
    ? await returnsApi.list(
        org,
        new URLSearchParams({ salesOrderId: orderId, limit: '25' }).toString(),
      )
    : null;
  const locations =
    draft && manage && permissions.includes(Permission.LOCATIONS_VIEW)
      ? await api.locations(org)
      : [];
  return (
    <div className="space-y-5">
      <Link href={`/app/${org}/sales`} className="underline">
        All sales
      </Link>
      <h2 className="text-xl font-semibold">
        SO-{String(order.sequenceNumber).padStart(6, '0')} · {order.status}
      </h2>
      <div className="panel space-y-2">
        <p>
          Customer: {order.customer?.name ?? 'Walk-in'}
          {order.customer && !order.customer.isActive ? ' (archived)' : ''}
        </p>
        <p>Location: {order.location?.name ?? 'Not assigned'}</p>
        <p>{order.note}</p>
        <p>
          Created: {order.createdAt} · User {order.createdBy.id}
        </p>
        {order.completedAt && <p>Completed: {order.completedAt}</p>}
        {order.cancelledAt && <p>Cancelled: {order.cancelledAt}</p>}
      </div>
      {draft && manage && (
        <>
          <h3 className="font-semibold">Draft details</h3>
          <OrderMetadataForm org={org} locations={locations} order={order} />
          <h3 className="font-semibold">Edit items</h3>
          <ItemsForm org={org} order={order} />
        </>
      )}
      <div className="overflow-x-auto">
        <table className="catalog-table">
          <thead>
            <tr>
              {['Saved item', 'SKU', 'Unit', 'Quantity', 'Price', 'Discount', 'Line total'].map(
                (h) => (
                  <th key={h}>{h}</th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {order.items.map((i) => (
              <tr key={i.id}>
                <td>
                  {i.snapshotItemName} {i.snapshotVariantName}
                </td>
                <td>{i.snapshotSku ?? '—'}</td>
                <td>{i.snapshotUnit}</td>
                <td>{i.quantity}</td>
                <td>{i.unitPrice}</td>
                <td>{i.discountAmount}</td>
                <td>{i.lineTotal}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel space-y-2">
        <p>Currency: {order.currencyCode}</p>
        <p>Subtotal: {order.subtotal}</p>
        <p>Discount: {order.discountTotal}</p>
        <p className="font-semibold">Total: {order.total}</p>
        <p>
          Original payments: {order.paidAmount} · Outstanding after returns:{' '}
          {eligibility?.netOutstandingAmount ?? order.outstandingAmount}
        </p>
      </div>
      {draft && permissions.includes(Permission.SALES_COMPLETE) && (
        <CompletionForm org={org} order={order} canPay={pay} />
      )}
      {draft && manage && <CancelForm org={org} id={order.id} />}
      {order.status === 'COMPLETED' && (
        <p>Sale completed; its quantities, prices and payments remain in the original record.</p>
      )}
      <h3 className="font-semibold">Payments</h3>
      {eligibility && (
        <section className="panel space-y-3">
          <h3 className="font-semibold">Returns & customer payouts</h3>
          {eligibility.financeVisible && (
            <>
              <p>
                Posted credits: {eligibility.postedReturnCredits} · Adjusted sale:{' '}
                {eligibility.adjustedSalesAmount} {order.currencyCode}
              </p>
              <p>
                Customer payouts: {eligibility.refundedAmount} · Net paid:{' '}
                {eligibility.netPaidAmount} · Net outstanding: {eligibility.netOutstandingAmount}
              </p>
            </>
          )}
          {permissions.includes(Permission.RETURNS_MANAGE) && (
            <Link className="button" href={`/app/${org}/returns/new?salesOrderId=${orderId}`}>
              Return items
            </Link>
          )}
          {returns?.items.map((r) => (
            <p key={r.id}>
              <Link className="underline" href={`/app/${org}/returns/${r.id}`}>
                {r.number} · {r.status}
              </Link>
            </p>
          ))}
          <Link className="underline" href={`/app/${org}/returns?salesOrderId=${orderId}`}>
            All returns for this sale
          </Link>{' '}
          <Link className="underline" href={`/app/${org}/refunds?salesOrderId=${orderId}`}>
            Customer payouts
          </Link>
        </section>
      )}
      <div className="overflow-x-auto">
        <table className="catalog-table">
          <thead>
            <tr>
              {['Date', 'Method', 'Amount', 'Reference', 'Note'].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {order.payments.map((p) => (
              <tr key={p.id}>
                <td>{p.createdAt}</td>
                <td>{p.method}</td>
                <td>
                  {p.amount} {order.currencyCode}
                </td>
                <td>{p.reference ?? '—'}</td>
                <td>{p.note ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {order.status === 'COMPLETED' &&
        pay &&
        (eligibility?.netOutstandingAmount !== undefined &&
        eligibility.netOutstandingAmount !== null
          ? Number(eligibility.netOutstandingAmount) > 0
          : order.paymentStatus !== 'PAID') && (
          <PaymentForm org={org} order={order} outstanding={eligibility?.netOutstandingAmount} />
        )}
    </div>
  );
}
