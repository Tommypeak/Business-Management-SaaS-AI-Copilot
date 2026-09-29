import Link from 'next/link';
import { CATALOG_ITEM_TYPES, CATALOG_SORTS, Permission } from '@saas/types';
import { api } from '../../../../../lib/api';
import { catalogApi } from '../../../../../lib/catalog';
import { categoryLabel } from './presentation';

export default async function CatalogPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId: org } = await params;
  const search = await searchParams;
  const query = new URLSearchParams();
  for (const key of ['q', 'type', 'categoryId', 'isActive', 'sort', 'cursor']) {
    const value = search[key];
    if (typeof value === 'string' && value) query.set(key, value);
  }
  query.set('limit', '25');
  const [organization, page, categories] = await Promise.all([
    api.organization(org),
    catalogApi.items(org, query.toString()),
    catalogApi.categories(org),
  ]);
  const manage = organization.currentMembership.permissions.includes(Permission.CATALOG_MANAGE);
  const base = `/app/${org}/catalog`;
  const next = new URLSearchParams(query);
  if (page.nextCursor) next.set('cursor', page.nextCursor);
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Items</h2>
        {manage && (
          <Link className="button" href={`${base}/new`}>
            Create item
          </Link>
        )}
      </div>
      <form className="panel grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-3" action={base}>
        <label className="field sm:col-span-2">
          Search
          <input
            name="q"
            maxLength={100}
            defaultValue={query.get('q') ?? ''}
            placeholder="Name, SKU or barcode"
          />
        </label>
        <label className="field">
          Type
          <select name="type" defaultValue={query.get('type') ?? ''}>
            <option value="">All types</option>
            {CATALOG_ITEM_TYPES.map((type) => (
              <option key={type}>{type}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Category
          <select name="categoryId" defaultValue={query.get('categoryId') ?? ''}>
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {categoryLabel(category, categories)}
                {category.isActive ? '' : ' (archived)'}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Status
          <select name="isActive" defaultValue={query.get('isActive') ?? 'true'}>
            <option value="true">Active</option>
            <option value="false">Archived</option>
          </select>
        </label>
        <label className="field">
          Sort
          <select name="sort" defaultValue={query.get('sort') ?? 'createdAt'}>
            {CATALOG_SORTS.map((sort) => (
              <option key={sort} value={sort}>
                {sort === 'name'
                  ? 'Name A–Z'
                  : sort === 'createdAt'
                    ? 'Newest first'
                    : 'Recently updated'}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-4">
          <button className="button">Apply filters</button>
          <Link className="underline" href={base}>
            Reset
          </Link>
        </div>
      </form>
      {page.items.length ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="catalog-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Type / Category</th>
                <th>Default price</th>
                <th>Default SKU</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <Link className="font-medium underline" href={`${base}/${item.id}`}>
                      {item.name}
                    </Link>
                  </td>
                  <td>
                    {item.type}
                    <div className="mt-1 text-slate-500">
                      {item.category?.name ?? 'Uncategorized'}
                    </div>
                  </td>
                  <td className="whitespace-nowrap tabular-nums">
                    {item.defaultVariant.sellingPrice} {item.currencyCode}
                  </td>
                  <td>{item.defaultVariant.sku ?? '—'}</td>
                  <td>{item.isActive ? 'Active' : 'Archived'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="panel text-slate-600">
          No items match these filters.{manage && ' Create an item or change the filters.'}
        </div>
      )}
      <div className="flex gap-5">
        {query.has('cursor') && (
          <Link
            className="underline"
            href={`${base}?${new URLSearchParams([...query].filter(([key]) => key !== 'cursor')).toString()}`}
          >
            First page
          </Link>
        )}
        {page.nextCursor && (
          <Link className="button" href={`${base}?${next.toString()}`}>
            Next page
          </Link>
        )}
      </div>
      {!manage && <p className="text-sm text-slate-500">You have read-only catalog access.</p>}
    </div>
  );
}
