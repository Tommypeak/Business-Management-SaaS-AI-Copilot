'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  CATALOG_ITEM_TYPES,
  CUSTOM_FIELD_TYPES,
  UNITS,
  type CatalogVariantInput,
  type CustomFieldAssignment,
} from '@saas/types';
import { catalogApi } from '../../../../../lib/catalog';
import { ApiError } from '../../../../../lib/api';
import type { FormState } from '../../actions';

const text = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
};
const nullable = (form: FormData, key: string) => text(form, key) || null;
const refresh = (org: string) => revalidatePath(`/app/${org}/catalog`, 'layout');
const errorState = (error: unknown): FormState => {
  if (error instanceof ApiError) return { error: error.message };
  throw error;
};
function variantInput(form: FormData): CatalogVariantInput | undefined {
  const unit = UNITS.find((unit) => unit === text(form, 'unit'));
  if (!unit) return undefined;
  return {
    name: nullable(form, 'variantName'),
    sku: nullable(form, 'sku'),
    barcode: nullable(form, 'barcode'),
    sellingPrice: text(form, 'sellingPrice'),
    costPrice: nullable(form, 'costPrice'),
    unit,
    isActive: form.get('variantActive') === 'on',
    optionValueIds: form
      .getAll('optionValueIds')
      .filter((value): value is string => typeof value === 'string' && Boolean(value)),
  };
}
async function customInput(org: string, form: FormData): Promise<CustomFieldAssignment[]> {
  const fields = await catalogApi.fields(org);
  return fields
    .filter((field) => field.isActive)
    .map((field) => {
      const name = `custom_${field.id}`;
      const raw = text(form, name);
      const values = form
        .getAll(name)
        .filter((value): value is string => typeof value === 'string' && Boolean(value));
      return {
        fieldId: field.id,
        value:
          field.type === 'MULTI_SELECT'
            ? values.length
              ? values
              : null
            : !raw
              ? null
              : field.type === 'BOOLEAN'
                ? raw === 'true'
                : raw,
      };
    });
}
export async function saveItem(
  org: string,
  item: string | null,
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const type = CATALOG_ITEM_TYPES.find((type) => type === text(form, 'type'));
  if (!type) return { error: 'Choose an item type.' };
  let id: string;
  try {
    const input = {
      type,
      name: text(form, 'name'),
      description: nullable(form, 'description'),
      categoryId: nullable(form, 'categoryId'),
      trackInventory: type === 'PRODUCT' && form.get('trackInventory') === 'on',
      customFields: await customInput(org, form),
    };
    if (item)
      id = (
        await catalogApi.updateItem(org, item, {
          ...input,
          isActive: form.get('isActive') === 'on',
        })
      ).id;
    else {
      const defaultVariant = variantInput(form);
      if (!defaultVariant) return { error: 'Choose a unit of measure.' };
      id = (
        await catalogApi.createItem(org, {
          ...input,
          defaultVariant: { ...defaultVariant, isActive: true },
        })
      ).id;
    }
  } catch (error) {
    return errorState(error);
  }
  refresh(org);
  if (!item) redirect(`/app/${org}/catalog/${id}`);
  return { success: 'Item saved.' };
}
export async function saveVariant(
  org: string,
  item: string,
  variant: string | null,
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const input = variantInput(form);
  if (!input) return { error: 'Choose a unit of measure.' };
  try {
    await catalogApi.variant(org, item, variant, input);
  } catch (error) {
    return errorState(error);
  }
  refresh(org);
  return { success: variant ? 'Variant saved.' : 'Variant created.' };
}
export async function saveCategory(
  org: string,
  category: string | null,
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  try {
    await catalogApi.category(org, category, {
      name: text(form, 'name'),
      parentId: nullable(form, 'parentId'),
      isActive: form.get('isActive') === 'on',
    });
  } catch (error) {
    return errorState(error);
  }
  refresh(org);
  return { success: 'Category saved.' };
}
export async function saveField(
  org: string,
  field: string | null,
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  try {
    if (field)
      await catalogApi.updateField(org, field, {
        name: text(form, 'name'),
        isRequired: form.get('isRequired') === 'on',
        isActive: form.get('isActive') === 'on',
      });
    else {
      const type = CUSTOM_FIELD_TYPES.find((type) => type === text(form, 'type'));
      if (!type) return { error: 'Choose a field type.' };
      const options = text(form, 'options')
        .split(/\r?\n/)
        .map((label) => label.trim())
        .filter(Boolean)
        .map((label, position) => ({ label, value: label, position }));
      await catalogApi.createField(org, {
        name: text(form, 'name'),
        key: text(form, 'key'),
        type,
        isRequired: form.get('isRequired') === 'on',
        ...(type.includes('SELECT') ? { options } : {}),
      });
    }
  } catch (error) {
    return errorState(error);
  }
  refresh(org);
  return { success: 'Custom field saved.' };
}
export async function saveFieldOption(
  org: string,
  field: string,
  option: string | null,
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const input = {
    label: text(form, 'label'),
    position: Number(text(form, 'position')),
    isActive: form.get('isActive') === 'on',
  };
  try {
    await catalogApi.fieldOption(
      org,
      field,
      option,
      option ? input : { ...input, value: text(form, 'value') },
    );
  } catch (error) {
    return errorState(error);
  }
  refresh(org);
  return { success: 'Field option saved.' };
}
export async function saveOption(
  org: string,
  item: string,
  option: string | null,
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  try {
    await catalogApi.option(org, item, option, {
      name: text(form, 'name'),
      position: Number(text(form, 'position')),
      isActive: form.get('isActive') === 'on',
    });
  } catch (error) {
    return errorState(error);
  }
  refresh(org);
  return { success: 'Variant option saved.' };
}
export async function saveOptionValue(
  org: string,
  item: string,
  option: string,
  value: string | null,
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  try {
    await catalogApi.optionValue(org, item, option, value, {
      value: text(form, 'value'),
      position: Number(text(form, 'position')),
      isActive: form.get('isActive') === 'on',
    });
  } catch (error) {
    return errorState(error);
  }
  refresh(org);
  return { success: 'Option value saved.' };
}
