'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { startTransition, useActionState, useRef, type FormEvent, type ReactNode } from 'react';
import {
  PAYMENT_METHODS,
  type ExpenseCategoryResponse,
  type ExpenseResponse,
  type LocationResponse,
} from '@saas/types';
import { saveExpenseCommand, type ExpenseCommand, type ExpenseFormState } from './actions';

function Command({
  org,
  kind,
  id = null,
  label,
  children,
}: {
  org: string;
  kind: ExpenseCommand;
  id?: string | null;
  label: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const attempt = useRef<{
    key: string;
    fingerprint: string;
    form: FormData;
    uncertain: boolean;
  } | null>(null);
  const [state, action, pending] = useActionState(
    async (_previous: ExpenseFormState, form: FormData): Promise<ExpenseFormState> => {
      const fingerprint = JSON.stringify([...form.entries()]);
      if (
        !attempt.current ||
        (!attempt.current.uncertain && attempt.current.fingerprint !== fingerprint)
      )
        attempt.current = { key: crypto.randomUUID(), fingerprint, form, uncertain: false };
      try {
        const result = await saveExpenseCommand(
          org,
          kind,
          id,
          attempt.current.key,
          attempt.current.form,
        );
        attempt.current.uncertain = !!result.uncertain;
        if (result.success) {
          attempt.current = null;
          router.refresh();
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
          {kind === 'create' && state.id && (
            <Link className="underline" href={`/app/${org}/expenses/${state.id}`}>
              Open expense
            </Link>
          )}
        </p>
      )}
      <button className="button" disabled={pending || (!!state.success && kind === 'create')}>
        {pending ? 'Saving…' : state.uncertain ? 'Retry original request' : label}
      </button>
    </form>
  );
}

export function CategoryForm({
  org,
  category,
}: {
  org: string;
  category?: ExpenseCategoryResponse;
}) {
  return (
    <Command
      org={org}
      kind={category ? 'category-edit' : 'category-create'}
      id={category?.id}
      label={category ? 'Save category' : 'Create category'}
    >
      <label className="field">
        Name
        <input name="name" required maxLength={120} defaultValue={category?.name ?? ''} />
      </label>
      <label className="field">
        Description
        <textarea name="description" maxLength={500} defaultValue={category?.description ?? ''} />
      </label>
      {category && (
        <label className="flex gap-2">
          <input name="isActive" type="checkbox" defaultChecked={category.isActive} />
          Active (uncheck to archive)
        </label>
      )}
    </Command>
  );
}

export function ExpenseForm({
  org,
  categories,
  locations,
  expense,
  defaultDate,
}: {
  org: string;
  categories: ExpenseCategoryResponse[];
  locations: LocationResponse[];
  expense?: ExpenseResponse;
  defaultDate?: string;
}) {
  const activeCategories = categories.filter(
    (row) => row.isActive || row.id === expense?.category.id,
  );
  return (
    <Command
      org={org}
      kind={expense ? 'edit' : 'create'}
      id={expense?.id}
      label={expense ? 'Save draft' : 'Create draft'}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="field">
          Expense date
          <input
            name="expenseDate"
            type="date"
            required
            defaultValue={expense?.expenseDate ?? defaultDate}
          />
        </label>
        <label className="field">
          Category
          <select name="categoryId" required defaultValue={expense?.category.id ?? ''}>
            <option value="">Choose category</option>
            {activeCategories.map((row) => (
              <option key={row.id} value={row.id} disabled={!row.isActive}>
                {row.name}
                {row.isActive ? '' : ' (archived)'}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Location (optional)
          <select name="locationId" defaultValue={expense?.location?.id ?? ''}>
            <option value="">Company-wide</option>
            {locations
              .filter((row) => row.isActive || row.id === expense?.location?.id)
              .map((row) => (
                <option key={row.id} value={row.id} disabled={!row.isActive}>
                  {row.name}
                  {row.isActive ? '' : ' (inactive)'}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          Amount
          <input
            name="amount"
            required
            inputMode="decimal"
            pattern="(0|[1-9][0-9]{0,14})(\.[0-9]{1,4})?"
            defaultValue={expense?.amount ?? ''}
          />
        </label>
        <label className="field">
          Payment method
          <select name="paymentMethod" defaultValue={expense?.paymentMethod ?? 'CASH'}>
            {PAYMENT_METHODS.map((method) => (
              <option key={method}>{method}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Payee (optional)
          <input name="payeeName" maxLength={200} defaultValue={expense?.payeeName ?? ''} />
        </label>
      </div>
      <label className="field">
        Description
        <textarea name="description" maxLength={2000} defaultValue={expense?.description ?? ''} />
      </label>
      <label className="field">
        Note
        <textarea name="note" maxLength={2000} defaultValue={expense?.note ?? ''} />
      </label>
    </Command>
  );
}

export function PostExpenseForm({ org, expense }: { org: string; expense: ExpenseResponse }) {
  return (
    <Command org={org} kind="post" id={expense.id} label="Post expense">
      <p>
        After posting, financial fields cannot be edited. Incorrect expenses must be voided and
        recreated.
      </p>
      <label className="flex gap-2">
        <input name="confirmed" type="checkbox" required />I confirm this expense is correct.
      </label>
    </Command>
  );
}

export function VoidExpenseForm({ org, expense }: { org: string; expense: ExpenseResponse }) {
  return (
    <Command org={org} kind="void" id={expense.id} label="Void expense">
      <label className="field">
        Reason
        <textarea name="reason" required maxLength={1000} />
      </label>
      <label className="flex gap-2">
        <input name="confirmed" type="checkbox" required />I confirm this posted expense must be
        voided.
      </label>
    </Command>
  );
}
