import 'server-only';
import { notFound } from 'next/navigation';
import type {
  ExpenseCategoryBreakdownResponse,
  ExpenseCategoryResponse,
  ExpenseListItem,
  ExpenseResponse,
  FinanceSummaryResponse,
  PageResponse,
} from '@saas/types';
import { ApiError, list, request } from './api';

export const financeRoot = (org: string) => `/organizations/${encodeURIComponent(org)}`;
async function detail<T>(path: string) {
  try {
    return await request<T>(path);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
}
export const expensesApi = {
  categories: (org: string, query: string) =>
    request<PageResponse<ExpenseCategoryResponse>>(
      `${financeRoot(org)}/expense-categories?${query}`,
    ),
  allCategories: (org: string) =>
    list<ExpenseCategoryResponse>(`${financeRoot(org)}/expense-categories`),
  expenses: (org: string, query: string) =>
    request<PageResponse<ExpenseListItem>>(`${financeRoot(org)}/expenses?${query}`),
  expense: (org: string, id: string) =>
    detail<ExpenseResponse>(`${financeRoot(org)}/expenses/${encodeURIComponent(id)}`),
  summary: (org: string, query: string) =>
    request<FinanceSummaryResponse>(`${financeRoot(org)}/finance/summary?${query}`),
  breakdown: (org: string, query: string) =>
    request<ExpenseCategoryBreakdownResponse[]>(
      `${financeRoot(org)}/finance/expenses-by-category?${query}`,
    ),
};
