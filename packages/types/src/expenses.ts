import type { PaymentMethod } from './sales.js';

export const EXPENSE_STATUSES = ['DRAFT', 'POSTED', 'VOIDED'] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

export interface ExpenseCategoryResponse {
  id: string;
  organizationId: string;
  name: string;
  normalizedName: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseListItem {
  id: string;
  sequenceNumber: number;
  number: string;
  status: ExpenseStatus;
  category: { id: string; name: string; isActive: boolean };
  location: { id: string; name: string; isActive: boolean } | null;
  expenseDate: string;
  amount: string;
  currencyCode: string;
  paymentMethod: PaymentMethod;
  payeeName: string | null;
  description: string | null;
  createdAt: string;
}

export interface ExpenseResponse extends ExpenseListItem {
  note: string | null;
  createdBy: { id: string };
  updatedAt: string;
  postedAt: string | null;
  voidedAt: string | null;
  voidedBy: { id: string } | null;
  voidReason: string | null;
}

export interface FinanceSummaryResponse {
  currencyCode: string;
  timezone: string;
  from: string | null;
  to: string | null;
  salesAmount: string;
  paymentsCollected: string;
  expensesPaid: string;
  netCashFlow: string;
  outstandingReceivablesCurrent: string;
}

export interface ExpenseCategoryBreakdownResponse {
  categoryId: string;
  categoryName: string;
  amount: string;
  count: number;
}
