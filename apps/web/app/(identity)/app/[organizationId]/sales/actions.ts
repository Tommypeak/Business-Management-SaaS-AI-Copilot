'use server';
import { revalidatePath } from 'next/cache';
import type {
  CatalogVariantResponse,
  PageResponse,
  SalesOrderResponse,
  CustomerResponse,
} from '@saas/types';
import { ApiError, request } from '../../../../../lib/api';
import { catalogApi } from '../../../../../lib/catalog';
import { salesApi, salesRoot } from '../../../../../lib/sales';
export interface SalesFormState {
  error?: string;
  uncertain?: boolean;
  success?: string;
  id?: string;
}
const text = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
};
export async function saveSalesCommand(
  org: string,
  kind: 'create' | 'metadata' | 'items' | 'complete' | 'cancel' | 'payment' | 'customer',
  id: string | null,
  key: string,
  form: FormData,
): Promise<SalesFormState> {
  try {
    let path = `${salesRoot(org)}/sales/orders${id ? `/${encodeURIComponent(id)}` : ''}`,
      method = 'POST',
      body: object = {};
    if (kind === 'create' || kind === 'metadata') {
      body = {
        locationId: text(form, 'locationId') || null,
        customerId: text(form, 'customerId') || null,
        note: text(form, 'note') || null,
      };
      if (kind === 'metadata') method = 'PATCH';
    } else if (kind === 'items') {
      path += '/items';
      method = 'PUT';
      const variants = form.getAll('variantId'),
        quantities = form.getAll('quantity'),
        discounts = form.getAll('discountAmount');
      body = {
        items: variants.map((variantId, i) => ({
          variantId,
          quantity: quantities[i],
          discountAmount: discounts[i],
        })),
      };
    } else if (kind === 'complete' || kind === 'payment') {
      path += kind === 'complete' ? '/complete' : '/payments';
      const payment = {
        amount: text(form, 'amount'),
        method: text(form, 'method'),
        reference: text(form, 'reference') || null,
        note: text(form, 'paymentNote') || null,
      };
      if (kind === 'complete') {
        if (form.get('confirmed') !== 'on')
          return { error: 'Confirm the sale before completing it.' };
        body = { payments: payment.amount ? [payment] : [] };
      } else body = payment;
    } else if (kind === 'cancel') {
      path += '/cancel';
      if (form.get('confirmed') !== 'on') return { error: 'Confirm cancellation.' };
    } else {
      path = `${salesRoot(org)}/customers${id ? `/${encodeURIComponent(id)}` : ''}`;
      method = id ? 'PATCH' : 'POST';
      body = {
        type: text(form, 'type'),
        name: text(form, 'name'),
        email: text(form, 'email') || null,
        phone: text(form, 'phone') || null,
        notes: text(form, 'notes') || null,
        isActive: form.get('isActive') === 'on',
      };
    }
    const result = await request<SalesOrderResponse | CustomerResponse>(path, {
      method,
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify(body),
    });
    revalidatePath(`/app/${org}`, 'layout');
    return { success: 'Saved.', id: result.id };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message, uncertain: error.status >= 500 };
    throw error;
  }
}
export async function findSaleProducts(org: string, q: string, cursor?: string) {
  return catalogApi.items(
    org,
    new URLSearchParams({
      q: q.slice(0, 100),
      isActive: 'true',
      limit: '10',
      ...(cursor ? { cursor } : {}),
    }).toString(),
  );
}
export async function findSaleVariants(org: string, itemId: string, cursor?: string) {
  return request<PageResponse<CatalogVariantResponse>>(
    `${salesRoot(org)}/catalog/items/${encodeURIComponent(itemId)}/variants?${new URLSearchParams({ limit: '25', ...(cursor ? { cursor } : {}) })}`,
  );
}
export async function findSaleCustomers(org: string, q: string, cursor?: string) {
  return salesApi.customers(
    org,
    new URLSearchParams({
      q: q.slice(0, 100),
      isActive: 'true',
      limit: '25',
      ...(cursor ? { cursor } : {}),
    }).toString(),
  );
}
