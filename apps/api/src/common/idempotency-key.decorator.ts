import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth-context.js';
export const IdempotencyKey = createParamDecorator(
  (_data: unknown, context: ExecutionContext): unknown => {
    const value = context.switchToHttp().getRequest<AuthenticatedRequest>().headers[
      'idempotency-key'
    ];
    return typeof value === 'string' ? value.toLowerCase() : value;
  },
);
export const idempotencyHeader = {
  name: 'Idempotency-Key',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};
