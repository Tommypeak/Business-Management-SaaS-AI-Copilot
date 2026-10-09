import Link from 'next/link';
import { Permission, SUPPLIER_BILL_PAYMENT_STATUSES, SUPPLIER_BILL_STATUSES } from '@saas/types';
import { api } from '../../../../../lib/api';
import { accountsPayableApi } from '../../../../../lib/accounts-payable';
import { purchasingApi } from '../../../../../lib/purchasing';
import { Pagination, selectedQuery } from '../inventory/navigation';

export default async function AccountsPayablePage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId: org } = await params;
  const organization = await api.organization(org);
  const permissions = organization.currentMembership.permissions;
  if (!permissions.includes(Permission.ACCOUNTS_PAYABLE_VIEW))
    return <p>You do not have permission to view Accounts Payable.</p>;
  const query = selectedQuery(await searchParams, [
    'q',
    'status',
    'paymentStatus',
    'supplierId',
    'purchaseOrderId',
    'overdue',
    'issueDateFrom',
    'issueDateTo',
    'dueDateFrom',
    'dueDateTo',
    'cursor',
  ]);
  const [bills, summary, suppliers] = await Promise.all([
    accountsPayableApi.bills(org, query.toString()),
    accountsPayableApi.summary(org),
    permissions.includes(Permission.SUPPLIERS_VIEW)
      ? purchasingApi.suppliers(org, 'limit=100').then((page) => page.items)
      : Promise.resolve([]),
  ]);
  const base = `/app/${org}/accounts-payable`;
  return (
    <div className="space-y-5">
      <h2 className="text-xl font-semibold">Accounts Payable</h2>
      <p>Supplier bills record obligations. Only supplier payments change cash flow.</p>
      {permissions.includes(Permission.ACCOUNTS_PAYABLE_MANAGE) && (
        <Link className="button" href={`${base}/new`}>
          New bill
        </Link>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(
          [
            ['Total Outstanding', `${summary.totalOutstanding} ${summary.currencyCode}`],
            ['Overdue Outstanding', `${summary.overdueOutstanding} ${summary.currencyCode}`],
            ['Unpaid Bills', String(summary.unpaidBillsCount)],
            ['Partially Paid Bills', String(summary.partiallyPaidBillsCount)],
            ['Overdue Bills', String(summary.overdueBillsCount)],
          ] as const
        ).map(([label, value]) => (
          <div className="panel" key={label}>
            <p>{label}</p>
            <p className="text-xl font-semibold">{value}</p>
          </div>
        ))}
      </div>
      <p>
        Overdue is measured against {summary.asOf} in {summary.timezone}.
      </p>
      <form action={base} className="panel grid gap-4 sm:grid-cols-3">
        <label className="field">
          Search
          <input
            name="q"
            maxLength={100}
            defaultValue={query.get('q') ?? ''}
            placeholder="Bill, invoice or supplier"
          />
        </label>
        <label className="field">
          Bill status
          <select name="status" defaultValue={query.get('status') ?? ''}>
            <option value="">All</option>
            {SUPPLIER_BILL_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Payment status
          <select name="paymentStatus" defaultValue={query.get('paymentStatus') ?? ''}>
            <option value="">All</option>
            {SUPPLIER_BILL_PAYMENT_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Supplier
          <select name="supplierId" defaultValue={query.get('supplierId') ?? ''}>
            <option value="">All</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Purchase Order ID
          <input
            name="purchaseOrderId"
            defaultValue={query.get('purchaseOrderId') ?? ''}
            placeholder="UUID"
          />
        </label>
        <label className="field">
          Overdue
          <select name="overdue" defaultValue={query.get('overdue') ?? ''}>
            <option value="">All</option>
            <option value="true">Overdue</option>
            <option value="false">Not overdue</option>
          </select>
        </label>
        <label className="field">
          Issue from
          <input name="issueDateFrom" type="date" defaultValue={query.get('issueDateFrom') ?? ''} />
        </label>
        <label className="field">
          Issue to
          <input name="issueDateTo" type="date" defaultValue={query.get('issueDateTo') ?? ''} />
        </label>
        <label className="field">
          Due from
          <input name="dueDateFrom" type="date" defaultValue={query.get('dueDateFrom') ?? ''} />
        </label>
        <label className="field">
          Due to
          <input name="dueDateTo" type="date" defaultValue={query.get('dueDateTo') ?? ''} />
        </label>
        <button className="button">Apply filters</button>
      </form>
      <table className="catalog-table">
        <thead>
          <tr>
            {[
              'Bill',
              'Supplier',
              'Invoice #',
              'Issue',
              'Due',
              'Amount',
              'Paid',
              'Outstanding',
              'Payment',
              'Overdue',
              'Status',
            ].map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bills.items.map((bill) => (
            <tr key={bill.id}>
              <td>
                <Link className="underline" href={`${base}/${bill.id}`}>
                  {bill.number}
                </Link>
              </td>
              <td>{bill.supplier.name}</td>
              <td>{bill.supplierInvoiceNumber ?? '—'}</td>
              <td>{bill.issueDate}</td>
              <td>{bill.dueDate ?? '—'}</td>
              <td>
                {bill.amount} {bill.currencyCode}
              </td>
              <td>{bill.paidAmount}</td>
              <td>{bill.outstandingAmount}</td>
              <td>{bill.paymentStatus}</td>
              <td>{bill.isOverdue ? 'Overdue' : '—'}</td>
              <td>{bill.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pagination base={base} query={query} nextCursor={bills.nextCursor} />
    </div>
  );
}
