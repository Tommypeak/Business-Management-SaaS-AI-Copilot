'use server';
import { revalidatePath } from 'next/cache';
import { Permission } from '@saas/types';
import { api, ApiError, request } from '../../../../../lib/api';
import { salesRoot } from '../../../../../lib/sales';
export interface ReturnFormState {
  error?: string;
  uncertain?: boolean;
  success?: string;
  id?: string;
}
const text = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === 'string' ? v.trim() : '';
};
export async function saveReturnCommand(
  org: string,
  kind: 'create' | 'metadata' | 'items' | 'post' | 'cancel' | 'refund',
  id: string | null,
  key: string,
  form: FormData,
): Promise<ReturnFormState> {
  try {
    const ctx = await api.organization(org);
    if (
      !ctx.currentMembership.permissions.includes(
        kind === 'refund' ? Permission.REFUNDS_MANAGE : Permission.RETURNS_MANAGE,
      )
    )
      return { error: 'You do not have permission to perform this action.' };
    let path = `${salesRoot(org)}/returns${id ? `/${encodeURIComponent(id)}` : ''}`,
      method = 'POST',
      body: object = {};
    if (kind === 'create' || kind === 'items') {
      const ids = form.getAll('salesOrderItemId'),
        quantities = form.getAll('quantity'),
        dispositions = form.getAll('restockDisposition'),
        locations = form.getAll('locationId');
      const items = ids.flatMap((salesOrderItemId, i) => {
        const quantity = String(quantities[i] ?? '').trim();
        if (!quantity || /^0+(\.0+)?$/.test(quantity)) return [];
        return [
          {
            salesOrderItemId,
            quantity,
            restockDisposition: dispositions[i],
            locationId: dispositions[i] === 'RESTOCK' ? String(locations[i] ?? '') || null : null,
          },
        ];
      });
      body =
        kind === 'create'
          ? {
              salesOrderId: text(form, 'salesOrderId'),
              reason: text(form, 'reason') || null,
              note: text(form, 'note') || null,
              items,
            }
          : { items };
      if (kind === 'items') {
        path += '/items';
        method = 'PUT';
      }
    } else if (kind === 'metadata') {
      method = 'PATCH';
      body = { reason: text(form, 'reason') || null, note: text(form, 'note') || null };
    } else if (kind === 'post') {
      if (form.get('confirmed') !== 'on') return { error: 'Confirm this return before posting.' };
      path += '/post';
      body = {
        revision: Number(text(form, 'revision')),
        ...(text(form, 'expectedCredit') ? { expectedCredit: text(form, 'expectedCredit') } : {}),
      };
    } else if (kind === 'cancel') {
      if (form.get('confirmed') !== 'on') return { error: 'Confirm draft cancellation.' };
      path += '/cancel';
      body = { reason: text(form, 'reason') || null };
    } else {
      if (form.get('confirmed') !== 'on') return { error: 'Confirm the customer payout.' };
      path = `${salesRoot(org)}/refunds`;
      const ids = form.getAll('salesReturnId'),
        amounts = form.getAll('allocatedAmount');
      body = {
        salesOrderId: text(form, 'salesOrderId'),
        amount: text(form, 'amount'),
        paymentDate: text(form, 'paymentDate'),
        paymentMethod: text(form, 'paymentMethod'),
        reference: text(form, 'reference') || null,
        note: text(form, 'note') || null,
        allocations: ids.flatMap((salesReturnId, i) => {
          const allocatedAmount = String(amounts[i] ?? '').trim();
          return !allocatedAmount || /^0+(\.0+)?$/.test(allocatedAmount)
            ? []
            : [{ salesReturnId, allocatedAmount }];
        }),
      };
    }
    const result = await request<{ id: string }>(path, {
      method,
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify(body),
    });
    revalidatePath(`/app/${org}`, 'layout');
    return { id: result.id, success: 'Saved.' };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message, uncertain: error.status >= 500 };
    throw error;
  }
}
