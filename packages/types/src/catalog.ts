import type { PageResponse } from './index.js';

export const CATALOG_ITEM_TYPES = ['PRODUCT', 'SERVICE'] as const;
export type CatalogItemType = (typeof CATALOG_ITEM_TYPES)[number];
export const UNITS = [
  'PIECE',
  'KILOGRAM',
  'GRAM',
  'LITER',
  'MILLILITER',
  'METER',
  'CENTIMETER',
  'HOUR',
  'MINUTE',
  'SERVICE',
  'OTHER',
] as const;
export type UnitOfMeasure = (typeof UNITS)[number];
export const CUSTOM_FIELD_TYPES = [
  'TEXT',
  'NUMBER',
  'BOOLEAN',
  'DATE',
  'SELECT',
  'MULTI_SELECT',
] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];
export const CATALOG_SORTS = ['name', 'createdAt', 'updatedAt'] as const;
export type CatalogSort = (typeof CATALOG_SORTS)[number];
/** Decimal strings only, including custom NUMBER values. null clears an assignment. */
export type CustomFieldValue = string | boolean | string[];
export interface CustomFieldAssignment {
  fieldId: string;
  value: CustomFieldValue | null;
}
export interface CatalogVariantInput {
  name?: string | null;
  sku?: string | null;
  barcode?: string | null;
  sellingPrice: string;
  costPrice?: string | null;
  unit: UnitOfMeasure;
  optionValueIds?: string[];
  isActive?: boolean;
}
export interface CatalogVariantResponse extends CatalogVariantInput {
  id: string;
  name: string | null;
  sku: string | null;
  barcode: string | null;
  costPrice: string | null;
  isDefault: boolean;
  isActive: boolean;
  optionValueIds: string[];
  createdAt: string;
  updatedAt: string;
}
export interface CatalogItemInput {
  type: CatalogItemType;
  name: string;
  description?: string | null;
  categoryId?: string | null;
  trackInventory: boolean;
  defaultVariant: CatalogVariantInput;
  customFields?: CustomFieldAssignment[];
}
export interface CatalogItemUpdate extends Partial<Omit<CatalogItemInput, 'defaultVariant'>> {
  isActive?: boolean;
}
export interface CatalogCategoryInput {
  name: string;
  parentId?: string | null;
  isActive?: boolean;
}
export interface CatalogCategoryResponse extends CatalogCategoryInput {
  id: string;
  parentId: string | null;
  isActive: boolean;
}
export interface CatalogOptionInput {
  name: string;
  position?: number;
  isActive?: boolean;
}
export interface CatalogOptionValueInput {
  value: string;
  position?: number;
  isActive?: boolean;
}
export interface CatalogOptionValueResponse extends CatalogOptionValueInput {
  id: string;
  isActive: boolean;
  position: number;
}
export interface CatalogOptionResponse extends CatalogOptionInput {
  id: string;
  isActive: boolean;
  position: number;
  values: CatalogOptionValueResponse[];
}
export interface CustomFieldOptionInput {
  label: string;
  value: string;
  position?: number;
  isActive?: boolean;
}
export interface CustomFieldOptionResponse extends CustomFieldOptionInput {
  id: string;
  position: number;
  isActive: boolean;
}
export interface CustomFieldDefinitionInput {
  name: string;
  key: string;
  type: CustomFieldType;
  isRequired?: boolean;
  options?: CustomFieldOptionInput[];
}
export interface CustomFieldDefinitionResponse extends CustomFieldDefinitionInput {
  id: string;
  isActive: boolean;
  isRequired: boolean;
  options: CustomFieldOptionResponse[];
}
export interface CatalogItemSummary {
  id: string;
  type: CatalogItemType;
  name: string;
  category: { id: string; name: string; isActive: boolean } | null;
  trackInventory: boolean;
  isActive: boolean;
  currencyCode: string;
  defaultVariant: CatalogVariantResponse;
  createdAt: string;
  updatedAt: string;
}
export interface CatalogItemResponse extends CatalogItemSummary {
  description: string | null;
  categoryId: string | null;
  variants: CatalogVariantResponse[];
  options: CatalogOptionResponse[];
  customFields: { fieldId: string; value: CustomFieldValue }[];
}
export type CatalogListResponse = PageResponse<CatalogItemSummary>;
