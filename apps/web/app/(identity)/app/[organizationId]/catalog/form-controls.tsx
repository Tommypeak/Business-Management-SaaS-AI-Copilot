'use client';
import type { FormState } from '../../actions';
import { UNITS, type CatalogVariantResponse } from '@saas/types';

export function Feedback({
  state,
  pending,
  label = 'Save',
}: {
  state: FormState;
  pending: boolean;
  label?: string;
}) {
  return (
    <div className="space-y-3">
      <div aria-live="polite">
        {state.error && (
          <p role="alert" className="text-red-700">
            {state.error}
          </p>
        )}
        {state.success && <p className="text-green-800">{state.success}</p>}
      </div>
      <button className="button" disabled={pending}>
        {pending ? 'Saving…' : label}
      </button>
    </div>
  );
}
export function Active({
  name = 'isActive',
  active = true,
  disabled = false,
}: {
  name?: string;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" name={name} defaultChecked={active} disabled={disabled} />
      {disabled && <input type="hidden" name={name} value="on" />}Active
    </label>
  );
}
export function PricingFields({
  variant,
  currency,
}: {
  variant?: CatalogVariantResponse;
  currency: string;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="field">
        Variant name
        <input
          name="variantName"
          maxLength={120}
          defaultValue={variant?.name ?? ''}
          placeholder="Default"
        />
      </label>
      <label className="field">
        Unit
        <select name="unit" defaultValue={variant?.unit ?? 'PIECE'}>
          {UNITS.map((unit) => (
            <option key={unit}>{unit}</option>
          ))}
        </select>
      </label>
      <label className="field">
        SKU
        <input name="sku" maxLength={80} defaultValue={variant?.sku ?? ''} placeholder="Optional" />
        <span className="text-xs font-normal text-slate-500">
          Letters, digits, dot, dash, underscore or slash.
        </span>
      </label>
      <label className="field">
        Barcode
        <input
          name="barcode"
          maxLength={120}
          defaultValue={variant?.barcode ?? ''}
          placeholder="Optional; leading zeros preserved"
        />
      </label>
      <label className="field">
        Selling price ({currency})
        <input
          name="sellingPrice"
          inputMode="decimal"
          required
          maxLength={20}
          pattern="(0|[1-9][0-9]{0,14})(\.[0-9]{1,4})?"
          defaultValue={variant?.sellingPrice ?? '0.0000'}
        />
      </label>
      <label className="field">
        Cost price ({currency})
        <input
          name="costPrice"
          inputMode="decimal"
          maxLength={20}
          pattern="(0|[1-9][0-9]{0,14})(\.[0-9]{1,4})?"
          defaultValue={variant?.costPrice ?? ''}
          placeholder="Optional"
        />
      </label>
    </div>
  );
}
