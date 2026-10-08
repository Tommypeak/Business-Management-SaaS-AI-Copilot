'use client';
import Link from 'next/link';
import {
  startTransition,
  useActionState,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import type {
  CatalogItemSummary,
  CatalogVariantResponse,
  LocationResponse,
  PageResponse,
  PurchaseOrderItemResponse,
  PurchaseOrderResponse,
  SupplierResponse,
} from '@saas/types';
import {
  findProducts,
  findSuppliers,
  findVariants,
  savePurchaseCommand,
  type PurchaseCommand,
  type PurchaseFormState,
} from './actions';

function Command({
  org,
  kind,
  id = null,
  label,
  children,
}: {
  org: string;
  kind: PurchaseCommand;
  id?: string | null;
  label: string;
  children: ReactNode;
}) {
  const attempt = useRef<{
    key: string;
    fingerprint: string;
    form: FormData;
    uncertain: boolean;
  } | null>(null);
  const [state, action, pending] = useActionState(
    async (_previous: PurchaseFormState, form: FormData): Promise<PurchaseFormState> => {
      const fingerprint = JSON.stringify([...form.entries()]);
      if (
        !attempt.current ||
        (!attempt.current.uncertain && attempt.current.fingerprint !== fingerprint)
      )
        attempt.current = { key: crypto.randomUUID(), fingerprint, form, uncertain: false };
      try {
        const result = await savePurchaseCommand(
          org,
          kind,
          id,
          attempt.current.key,
          attempt.current.form,
        );
        attempt.current.uncertain = !!result.uncertain;
        if (result.success) attempt.current = null;
        return result;
      } catch {
        if (attempt.current) attempt.current.uncertain = true;
        return { error: 'The result could not be confirmed.', uncertain: true };
      }
    },
    {},
  );
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(() => action(new FormData(event.currentTarget)));
  }
  return (
    <form onSubmit={submit} className="panel space-y-4">
      <fieldset disabled={pending || state.uncertain} className="space-y-4">
        {children}
      </fieldset>
      {state.error && (
        <p role="alert" className="text-red-700">
          {state.error}
        </p>
      )}
      {state.uncertain && <p>Retry sends the original payload with the same request key.</p>}
      {state.success && (
        <p role="status">
          {state.success}{' '}
          {state.id &&
            (((kind === 'create' || kind === 'supplier') && !id) || kind === 'receive') && (
              <Link
                className="underline"
                href={`/app/${org}/${kind === 'supplier' ? 'suppliers' : 'purchasing'}/${kind === 'receive' ? `receipts/${state.id}` : state.id}`}
              >
                Open result
              </Link>
            )}
        </p>
      )}
      <button
        className="button"
        disabled={
          pending ||
          (!!state.success &&
            (((kind === 'create' || kind === 'supplier') && !id) || kind === 'receive'))
        }
      >
        {pending ? 'Saving…' : state.uncertain ? 'Retry original request' : label}
      </button>
    </form>
  );
}

export function SupplierForm({ org, supplier }: { org: string; supplier?: SupplierResponse }) {
  return (
    <Command
      org={org}
      kind="supplier"
      id={supplier?.id}
      label={supplier ? 'Save supplier' : 'Create supplier'}
    >
      <label className="field">
        Name
        <input name="name" required maxLength={200} defaultValue={supplier?.name ?? ''} />
      </label>
      <label className="field">
        Contact name
        <input name="contactName" maxLength={200} defaultValue={supplier?.contactName ?? ''} />
      </label>
      <label className="field">
        Email
        <input name="email" type="email" maxLength={254} defaultValue={supplier?.email ?? ''} />
      </label>
      <label className="field">
        Phone
        <input name="phone" maxLength={50} defaultValue={supplier?.phone ?? ''} />
      </label>
      <label className="field">
        Tax ID
        <input name="taxId" maxLength={100} defaultValue={supplier?.taxId ?? ''} />
      </label>
      <label className="field">
        Address
        <textarea name="address" maxLength={1000} defaultValue={supplier?.address ?? ''} />
      </label>
      <label className="field">
        Notes
        <textarea name="notes" maxLength={2000} defaultValue={supplier?.notes ?? ''} />
      </label>
      <label className="flex gap-2">
        <input name="isActive" type="checkbox" defaultChecked={supplier?.isActive ?? true} />
        Active (uncheck to archive)
      </label>
    </Command>
  );
}

