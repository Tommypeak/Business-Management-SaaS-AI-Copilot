import { Permission } from '@saas/types';
import { api } from '../../../../../../lib/api';
import { catalogApi } from '../../../../../../lib/catalog';
import { CategoryForm } from '../management-forms';
import { categoryLabel } from '../presentation';

export default async function CategoriesPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId: org } = await params;
  const [organization, categories] = await Promise.all([
    api.organization(org),
    catalogApi.categories(org),
  ]);
  const manage = organization.currentMembership.permissions.includes(Permission.CATALOG_MANAGE);
  const sorted = [...categories].sort((a, b) =>
    categoryLabel(a, categories).localeCompare(categoryLabel(b, categories)),
  );
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Categories</h2>
      <p className="text-sm text-slate-500">
        Archive or move child categories before archiving their parent. Existing item references are
        retained.
      </p>
      {manage && (
        <details className="panel space-y-4">
          <summary className="cursor-pointer font-semibold">Create category</summary>
          <CategoryForm org={org} categories={categories} />
        </details>
      )}
      {sorted.map((category) => (
        <article className="panel space-y-4" key={category.id}>
          <h3 className="font-medium">{categoryLabel(category, categories)}</h3>
          <p className="text-sm text-slate-500">{category.isActive ? 'Active' : 'Archived'}</p>
          {manage && (
            <details className="space-y-4">
              <summary className="cursor-pointer underline">Edit category</summary>
              <CategoryForm org={org} categories={categories} category={category} />
            </details>
          )}
        </article>
      ))}
      {!categories.length && <p className="panel text-slate-500">No categories yet.</p>}
    </div>
  );
}
