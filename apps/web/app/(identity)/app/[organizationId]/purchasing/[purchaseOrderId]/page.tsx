import Link from 'next/link';
import { Permission } from '@saas/types';
import { api } from '../../../../../../lib/api';
import { purchasingApi } from '../../../../../../lib/purchasing';
import {
  CancelPurchaseForm,
  OrderPurchaseForm,
  PurchaseForm,
  PurchaseItemsForm,
  ReceiveGoodsForm,
} from '../forms';
export default async function PurchaseOrderPage({
  params,
}: {
  params: Promise<{ organizationId: string; purchaseOrderId: string }>;
}) {
  const { organizationId: org, purchaseOrderId } = await params,
    organization = await api.organization(org),
    permissions = organization.currentMembership.permissions;
  if (!permissions.includes(Permission.PURCHASING_VIEW))
    return <p>You do not have permission to view purchasing.</p>;
  const order = await purchasingApi.order(org, purchaseOrderId),
    draft = order.status === 'DRAFT',
    manage = permissions.includes(Permission.PURCHASING_MANAGE);
  const locations =
    draft && manage && permissions.includes(Permission.LOCATIONS_VIEW)
      ? await api.locations(org)
      : [];
  return (
    <div className="space-y-5">
      <Link className="underline" href={`/app/${org}/purchasing`}>
        All purchases
      </Link>
      <h2 className="text-xl font-semibold">
        {order.number} · {order.status}
      </h2>
      <div className="panel space-y-2">
        <p>
          Supplier:{' '}
          <Link className="underline" href={`/app/${org}/suppliers/${order.supplier.id}`}>
            {order.supplier.name}
          </Link>
          {order.supplier.isActive ? '' : ' (archived)'}
        </p>
        <p>
          Destination: {order.destinationLocation.name}
          {order.destinationLocation.isActive ? '' : ' (inactive)'}
        </p>
        <p className="whitespace-pre-wrap">{order.note}</p>
        <p>
          Created: {order.createdAt} · User {order.createdBy.id}
        </p>
        {order.orderedAt && <p>Ordered: {order.orderedAt}</p>}
        {order.completedAt && <p>Received: {order.completedAt}</p>}
        {order.cancelledAt && <p>Cancelled: {order.cancelledAt}</p>}
      </div>
      {draft && manage && (
        <>
          <h3 className="font-semibold">Draft details</h3>
          <PurchaseForm org={org} locations={locations} order={order} />
          <h3 className="font-semibold">Edit items</h3>
          <PurchaseItemsForm org={org} order={order} />
        </>
      )}
      <div className="overflow-x-auto">
        <table className="catalog-table">
          <thead>
            <tr>
              {[
                'Saved item',
                'SKU',
                'Unit',
                'Ordered',
                'Received',
                'Remaining',
                'Unit cost',
                'Line total',
              ].map((h) => (
                <th key={h}>{h}</th>
              ))}
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
                <td>{i.orderedQuantity}</td>
                <td>{i.receivedQuantity}</td>
                <td>{i.remainingQuantity}</td>
                <td>{i.unitCost}</td>
                <td>{i.lineTotal}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel space-y-2">
        <p>Currency snapshot: {order.currencyCode}</p>
        <p>Subtotal: {order.subtotal}</p>
        <p className="font-semibold">Total: {order.total}</p>
        <p>
          Receiving progress: {order.receivedQuantity} / {order.orderedQuantity}
        </p>
      </div>
      {draft && manage && <OrderPurchaseForm org={org} order={order} />}
      {(draft || order.status === 'ORDERED') && manage && (
        <CancelPurchaseForm org={org} order={order} />
      )}
      {(order.status === 'ORDERED' || order.status === 'PARTIALLY_RECEIVED') &&
        permissions.includes(Permission.PURCHASING_RECEIVE) && (
          <>
            <h3 className="font-semibold">Receive goods</h3>
            <ReceiveGoodsForm org={org} order={order} />
          </>
        )}
      <h3 className="font-semibold">Receipts</h3>
      <table className="catalog-table">
        <thead>
          <tr>
            {['Receipt', 'Received at', 'User', 'Items', 'Stock'].map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {order.receipts.map((r) => (
            <tr key={r.id}>
              <td>
                <Link className="underline" href={`/app/${org}/purchasing/receipts/${r.id}`}>
                  {r.number}
                </Link>
              </td>
              <td>{r.receivedAt}</td>
              <td>{r.createdBy.id}</td>
              <td>
                {r.items.map((i) => `${i.snapshotItemName}: ${i.receivedQuantity}`).join(', ')}
              </td>
              <td>
                {r.inventoryTransactionId ? (
                  <Link
                    className="underline"
                    href={`/app/${org}/inventory/history/${r.inventoryTransactionId}`}
                  >
                    Stock updated
                  </Link>
                ) : (
                  'No tracked items'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Link
        className="underline"
        href={`/app/${org}/inventory?locationId=${order.destinationLocation.id}`}
      >
        View destination inventory
      </Link>
    </div>
  );
}
