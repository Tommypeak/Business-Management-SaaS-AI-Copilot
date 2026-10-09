'use server';
import { revalidatePath } from 'next/cache';
import type { ExpenseCategoryResponse, ExpenseResponse } from '@saas/types';
import { ApiError, request } from '../../../../../lib/api';
import { financeRoot } from '../../../../../lib/expenses';

export interface ExpenseFormState {
  error?: string;
  uncertain?: boolean;
  success?: string;
  id?: string;
}
export type ExpenseCommand =
  'category-create' | 'category-edit' | 'create' | 'edit' | 'post' | 'void';
const text = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
};

export async function saveExpenseCommand(
  org: string,
  kind: ExpenseCommand,
  id: string | null,
  key: string,
  form: FormData,
): Promise<ExpenseFormState> {
  try {
    let path: string;
    let method = 'POST';
    let body: object;
    if (kind === 'category-create' || kind === 'category-edit') {
      path = `${financeRoot(org)}/expense-categories${id ? `/${encodeURIComponent(id)}` : ''}`;
      method = kind === 'category-edit' ? 'PATCH' : 'POST';
      body = {
        name: text(form, 'name'),
        description: text(form, 'description') || null,
        ...(kind === 'category-edit' ? { isActive: form.get('isActive') === 'on' } : {}),
      };
    } else {
      path = `${financeRoot(org)}/expenses${id ? `/${encodeURIComponent(id)}` : ''}`;
      if (kind === 'create' || kind === 'edit') {
        method = kind === 'edit' ? 'PATCH' : 'POST';
        body = {
          categoryId: text(form, 'categoryId'),
          locationId: text(form, 'locationId') || null,
          expenseDate: text(form, 'expenseDate'),
          amount: text(form, 'amount'),
          paymentMethod: text(form, 'paymentMethod'),
          payeeName: text(form, 'payeeName') || null,
          description: text(form, 'description') || null,
          note: text(form, 'note') || null,
        };
      } else if (kind === 'post') {
        if (form.get('confirmed') !== 'on') return { error: 'Confirm posting first.' };
        path += '/post';
        body = {};
      } else {
        if (form.get('confirmed') !== 'on') return { error: 'Confirm voiding first.' };
        path += '/void';
        body = { reason: text(form, 'reason') };
      }
    }
    const result = await request<ExpenseResponse | ExpenseCategoryResponse>(path, {
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
