import 'server-only';
import { notFound } from 'next/navigation';
import type {
  AdjustmentInput,
  InventorySettingsResponse,
  InventoryStockRow,
  InventoryTransactionResponse,
  OpeningBalanceInput,
  PageResponse,
  TransferInput,
} from '@saas/types';
import { ApiError, request } from './api';

const root = (org: string) => `/organizations/${encodeURIComponent(org)}/inventory`;
const command = (org: string, path: string, key: string, body: object) =>
  request<InventoryTransactionResponse>(`${root(org)}/${path}`, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify(body),
  });
export const inventoryApi = {
  stock: (org: string, query: string) =>
    request<PageResponse<InventoryStockRow>>(`${root(org)}/stock?${query}`),
  history: (org: string, query: string) =>
    request<PageResponse<InventoryTransactionResponse>>(`${root(org)}/transactions?${query}`),
  transaction: async (org: string, id: string) => {
    try {
      return await request<InventoryTransactionResponse>(
        `${root(org)}/transactions/${encodeURIComponent(id)}`,
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) notFound();
      throw error;
    }
  },
  settings: (org: string) => request<InventorySettingsResponse>(`${root(org)}/settings`),
  saveSettings: (org: string, allowNegativeStock: boolean) =>
    request<InventorySettingsResponse>(`${root(org)}/settings`, {
      method: 'PATCH',
      body: JSON.stringify({ allowNegativeStock }),
    }),
  opening: (org: string, key: string, input: OpeningBalanceInput) =>
    command(org, 'opening-balances', key, input),
  adjustment: (org: string, key: string, input: AdjustmentInput) =>
    command(org, 'adjustments', key, input),
  transfer: (org: string, key: string, input: TransferInput) =>
    command(org, 'transfers', key, input),
  reverse: (org: string, id: string, key: string, note: string | null) =>
    command(org, `transactions/${encodeURIComponent(id)}/reverse`, key, { note }),
};
