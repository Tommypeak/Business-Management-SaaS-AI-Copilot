import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { Permission } from '@saas/types';
import { api } from '../../../../../lib/api';

export default async function InventoryLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId: org } = await params;
  const organization = await api.organization(org);
  const permissions = organization.currentMembership.permissions;
  if (!permissions.includes(Permission.INVENTORY_VIEW)) notFound();
  const base = `/app/${org}/inventory`;
  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Inventory</h1>
        <p className="mt-1 text-slate-600">Stock across locations for {organization.name}</p>
      </header>
      <nav
        aria-label="Inventory sections"
        className="flex flex-wrap gap-5 border-b border-slate-200 pb-3"
      >
        <Link href={base} className="underline">
          Stock
        </Link>
        <Link href={`${base}/history`} className="underline">
          History
        </Link>
        {(permissions.includes(Permission.INVENTORY_ADJUST) ||
          permissions.includes(Permission.INVENTORY_TRANSFER)) && (
          <Link href={`${base}/operations`} className="underline">
            Record movement
          </Link>
        )}
        {permissions.includes(Permission.INVENTORY_SETTINGS_MANAGE) && (
          <Link href={`${base}/settings`} className="underline">
            Inventory settings
          </Link>
        )}
      </nav>
      {children}
    </section>
  );
}
