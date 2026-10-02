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
import {
  CUSTOMER_TYPES,
  PAYMENT_METHODS,
  type CustomerResponse,
  type LocationResponse,
  type SalesOrderResponse,
  type SalesOrderItemResponse,
  type CatalogItemSummary,
  type CatalogVariantResponse,
  type PageResponse,
} from '@saas/types';
import {
  findSaleCustomers,
  findSaleProducts,
  findSaleVariants,
  saveSalesCommand,
  type SalesFormState,
} from './actions';
type Kind = Parameters<typeof saveSalesCommand>[1];
function Command({
  org,
  kind,
  id = null,
  label,
  children,
  onSaved,
}: {
  org: string;
  kind: Kind;
  id?: string | null;
  label: string;
  children: ReactNode;
  onSaved?: () => void;
}) {
  const attempt = useRef<{
    key: string;
    fingerprint: string;
    form: FormData;
    uncertain: boolean;
  } | null>(null);
  const [state, action, pending] = useActionState(
    async (_previous: SalesFormState, form: FormData): Promise<SalesFormState> => {
      const fingerprint = JSON.stringify([...form.entries()]);
      if (
        !attempt.current ||
        (!attempt.current.uncertain && attempt.current.fingerprint !== fingerprint)
      )
        attempt.current = { key: crypto.randomUUID(), fingerprint, form, uncertain: false };
      try {
        const result = await saveSalesCommand(
          org,
          kind,
          id,
          attempt.current.key,
          attempt.current.form,
        );
        attempt.current.uncertain = !!result.uncertain;
        if (result.success) {
          attempt.current = null;
          onSaved?.();
        }
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
    const form = new FormData(event.currentTarget);
    startTransition(() => action(form));
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
      {state.uncertain && (
        <p>
          Retry sends the original request with the same key. Keep this page open until its result
          is confirmed.
        </p>
      )}
      {state.success && (
        <p role="status">
          {state.success}{' '}
          {state.id && (kind === 'create' || (kind === 'customer' && !id)) && (
            <Link
              className="underline"
              href={`/app/${org}/${kind === 'customer' ? 'customers' : 'sales'}/${state.id}`}
            >
              Open {kind === 'customer' ? 'customer' : 'draft sale'}
            </Link>
          )}
        </p>
      )}
      <button
        className="button"
        disabled={
          pending || (!!state.success && (kind === 'create' || (kind === 'customer' && !id)))
        }
      >
        {pending ? 'Saving…' : state.uncertain ? 'Retry original request' : label}
      </button>
    </form>
  );
}
function CustomerPicker({
  org,
  initial,
}: {
  org: string;
  initial?: SalesOrderResponse['customer'];
}) {
  const [selected, setSelected] = useState(initial ?? null),
    [q, setQ] = useState(''),
    [page, setPage] = useState<PageResponse<CustomerResponse> | null>(null),
    [error, setError] = useState('');
  async function search(cursor?: string) {
    try {
      setPage(await findSaleCustomers(org, q, cursor));
      setError('');
    } catch {
      setError('Customer search is unavailable.');
    }
  }
  return (
    <div className="space-y-2">
      <input type="hidden" name="customerId" value={selected?.id ?? ''} />
      <p>Customer: {selected?.name ?? 'Walk-in / none'}</p>
      <button type="button" className="underline" onClick={() => setSelected(null)}>
        Clear customer
      </button>
      <label className="field">
        Find customer
        <input value={q} maxLength={100} onChange={(e) => setQ(e.target.value)} />
      </label>
      <button type="button" className="underline" onClick={() => void search()}>
        Search customers
      </button>
      {error && <p role="alert">{error}</p>}
      {page?.items.map((c) => (
        <p key={c.id}>
          <button type="button" className="underline" onClick={() => setSelected(c)}>
            {c.name} {c.phone}
          </button>
        </p>
      ))}
      {page?.nextCursor && (
        <button type="button" className="underline" onClick={() => void search(page.nextCursor!)}>
          More customers
        </button>
      )}
    </div>
  );
}
export function OrderMetadataForm({
  org,
  locations,
  order,
}: {
  org: string;
  locations: LocationResponse[];
  order?: SalesOrderResponse;
}) {
  return (
    <Command
      org={org}
      kind={order ? 'metadata' : 'create'}
      id={order?.id}
      label={order ? 'Save draft details' : 'Create draft'}
    >
      <label className="field">
        Location
        <select name="locationId" defaultValue={order?.location?.id ?? ''}>
          <option value="">Choose later</option>
          {locations
            .filter((l) => l.isActive || l.id === order?.location?.id)
            .map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {l.isActive ? '' : ' (inactive)'}
              </option>
            ))}
        </select>
      </label>
      <CustomerPicker org={org} initial={order?.customer} />
      <label className="field">
        Note
        <textarea name="note" maxLength={2000} defaultValue={order?.note ?? ''} />
      </label>
      {!order && (
        <p>Create a draft, then add products and services. Drafts do not reserve stock.</p>
      )}
    </Command>
  );
}
export function ItemsForm({ org, order }: { org: string; order: SalesOrderResponse }) {
  const [rows, setRows] = useState<SalesOrderItemResponse[]>(order.items),
    [q, setQ] = useState(''),
    [page, setPage] = useState<PageResponse<CatalogItemSummary> | null>(null),
    [chosen, setChosen] = useState<CatalogItemSummary | null>(null),
    [variants, setVariants] = useState<PageResponse<CatalogVariantResponse> | null>(null),
    [error, setError] = useState('');
  async function search(cursor?: string) {
    try {
      setPage(await findSaleProducts(org, q, cursor));
      setError('');
    } catch {
      setError('Catalog search is unavailable.');
    }
  }
  async function choose(item: CatalogItemSummary, cursor?: string) {
    try {
      setChosen(item);
      setVariants(await findSaleVariants(org, item.id, cursor));
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
        id: variant.id,
        variantId: variant.id,
        quantity: '1.000000',
        discountAmount: '0.0000',
        unitPrice: variant.sellingPrice,
        lineTotal: variant.sellingPrice,
        snapshotItemName: chosen.name,
        snapshotVariantName: variant.name ?? null,
        snapshotSku: variant.sku ?? null,
        snapshotUnit: variant.unit,
      },
    ]);
  }
  return (
    <Command org={org} kind="items" id={order.id} label="Save items and recalculate">
      <p>
        Saving the complete item list refreshes all line prices and names from Catalog. Totals below
        the form update after saving.
      </p>
      <label className="field">
        Search products or services
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
      {page?.items.map((item) => (
        <p key={item.id}>
          <button type="button" className="underline" onClick={() => void choose(item)}>
            {item.name} ({item.type})
          </button>
        </p>
      ))}
      {page?.nextCursor && (
        <button type="button" className="underline" onClick={() => void search(page.nextCursor!)}>
          More catalog items
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
                  {v.name ?? 'Default'} · {v.sku ?? 'No SKU'} · {v.sellingPrice} / {v.unit}
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
            {row.snapshotItemName} {row.snapshotVariantName} · {row.snapshotSku ?? 'No SKU'} ·{' '}
            {row.unitPrice} / {row.snapshotUnit}
          </p>
          <label className="field">
            Quantity
            <input
              name="quantity"
              inputMode="decimal"
              required
              pattern="(0|[1-9][0-9]{0,12})(\.[0-9]{1,6})?"
              value={row.quantity}
              onChange={(e) =>
                setRows(rows.map((r, i) => (i === index ? { ...r, quantity: e.target.value } : r)))
              }
            />
          </label>
          <label className="field">
            Fixed line discount
            <input
              name="discountAmount"
              inputMode="decimal"
              required
              pattern="(0|[1-9][0-9]{0,14})(\.[0-9]{1,4})?"
              value={row.discountAmount}
              onChange={(e) =>
                setRows(
                  rows.map((r, i) => (i === index ? { ...r, discountAmount: e.target.value } : r)),
                )
              }
            />
          </label>
          <button
            type="button"
            className="underline"
            onClick={() => setRows(rows.filter((r) => r.variantId !== row.variantId))}
          >
            Remove
          </button>
        </div>
      ))}
    </Command>
  );
}
function PaymentFields({ amount = '', optional = false }: { amount?: string; optional?: boolean }) {
  return (
    <>
      <label className="field">
        {optional ? 'Initial payment (optional)' : 'Amount'}
        <input
          name="amount"
          inputMode="decimal"
          required={!optional}
          defaultValue={amount}
          pattern="(0|[1-9][0-9]{0,14})(\.[0-9]{1,4})?"
        />
      </label>
      <label className="field">
        Method
        <select name="method">
          {PAYMENT_METHODS.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </label>
      <label className="field">
        Reference
        <input name="reference" maxLength={200} />
      </label>
      <label className="field">
        Payment note
        <textarea name="paymentNote" maxLength={2000} />
      </label>
      <p>Records an offline payment. No card or bank credentials.</p>
    </>
  );
}
export function CompletionForm({
  org,
  order,
  canPay,
}: {
  org: string;
  order: SalesOrderResponse;
  canPay: boolean;
}) {
  return (
    <Command org={org} kind="complete" id={order.id} label="Complete sale">
      <p>
        Total: {order.total} {order.currencyCode}
      </p>
      {canPay && <PaymentFields optional />}
      <label className="flex gap-2">
        <input type="checkbox" name="confirmed" required />
        Confirm completion and stock deduction. This sale cannot be edited afterwards.
      </label>
    </Command>
  );
}
export function PaymentForm({ org, order }: { org: string; order: SalesOrderResponse }) {
  return (
    <Command org={org} kind="payment" id={order.id} label="Add payment">
      <PaymentFields key={order.paidAmount} amount={order.outstandingAmount} />
    </Command>
  );
}
export function CancelForm({ org, id }: { org: string; id: string }) {
  return (
    <Command org={org} kind="cancel" id={id} label="Cancel draft">
      <label className="flex gap-2">
        <input type="checkbox" name="confirmed" required />
        Confirm cancellation of this draft.
      </label>
    </Command>
  );
}
export function CustomerForm({ org, customer }: { org: string; customer?: CustomerResponse }) {
  return (
    <Command
      org={org}
      kind="customer"
      id={customer?.id}
      label={customer ? 'Save customer' : 'Create customer'}
    >
      <label className="field">
        Type
        <select name="type" defaultValue={customer?.type ?? 'INDIVIDUAL'}>
          {CUSTOMER_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>
      <label className="field">
        Name
        <input name="name" required maxLength={200} defaultValue={customer?.name ?? ''} />
      </label>
      <label className="field">
        Email
        <input name="email" type="email" maxLength={254} defaultValue={customer?.email ?? ''} />
      </label>
      <label className="field">
        Phone
        <input name="phone" maxLength={50} defaultValue={customer?.phone ?? ''} />
      </label>
      <label className="field">
        Notes
        <textarea name="notes" maxLength={2000} defaultValue={customer?.notes ?? ''} />
      </label>
      <label className="flex gap-2">
        <input name="isActive" type="checkbox" defaultChecked={customer?.isActive ?? true} />
        Active (uncheck to archive)
      </label>
    </Command>
  );
}
