'use server';
import { revalidatePath } from 'next/cache';
import { ADJUSTMENT_DIRECTIONS, ADJUSTMENT_REASONS } from '@saas/types';
import { ApiError } from '../../../../../lib/api';
import { inventoryApi } from '../../../../../lib/inventory';

export interface InventoryFormState {
  error?: string;
  success?: string;
  transactionId?: string;
}
const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
};
const refresh = (org: string) => {
  revalidatePath(`/app/${org}/inventory`, 'layout');
};
const errorState = (error: unknown): InventoryFormState => {
  if (error instanceof ApiError) return { error: error.message };
  throw error;
};
export async function recordMovement(
  org: string,
  kind: 'opening' | 'adjustment' | 'transfer',
  key: string,
  form: FormData,
): Promise<InventoryFormState> {
  const variantId = text(form, 'variantId'),
    quantity = text(form, 'quantity'),
    note = text(form, 'note') || null;
  try {
    let result;
    if (kind === 'transfer') {
      const sourceLocationId = text(form, 'sourceLocationId'),
        destinationLocationId = text(form, 'destinationLocationId');
      if (sourceLocationId === destinationLocationId)
        return { error: 'Choose different source and destination locations.' };
      result = await inventoryApi.transfer(org, key, {
        variantId,
        quantity,
        note,
        sourceLocationId,
        destinationLocationId,
      });
    } else {
      const input = { variantId, quantity, note, locationId: text(form, 'locationId') };
      if (kind === 'opening') result = await inventoryApi.opening(org, key, input);
      else {
        const direction = ADJUSTMENT_DIRECTIONS.find((value) => value === text(form, 'direction'));
        const reason = ADJUSTMENT_REASONS.find((value) => value === text(form, 'reason'));
        if (!direction || !reason) return { error: 'Choose a direction and reason.' };
        result = await inventoryApi.adjustment(org, key, { ...input, direction, reason });
      }
    }
    refresh(org);
    return { success: 'Inventory movement recorded.', transactionId: result.id };
  } catch (error) {
    return errorState(error);
  }
}
export async function reverseTransaction(
  org: string,
  id: string,
  key: string,
  form: FormData,
): Promise<InventoryFormState> {
  if (form.get('confirmed') !== 'on') return { error: 'Confirm the reversal first.' };
  try {
    const result = await inventoryApi.reverse(org, id, key, text(form, 'note') || null);
    refresh(org);
    return { success: 'Reversal recorded.', transactionId: result.id };
  } catch (error) {
    return errorState(error);
  }
}
export async function saveInventorySettings(
  org: string,
  _state: InventoryFormState,
  form: FormData,
): Promise<InventoryFormState> {
  try {
    await inventoryApi.saveSettings(org, form.get('allowNegativeStock') === 'on');
    refresh(org);
    return { success: 'Inventory settings saved.' };
  } catch (error) {
    return errorState(error);
  }
}
export async function sourceStock(
  org: string,
  itemId: string,
  variantId: string,
  locationId: string,
): Promise<{ quantity?: string; error?: string }> {
  try {
    const page = await inventoryApi.stock(
      org,
      new URLSearchParams({ itemId, locationId, limit: '100' }).toString(),
    );
    const row = page.items.find((row) => row.variantId === variantId);
    return row ? { quantity: row.quantity } : { error: 'Variant unavailable.' };
  } catch (error) {
    return errorState(error);
  }
}
