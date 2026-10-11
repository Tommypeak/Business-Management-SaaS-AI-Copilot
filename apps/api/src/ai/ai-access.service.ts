import { Injectable } from '@nestjs/common';
import { Permission, type PermissionCode } from '@saas/types';
import { PrismaService } from '../prisma/prisma.service.js';
import { isPermission } from '../authorization/permissions.js';
import { aiError } from './ai.config.js';
@Injectable()
export class AiAccessService {
  constructor(private readonly prisma: PrismaService) {}
  async permissions(
    org: string,
    user: string,
    required: readonly PermissionCode[] = [Permission.AI_USE],
  ) {
    const membership = await this.prisma.organizationMembership.findFirst({
      where: { organizationId: org, userId: user, status: 'ACTIVE' },
      include: {
        roles: {
          where: { organizationId: org },
          include: { role: { include: { permissions: { where: { organizationId: org } } } } },
        },
      },
    });
    if (!membership) aiError('AI_ACCESS_DENIED', 404);
    const permissions = [
      ...new Set(
        membership.roles.flatMap(({ role }) =>
          role.permissions.map((p) => p.permissionCode).filter(isPermission),
        ),
      ),
    ];
    if (!required.every((p) => permissions.includes(p))) aiError('AI_PERMISSION_DENIED', 403);
    return permissions;
  }
  async enabled(org: string) {
    if (!(await this.prisma.aiSettings.findUnique({ where: { organizationId: org } }))?.enabled)
      aiError('AI_DISABLED', 409);
  }
}
