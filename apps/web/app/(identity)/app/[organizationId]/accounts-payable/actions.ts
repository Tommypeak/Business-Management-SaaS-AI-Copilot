'use server';
import { revalidatePath } from 'next/cache';
import type { SupplierBillResponse, SupplierPaymentResponse } from '@saas/types';
import { ApiError, request } from '../../../../../lib/api';
import { accountsPayableRoot } from '../../../../../lib/accounts-payable';

export type BillCommand = 'create' | 'edit' | 'post' | 'void' | 'payment';
export interface BillFormState {
  error?: string;
  uncertain?: boolean;
  success?: string;
  id?: string;
}
const value = (form: FormData, name: string) => {
  const row = form.get(name);
  return typeof row === 'string' ? row.trim() : '';
};

export async function saveBillCommand(
  org: string,
  kind: BillCommand,
  id: string | null,
  key: string,
  form: FormData,
): Promise<BillFormState> {
  try {
    let path = `${accountsPayableRoot(org)}/bills${id ? `/${encodeURIComponent(id)}` : ''}`;
    let method = 'POST';
    let body: object;
    if (kind === 'create' || kind === 'edit') {
      method = kind === 'edit' ? 'PATCH' : 'POST';
      body = {
        supplierId: value(form, 'supplierId'),
        purchaseOrderId: value(form, 'purchaseOrderId') || null,
        supplierInvoiceNumber: value(form, 'supplierInvoiceNumber') || null,
        issueDate: value(form, 'issueDate'),
        dueDate: value(form, 'dueDate') || null,
        amount: value(form, 'amount'),
        description: value(form, 'description') || null,
        note: value(form, 'note') || null,
      };
    } else if (kind === 'post') {
      if (form.get('confirmed') !== 'on') return { error: 'Confirm posting first.' };
      path += '/post';
      body = {};
    } else if (kind === 'void') {
      if (form.get('confirmed') !== 'on') return { error: 'Confirm voiding first.' };
      path += '/void';
      body = { reason: value(form, 'reason') };
    } else {
      path += '/payments';
      body = {
        paymentDate: value(form, 'paymentDate'),
        amount: value(form, 'amount'),
        method: value(form, 'method'),
        reference: value(form, 'reference') || null,
        note: value(form, 'note') || null,
      };
    }
    const result = await request<SupplierBillResponse | SupplierPaymentResponse>(path, {
      method,
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify(body),
    });
    revalidatePath(`/app/${org}`, 'layout');
    return { success: 'Saved.', id: result.id };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message, uncertain: error.status >= 500 };
    throw error;
  }
}
