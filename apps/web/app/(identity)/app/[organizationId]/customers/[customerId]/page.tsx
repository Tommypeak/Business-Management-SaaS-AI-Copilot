import Link from 'next/link';
import { Permission } from '@saas/types';
import { api } from '../../../../../../lib/api';
import { salesApi } from '../../../../../../lib/sales';
import { Pagination, selectedQuery } from '../../inventory/navigation';
import { CustomerForm } from '../../sales/forms';
import { SalesTable } from '../../sales/table';
export default async function CustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string; customerId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId: org, customerId } = await params,
    organization = await api.organization(org),
    permissions = organization.currentMembership.permissions;
  if (!permissions.includes(Permission.CUSTOMERS_VIEW))
    return <p>You do not have permission to view customers.</p>;
  const customer = await salesApi.customer(org, customerId),
    query = selectedQuery(await searchParams, ['cursor']);
  query.set('customerId', customerId);
  const page = permissions.includes(Permission.SALES_VIEW)
    ? await salesApi.orders(org, query.toString())
    : null;
  return (
    <div className="space-y-5">
      <Link className="underline" href={`/app/${org}/customers`}>
        All customers
      </Link>
      <h2 className="text-xl font-semibold">
        {customer.name}
        {customer.isActive ? '' : ' (archived)'}
      </h2>
      <p>
        {customer.type} · {customer.email} · {customer.phone}
      </p>
      <p className="whitespace-pre-wrap">{customer.notes}</p>
      {permissions.includes(Permission.CUSTOMERS_MANAGE) && (
        <CustomerForm org={org} customer={customer} />
      )}
      {page && (
        <>
          <h3 className="font-semibold">Sales history</h3>
          <p>Amounts retain each order’s currency.</p>
          <SalesTable org={org} orders={page.items} />
          <Pagination
            base={`/app/${org}/customers/${customerId}`}
            query={query}
            nextCursor={page.nextCursor}
          />
        </>
      )}
    </div>
  );
}
