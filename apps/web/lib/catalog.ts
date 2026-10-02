import 'server-only';
import { notFound } from 'next/navigation';
import type {
  CatalogCategoryResponse,
  CatalogItemInput,
  CatalogItemResponse,
  CatalogItemUpdate,
  CatalogListResponse,
  CatalogVariantInput,
  CatalogVariantResponse,
  CustomFieldDefinitionInput,
  CustomFieldDefinitionResponse,
  CustomFieldOptionInput,
  CatalogCategoryInput,
  CatalogOptionInput,
  CatalogOptionValueInput,
} from '@saas/types';
import { ApiError, list, request } from './api';

const root = (organizationId: string) =>
  `/organizations/${encodeURIComponent(organizationId)}/catalog`;
const id = encodeURIComponent;
const write = <T>(path: string, method: 'POST' | 'PATCH', body: object) =>
  request<T>(path, { method, body: JSON.stringify(body) });
export const catalogApi = {
  items: (org: string, query: string) =>
    request<CatalogListResponse>(`${root(org)}/items?${query}`),
  item: async (org: string, item: string) => {
    try {
      return await request<CatalogItemResponse>(`${root(org)}/items/${id(item)}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) notFound();
      throw error;
    }
  },
  createItem: (org: string, input: CatalogItemInput) =>
    write<CatalogItemResponse>(`${root(org)}/items`, 'POST', input),
  updateItem: (org: string, item: string, input: CatalogItemUpdate) =>
    write<CatalogItemResponse>(`${root(org)}/items/${id(item)}`, 'PATCH', input),
  variant: (org: string, item: string, variant: string | null, input: CatalogVariantInput) =>
    write<CatalogVariantResponse>(
      `${root(org)}/items/${id(item)}/variants${variant ? `/${id(variant)}` : ''}`,
      variant ? 'PATCH' : 'POST',
      input,
    ),
  categories: (org: string) => list<CatalogCategoryResponse>(`${root(org)}/categories`),
  category: (org: string, category: string | null, input: CatalogCategoryInput) =>
    write<CatalogCategoryResponse>(
      `${root(org)}/categories${category ? `/${id(category)}` : ''}`,
      category ? 'PATCH' : 'POST',
      input,
    ),
  fields: (org: string) => list<CustomFieldDefinitionResponse>(`${root(org)}/custom-fields`),
  createField: (org: string, input: CustomFieldDefinitionInput) =>
    write<CustomFieldDefinitionResponse>(`${root(org)}/custom-fields`, 'POST', input),
  updateField: (
    org: string,
    field: string,
    input: { name: string; isRequired: boolean; isActive: boolean },
  ) =>
    write<CustomFieldDefinitionResponse>(`${root(org)}/custom-fields/${id(field)}`, 'PATCH', input),
  fieldOption: (
    org: string,
    field: string,
    option: string | null,
    input: CustomFieldOptionInput | Omit<CustomFieldOptionInput, 'value'>,
  ) =>
    write(
      `${root(org)}/custom-fields/${id(field)}/options${option ? `/${id(option)}` : ''}`,
      option ? 'PATCH' : 'POST',
      input,
    ),
  option: (org: string, item: string, option: string | null, input: CatalogOptionInput) =>
    write(
      `${root(org)}/items/${id(item)}/options${option ? `/${id(option)}` : ''}`,
      option ? 'PATCH' : 'POST',
      input,
    ),
  optionValue: (
    org: string,
    item: string,
    option: string,
    value: string | null,
    input: CatalogOptionValueInput,
  ) =>
    write(
      `${root(org)}/items/${id(item)}/options/${id(option)}/values${value ? `/${id(value)}` : ''}`,
      value ? 'PATCH' : 'POST',
      input,
    ),
};
