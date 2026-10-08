'use server';
import { revalidatePath } from 'next/cache';
import type {
  CatalogVariantResponse,
  GoodsReceiptResponse,
  PageResponse,
  PurchaseOrderResponse,
  SupplierResponse,
} from '@saas/types';
import { ApiError, request } from '../../../../../lib/api';
import { catalogApi } from '../../../../../lib/catalog';
import { purchasingApi, purchasingRoot } from '../../../../../lib/purchasing';

export interface PurchaseFormState {
  error?: string;
  uncertain?: boolean;
  success?: string;
  id?: string;
}
export type PurchaseCommand =
  'supplier' | 'create' | 'metadata' | 'items' | 'order' | 'cancel' | 'receive';
const text = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
};
export async function savePurchaseCommand(
  org: string,
  kind: PurchaseCommand,
  id: string | null,
  key: string,
  form: FormData,
): Promise<PurchaseFormState> {
  try {
    let path = `${purchasingRoot(org)}/purchasing/orders${id ? `/${encodeURIComponent(id)}` : ''}`;
    let method = 'POST';
    let body: object = {};
    if (kind === 'supplier') {
      path = `${purchasingRoot(org)}/suppliers${id ? `/${encodeURIComponent(id)}` : ''}`;
      method = id ? 'PATCH' : 'POST';
      body = {
        name: text(form, 'name'),
        contactName: text(form, 'contactName') || null,
        email: text(form, 'email') || null,
        phone: text(form, 'phone') || null,
        taxId: text(form, 'taxId') || null,
        address: text(form, 'address') || null,
        notes: text(form, 'notes') || null,
        isActive: form.get('isActive') === 'on',
      };
    } else if (kind === 'create' || kind === 'metadata') {
      method = kind === 'metadata' ? 'PATCH' : 'POST';
      body = {
        supplierId: text(form, 'supplierId'),
        destinationLocationId: text(form, 'destinationLocationId'),
        note: text(form, 'note') || null,
        ...(kind === 'create'
          ? {
              items: form.getAll('variantId').map((variantId, i) => ({
                variantId,
                orderedQuantity: form.getAll('orderedQuantity')[i],
                unitCost: form.getAll('unitCost')[i],
              })),
            }
          : {}),
      };
    } else if (kind === 'items') {
      path += '/items';
      method = 'PUT';
      body = {
        items: form.getAll('variantId').map((variantId, i) => ({
          variantId,
          orderedQuantity: form.getAll('orderedQuantity')[i],
          unitCost: form.getAll('unitCost')[i],
        })),
      };
    } else if (kind === 'order' || kind === 'cancel') {
      if (form.get('confirmed') !== 'on') return { error: 'Confirm this action first.' };
      path += kind === 'order' ? '/order' : '/cancel';
    } else {
      path += '/receipts';
      body = {
        note: text(form, 'note') || null,
        items: form
          .getAll('purchaseOrderItemId')
          .map((purchaseOrderItemId, i) => ({
            purchaseOrderItemId,
            quantity: String(form.getAll('quantity')[i] ?? ''),
          }))
          .filter((item) => item.quantity && !/^0(?:\.0*)?$/.test(item.quantity)),
      };
    }
    const result = await request<PurchaseOrderResponse | GoodsReceiptResponse | SupplierResponse>(
      path,
      {
        method,
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(body),
      },
    );
    revalidatePath(`/app/${org}`, 'layout');
    return { success: 'Saved.', id: result.id };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message, uncertain: error.status >= 500 };
    throw error;
  }
}
export async function findSuppliers(org: string, q: string, cursor?: string) {
  return purchasingApi.suppliers(
    org,
    new URLSearchParams({
      q: q.slice(0, 100),
      isActive: 'true',
      limit: '25',
      ...(cursor ? { cursor } : {}),
    }).toString(),
  );
}
export async function findProducts(org: string, q: string, cursor?: string) {
  return catalogApi.items(
    org,
    new URLSearchParams({
      q: q.slice(0, 100),
      type: 'PRODUCT',
      isActive: 'true',
      limit: '20',
      ...(cursor ? { cursor } : {}),
    }).toString(),
  );
}
export async function findVariants(
  org: string,
  itemId: string,
  cursor?: string,
): Promise<PageResponse<CatalogVariantResponse>> {
  return request(
    `${purchasingRoot(org)}/catalog/items/${encodeURIComponent(itemId)}/variants?${new URLSearchParams({ limit: '25', ...(cursor ? { cursor } : {}) })}`,
  );
}
