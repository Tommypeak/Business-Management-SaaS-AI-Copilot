import Link from 'next/link';
import { Permission } from '@saas/types';
import { api } from '../../../../../../lib/api';
import { expensesApi } from '../../../../../../lib/expenses';
import { ExpenseForm, PostExpenseForm, VoidExpenseForm } from '../forms';

export default async function ExpenseDetailPage({
  params,
}: {
  params: Promise<{ organizationId: string; expenseId: string }>;
}) {
  const { organizationId: org, expenseId } = await params;
  const organization = await api.organization(org);
  const permissions = organization.currentMembership.permissions;
  if (!permissions.includes(Permission.EXPENSES_VIEW))
    return <p>You do not have permission to view expenses.</p>;
  const expense = await expensesApi.expense(org, expenseId);
  const canManage = permissions.includes(Permission.EXPENSES_MANAGE);
  const [categories, locations] =
    expense.status === 'DRAFT' && canManage
      ? await Promise.all([
          expensesApi.allCategories(org),
          permissions.includes(Permission.LOCATIONS_VIEW)
            ? api.locations(org)
            : Promise.resolve([]),
        ])
      : [[], []];
  return (
    <div className="space-y-5">
      <Link className="underline" href={`/app/${org}/expenses`}>
        All expenses
      </Link>
      <h2 className="text-xl font-semibold">
        {expense.number} · {expense.status}
      </h2>
      <div className="panel space-y-2">
        <p>Date: {expense.expenseDate}</p>
        <p>
          Category: {expense.category.name}
          {expense.category.isActive ? '' : ' (archived)'}
        </p>
        <p>Location: {expense.location?.name ?? 'Company-wide'}</p>
        <p>Payee: {expense.payeeName ?? '—'}</p>
        <p>Payment method: {expense.paymentMethod}</p>
        <p className="font-semibold">
          Amount: {expense.amount} {expense.currencyCode}
        </p>
        <p className="whitespace-pre-wrap">Description: {expense.description ?? '—'}</p>
        <p className="whitespace-pre-wrap">Note: {expense.note ?? '—'}</p>
        <p>
          Created: {expense.createdAt} · User {expense.createdBy.id}
        </p>
        {expense.postedAt && <p>Posted: {expense.postedAt}</p>}
        {expense.status === 'VOIDED' && (
          <div className="space-y-1 border-t pt-2">
            <p className="font-semibold">Voided</p>
            <p>Reason: {expense.voidReason}</p>
            <p>
              Voided: {expense.voidedAt} · User {expense.voidedBy?.id}
            </p>
          </div>
        )}
      </div>
      {expense.status === 'DRAFT' && canManage && (
        <>
          <h3 className="font-semibold">Edit draft</h3>
          <ExpenseForm org={org} expense={expense} categories={categories} locations={locations} />
          <h3 className="font-semibold">Post expense</h3>
          <PostExpenseForm org={org} expense={expense} />
        </>
      )}
      {expense.status === 'POSTED' && canManage && (
        <>
          <h3 className="font-semibold">Void incorrect expense</h3>
          <VoidExpenseForm org={org} expense={expense} />
        </>
      )}
    </div>
  );
}
