import type { HealthResponse } from '@saas/types';

export function GET() {
  return Response.json({ status: 'ok', service: 'web' } satisfies HealthResponse, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
