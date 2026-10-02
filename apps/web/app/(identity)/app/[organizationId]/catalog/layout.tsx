import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { Permission } from '@saas/types';
import { api } from '../../../../../lib/api';

export default async function CatalogLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  const organization = await api.organization(organizationId);
  if (!organization.currentMembership.permissions.includes(Permission.CATALOG_VIEW)) notFound();
  const base = `/app/${organizationId}/catalog`;
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Catalog</h1>
        <p className="mt-1 text-slate-600">Products and services for {organization.name}</p>
      </div>
      <nav
        aria-label="Catalog sections"
        className="flex flex-wrap gap-5 border-b border-slate-200 pb-3"
      >
        <Link className="underline" href={base}>
          Items
        </Link>
        <Link className="underline" href={`${base}/categories`}>
          Categories
        </Link>
        <Link className="underline" href={`${base}/custom-fields`}>
          Custom fields
        </Link>
      </nav>
      {children}
    </section>
  );
}
