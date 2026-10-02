import Link from 'next/link';
import { Permission } from '@saas/types';
import { api } from '../../../../../../lib/api';
import { salesApi } from '../../../../../../lib/sales';
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
          Paid: {order.paidAmount} · Outstanding: {order.outstandingAmount} · {order.paymentStatus}
        </p>
      </div>
      {draft && permissions.includes(Permission.SALES_COMPLETE) && (
        <CompletionForm org={org} order={order} canPay={pay} />
      )}
      {draft && manage && <CancelForm org={org} id={order.id} />}
      {order.status === 'COMPLETED' && (
        <p>
          Sale completed; applicable stock movements were recorded atomically. Returns and refunds
          are not available in this stage.
        </p>
      )}
      <h3 className="font-semibold">Payments</h3>
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
      {order.status === 'COMPLETED' && pay && order.paymentStatus !== 'PAID' && (
        <PaymentForm org={org} order={order} />
      )}
    </div>
  );
}
