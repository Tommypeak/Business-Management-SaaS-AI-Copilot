import {
  ForbiddenException,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionCode } from '@saas/types';
import type { AuthenticatedRequest } from '../auth/auth-context.js';

const REQUIRED_PERMISSIONS = Symbol('required-permissions');
export const RequirePermissions = (...permissions: PermissionCode[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PermissionCode[]>(REQUIRED_PERMISSIONS, [
      context.getHandler(),
      context.getClass(),
    ]);
    const tenant = context.switchToHttp().getRequest<AuthenticatedRequest>().organizationContext;
    if (
      !tenant ||
      !required?.length ||
      !required.every((permission) => tenant.permissions.includes(permission))
    ) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }
}
