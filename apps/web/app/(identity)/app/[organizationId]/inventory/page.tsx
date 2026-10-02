import Link from 'next/link';
import { Permission } from '@saas/types';
import { api } from '../../../../../lib/api';
import { catalogApi } from '../../../../../lib/catalog';
import { inventoryApi } from '../../../../../lib/inventory';
import { Pagination, selectedQuery } from './navigation';

export default async function StockPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId: org } = await params;
  const query = selectedQuery(await searchParams, [
    'q',
    'locationId',
    'categoryId',
    'itemId',
    'cursor',
  ]);
  const [organization, page, locations, categories] = await Promise.all([
    api.organization(org),
    inventoryApi.stock(org, query.toString()),
    api.locations(org),
    catalogApi.categories(org),
  ]);
  const permissions = organization.currentMembership.permissions;
  const manage =
    permissions.includes(Permission.INVENTORY_ADJUST) ||
    permissions.includes(Permission.INVENTORY_TRANSFER);
  const base = `/app/${org}/inventory`;
  return (
    <div className="space-y-5">
      <h2 className="text-xl font-semibold">
        {locations.find((location) => location.id === query.get('locationId'))?.name ??
          'All locations'}{' '}
        — stock
      </h2>
      <form action={base} className="panel grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="field">
          Search
          <input
            name="q"
            maxLength={100}
            placeholder="Item, variant, SKU or barcode"
            defaultValue={query.get('q') ?? ''}
          />
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
          Category
          <select name="categoryId" defaultValue={query.get('categoryId') ?? ''}>
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <button className="button">Apply filters</button>
      </form>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="catalog-table">
          <thead>
            <tr>
              <th>Item / Variant</th>
              <th>SKU</th>
              <th>Unit</th>
              <th>Quantity</th>
              <th>Location</th>
              <th>Status</th>
              {manage && <th>Action</th>}
            </tr>
          </thead>
          <tbody>
            {page.items.map((row) => (
              <tr key={row.variantId}>
                <td>
                  <Link href={`/app/${org}/catalog/${row.itemId}`} className="underline">
                    {row.itemName}
                  </Link>
                  <p className="text-slate-500">{row.variantName ?? 'Default variant'}</p>
                </td>
                <td>{row.sku ?? '—'}</td>
                <td>{row.unit}</td>
                <td
                  className={`tabular-nums ${row.quantity.startsWith('-') ? 'font-semibold text-red-700' : ''}`}
                >
                  {row.quantity}
                </td>
                <td>{row.location?.name ?? 'Total'}</td>
                <td>
                  {row.isActive ? 'Active' : 'Archived'}
                  {!row.trackInventory && ' · Tracking off'}
                </td>
                {manage && (
                  <td>
                    {row.isActive && row.trackInventory ? (
                      <Link
                        className="underline"
                        href={`${base}/operations?itemId=${row.itemId}&variantId=${row.variantId}${row.location ? `&locationId=${row.location.id}` : ''}`}
                      >
                        Record movement
                      </Link>
                    ) : (
                      'Reactivate to move stock'
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {!page.items.length && (
          <p className="p-6 text-slate-600">
            No inventory items match these filters. Enable inventory tracking on an active product
            in Catalog.
          </p>
        )}
      </div>
      <Pagination base={base} query={query} nextCursor={page.nextCursor} />
      {!manage && <p className="text-sm text-slate-500">Read-only inventory access</p>}
    </div>
  );
}
