import { Permission } from '@saas/types';
import { api } from '../../../../../lib/api';
import { OrganizationForm } from '../../forms';

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  const organization = await api.organization(organizationId);
  if (!organization.currentMembership.permissions.includes(Permission.ORGANIZATION_UPDATE))
    return <p role="alert">You do not have permission to edit organization settings.</p>;
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Organization settings</h1>
      <OrganizationForm organization={organization} />
    </section>
  );
}
