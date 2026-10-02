import { createParamDecorator, NotFoundException, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth-context.js';

export const CurrentOrganization = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => {
    const tenant = context.switchToHttp().getRequest<AuthenticatedRequest>().organizationContext;
    if (!tenant) throw new NotFoundException();
    return tenant;
  },
);
