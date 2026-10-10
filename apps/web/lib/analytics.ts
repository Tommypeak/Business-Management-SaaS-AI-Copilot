import 'server-only';
import { ApiError, request } from './api';
export type AnalyticsResult<T> = { data: T; error?: never } | { data?: never; error: string };
export async function analyticsRequest<T>(
  org: string,
  path: string,
  query: string,
): Promise<AnalyticsResult<T>> {
  try {
    return {
      data: await request<T>(`/organizations/${org}/analytics/${path}${query ? '?' + query : ''}`),
    };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error;
  }
}
