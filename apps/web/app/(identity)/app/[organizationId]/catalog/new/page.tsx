import { Permission } from '@saas/types';
import { api } from '../../../../../../lib/api';
import { catalogApi } from '../../../../../../lib/catalog';
import { ItemForm } from '../item-form';

export default async function NewItemPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId: org } = await params;
  const organization = await api.organization(org);
  if (!organization.currentMembership.permissions.includes(Permission.CATALOG_MANAGE))
    return <p>You do not have permission to create catalog items.</p>;
  const [categories, fields] = await Promise.all([
    catalogApi.categories(org),
    catalogApi.fields(org),
  ]);
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Create catalog item</h2>
      <ItemForm
        org={org}
        currency={organization.defaultCurrency}
        categories={categories}
        fields={fields}
      />
    </div>
  );
}
