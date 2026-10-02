import 'server-only';
import { notFound } from 'next/navigation';
import type {
  CustomerResponse,
  PageResponse,
  SalesOrderListItem,
  SalesOrderResponse,
} from '@saas/types';
import { ApiError, request } from './api';
export const salesRoot = (org: string) => `/organizations/${encodeURIComponent(org)}`;
async function detail<T>(path: string) {
  try {
    return await request<T>(path);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
}
export const salesApi = {
  customers: (org: string, query: string) =>
    request<PageResponse<CustomerResponse>>(`${salesRoot(org)}/customers?${query}`),
  customer: (org: string, id: string) =>
    detail<CustomerResponse>(`${salesRoot(org)}/customers/${encodeURIComponent(id)}`),
  orders: (org: string, query: string) =>
    request<PageResponse<SalesOrderListItem>>(`${salesRoot(org)}/sales/orders?${query}`),
  order: (org: string, id: string) =>
    detail<SalesOrderResponse>(`${salesRoot(org)}/sales/orders/${encodeURIComponent(id)}`),
};
