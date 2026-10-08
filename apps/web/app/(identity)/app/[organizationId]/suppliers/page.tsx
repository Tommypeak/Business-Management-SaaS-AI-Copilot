import Link from 'next/link';
import { Permission } from '@saas/types';
import { api } from '../../../../../lib/api';
import { purchasingApi } from '../../../../../lib/purchasing';
import { Pagination, selectedQuery } from '../inventory/navigation';
import { SupplierForm } from '../purchasing/forms';
export default async function SuppliersPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId: org } = await params,
    organization = await api.organization(org),
    permissions = organization.currentMembership.permissions;
  if (!permissions.includes(Permission.SUPPLIERS_VIEW))
    return <p>You do not have permission to view suppliers.</p>;
  const query = selectedQuery(await searchParams, ['q', 'isActive', 'cursor']);
  if (!query.has('isActive')) query.set('isActive', 'true');
  const page = await purchasingApi.suppliers(org, query.toString()),
    base = `/app/${org}/suppliers`;
  return (
    <div className="space-y-5">
      <h2 className="text-xl font-semibold">Suppliers</h2>
      <form action={base} className="panel flex flex-wrap items-end gap-4">
        <label className="field">
          Search
          <input
            name="q"
            maxLength={100}
            defaultValue={query.get('q') ?? ''}
            placeholder="Name, contact, email, phone or tax ID"
          />
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
            {['Name', 'Contact', 'Email', 'Phone', 'State'].map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {page.items.map((s) => (
            <tr key={s.id}>
              <td>
                <Link className="underline" href={`${base}/${s.id}`}>
                  {s.name}
                </Link>
              </td>
              <td>{s.contactName ?? '—'}</td>
              <td>{s.email ?? '—'}</td>
              <td>{s.phone ?? '—'}</td>
              <td>{s.isActive ? 'Active' : 'Archived'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pagination base={base} query={query} nextCursor={page.nextCursor} />
      {permissions.includes(Permission.SUPPLIERS_MANAGE) && (
        <>
          <h3 className="font-semibold">New supplier</h3>
          <SupplierForm org={org} />
        </>
      )}
    </div>
  );
}