function SupplierPicker({
  org,
  initial,
}: {
  org: string;
  initial?: PurchaseOrderResponse['supplier'];
}) {
  const [selected, setSelected] = useState(initial ?? null),
    [q, setQ] = useState(''),
    [page, setPage] = useState<PageResponse<SupplierResponse> | null>(null),
    [error, setError] = useState('');
  async function search(cursor?: string) {
    try {
      setPage(await findSuppliers(org, q, cursor));
      setError('');
    } catch {
      setError('Supplier search is unavailable.');
    }
  }
  return (
    <div className="space-y-2">
      <input type="hidden" name="supplierId" value={selected?.id ?? ''} />
      <p>Supplier: {selected?.name ?? 'Choose a supplier'}</p>
      <label className="field">
        Find supplier
        <input value={q} maxLength={100} onChange={(e) => setQ(e.target.value)} />
      </label>
      <button type="button" className="underline" onClick={() => void search()}>
        Search suppliers
      </button>
      {error && <p role="alert">{error}</p>}
      {page?.items.map((supplier) => (
        <p key={supplier.id}>
          <button type="button" className="underline" onClick={() => setSelected(supplier)}>
            {supplier.name} {supplier.phone}
          </button>
        </p>
      ))}
      {page?.nextCursor && (
        <button type="button" className="underline" onClick={() => void search(page.nextCursor!)}>
          More suppliers
        </button>
      )}
    </div>
  );
}

type EditableLine = Pick<
  PurchaseOrderItemResponse,
  | 'variantId'
  | 'orderedQuantity'
  | 'unitCost'
  | 'snapshotItemName'
  | 'snapshotVariantName'
  | 'snapshotSku'
  | 'snapshotUnit'
