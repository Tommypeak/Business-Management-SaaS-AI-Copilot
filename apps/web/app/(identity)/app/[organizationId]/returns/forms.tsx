'use client';
import { startTransition, useActionState, useRef, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  PAYMENT_METHODS,
  type LocationResponse,
  type ReturnEligibilityResponse,
  type SalesReturnResponse,
  type SalesReturnListItem,
} from '@saas/types';
import { saveReturnCommand, type ReturnFormState } from './actions';
function Command({
  org,
  kind,
  id = null,
  label,
  children,
}: {
  org: string;
  kind: Parameters<typeof saveReturnCommand>[1];
  id?: string | null;
  label: string;
  children: ReactNode;
}) {
  const router = useRouter(),
    attempt = useRef<{
      key: string;
      form: FormData;
      fingerprint: string;
      uncertain: boolean;
    } | null>(null);
  const [state, action, pending] = useActionState(
    async (_previous: ReturnFormState, form: FormData): Promise<ReturnFormState> => {
      const fingerprint = JSON.stringify([...form.entries()]);
      if (
        !attempt.current ||
        (!attempt.current.uncertain && attempt.current.fingerprint !== fingerprint)
      )
        attempt.current = { key: crypto.randomUUID(), form, fingerprint, uncertain: false };
      try {
        const result = await saveReturnCommand(
          org,
          kind,
          id,
          attempt.current.key,
          attempt.current.form,
        );
        attempt.current.uncertain = !!result.uncertain;
        if (result.success) {
          attempt.current = null;
          if (kind === 'create' || kind === 'refund')
            router.push(`/app/${org}/${kind === 'refund' ? 'refunds' : 'returns'}/${result.id}`);
          else router.refresh();
        }
        return result;
      } catch {
        if (attempt.current) attempt.current.uncertain = true;
        return {
          error: 'The result could not be confirmed. Retry the original request.',
          uncertain: true,
        };
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
      {state.error && <p role="alert">{state.error}</p>}
      {state.uncertain && (
        <p>
          Retry sends the original request with the same key. Keep this page open until confirmed.
        </p>
      )}
      {state.success && <p role="status">{state.success}</p>}
      <button className="button" disabled={pending}>
        {pending ? 'Saving…' : state.uncertain ? 'Retry original request' : label}
      </button>
    </form>
  );
}
export function ReturnItemsForm({
  org,
  eligibility,
  locations,
  doc,
}: {
  org: string;
  eligibility: ReturnEligibilityResponse;
  locations: LocationResponse[];
  doc?: SalesReturnResponse;
}) {
  return (
    <Command
      org={org}
      kind={doc ? 'items' : 'create'}
      id={doc?.id}
      label={doc ? 'Save return lines' : 'Create draft return'}
    >
      <input type="hidden" name="salesOrderId" value={eligibility.salesOrder.id} />
      <p>
        Enter quantities to return; leave other lines at zero. A draft does not reserve quantities.
      </p>
      <div className="table-scroll">
        <table className="catalog-table">
          <thead>
            <tr>
              <th>Original item</th>
              <th>Sold / returned / remaining</th>
              <th>Return quantity</th>
              <th>Disposition</th>
              <th>Restock destination</th>
            </tr>
          </thead>
          <tbody>
            {eligibility.items.map((i) => {
              const line = doc?.items.find((l) => l.salesOrderItemId === i.salesOrderItemId);
              return (
                <tr key={i.salesOrderItemId}>
                  <td>
                    {i.snapshotItemName} {i.snapshotVariantName}
                    <small className="block">
                      {i.snapshotSku ?? 'No SKU'} · {i.snapshotItemType ?? 'Historic type unknown'}{' '}
                      · {i.snapshotUnit}
                    </small>
                    <input name="salesOrderItemId" type="hidden" value={i.salesOrderItemId} />
                  </td>
                  <td>
                    {i.soldQuantity} / {i.returnedQuantity} / {i.remainingQuantity}
                  </td>
                  <td>
                    <input
                      aria-label={`Return quantity for ${i.snapshotItemName}`}
                      name="quantity"
                      type="number"
                      min="0"
                      max={i.remainingQuantity}
                      step="0.000001"
                      defaultValue={line?.quantity ?? '0'}
                    />
                  </td>
                  <td>
                    <select
                      aria-label={`Disposition for ${i.snapshotItemName}`}
                      name="restockDisposition"
                      defaultValue={line?.restockDisposition ?? 'NO_RESTOCK'}
                    >
                      <option value="NO_RESTOCK">No restock</option>
                      {i.restockAllowed && <option value="RESTOCK">Restock</option>}
                    </select>
                    <small className="block">
                      {i.stockDeducted
                        ? 'Restock records a positive inventory movement.'
                        : 'No original stock deduction; no inventory movement.'}
                    </small>
                  </td>
                  <td>
                    <select
                      aria-label={`Destination for ${i.snapshotItemName}`}
                      name="locationId"
                      defaultValue={line?.location?.id ?? eligibility.salesOrder.location?.id ?? ''}
                    >
                      <option value="">Choose location</option>
                      {locations
                        .filter((l) => l.isActive)
                        .map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!doc && (
        <>
          <label className="field">
            Reason
            <textarea name="reason" maxLength={1000} />
          </label>
          <label className="field">
            Note
            <textarea name="note" maxLength={2000} />
          </label>
        </>
      )}
    </Command>
  );
}
export function ReturnMetadataForm({ org, doc }: { org: string; doc: SalesReturnResponse }) {
  return (
    <Command org={org} kind="metadata" id={doc.id} label="Save details">
      <label className="field">
        Reason
        <textarea name="reason" maxLength={1000} defaultValue={doc.reason ?? ''} />
      </label>
      <label className="field">
        Note
        <textarea name="note" maxLength={2000} defaultValue={doc.note ?? ''} />
      </label>
    </Command>
  );
}
export function ReturnPostForm({ org, doc }: { org: string; doc: SalesReturnResponse }) {
  return (
    <Command org={org} kind="post" id={doc.id} label="Post return">
      <h3>Post this return</h3>
      <p>
        Posting makes this document final. It records return credits and applicable restock
        movements. A customer payout is recorded separately.
      </p>
      <input name="revision" type="hidden" value={doc.revision} />
      {doc.currentQuoteAmount !== null && (
        <input name="expectedCredit" type="hidden" value={doc.currentQuoteAmount} />
      )}
      <p>
        Current credit: {doc.currentQuoteAmount ?? 'Finance access required'}{' '}
        {doc.financeVisible ? doc.currencyCode : ''}
      </p>
      {!doc.quoteValid ? (
        <p role="alert">
          The return quantities are no longer available. Edit the lines and refresh.
        </p>
      ) : (
        <label className="flex gap-2">
          <input type="checkbox" name="confirmed" required />I confirm the quantities, disposition,
          destination and credit.
        </label>
      )}
    </Command>
  );
}
export function ReturnCancelForm({ org, id }: { org: string; id: string }) {
  return (
    <Command org={org} kind="cancel" id={id} label="Cancel draft">
      <label className="field">
        Cancellation reason
        <input name="reason" maxLength={1000} />
      </label>
      <label className="flex gap-2">
        <input type="checkbox" name="confirmed" required />
        Cancel this draft without changing stock or cash.
      </label>
    </Command>
  );
}
export function RefundForm({
  org,
  salesOrderId,
  returns,
  today,
}: {
  org: string;
  salesOrderId: string;
  returns: SalesReturnListItem[];
  today: string;
}) {
  return (
    <Command org={org} kind="refund" label="Record customer payout">
      <input name="salesOrderId" type="hidden" value={salesOrderId} />
      <p>
        Record money actually paid to the customer. Allocate the entire amount to posted returns
        from this sale. The server checks collected cash and each unused return credit.
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="field">
          Payout amount
          <input name="amount" type="number" min="0.0001" step="0.0001" required />
        </label>
        <label className="field">
          Payment date
          <input name="paymentDate" type="date" defaultValue={today} required />
        </label>
        <label className="field">
          Method
          <select name="paymentMethod">
            {PAYMENT_METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="table-scroll">
        <table className="catalog-table">
          <thead>
            <tr>
              <th>Posted return</th>
              <th>Unused credit</th>
              <th>Allocate payout</th>
            </tr>
          </thead>
          <tbody>
            {returns.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.number}
                  <input type="hidden" name="salesReturnId" value={r.id} />
                </td>
                <td>
                  {r.remainingReturnCredit ?? 'Finance access required'}{' '}
                  {r.remainingReturnCredit !== null ? r.currencyCode : ''}
                </td>
                <td>
                  <input
                    aria-label={`Allocation to ${r.number}`}
                    name="allocatedAmount"
                    type="number"
                    min="0"
                    step="0.0001"
                    defaultValue="0"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <label className="field">
        Reference
        <input name="reference" maxLength={200} />
      </label>
      <label className="field">
        Note
        <textarea name="note" maxLength={2000} />
      </label>
      <label className="flex gap-2">
        <input name="confirmed" type="checkbox" required />I confirm the actual customer payout,
        date, method and allocations.
      </label>
    </Command>
  );
}
