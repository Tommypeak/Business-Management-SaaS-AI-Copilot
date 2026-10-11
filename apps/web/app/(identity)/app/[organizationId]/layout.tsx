import type { ReactNode } from 'react';
import { api } from '../../../../lib/api';
import { OrganizationNavigation } from '../../../../components/organization-navigation';
export default async function OrganizationLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  const [organization, organizations] = await Promise.all([
    api.organizationContext(organizationId),
    api.organizations(),
  ]);
  return (
    <div className="organization-shell">
      <OrganizationNavigation
        org={organizationId}
        organizations={organizations}
        permissions={organization.permissions}
      />
      <main className="organization-content" id="main-content">
        {children}
      </main>
    </div>
  );
}
