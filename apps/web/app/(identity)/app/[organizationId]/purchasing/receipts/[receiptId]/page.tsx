import Link from 'next/link';
import { Permission } from '@saas/types';
import { api } from '../../../../../../../lib/api';
import { purchasingApi } from '../../../../../../../lib/purchasing';
export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ organizationId: string; receiptId: string }>;
}) {
  const { organizationId: org, receiptId } = await params,
    organization = await api.organization(org);
  if (!organization.currentMembership.permissions.includes(Permission.PURCHASING_VIEW))
    return <p>You do not have permission to view purchasing.</p>;
  const receipt = await purchasingApi.receipt(org, receiptId);
  return (
    <div className="space-y-5">
      <Link className="underline" href={`/app/${org}/purchasing/${receipt.purchaseOrderId}`}>
        Purchase order
      </Link>
      <h2 className="text-xl font-semibold">{receipt.number}</h2>
      <div className="panel space-y-2">
        <p>Received: {receipt.receivedAt}</p>
        <p>Recorded by: {receipt.createdBy.id}</p>
        <p className="whitespace-pre-wrap">{receipt.note}</p>
        {receipt.inventoryTransactionId && (
          <Link
            className="underline"
            href={`/app/${org}/inventory/history/${receipt.inventoryTransactionId}`}
          >
            Stock updated · View inventory transaction
          </Link>
        )}
      </div>
      <table className="catalog-table">
        <thead>
          <tr>
            {['Saved item', 'SKU', 'Quantity', 'Unit', 'Stock'].map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {receipt.items.map((i) => (
            <tr key={i.id}>
              <td>
                {i.snapshotItemName} {i.snapshotVariantName}
              </td>
              <td>{i.snapshotSku ?? '—'}</td>
              <td>{i.receivedQuantity}</td>
              <td>{i.snapshotUnit}</td>
              <td>{i.inventoryTracked ? 'Updated' : 'Not tracked'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
