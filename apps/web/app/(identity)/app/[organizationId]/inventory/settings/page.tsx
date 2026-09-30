import { notFound } from 'next/navigation';
import { Permission } from '@saas/types';
import { api } from '../../../../../../lib/api';
import { inventoryApi } from '../../../../../../lib/inventory';
import { InventorySettingsForm } from '../forms';
export default async function SettingsPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId: org } = await params;
  const organization = await api.organization(org);
  if (!organization.currentMembership.permissions.includes(Permission.INVENTORY_SETTINGS_MANAGE))
    notFound();
  const settings = await inventoryApi.settings(org);
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Inventory settings</h2>
      <InventorySettingsForm org={org} allowNegativeStock={settings.allowNegativeStock} />
    </div>
  );
}
