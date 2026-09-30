import Link from 'next/link';
import { INVENTORY_TYPES } from '@saas/types';
import { api } from '../../../../../../lib/api';
import { inventoryApi } from '../../../../../../lib/inventory';
import { Pagination, selectedQuery } from '../navigation';
export default async function HistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId: org } = await params;
  const query = selectedQuery(await searchParams, [
    'type',
    'locationId',
    'variantId',
    'from',
    'to',
    'cursor',
  ]);
  const [page, locations] = await Promise.all([
    inventoryApi.history(org, query.toString()),
    api.locations(org),
  ]);
  const base = `/app/${org}/inventory/history`;
  return (
    <div className="space-y-5">
      <h2 className="text-xl font-semibold">Movement history</h2>
      <p className="text-sm text-slate-500">Times shown in UTC.</p>
      <form action={base} className="panel grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="field">
          Type
          <select name="type" defaultValue={query.get('type') ?? ''}>
            <option value="">All types</option>
            {INVENTORY_TYPES.map((type) => (
              <option key={type}>{type}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Location
          <select name="locationId" defaultValue={query.get('locationId') ?? ''}>
            <option value="">All locations</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
                {location.isActive ? '' : ' (inactive)'}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          From (UTC)
          <input
            type="datetime-local"
            step="1"
            name="from"
            defaultValue={query.get('from') ?? ''}
          />
        </label>
        <label className="field">
          To (UTC)
          <input type="datetime-local" step="1" name="to" defaultValue={query.get('to') ?? ''} />
        </label>
        {query.has('variantId') && (
          <input type="hidden" name="variantId" value={query.get('variantId')!} />
        )}
        <button className="button">Apply filters</button>
        <Link href={base} className="underline">
          Reset filters
        </Link>
      </form>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="catalog-table">
          <thead>
            <tr>
              <th>Date / Type</th>
              <th>Movements</th>
              <th>User</th>
              <th>Note</th>
              <th>Reversal</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((row) => (
              <tr key={row.id}>
                <td>
                  <Link className="underline" href={`${base}/${row.id}`}>
                    {row.createdAt.replace('T', ' ').replace('Z', ' UTC')}
                  </Link>
                  <p>{row.type}</p>
                </td>
                <td>
                  {row.entries.map((entry) => (
                    <p key={entry.id}>
                      {entry.variant.itemName} · {entry.variant.name ?? 'Default'} ·{' '}
                      {entry.location.name}:{' '}
                      <span className="tabular-nums">
                        {entry.quantityDelta} {entry.unit}
                      </span>
                    </p>
                  ))}
                </td>
                <td className="max-w-36 break-all text-xs">{row.createdBy.id}</td>
                <td className="max-w-64 whitespace-pre-wrap break-words">{row.note ?? '—'}</td>
                <td>
                  {row.reversedByTransactionId ? (
                    'Reversed'
                  ) : row.reversesTransactionId ? (
                    <Link className="underline" href={`${base}/${row.reversesTransactionId}`}>
                      Reversal of original
                    </Link>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!page.items.length && <p className="p-6">No movements match these filters.</p>}
      </div>
      <Pagination base={base} query={query} nextCursor={page.nextCursor} />
    </div>
  );
}
