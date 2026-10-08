import Link from 'next/link';
import { Permission } from '@saas/types';
import { api } from '../../../../../../lib/api';
import { purchasingApi } from '../../../../../../lib/purchasing';
import { Pagination, selectedQuery } from '../../inventory/navigation';
import { SupplierForm } from '../../purchasing/forms';
export default async function SupplierPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string; supplierId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId: org, supplierId } = await params,
    organization = await api.organization(org),
    permissions = organization.currentMembership.permissions;
  if (!permissions.includes(Permission.SUPPLIERS_VIEW))
    return <p>You do not have permission to view suppliers.</p>;
  const supplier = await purchasingApi.supplier(org, supplierId),
    query = selectedQuery(await searchParams, ['cursor']);
  query.set('supplierId', supplierId);
  const orders = permissions.includes(Permission.PURCHASING_VIEW)
    ? await purchasingApi.orders(org, query.toString())
    : null;
  return (
    <div className="space-y-5">
      <Link className="underline" href={`/app/${org}/suppliers`}>
        All suppliers
      </Link>
      <h2 className="text-xl font-semibold">
        {supplier.name}
        {supplier.isActive ? '' : ' (archived)'}
      </h2>
      <div className="panel space-y-2">
        <p>
          {supplier.contactName} · {supplier.email} · {supplier.phone}
        </p>
        <p>Tax ID: {supplier.taxId ?? '—'}</p>
        <p className="whitespace-pre-wrap">{supplier.address}</p>
        <p className="whitespace-pre-wrap">{supplier.notes}</p>
      </div>
      {permissions.includes(Permission.SUPPLIERS_MANAGE) && (
        <SupplierForm org={org} supplier={supplier} />
      )}
      {orders && (
        <>
          <h3 className="font-semibold">Purchase order history</h3>
          <p>
            Orders shown: {orders.items.length} · Open on this page:{' '}
            {
              orders.items.filter(
                (o) => o.status === 'ORDERED' || o.status === 'PARTIALLY_RECEIVED',
              ).length
            }
          </p>
          <table className="catalog-table">
            <thead>
              <tr>
                {['PO', 'Status', 'Total', 'Created'].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.items.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link className="underline" href={`/app/${org}/purchasing/${o.id}`}>
                      {o.number}
                    </Link>
                  </td>
                  <td>{o.status}</td>
                  <td>
                    {o.total} {o.currencyCode}
                  </td>
                  <td>{o.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination
            base={`/app/${org}/suppliers/${supplierId}`}
            query={query}
            nextCursor={orders.nextCursor}
          />
        </>
      )}
    </div>
  );
}
