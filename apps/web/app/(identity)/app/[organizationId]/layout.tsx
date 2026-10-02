import Link from 'next/link';
import type { ReactNode } from 'react';
import { Permission } from '@saas/types';
import { api } from '../../../../lib/api';

export default async function OrganizationLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  const [organization, organizations] = await Promise.all([
    api.organization(organizationId),
    api.organizations(),
  ]);
  const permissions = organization.currentMembership.permissions;
  return (
    <div className="space-y-6">
      <nav aria-label="Organization switcher" className="flex flex-wrap items-center gap-3">
        <span className="font-medium">Organization:</span>
        {organizations.map((item) => (
          <Link
            key={item.id}
            href={`/app/${item.id}`}
            aria-current={item.id === organizationId ? 'page' : undefined}
            className={item.id === organizationId ? 'font-semibold underline' : 'underline'}
          >
            {item.name}
          </Link>
        ))}
      </nav>
      <nav aria-label="Organization pages" className="flex gap-4">
        <Link href={`/app/${organizationId}`}>Overview</Link>
        {permissions.includes(Permission.SALES_VIEW) && (
          <Link href={`/app/${organizationId}/sales`}>Sales</Link>
        )}
        {permissions.includes(Permission.CUSTOMERS_VIEW) && (
          <Link href={`/app/${organizationId}/customers`}>Customers</Link>
        )}
        {permissions.includes(Permission.CATALOG_VIEW) && (
          <Link href={`/app/${organizationId}/catalog`}>Catalog</Link>
        )}
        {permissions.includes(Permission.INVENTORY_VIEW) && (
          <Link href={`/app/${organizationId}/inventory`}>Inventory</Link>
        )}
        {permissions.includes(Permission.ORGANIZATION_UPDATE) && (
          <Link href={`/app/${organizationId}/settings`}>Settings</Link>
        )}
        {permissions.includes(Permission.LOCATIONS_VIEW) && (
          <Link href={`/app/${organizationId}/locations`}>Locations</Link>
        )}
      </nav>
      {children}
    </div>
  );
}
