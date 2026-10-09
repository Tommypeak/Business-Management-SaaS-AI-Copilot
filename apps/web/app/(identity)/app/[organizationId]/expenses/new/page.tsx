import Link from 'next/link';
import { Permission } from '@saas/types';
import { api } from '../../../../../../lib/api';
import { expensesApi } from '../../../../../../lib/expenses';
import { ExpenseForm } from '../forms';

export default async function NewExpensePage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId: org } = await params;
  const organization = await api.organization(org);
  const permissions = organization.currentMembership.permissions;
  if (!permissions.includes(Permission.EXPENSES_MANAGE))
    return <p>You do not have permission to create expenses.</p>;
  const [categories, locations] = await Promise.all([
    expensesApi.allCategories(org),
    permissions.includes(Permission.LOCATIONS_VIEW) ? api.locations(org) : Promise.resolve([]),
  ]);
  const localDate = Object.fromEntries(
    new Intl.DateTimeFormat('en', {
      timeZone: organization.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(new Date())
      .map((part) => [part.type, part.value]),
  );
  const defaultDate = `${localDate.year}-${localDate.month}-${localDate.day}`;
  return (
    <div className="space-y-4">
      <Link className="underline" href={`/app/${org}/expenses`}>
        All expenses
      </Link>
      <h2 className="text-xl font-semibold">New expense</h2>
      <p>Save a draft, review its details, then post it to include it in Finance.</p>
      {categories.some((row) => row.isActive) ? (
        <ExpenseForm
          org={org}
          categories={categories}
          locations={locations}
          defaultDate={defaultDate}
        />
      ) : (
        <p>
          Create an active{' '}
          <Link className="underline" href={`/app/${org}/expenses/categories`}>
            expense category
          </Link>{' '}
          first.
        </p>
      )}
    </div>
  );
}
