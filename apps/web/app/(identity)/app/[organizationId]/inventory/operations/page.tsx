import { notFound } from 'next/navigation';
import { Permission } from '@saas/types';
import { api } from '../../../../../../lib/api';
import { inventoryApi } from '../../../../../../lib/inventory';
import { MovementForm } from '../forms';

export default async function OperationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId: org } = await params;
  const search = await searchParams;
  const organization = await api.organization(org);
  const permissions = organization.currentMembership.permissions;
  const adjust = permissions.includes(Permission.INVENTORY_ADJUST),
    transfer = permissions.includes(Permission.INVENTORY_TRANSFER);
  if (!adjust && !transfer) notFound();
  const q = typeof search.q === 'string' ? search.q : '';
  const itemId = typeof search.itemId === 'string' ? search.itemId : '';
  const variantId = typeof search.variantId === 'string' ? search.variantId : '';
  const locationId = typeof search.locationId === 'string' ? search.locationId : '';
  const query = new URLSearchParams({ limit: '100', ...(itemId ? { itemId } : { q }) });
  const [page, locations] = await Promise.all([
    inventoryApi.stock(org, query.toString()),
    api.locations(org),
  ]);
  const rows = page.items.filter((row) => row.isActive && row.trackInventory);
  const selected = rows.find((row) => row.variantId === variantId);
  const base = `/app/${org}/inventory/operations`;
  return (
    <div className="space-y-5">
      <h2 className="text-xl font-semibold">Record inventory movement</h2>
      <form action={base} className="panel flex flex-wrap items-end gap-4">
        <label className="field">
          Find a product / variant
          <input name="q" maxLength={100} defaultValue={q} placeholder="Name, SKU or barcode" />
        </label>
        <button className="button">Search</button>
      </form>
      <form action={base} className="panel flex flex-wrap items-end gap-4">
        <input type="hidden" name="q" value={q} />
        {itemId && <input type="hidden" name="itemId" value={itemId} />}
        <input type="hidden" name="locationId" value={locationId} />
        <label className="field">
          Variant
          <select name="variantId" defaultValue={variantId} required>
            <option value="">Choose a variant</option>
            {rows.map((row) => (
              <option key={row.variantId} value={row.variantId}>
                {row.itemName} · {row.variantName ?? 'Default'} · {row.sku ?? 'No SKU'} · {row.unit}
              </option>
            ))}
          </select>
        </label>
        <button className="button">Select variant</button>
        {page.nextCursor && (
          <p className="text-sm">Showing the first 100 results. Refine your search.</p>
        )}
      </form>
      {selected ? (
        <>
          <h3 className="font-semibold">
            {selected.itemName} · {selected.variantName ?? 'Default variant'} · {selected.unit}
          </h3>
          {adjust && (
            <>
              <MovementForm
                key={`opening:${selected.variantId}`}
                org={org}
                kind="opening"
                row={selected}
                locations={locations}
                locationId={locationId}
              />
              <MovementForm
                key={`adjustment:${selected.variantId}`}
                org={org}
                kind="adjustment"
                row={selected}
                locations={locations}
                locationId={locationId}
              />
            </>
          )}
          {transfer && (
            <MovementForm
              key={`transfer:${selected.variantId}`}
              org={org}
              kind="transfer"
              row={selected}
              locations={locations}
              locationId={locationId}
            />
          )}
        </>
      ) : (
        <p className="text-slate-600">
          Select an active product variant with inventory tracking enabled.
        </p>
      )}
    </div>
  );
}
