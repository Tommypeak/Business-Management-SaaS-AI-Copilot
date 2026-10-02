import Link from 'next/link';
import { CUSTOMER_TYPES, Permission } from '@saas/types';
import { api } from '../../../../../lib/api';
import { salesApi } from '../../../../../lib/sales';
import { Pagination, selectedQuery } from '../inventory/navigation';
import { CustomerForm } from '../sales/forms';
export default async function CustomersPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId: org } = await params,
    organization = await api.organization(org),
    permissions = organization.currentMembership.permissions;
  if (!permissions.includes(Permission.CUSTOMERS_VIEW))
    return <p>You do not have permission to view customers.</p>;
  const query = selectedQuery(await searchParams, ['q', 'type', 'isActive', 'cursor']);
  if (!query.has('isActive')) query.set('isActive', 'true');
  const page = await salesApi.customers(org, query.toString()),
    base = `/app/${org}/customers`;
  return (
    <div className="space-y-5">
      <h2 className="text-xl font-semibold">Customers</h2>
      <form action={base} className="panel flex flex-wrap items-end gap-4">
        <label className="field">
          Search
          <input
            name="q"
            maxLength={100}
            defaultValue={query.get('q') ?? ''}
            placeholder="Name, email or phone"
          />
        </label>
        <label className="field">
          Type
          <select name="type" defaultValue={query.get('type') ?? ''}>
            <option value="">All</option>
            {CUSTOMER_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="field">
          State
          <select name="isActive" defaultValue={query.get('isActive') ?? 'true'}>
            <option value="true">Active</option>
            <option value="false">Archived</option>
          </select>
        </label>
        <button className="button">Search</button>
      </form>
      <table className="catalog-table">
        <thead>
          <tr>
            {['Name', 'Type', 'Email', 'Phone', 'State'].map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {page.items.map((c) => (
            <tr key={c.id}>
              <td>
                <Link href={`${base}/${c.id}`} className="underline">
                  {c.name}
                </Link>
              </td>
              <td>{c.type}</td>
              <td>{c.email ?? '—'}</td>
              <td>{c.phone ?? '—'}</td>
              <td>{c.isActive ? 'Active' : 'Archived'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pagination base={base} query={query} nextCursor={page.nextCursor} />
      {permissions.includes(Permission.CUSTOMERS_MANAGE) && (
        <>
          <h3 className="font-semibold">New customer</h3>
          <CustomerForm org={org} />
        </>
      )}
    </div>
  );
}
