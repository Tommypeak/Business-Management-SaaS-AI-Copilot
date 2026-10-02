import type { UnitOfMeasure } from './catalog.js';
export const CUSTOMER_TYPES = ['INDIVIDUAL', 'BUSINESS'] as const;
export const SALES_STATUSES = ['DRAFT', 'COMPLETED', 'CANCELLED'] as const;
export const PAYMENT_METHODS = ['CASH', 'CARD', 'BANK_TRANSFER', 'QR', 'OTHER'] as const;
export const PAYMENT_STATUSES = ['UNPAID', 'PARTIALLY_PAID', 'PAID'] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];
export type SalesStatus = (typeof SALES_STATUSES)[number];
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export interface CustomerResponse {
  id: string;
  organizationId: string;
  type: CustomerType;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface SalesOrderItemResponse {
  id: string;
  variantId: string;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  lineTotal: string;
  snapshotItemName: string;
  snapshotVariantName: string | null;
  snapshotSku: string | null;
  snapshotUnit: UnitOfMeasure;
}
export interface SalesPaymentResponse {
  id: string;
  salesOrderId: string;
  amount: string;
  method: PaymentMethod;
  reference: string | null;
  note: string | null;
  createdBy: { id: string };
  createdAt: string;
}
export interface SalesOrderListItem {
  id: string;
  sequenceNumber: number;
  status: SalesStatus;
  currencyCode: string;
  customer: { id: string; name: string; isActive: boolean } | null;
  location: { id: string; name: string; isActive: boolean } | null;
  subtotal: string;
  discountTotal: string;
  total: string;
  paidAmount: string;
  outstandingAmount: string;
  paymentStatus: PaymentStatus;
  createdAt: string;
}
export interface SalesOrderResponse extends SalesOrderListItem {
  note: string | null;
  createdBy: { id: string };
  updatedAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  items: SalesOrderItemResponse[];
  payments: SalesPaymentResponse[];
}
