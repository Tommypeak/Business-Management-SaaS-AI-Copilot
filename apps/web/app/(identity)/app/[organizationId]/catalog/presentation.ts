import type {
  CatalogCategoryResponse,
  CustomFieldDefinitionResponse,
  CustomFieldValue,
} from '@saas/types';

export function categoryLabel(
  category: CatalogCategoryResponse,
  categories: CatalogCategoryResponse[],
): string {
  const names = [category.name];
  const seen = new Set([category.id]);
  let parent = category.parentId;
  while (parent && !seen.has(parent)) {
    seen.add(parent);
    const entry = categories.find((item) => item.id === parent);
    if (!entry) break;
    names.unshift(entry.name);
    parent = entry.parentId;
  }
  return names.join(' / ');
}
export function fieldLabel(
  field: CustomFieldDefinitionResponse | undefined,
  value: CustomFieldValue,
): string {
  const option = (id: string) => field?.options.find((option) => option.id === id)?.label ?? id;
  if (Array.isArray(value)) return value.map(option).join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return field?.type === 'SELECT' ? option(value) : value;
}
