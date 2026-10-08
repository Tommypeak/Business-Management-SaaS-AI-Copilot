import 'server-only';
import { notFound } from 'next/navigation';
import type {
  GoodsReceiptResponse,
  PageResponse,
  PurchaseOrderListItem,
  PurchaseOrderResponse,
  SupplierResponse,
} from '@saas/types';
import { ApiError, request } from './api';
export const purchasingRoot = (org: string) => `/organizations/${encodeURIComponent(org)}`;
async function detail<T>(path: string) {
  try {
    return await request<T>(path);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
}
export const purchasingApi = {
  suppliers: (org: string, query: string) =>
    request<PageResponse<SupplierResponse>>(`${purchasingRoot(org)}/suppliers?${query}`),
  supplier: (org: string, id: string) =>
    detail<SupplierResponse>(`${purchasingRoot(org)}/suppliers/${encodeURIComponent(id)}`),
  orders: (org: string, query: string) =>
    request<PageResponse<PurchaseOrderListItem>>(
      `${purchasingRoot(org)}/purchasing/orders?${query}`,
    ),
  order: (org: string, id: string) =>
    detail<PurchaseOrderResponse>(
      `${purchasingRoot(org)}/purchasing/orders/${encodeURIComponent(id)}`,
    ),
  receipt: (org: string, id: string) =>
    detail<GoodsReceiptResponse>(
      `${purchasingRoot(org)}/purchasing/receipts/${encodeURIComponent(id)}`,
    ),
};
