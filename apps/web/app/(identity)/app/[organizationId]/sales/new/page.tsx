import { Permission } from '@saas/types';
import { api } from '../../../../../../lib/api';
import { OrderMetadataForm } from '../forms';
export default async function NewSalePage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId: org } = await params,
    organization = await api.organization(org);
  if (!organization.currentMembership.permissions.includes(Permission.SALES_CREATE))
    return <p>You do not have permission to create sales.</p>;
  const locations = organization.currentMembership.permissions.includes(Permission.LOCATIONS_VIEW)
    ? await api.locations(org)
    : [];
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">New sale</h2>
      <OrderMetadataForm org={org} locations={locations} />
    </div>
  );
}
