import type { UnitOfMeasure } from './catalog.js';

export const PURCHASE_STATUSES = [
  'DRAFT',
  'ORDERED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED',
] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];
export interface SupplierResponse {
  id: string;
  organizationId: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  taxId: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface PurchaseOrderItemResponse {
  id: string;
  variantId: string;
  orderedQuantity: string;
  receivedQuantity: string;
  remainingQuantity: string;
  unitCost: string;
  lineTotal: string;
  snapshotItemName: string;
  snapshotVariantName: string | null;
  snapshotSku: string | null;
  snapshotUnit: UnitOfMeasure;
}
export interface PurchaseOrderListItem {
  id: string;
  sequenceNumber: number;
  number: string;
  status: PurchaseStatus;
  currencyCode: string;
  supplier: { id: string; name: string; isActive: boolean };
  destinationLocation: { id: string; name: string; isActive: boolean };
  subtotal: string;
  total: string;
  orderedQuantity: string;
  receivedQuantity: string;
  createdAt: string;
  orderedAt: string | null;
}
export interface PurchaseOrderResponse extends PurchaseOrderListItem {
  note: string | null;
  createdBy: { id: string };
  updatedAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  items: PurchaseOrderItemResponse[];
  receipts: GoodsReceiptResponse[];
}
export interface GoodsReceiptItemResponse {
  id: string;
  purchaseOrderItemId: string;
  variantId: string;
  snapshotItemName: string;
  snapshotVariantName: string | null;
  snapshotSku: string | null;
  receivedQuantity: string;
  snapshotUnit: UnitOfMeasure;
  inventoryTracked: boolean;
}
export interface GoodsReceiptResponse {
  id: string;
  sequenceNumber: number;
  number: string;
  purchaseOrderId: string;
  receivedAt: string;
  createdBy: { id: string };
  note: string | null;
  items: GoodsReceiptItemResponse[];
  inventoryTransactionId: string | null;
}
