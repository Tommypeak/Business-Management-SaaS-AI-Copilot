'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  startTransition,
  useActionState,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  PAYMENT_METHODS,
  type PurchaseOrderListItem,
  type SupplierBillResponse,
  type SupplierResponse,
} from '@saas/types';
import { saveBillCommand, type BillCommand, type BillFormState } from './actions';

function Command({
  org,
  kind,
  id = null,
  label,
  children,
}: {
  org: string;
  kind: BillCommand;
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
    async (_previous: BillFormState, form: FormData): Promise<BillFormState> => {
      const fingerprint = JSON.stringify([...form.entries()]);
      if (
        !attempt.current ||
        (!attempt.current.uncertain && attempt.current.fingerprint !== fingerprint)
      )
        attempt.current = { key: crypto.randomUUID(), fingerprint, form, uncertain: false };
      try {
        const result = await saveBillCommand(
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
            <Link className="underline" href={`/app/${org}/accounts-payable/${state.id}`}>
              Open bill
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

export function BillForm({
  org,
  suppliers,
  orders,
  bill,
  defaultDate,
  suggestedOrderId,
}: {
  org: string;
  suppliers: SupplierResponse[];
  orders: PurchaseOrderListItem[];
  bill?: SupplierBillResponse;
  defaultDate: string;
  suggestedOrderId?: string;
}) {
  const suggested = orders.find((order) => order.id === suggestedOrderId);
  const [supplierId, setSupplierId] = useState(bill?.supplier.id ?? suggested?.supplier.id ?? '');
  const [amount, setAmount] = useState(bill?.amount ?? suggested?.total ?? '');
  const [purchaseOrderId, setPurchaseOrderId] = useState(
    bill?.purchaseOrder?.id ?? suggestedOrderId ?? '',
  );
  return (
    <Command
      org={org}
      kind={bill ? 'edit' : 'create'}
      id={bill?.id}
      label={bill ? 'Save draft' : 'Create draft'}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="field">
          Supplier
          <select
            name="supplierId"
            required
            value={supplierId}
            onChange={(event) => setSupplierId(event.target.value)}
          >
            <option value="">Choose supplier</option>
            {suppliers
              .filter((supplier) => supplier.isActive || supplier.id === bill?.supplier.id)
              .map((supplier) => (
                <option key={supplier.id} value={supplier.id} disabled={!supplier.isActive}>
                  {supplier.name}
                  {supplier.isActive ? '' : ' (archived)'}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          Purchase Order (optional)
          <select
            name="purchaseOrderId"
            value={purchaseOrderId}
            onChange={(event) => {
              const selected = orders.find((order) => order.id === event.target.value);
              setPurchaseOrderId(event.target.value);
              if (selected) {
                setSupplierId(selected.supplier.id);
                setAmount(selected.total);
              }
            }}
          >
            <option value="">No purchase order</option>
            {orders
              .filter(
                (order) => order.status !== 'CANCELLED' || order.id === bill?.purchaseOrder?.id,
              )
              .map((order) => (
                <option key={order.id} value={order.id}>
                  {order.number} · {order.supplier.name} · {order.total} {order.currencyCode}
                </option>
              ))}
          </select>
          <span className="text-sm">
            Selecting a PO suggests its supplier and total. The bill amount can differ.
          </span>
        </label>
        <label className="field">
          Supplier invoice number
          <input
            name="supplierInvoiceNumber"
            maxLength={120}
            defaultValue={bill?.supplierInvoiceNumber ?? ''}
          />
        </label>
        <label className="field">
          Issue date
          <input
            name="issueDate"
            type="date"
            required
            defaultValue={bill?.issueDate ?? defaultDate}
          />
        </label>
        <label className="field">
          Due date
          <input name="dueDate" type="date" defaultValue={bill?.dueDate ?? ''} />
        </label>
        <label className="field">
          Amount
          <input
            name="amount"
            required
            inputMode="decimal"
            pattern="(0|[1-9][0-9]{0,14})(\.[0-9]{1,4})?"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
      </div>
      <label className="field">
        Description
        <textarea name="description" maxLength={2000} defaultValue={bill?.description ?? ''} />
      </label>
      <label className="field">
        Note
        <textarea name="note" maxLength={2000} defaultValue={bill?.note ?? ''} />
      </label>
    </Command>
  );
}

export function PostBillForm({ org, bill }: { org: string; bill: SupplierBillResponse }) {
  return (
    <Command org={org} kind="post" id={bill.id} label="Post bill">
      <p>
        Posting records a payable obligation. Commercial fields cannot be edited afterward. It does
        not change cash flow.
      </p>
      <label className="flex gap-2">
        <input name="confirmed" type="checkbox" required />I confirm this bill is correct.
      </label>
    </Command>
  );
}

export function VoidBillForm({ org, bill }: { org: string; bill: SupplierBillResponse }) {
  return (
    <Command org={org} kind="void" id={bill.id} label="Void bill">
      <label className="field">
        Reason
        <textarea name="reason" required maxLength={1000} />
      </label>
      <label className="flex gap-2">
        <input name="confirmed" type="checkbox" required />I confirm this unpaid bill must be
        voided.
      </label>
    </Command>
  );
}

export function SupplierPaymentForm({
  org,
  bill,
  defaultDate,
}: {
  org: string;
  bill: SupplierBillResponse;
  defaultDate: string;
}) {
  return (
    <Command org={org} kind="payment" id={bill.id} label="Record supplier payment">
      <p>Payments are immutable after recording. Verify the date and amount.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="field">
          Payment date
          <input name="paymentDate" type="date" required defaultValue={defaultDate} />
        </label>
        <label className="field">
          Amount
          <input
            name="amount"
            required
            inputMode="decimal"
            pattern="(0|[1-9][0-9]{0,14})(\.[0-9]{1,4})?"
            defaultValue={bill.outstandingAmount}
          />
        </label>
        <label className="field">
          Method
          <select name="method" defaultValue="BANK_TRANSFER">
            {PAYMENT_METHODS.map((method) => (
              <option key={method}>{method}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Reference
          <input name="reference" maxLength={200} />
        </label>
      </div>
      <label className="field">
        Note
        <textarea name="note" maxLength={2000} />
      </label>
    </Command>
  );
}
