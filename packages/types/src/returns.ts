import type { AnalyticsContext } from './analytics.js';
import type { CatalogItemType, UnitOfMeasure } from './catalog.js';
import type { PaymentMethod } from './sales.js';

export const SALES_RETURN_STATUSES = ['DRAFT', 'POSTED', 'CANCELLED'] as const;
export type SalesReturnStatus = (typeof SALES_RETURN_STATUSES)[number];
export const RESTOCK_DISPOSITIONS = ['RESTOCK', 'NO_RESTOCK'] as const;
export type RestockDisposition = (typeof RESTOCK_DISPOSITIONS)[number];
export interface ReturnItemInput {
  salesOrderItemId: string;
  quantity: string;
  restockDisposition: RestockDisposition;
  locationId?: string | null;
}
export interface SalesReturnInput {
  salesOrderId: string;
  reason?: string | null;
  note?: string | null;
  items: ReturnItemInput[];
}
export interface ReturnSourceSale {
  id: string;
  sequenceNumber: number;
  number: string;
  customer: { id: string; name: string; isActive: boolean } | null;
  location: { id: string; name: string; isActive: boolean } | null;
}
export interface SalesReturnListItem {
  id: string;
  sequenceNumber: number;
  number: string;
  status: SalesReturnStatus;
  salesOrder: ReturnSourceSale;
  currencyCode: string;
  totalRefundableAmount: string | null;
  refundedForReturn: string | null;
  remainingReturnCredit: string | null;
  itemsCount: number;
  createdAt: string;
  postedAt: string | null;
}
export interface SalesReturnItemResponse {
  id: string;
  salesOrderItemId: string;
  variantId: string;
  quantity: string;
  restockDisposition: RestockDisposition;
  location: { id: string; name: string; isActive: boolean } | null;
  refundAmount: string | null;
  stockRestocked: boolean;
  snapshotItemName: string;
  snapshotVariantName: string | null;
  snapshotSku: string | null;
  snapshotUnit: UnitOfMeasure;
  snapshotItemType: CatalogItemType | null;
}
export interface RefundAllocationResponse {
  salesReturnId: string;
  returnNumber: string;
  allocatedAmount: string | null;
}
export interface CustomerRefundListItem {
  id: string;
  sequenceNumber: number;
  number: string;
  salesOrder: ReturnSourceSale;
  amount: string | null;
  currencyCode: string;
  paymentDate: string;
  paymentMethod: PaymentMethod;
  reference: string | null;
  createdAt: string;
}
export interface CustomerRefundResponse extends CustomerRefundListItem {
  note: string | null;
  createdBy: { id: string };
  allocations: RefundAllocationResponse[];
}
export interface SalesReturnResponse extends SalesReturnListItem {
  reason: string | null;
  note: string | null;
  revision: number;
  createdBy: { id: string };
  postedBy: { id: string } | null;
  updatedAt: string;
  cancelledAt: string | null;
  cancelledBy: { id: string } | null;
  cancelReason: string | null;
  items: SalesReturnItemResponse[];
  inventoryTransactionId: string | null;
  financeVisible: boolean;
  quoteValid: boolean;
  currentQuoteAmount: string | null;
  collectedAmount: string | null;
  refundedAmount: string | null;
  refundedForReturn: string | null;
  remainingReturnCredit: string | null;
  availableRefundAmount: string | null;
  refunds: CustomerRefundListItem[] | null;
  refundsTruncated: boolean;
}
export interface ReturnEligibilityItem {
  salesOrderItemId: string;
  variantId: string;
  snapshotItemName: string;
  snapshotVariantName: string | null;
  snapshotSku: string | null;
  snapshotUnit: UnitOfMeasure;
  snapshotItemType: CatalogItemType | null;
  stockDeducted: boolean;
  restockAllowed: boolean;
  soldQuantity: string;
  returnedQuantity: string;
  remainingQuantity: string;
  originalLineAmount: string | null;
  creditedAmount: string | null;
  remainingCredit: string | null;
}
export interface ReturnEligibilityResponse {
  salesOrder: ReturnSourceSale;
  currencyCode: string;
  financeVisible: boolean;
  items: ReturnEligibilityItem[];
  postedReturnsCount: number;
  postedReturnCredits: string | null;
  collectedAmount: string | null;
  refundedAmount: string | null;
  remainingRefundableCashCap: string | null;
  unusedReturnCredit: string | null;
  availableRefundAmount: string | null;
  adjustedSalesAmount: string | null;
  netOutstandingAmount: string | null;
  netPaidAmount: string | null;
}
export interface CustomerRefundInput {
  salesOrderId: string;
  amount: string;
  paymentMethod: PaymentMethod;
  paymentDate: string;
  reference?: string | null;
  note?: string | null;
  allocations: { salesReturnId: string; allocatedAmount: string }[];
}
export interface ReturnsAnalyticsSummary {
  context: AnalyticsContext;
  financeVisible: boolean;
  currencyCode: string | null;
  returnsCount: number;
  postedReturnCredits: string | null;
  customerRefundsPaid: string | null;
  topReturnedVariants: {
    variantId: string;
    itemName: string;
    variantName: string | null;
    sku: string | null;
    unit: string;
    type: CatalogItemType | 'UNKNOWN';
    quantityReturned: string;
    returnCredits: string | null;
  }[];
  trend: {
    bucket: string;
    returnsCount: number;
    postedReturnCredits: string | null;
    customerRefundsPaid: string | null;
  }[];
}
