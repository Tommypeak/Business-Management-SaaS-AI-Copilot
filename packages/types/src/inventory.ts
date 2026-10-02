import type { UnitOfMeasure } from './catalog.js';

export const INVENTORY_TYPES = [
  'OPENING_BALANCE',
  'ADJUSTMENT',
  'TRANSFER',
  'REVERSAL',
  'SALE',
] as const;
export type InventoryTransactionType = (typeof INVENTORY_TYPES)[number];
export const ADJUSTMENT_DIRECTIONS = ['INCREASE', 'DECREASE'] as const;
export type AdjustmentDirection = (typeof ADJUSTMENT_DIRECTIONS)[number];
export const ADJUSTMENT_REASONS = ['COUNT_CORRECTION', 'DAMAGE', 'LOSS', 'FOUND', 'OTHER'] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];
export interface InventorySettingsResponse {
  allowNegativeStock: boolean;
}
export interface InventoryStockRow {
  variantId: string;
  itemId: string;
  itemName: string;
  variantName: string | null;
  sku: string | null;
  barcode: string | null;
  unit: UnitOfMeasure;
  quantity: string;
  isActive: boolean;
  trackInventory: boolean;
  location: { id: string; name: string; isActive: boolean } | null;
}
export interface InventoryLedgerEntryResponse {
  id: string;
  location: { id: string; name: string; isActive: boolean };
  variant: {
    id: string;
    name: string | null;
    sku: string | null;
    itemId: string;
    itemName: string;
    isActive: boolean;
  };
  quantityDelta: string;
  unit: UnitOfMeasure;
}
export interface InventoryTransactionResponse {
  salesOrderId: string | null;
  id: string;
  type: InventoryTransactionType;
  reason: AdjustmentReason | null;
  createdAt: string;
  createdBy: { id: string };
  note: string | null;
  reversesTransactionId: string | null;
  reversedByTransactionId: string | null;
  entries: InventoryLedgerEntryResponse[];
}
export interface OpeningBalanceInput {
  locationId: string;
  variantId: string;
  quantity: string;
  note?: string | null;
}
export interface AdjustmentInput extends OpeningBalanceInput {
  direction: AdjustmentDirection;
  reason: AdjustmentReason;
}
export interface TransferInput {
  sourceLocationId: string;
  destinationLocationId: string;
  variantId: string;
  quantity: string;
  note?: string | null;
}
