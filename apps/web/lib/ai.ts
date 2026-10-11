import 'server-only';
import { auth } from '@clerk/nextjs/server';
import { aiErrors } from './ai-errors';
export type AiResult<T> = { ok: true; data: T } | { ok: false; code: string };
export async function aiRequest<T>(
  org: string,
  path: string,
  method = 'GET',
  data?: unknown,
): Promise<AiResult<T>> {
  if (!/^[\da-f-]{36}$/i.test(org)) return { ok: false, code: 'AI_ACCESS_DENIED' };
  const session = await auth();
  if (!session.userId) return { ok: false, code: 'AI_ACCESS_DENIED' };
  const token = await session.getToken();
  if (!token) return { ok: false, code: 'AI_ACCESS_DENIED' };
  try {
    const response = await fetch(
      `${(process.env.API_BASE_URL ?? 'http://127.0.0.1:3001/api/v1').replace(/\/$/, '')}/organizations/${org}/ai/${path}`,
      {
        method,
        cache: 'no-store',
        signal: AbortSignal.timeout(130000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      },
    );
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const code =
        body &&
        typeof body === 'object' &&
        'code' in body &&
        typeof body.code === 'string' &&
        Object.hasOwn(aiErrors, body.code)
          ? body.code
          : [401, 403, 404].includes(response.status)
            ? 'AI_ACCESS_DENIED'
            : 'AI_SERVICE_UNAVAILABLE';
      return { ok: false, code };
    }
    return { ok: true, data: (await response.json()) as T };
  } catch {
    return { ok: false, code: 'AI_SERVICE_UNAVAILABLE' };
  }
}
