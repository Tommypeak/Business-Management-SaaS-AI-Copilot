import type { FastifyRequest } from 'fastify';
import type { PermissionCode, RoleSummary } from '@saas/types';

export interface LocalUser {
  id: string;
  createdAt: Date;
}
export interface OrganizationContext {
  organizationId: string;
  membershipId: string;
  roles: RoleSummary[];
  permissions: PermissionCode[];
}
export interface AuthenticatedRequest extends FastifyRequest {
  currentUser?: LocalUser;
  organizationContext?: OrganizationContext;
}
