'use client';
import Link from 'next/link';
import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import {
  ADJUSTMENT_DIRECTIONS,
  ADJUSTMENT_REASONS,
  type InventoryStockRow,
  type LocationResponse,
} from '@saas/types';
import {
  recordMovement,
  reverseTransaction,
  saveInventorySettings,
  sourceStock,
  type InventoryFormState,
} from './actions';

// A retry of unchanged input keeps its key. Success or edited input starts a new command.
function useCommand(submit: (key: string, form: FormData) => Promise<InventoryFormState>) {
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  return useActionState(
    async (_state: InventoryFormState, form: FormData): Promise<InventoryFormState> => {
      const fingerprint = JSON.stringify(
        [...form.entries()]
          .filter(([key]) => !key.startsWith('$ACTION'))
          .sort(([a], [b]) => a.localeCompare(b)),
      );
      if (attempt.current?.fingerprint !== fingerprint)
        attempt.current = { fingerprint, key: crypto.randomUUID() };
      try {
        const result = await submit(attempt.current.key, form);
        if (result.success) attempt.current = null;
        return result;
      } catch {
        return {
          error:
            'The result could not be confirmed. Retry the unchanged form to safely check this operation.',
        };
      }
    },
    {},
  );
}
// Do not let React reset uncontrolled inputs on an error/ambiguous network result:
// a retry must preserve both the payload and its idempotency key.
function submitWithoutReset(action: (form: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(() => action(form));
  };
}
function Feedback({
  org,
  state,
  pending,
  label,
}: {
  org: string;
  state: InventoryFormState;
  pending: boolean;
  label: string;
}) {
  return (
    <div className="space-y-3">
      {state.error && (
        <p role="alert" className="text-red-700">
          {state.error}
        </p>
      )}
      {state.success && (
        <p role="status" className="text-green-800">
          {state.success}{' '}
          {state.transactionId && (
            <Link
              className="underline"
              href={`/app/${org}/inventory/history/${state.transactionId}`}
            >
              View transaction
            </Link>
          )}
        </p>
      )}
      <button className="button" disabled={pending}>
        {pending ? 'Saving…' : label}
      </button>
    </div>
  );
}
function StockQuote({
  org,
  row,
  locationId,
  revision,
}: {
  org: string;
  row: InventoryStockRow;
  locationId: string;
  revision?: string;
}) {
  const key = `${row.variantId}:${locationId}:${row.quantity}:${revision ?? ''}`;
  const [result, setResult] = useState<{ key: string; quantity?: string; error?: string }>();
  useEffect(() => {
    let cancelled = false;
    if (locationId)
      void sourceStock(org, row.itemId, row.variantId, locationId)
        .then((value) => {
          if (!cancelled) setResult({ key, ...value });
        })
        .catch(() => {
          if (!cancelled) setResult({ key, error: 'Stock could not be loaded.' });
        });
    return () => {
      cancelled = true;
    };
  }, [org, row.itemId, row.variantId, locationId, key]);
  return (
    <p aria-live="polite" className="text-sm text-slate-600">
      Source stock:{' '}
      {!locationId
        ? 'Choose a location'
        : result?.key !== key
          ? 'Loading…'
          : (result.error ?? `${result.quantity} ${row.unit}`)}
      . Stock is checked again when saving.
    </p>
  );
}
export function MovementForm({
  org,
  kind,
  row,
  locations,
  locationId,
}: {
  org: string;
  kind: 'opening' | 'adjustment' | 'transfer';
  row: InventoryStockRow;
  locations: LocationResponse[];
  locationId: string;
}) {
  const [state, action, pending] = useCommand((key, form) => recordMovement(org, kind, key, form));
  const active = locations.filter((location) => location.isActive);
  const [source, setSource] = useState(
    active.some((location) => location.id === locationId) ? locationId : (active[0]?.id ?? ''),
  );
  const label =
    kind === 'opening' ? 'Opening balance' : kind === 'adjustment' ? 'Adjustment' : 'Transfer';
  return (
    <form onSubmit={submitWithoutReset(action)} className="panel space-y-4">
      <h3 className="text-lg font-semibold">{label}</h3>
      {kind === 'opening' && (
        <p className="text-sm text-slate-600">
          Use only for the first movement of this variant at the selected location. Existing history
          requires an adjustment.
        </p>
      )}
      <input type="hidden" name="variantId" value={row.variantId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="field">
          {kind === 'transfer' ? 'From' : 'Location'}
          <select
            name={kind === 'transfer' ? 'sourceLocationId' : 'locationId'}
            required
            value={source}
            onChange={(event) => setSource(event.target.value)}
          >
            <option value="">Choose location</option>
            {active.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </label>
        {kind === 'transfer' && (
          <label className="field">
            To
            <select name="destinationLocationId" required defaultValue="">
              <option value="">Choose destination</option>
              {active.map((location) => (
                <option key={location.id} value={location.id} disabled={location.id === source}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === 'adjustment' && (
          <>
            <label className="field">
              Direction
              <select name="direction">
                {ADJUSTMENT_DIRECTIONS.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className="field">
              Reason
              <select name="reason">
                {ADJUSTMENT_REASONS.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          </>
        )}
        <label className="field">
          Quantity ({row.unit})
          <input
            name="quantity"
            type="text"
            inputMode="decimal"
            required
            maxLength={20}
            pattern="(?=.*[1-9])(0|[1-9][0-9]{0,12})(\.[0-9]{1,6})?"
            placeholder="1.250000"
          />
        </label>
        <label className="field sm:col-span-2">
          Note
          <textarea name="note" maxLength={2000} rows={2} />
        </label>
      </div>
      {kind === 'transfer' && (
        <StockQuote org={org} row={row} locationId={source} revision={state.transactionId} />
      )}
      {!active.length ? (
        <p>Create or activate a Location before recording movements.</p>
      ) : (
        <Feedback
          org={org}
          state={state}
          pending={pending}
          label={`Record ${label.toLowerCase()}`}
        />
      )}
    </form>
  );
}
export function ReversalForm({ org, id }: { org: string; id: string }) {
  const [state, action, pending] = useCommand((key, form) =>
    reverseTransaction(org, id, key, form),
  );
  return (
    <form onSubmit={submitWithoutReset(action)} className="panel space-y-4">
      <h3 className="font-semibold">Reverse transaction</h3>
      <p>
        This creates opposite movements at the original locations. The original transaction remains
        in history.
      </p>
      <label className="field">
        Reason / note
        <textarea name="note" maxLength={2000} />
      </label>
      <label className="flex items-start gap-2">
        <input type="checkbox" name="confirmed" required />I confirm reversing all movements in this
        transaction.
      </label>
      <Feedback org={org} state={state} pending={pending} label="Confirm reversal" />
    </form>
  );
}
export function InventorySettingsForm({
  org,
  allowNegativeStock,
}: {
  org: string;
  allowNegativeStock: boolean;
}) {
  const [state, action, pending] = useActionState(saveInventorySettings.bind(null, org), {});
  return (
    <form action={action} className="panel space-y-4">
      <label className="flex gap-2">
        <input type="checkbox" name="allowNegativeStock" defaultChecked={allowNegativeStock} />
        Allow negative stock
      </label>
      <p className="text-amber-800">
        Enabling this permits adjustments, transfers and reversals to take stock below zero. Resolve
        any negative balances before disabling it.
      </p>
      <Feedback org={org} state={state} pending={pending} label="Save settings" />
    </form>
  );
}
