import 'server-only';
import { auth } from '@clerk/nextjs/server';
import { notFound, redirect } from 'next/navigation';
import type {
  OrganizationDetailResponse,
  OrganizationResponse,
  PageResponse,
  LocationResponse,
  OrganizationInput,
  LocationInput,
} from '@saas/types';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = await auth();
  if (!session.userId) redirect('/sign-in');
  const token = await session.getToken();
  if (!token) redirect('/sign-in');
  const base = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001/api/v1';
  let response: Response;
  try {
    response = await fetch(`${base.replace(/\/$/, '')}${path}`, {
      ...init,
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
      headers: {
        'Content-Type': 'application/json',
        ...init.headers,
        Authorization: `Bearer ${token}`,
      },
    });
  } catch {
    throw new ApiError(503, 'The service is unavailable. Please try again.');
  }
  if (response.status === 401) {
    throw new ApiError(401, 'Your session could not be verified. Sign out and sign in again.');
  }
  if (!response.ok) {
    const messages: Record<number, string> = {
      400: 'Check the fields and try again.',
      403: 'You do not have permission to perform this action.',
      404: 'This organization or resource is unavailable.',
      409: 'The change conflicts with the current state. Please refresh.',
    };
    throw new ApiError(
      response.status,
      messages[response.status] ?? 'The service is unavailable. Please try again.',
    );
  }
  return (await response.json()) as T;
}

async function list<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | null = null;
  do {
    const page: PageResponse<T> = await request(
      `${path}?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    );
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

export const api = {
  organizations: () => list<OrganizationResponse>('/organizations'),
  organization: async (id: string) => {
    try {
      return await request<OrganizationDetailResponse>(`/organizations/${encodeURIComponent(id)}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) notFound();
      throw error;
    }
  },
  createOrganization: (data: OrganizationInput) =>
    request<OrganizationResponse>('/organizations', { method: 'POST', body: JSON.stringify(data) }),
  updateOrganization: (id: string, data: OrganizationInput) =>
    request<OrganizationResponse>(`/organizations/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  locations: (org: string) =>
    list<LocationResponse>(`/organizations/${encodeURIComponent(org)}/locations`),
  createLocation: (org: string, data: LocationInput) =>
    request<LocationResponse>(`/organizations/${encodeURIComponent(org)}/locations`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateLocation: (org: string, id: string, data: LocationInput) =>
    request<LocationResponse>(
      `/organizations/${encodeURIComponent(org)}/locations/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify(data) },
    ),
};
