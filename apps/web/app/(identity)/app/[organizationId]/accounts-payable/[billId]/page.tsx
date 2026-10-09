import Link from 'next/link';
import { Permission, type PurchaseOrderListItem, type SupplierResponse } from '@saas/types';
import { api, list } from '../../../../../../lib/api';
import { accountsPayableApi } from '../../../../../../lib/accounts-payable';
import { purchasingRoot } from '../../../../../../lib/purchasing';
import { BillForm, PostBillForm, SupplierPaymentForm, VoidBillForm } from '../forms';

export default async function SupplierBillPage({
  params,
}: {
  params: Promise<{ organizationId: string; billId: string }>;
}) {
  const { organizationId: org, billId } = await params;
  const organization = await api.organization(org);
  const permissions = organization.currentMembership.permissions;
  if (!permissions.includes(Permission.ACCOUNTS_PAYABLE_VIEW))
    return <p>You do not have permission to view Supplier Bills.</p>;
  const bill = await accountsPayableApi.bill(org, billId);
  const canManage = permissions.includes(Permission.ACCOUNTS_PAYABLE_MANAGE);
  const canPay = permissions.includes(Permission.ACCOUNTS_PAYABLE_PAYMENTS_MANAGE);
  const [suppliers, orders] =
    bill.status === 'DRAFT' && canManage
      ? await Promise.all([
          permissions.includes(Permission.SUPPLIERS_VIEW)
            ? list<SupplierResponse>(`${purchasingRoot(org)}/suppliers`)
            : Promise.resolve([]),
          permissions.includes(Permission.PURCHASING_VIEW)
            ? list<PurchaseOrderListItem>(`${purchasingRoot(org)}/purchasing/orders`)
            : Promise.resolve([]),
        ])
      : [[], []];
  const today = Object.fromEntries(
    new Intl.DateTimeFormat('en', {
      timeZone: organization.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(new Date())
      .map((part) => [part.type, part.value]),
  );
  const defaultDate = `${today.year}-${today.month}-${today.day}`;
  return (
    <div className="space-y-5">
      <Link className="underline" href={`/app/${org}/accounts-payable`}>
        All bills
      </Link>
      <h2 className="text-xl font-semibold">
        {bill.number} · {bill.status}
      </h2>
      <div className="panel space-y-2">
        <p>
          Supplier: {bill.supplier.name}
          {bill.supplier.isActive ? '' : ' (archived)'}
        </p>
        <p>
          Purchase Order:{' '}
          {bill.purchaseOrder ? (
            <Link className="underline" href={`/app/${org}/purchasing/${bill.purchaseOrder.id}`}>
              {bill.purchaseOrder.number}
            </Link>
          ) : (
            '—'
          )}
        </p>
        <p>Supplier invoice #: {bill.supplierInvoiceNumber ?? '—'}</p>
        <p>
          Issue date: {bill.issueDate} · Due date: {bill.dueDate ?? '—'}
        </p>
        <p className="font-semibold">
          Amount: {bill.amount} {bill.currencyCode}
        </p>
        <p>
          Paid: {bill.paidAmount} · Outstanding: {bill.outstandingAmount} · {bill.paymentStatus}
        </p>
        {bill.isOverdue && <p className="font-semibold text-red-700">Overdue</p>}
        <p className="whitespace-pre-wrap">Description: {bill.description ?? '—'}</p>
        <p className="whitespace-pre-wrap">Note: {bill.note ?? '—'}</p>
        <p>
          Created: {bill.createdAt} · User {bill.createdBy.id}
        </p>
        {bill.postedAt && <p>Posted: {bill.postedAt}</p>}
        {bill.status === 'VOIDED' && (
          <div className="border-t pt-2">
            <p className="font-semibold">Voided</p>
            <p>Reason: {bill.voidReason}</p>
            <p>
              {bill.voidedAt} · User {bill.voidedBy?.id}
            </p>
          </div>
        )}
      </div>
      {bill.status === 'DRAFT' && canManage && (
        <>
          <h3 className="font-semibold">Edit draft</h3>
          <BillForm
            org={org}
            bill={bill}
            suppliers={suppliers}
            orders={orders}
            defaultDate={defaultDate}
          />
          <h3 className="font-semibold">Post bill</h3>
          <PostBillForm org={org} bill={bill} />
        </>
      )}
      {bill.status === 'POSTED' && canPay && bill.outstandingAmount !== '0.0000' && (
        <>
          <h3 className="font-semibold">Add Supplier Payment</h3>
          <SupplierPaymentForm org={org} bill={bill} defaultDate={defaultDate} />
        </>
      )}
      {bill.status === 'POSTED' && canManage && bill.paidAmount === '0.0000' && (
        <>
          <h3 className="font-semibold">Void unpaid bill</h3>
          <VoidBillForm org={org} bill={bill} />
        </>
      )}
      {bill.status === 'POSTED' && bill.paidAmount !== '0.0000' && (
        <p>
          Void is unavailable because payments are recorded. Refunds and reversals are separate
          future flows.
        </p>
      )}
      <h3 className="font-semibold">Supplier Payments</h3>
      <table className="catalog-table">
        <thead>
          <tr>
            {['Date', 'Amount', 'Method', 'Reference', 'Note', 'Recorded'].map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bill.payments.map((payment) => (
            <tr key={payment.id}>
              <td>{payment.paymentDate}</td>
              <td>
                {payment.amount} {bill.currencyCode}
              </td>
              <td>{payment.method}</td>
              <td>{payment.reference ?? '—'}</td>
              <td>{payment.note ?? '—'}</td>
              <td>{payment.createdAt}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
