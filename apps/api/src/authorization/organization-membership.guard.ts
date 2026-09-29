import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthenticatedRequest } from '../auth/auth-context.js';
import { isPermission } from './permissions.js';

@Injectable()
export class OrganizationMembershipGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.currentUser) throw new UnauthorizedException();
    const { organizationId } = request.params as Record<string, string | undefined>;
    if (!organizationId || !isUUID(organizationId)) throw new NotFoundException();
    const membership = await this.prisma.organizationMembership.findFirst({
      where: { organizationId, userId: request.currentUser.id, status: 'ACTIVE' },
      include: {
        roles: {
          where: { organizationId },
          include: { role: { include: { permissions: { where: { organizationId } } } } },
        },
      },
    });
    if (!membership) throw new NotFoundException();
    request.organizationContext = {
      organizationId,
      membershipId: membership.id,
      roles: membership.roles.map(({ role }) => ({ id: role.id, key: role.key, name: role.name })),
      permissions: [
        ...new Set(
          membership.roles.flatMap(({ role }) =>
            role.permissions.map((permission) => permission.permissionCode).filter(isPermission),
          ),
        ),
      ],
    };
    return true;
  }
}
