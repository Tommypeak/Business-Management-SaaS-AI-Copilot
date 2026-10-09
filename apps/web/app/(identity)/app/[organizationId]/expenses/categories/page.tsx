import Link from 'next/link';
import { Permission } from '@saas/types';
import { api } from '../../../../../../lib/api';
import { expensesApi } from '../../../../../../lib/expenses';
import { Pagination, selectedQuery } from '../../inventory/navigation';
import { CategoryForm } from '../forms';

export default async function ExpenseCategoriesPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId: org } = await params;
  const organization = await api.organization(org);
  const permissions = organization.currentMembership.permissions;
  if (!permissions.includes(Permission.EXPENSES_VIEW))
    return <p>You do not have permission to view expense categories.</p>;
  const query = selectedQuery(await searchParams, ['q', 'isActive', 'cursor']);
  const page = await expensesApi.categories(org, query.toString());
  const base = `/app/${org}/expenses/categories`;
  return (
    <div className="space-y-5">
      <Link className="underline" href={`/app/${org}/expenses`}>
        All expenses
      </Link>
      <h2 className="text-xl font-semibold">Expense categories</h2>
      {permissions.includes(Permission.EXPENSES_MANAGE) && (
        <>
          <h3 className="font-semibold">New category</h3>
          <CategoryForm org={org} />
        </>
      )}
      <form action={base} className="panel flex flex-wrap gap-4">
        <label className="field">
          Search
          <input name="q" defaultValue={query.get('q') ?? ''} maxLength={100} />
        </label>
        <label className="field">
          Status
          <select name="isActive" defaultValue={query.get('isActive') ?? ''}>
            <option value="">All</option>
            <option value="true">Active</option>
            <option value="false">Archived</option>
          </select>
        </label>
        <button className="button">Apply</button>
      </form>
      {page.items.map((category) => (
        <section key={category.id} className="space-y-2">
          <h3 className="font-semibold">
            {category.name}
            {category.isActive ? '' : ' · Archived'}
          </h3>
          {permissions.includes(Permission.EXPENSES_MANAGE) ? (
            <CategoryForm org={org} category={category} />
          ) : (
            <p>{category.description}</p>
          )}
        </section>
      ))}
      <Pagination base={base} query={query} nextCursor={page.nextCursor} />
    </div>
  );
}