>;
function scaled(value: string, places: number) {
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > places) return null;
  return (
    BigInt(whole!) * 10n ** BigInt(places) +
    BigInt((fraction + '0'.repeat(places)).slice(0, places))
  );
}
function preview(quantity: string, cost: string) {
  const q = scaled(quantity, 6),
    c = scaled(cost, 4);
  if (q === null || c === null) return '—';
  const rounded = (q * c + 500000n) / 1000000n;
  return `${rounded / 10000n}.${String(rounded % 10000n).padStart(4, '0')}`;
}
function LinesPicker({ org, initial = [] }: { org: string; initial?: EditableLine[] }) {
  const [rows, setRows] = useState<EditableLine[]>(initial),
    [q, setQ] = useState(''),
    [page, setPage] = useState<PageResponse<CatalogItemSummary> | null>(null),
    [chosen, setChosen] = useState<CatalogItemSummary | null>(null),
    [variants, setVariants] = useState<PageResponse<CatalogVariantResponse> | null>(null),
    [error, setError] = useState('');
  async function search(cursor?: string) {
    try {
      setPage(await findProducts(org, q, cursor));
      setError('');
    } catch {
      setError('Catalog search is unavailable.');
    }
  }
  async function choose(item: CatalogItemSummary, cursor?: string) {
    try {
      setChosen(item);
      setVariants(await findVariants(org, item.id, cursor));
      setError('');
    } catch {
      setError('Variants are unavailable.');
    }
  }
  function add(variant: CatalogVariantResponse) {
    if (!chosen || rows.some((r) => r.variantId === variant.id) || rows.length >= 100) return;
    setRows([
      ...rows,
      {
        variantId: variant.id,
        orderedQuantity: '1.000000',
        unitCost: variant.costPrice ?? '0.0000',
        snapshotItemName: chosen.name,
        snapshotVariantName: variant.name,
        snapshotSku: variant.sku,
        snapshotUnit: variant.unit,
      },
    ]);
  }
  return (
    <div className="space-y-3">
      <p>Product lines. Catalog cost is a suggestion; edit the unit cost for this purchase.</p>
      <label className="field">
        Find product
        <input
          value={q}
          maxLength={100}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name, SKU or barcode"
        />
      </label>
      <button type="button" className="underline" onClick={() => void search()}>
        Search catalog
      </button>
      {error && <p role="alert">{error}</p>}
      {page?.items
        .filter((item) => item.type === 'PRODUCT')
        .map((item) => (
          <p key={item.id}>
            <button type="button" className="underline" onClick={() => void choose(item)}>
              {item.name}
            </button>
          </p>
        ))}
      {page?.nextCursor && (
        <button type="button" className="underline" onClick={() => void search(page.nextCursor!)}>
          More products
        </button>
      )}
      {chosen && (
        <div>
          <p>{chosen.name} — choose a variant:</p>
          {variants?.items
            .filter((v) => v.isActive)
            .map((v) => (
              <p key={v.id}>
                <button
                  type="button"
                  className="underline"
                  disabled={rows.some((r) => r.variantId === v.id)}
                  onClick={() => add(v)}
                >
                  {v.name ?? 'Default'} · {v.sku ?? 'No SKU'} · suggested {v.costPrice ?? '0.0000'}{' '}
                  / {v.unit}
                </button>
              </p>
            ))}
          {variants?.nextCursor && (
            <button
              type="button"
              className="underline"
              onClick={() => void choose(chosen, variants.nextCursor!)}
            >
              More variants
            </button>
          )}
        </div>
      )}
      {rows.map((row, index) => (
        <div key={row.variantId} className="rounded border p-3 space-y-2">
          <input type="hidden" name="variantId" value={row.variantId} />
          <p>
            {row.snapshotItemName} {row.snapshotVariantName} · {row.snapshotSku ?? 'No SKU'} /{' '}
            {row.snapshotUnit}
          </p>
          <label className="field">
            Ordered quantity
            <input
              name="orderedQuantity"
              inputMode="decimal"
              required
              pattern="(0|[1-9][0-9]{0,12})(\.[0-9]{1,6})?"
              value={row.orderedQuantity}
              onChange={(e) =>
                setRows(
                  rows.map((r, i) => (i === index ? { ...r, orderedQuantity: e.target.value } : r)),
                )
              }
            />
          </label>
          <label className="field">
            Unit cost
            <input
              name="unitCost"
              inputMode="decimal"
              required
              pattern="(0|[1-9][0-9]{0,14})(\.[0-9]{1,4})?"
              value={row.unitCost}
              onChange={(e) =>
                setRows(rows.map((r, i) => (i === index ? { ...r, unitCost: e.target.value } : r)))
              }
            />
          </label>
          <p>
            Line total preview: {preview(row.orderedQuantity, row.unitCost)} · Final total is
            calculated by the API.
          </p>
          <button
            type="button"
            className="underline"
            onClick={() => setRows(rows.filter((r) => r.variantId !== row.variantId))}
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}

export function PurchaseForm({
  org,
  locations,
  order,
}: {
  org: string;
  locations: LocationResponse[];
  order?: PurchaseOrderResponse;
}) {
  return (
    <Command
      org={org}
      kind={order ? 'metadata' : 'create'}
      id={order?.id}
      label={order ? 'Save draft details' : 'Create purchase draft'}
    >
      <SupplierPicker org={org} initial={order?.supplier} />
      <label className="field">
        Destination location
        <select
          name="destinationLocationId"
          required
          defaultValue={order?.destinationLocation.id ?? ''}
        >
          <option value="">Choose location</option>
          {locations
            .filter((l) => l.isActive || l.id === order?.destinationLocation.id)
            .map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {l.isActive ? '' : ' (inactive)'}
              </option>
            ))}
        </select>
      </label>
      <label className="field">
        Note
        <textarea name="note" maxLength={2000} defaultValue={order?.note ?? ''} />
      </label>
      {!order && <LinesPicker org={org} />}
    </Command>
  );
}
export function PurchaseItemsForm({ org, order }: { org: string; order: PurchaseOrderResponse }) {
  return (
    <Command org={org} kind="items" id={order.id} label="Save items and recalculate">
      <LinesPicker org={org} initial={order.items} />
    </Command>
  );
}
export function OrderPurchaseForm({ org, order }: { org: string; order: PurchaseOrderResponse }) {
  return (
    <Command org={org} kind="order" id={order.id} label="Order purchase">
      <p>
        Commit {order.number} for {order.total} {order.currencyCode}. Commercial fields become
        read-only.
      </p>
      <label className="flex gap-2">
        <input type="checkbox" name="confirmed" required />
        Confirm purchase order
      </label>
    </Command>
  );
}
export function CancelPurchaseForm({ org, order }: { org: string; order: PurchaseOrderResponse }) {
  return (
    <Command org={org} kind="cancel" id={order.id} label="Cancel purchase order">
      <label className="flex gap-2">
        <input type="checkbox" name="confirmed" required />
        Confirm cancellation
      </label>
    </Command>
  );
}
export function ReceiveGoodsForm({ org, order }: { org: string; order: PurchaseOrderResponse }) {
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  return (
    <Command org={org} kind="receive" id={order.id} label="Receive goods">
      <p>Enter any portion of the remaining quantities. Blank or zero lines are skipped.</p>
      {order.items
        .filter((item) => !/^0(?:\.0*)?$/.test(item.remainingQuantity))
        .map((item) => (
          <div key={item.id} className="rounded border p-3 space-y-2">
            <input type="hidden" name="purchaseOrderItemId" value={item.id} />
            <p>
              {item.snapshotItemName} {item.snapshotVariantName} · {item.snapshotSku ?? 'No SKU'} ·{' '}
              {item.snapshotUnit}
            </p>
            <p>
              Ordered {item.orderedQuantity} · Received {item.receivedQuantity} · Remaining{' '}
              {item.remainingQuantity}
            </p>
            <label className="field">
              Receive now
              <input
                name="quantity"
                inputMode="decimal"
                pattern="(0|[1-9][0-9]{0,12})(\.[0-9]{1,6})?"
                value={amounts[item.id] ?? ''}
                onChange={(e) => setAmounts({ ...amounts, [item.id]: e.target.value })}
                placeholder={item.remainingQuantity}
              />
            </label>
            <button
              type="button"
              className="underline"
              onClick={() => setAmounts({ ...amounts, [item.id]: item.remainingQuantity })}
            >
              Fill remaining
            </button>
          </div>
        ))}
      <label className="field">
        Receipt note
        <textarea name="note" maxLength={2000} />
      </label>
    </Command>
  );
}
