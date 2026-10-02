import Link from 'next/link';
import { Permission } from '@saas/types';
import { api } from '../../../../../../../lib/api';
import { inventoryApi } from '../../../../../../../lib/inventory';
import { ReversalForm } from '../../forms';
export default async function TransactionPage({
  params,
}: {
  params: Promise<{ organizationId: string; transactionId: string }>;
}) {
  const { organizationId: org, transactionId } = await params;
  const [row, organization] = await Promise.all([
    inventoryApi.transaction(org, transactionId),
    api.organization(org),
  ]);
  const permission =
    row.type === 'TRANSFER' ? Permission.INVENTORY_TRANSFER : Permission.INVENTORY_ADJUST;
  const reverse =
    row.type !== 'REVERSAL' &&
    row.type !== 'SALE' &&
    !row.reversedByTransactionId &&
    organization.currentMembership.permissions.includes(permission);
  const base = `/app/${org}/inventory/history`;
  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-xl font-semibold">{row.type}</h2>
        <p className="break-all text-sm text-slate-500">{row.id}</p>
      </header>
      <section className="panel space-y-3">
        <p>{row.createdAt.replace('T', ' ').replace('Z', ' UTC')}</p>
        <p className="break-all">Created by: {row.createdBy.id}</p>
        {row.salesOrderId &&
          organization.currentMembership.permissions.includes(Permission.SALES_VIEW) && (
            <p>
              Source sale:{' '}
              <Link className="underline" href={`/app/${org}/sales/${row.salesOrderId}`}>
                {row.salesOrderId}
              </Link>
            </p>
          )}
        {row.reason && <p>Reason: {row.reason}</p>}
        <p className="whitespace-pre-wrap break-words">{row.note ?? 'No note'}</p>
        {row.reversesTransactionId && (
          <p>
            Reversal of{' '}
            <Link className="underline" href={`${base}/${row.reversesTransactionId}`}>
              {row.reversesTransactionId}
            </Link>
          </p>
        )}
        {row.reversedByTransactionId && (
          <p>
            Reversed ·{' '}
            <Link className="underline" href={`${base}/${row.reversedByTransactionId}`}>
              View reversal
            </Link>
          </p>
        )}
      </section>
      <div className="overflow-x-auto">
        <table className="catalog-table">
          <thead>
            <tr>
              <th>Item / Variant</th>
              <th>Location</th>
              <th>Quantity change</th>
            </tr>
          </thead>
          <tbody>
            {row.entries.map((entry) => (
              <tr key={entry.id}>
                <td>
                  {entry.variant.itemName} · {entry.variant.name ?? 'Default'}
                  <p>{entry.variant.sku ?? 'No SKU'}</p>
                </td>
                <td>
                  {entry.location.name}
                  {entry.location.isActive ? '' : ' (inactive)'}
                </td>
                <td className="tabular-nums">
                  {entry.quantityDelta} {entry.unit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {reverse && <ReversalForm org={org} id={row.id} />}
      <Link className="underline" href={base}>
        Back to history
      </Link>
    </div>
  );
}
