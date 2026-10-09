import 'server-only';
import { notFound } from 'next/navigation';
import type {
  AccountsPayableSummaryResponse,
  PageResponse,
  SupplierBillListItem,
  SupplierBillResponse,
  SupplierPaymentResponse,
} from '@saas/types';
import { ApiError, request } from './api';

export const accountsPayableRoot = (org: string) =>
  `/organizations/${encodeURIComponent(org)}/accounts-payable`;
export const accountsPayableApi = {
  bills: (org: string, query: string) =>
    request<PageResponse<SupplierBillListItem>>(`${accountsPayableRoot(org)}/bills?${query}`),
  bill: async (org: string, id: string) => {
    try {
      return await request<SupplierBillResponse>(
        `${accountsPayableRoot(org)}/bills/${encodeURIComponent(id)}`,
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) notFound();
      throw error;
    }
  },
  payments: (org: string, id: string, query: string) =>
    request<PageResponse<SupplierPaymentResponse>>(
      `${accountsPayableRoot(org)}/bills/${encodeURIComponent(id)}/payments?${query}`,
    ),
  summary: (org: string) =>
    request<AccountsPayableSummaryResponse>(`${accountsPayableRoot(org)}/summary`),
};
