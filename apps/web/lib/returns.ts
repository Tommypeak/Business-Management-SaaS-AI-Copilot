import 'server-only';
import { notFound } from 'next/navigation';
import type {
  CustomerRefundListItem,
  CustomerRefundResponse,
  PageResponse,
  ReturnEligibilityResponse,
  SalesReturnListItem,
  SalesReturnResponse,
} from '@saas/types';
import { ApiError, request } from './api';
import { salesRoot } from './sales';
async function detail<T>(path: string) {
  try {
    return await request<T>(path);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
}
export const returnsApi = {
  list: (org: string, q: string) =>
    request<PageResponse<SalesReturnListItem>>(`${salesRoot(org)}/returns?${q}`),
  get: (org: string, id: string) =>
    detail<SalesReturnResponse>(`${salesRoot(org)}/returns/${encodeURIComponent(id)}`),
  eligibility: (org: string, id: string) =>
    detail<ReturnEligibilityResponse>(
      `${salesRoot(org)}/sales/orders/${encodeURIComponent(id)}/return-eligibility`,
    ),
  refunds: (org: string, q: string) =>
    request<PageResponse<CustomerRefundListItem>>(`${salesRoot(org)}/refunds?${q}`),
  refund: (org: string, id: string) =>
    detail<CustomerRefundResponse>(`${salesRoot(org)}/refunds/${encodeURIComponent(id)}`),
};
