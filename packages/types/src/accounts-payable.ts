import type { PaymentMethod } from './sales.js';

export const SUPPLIER_BILL_STATUSES = ['DRAFT', 'POSTED', 'VOIDED'] as const;
export type SupplierBillStatus = (typeof SUPPLIER_BILL_STATUSES)[number];
export const SUPPLIER_BILL_PAYMENT_STATUSES = ['UNPAID', 'PARTIALLY_PAID', 'PAID'] as const;
export type SupplierBillPaymentStatus = (typeof SUPPLIER_BILL_PAYMENT_STATUSES)[number];

export interface SupplierPaymentResponse {
  id: string;
  supplierBillId: string;
  amount: string;
  method: PaymentMethod;
  reference: string | null;
  note: string | null;
  paymentDate: string;
  createdBy: { id: string };
  createdAt: string;
}

export interface SupplierBillListItem {
  id: string;
  sequenceNumber: number;
  number: string;
  status: SupplierBillStatus;
  supplier: { id: string; name: string; isActive: boolean };
  purchaseOrder: { id: string; number: string; status: string; total: string } | null;
  supplierInvoiceNumber: string | null;
  issueDate: string;
  dueDate: string | null;
  currencyCode: string;
  amount: string;
  paidAmount: string;
  outstandingAmount: string;
  paymentStatus: SupplierBillPaymentStatus;
  isOverdue: boolean;
  description: string | null;
  createdAt: string;
}

export interface SupplierBillResponse extends SupplierBillListItem {
  note: string | null;
  createdBy: { id: string };
  updatedAt: string;
  postedAt: string | null;
  voidedAt: string | null;
  voidedBy: { id: string } | null;
  voidReason: string | null;
  payments: SupplierPaymentResponse[];
}

export interface AccountsPayableSummaryResponse {
  currencyCode: string;
  timezone: string;
  asOf: string;
  totalOutstanding: string;
  overdueOutstanding: string;
  unpaidBillsCount: number;
  partiallyPaidBillsCount: number;
  overdueBillsCount: number;
}
