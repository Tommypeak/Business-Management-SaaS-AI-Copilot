import { Permission } from '@saas/types';
import { api } from '../../../../../../lib/api';
import { PurchaseForm } from '../forms';
export default async function NewPurchasePage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId: org } = await params,
    organization = await api.organization(org),
    permissions = organization.currentMembership.permissions;
  if (!permissions.includes(Permission.PURCHASING_CREATE))
    return <p>You do not have permission to create purchases.</p>;
  const locations = permissions.includes(Permission.LOCATIONS_VIEW) ? await api.locations(org) : [];
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">New purchase</h2>
      <PurchaseForm org={org} locations={locations} />
    </div>
  );
}
