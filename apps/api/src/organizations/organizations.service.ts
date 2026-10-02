import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  OrganizationDetailResponse,
  OrganizationResponse,
  PageResponse,
  MembershipResponse,
  RoleResponse,
} from '@saas/types';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Organization } from '../generated/prisma/client.js';
import type { OrganizationContext } from '../auth/auth-context.js';
import { SYSTEM_ROLES, isPermission } from '../authorization/permissions.js';
import type { CreateOrganizationDto, UpdateOrganizationDto } from './organization.dto.js';
import type { ListQueryDto } from '../common/list-query.dto.js';

function serialize(organization: Organization): OrganizationResponse {
  return {
    id: organization.id,
    name: organization.name,
    businessType: organization.businessType,
    defaultCurrency: organization.defaultCurrency,
    timezone: organization.timezone,
    locale: organization.locale,
    createdAt: organization.createdAt.toISOString(),
    updatedAt: organization.updatedAt.toISOString(),
  };
}

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, input: CreateOrganizationDto): Promise<OrganizationResponse> {
    const organization = await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: input.name,
          businessType: input.businessType,
          defaultCurrency: input.defaultCurrency,
          timezone: input.timezone,
          locale: input.locale ?? 'en',
          inventorySettings: { create: {} },
        },
      });
      const membership = await tx.organizationMembership.create({
        data: { organizationId: organization.id, userId },
      });
      for (const definition of SYSTEM_ROLES) {
        const role = await tx.role.create({
          data: {
            organizationId: organization.id,
            key: definition.key,
            name: definition.name,
            isSystem: true,
          },
        });
        await tx.rolePermission.createMany({
          data: definition.permissions.map((permissionCode) => ({
            organizationId: organization.id,
            roleId: role.id,
            permissionCode,
          })),
        });
        if (definition.key === 'OWNER')
          await tx.membershipRole.create({
            data: { organizationId: organization.id, membershipId: membership.id, roleId: role.id },
          });
      }
      return organization;
    });
    return serialize(organization);
  }

  async list(userId: string, query: ListQueryDto): Promise<PageResponse<OrganizationResponse>> {
    const rows = await this.prisma.organization.findMany({
      where: {
        memberships: { some: { userId, status: 'ACTIVE' } },
        ...(query.cursor ? { id: { gt: query.cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: query.limit + 1,
    });
    const items = rows.slice(0, query.limit).map(serialize);
    return { items, nextCursor: rows.length > query.limit ? items.at(-1)!.id : null };
  }

  async get(
    organizationId: string,
    context: OrganizationContext,
  ): Promise<OrganizationDetailResponse> {
    const row = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!row) throw new NotFoundException();
    return {
      ...serialize(row),
      currentMembership: {
        id: context.membershipId,
        roles: context.roles,
        permissions: context.permissions,
      },
    };
  }

  async update(
    organizationId: string,
    input: UpdateOrganizationDto,
  ): Promise<OrganizationResponse> {
    const rows = await this.prisma.organization.updateManyAndReturn({
      where: { id: organizationId },
      data: {
        name: input.name,
        businessType: input.businessType,
        defaultCurrency: input.defaultCurrency,
        timezone: input.timezone,
        locale: input.locale,
      },
    });
    if (!rows[0]) throw new NotFoundException();
    return serialize(rows[0]);
  }

  async members(
    organizationId: string,
    query: ListQueryDto,
  ): Promise<PageResponse<MembershipResponse>> {
    const rows = await this.prisma.organizationMembership.findMany({
      where: { organizationId, ...(query.cursor ? { id: { gt: query.cursor } } : {}) },
      orderBy: { id: 'asc' },
      take: query.limit + 1,
      include: { roles: { where: { organizationId }, include: { role: true } } },
    });
    const items = rows.slice(0, query.limit).map((row) => ({
      id: row.id,
      userId: row.userId,
      status: row.status,
      roles: row.roles.map(({ role }) => ({ id: role.id, name: role.name, key: role.key })),
    }));
    return { items, nextCursor: rows.length > query.limit ? items.at(-1)!.id : null };
  }

  async roles(organizationId: string, query: ListQueryDto): Promise<PageResponse<RoleResponse>> {
    const rows = await this.prisma.role.findMany({
      where: { organizationId, ...(query.cursor ? { id: { gt: query.cursor } } : {}) },
      orderBy: { id: 'asc' },
      take: query.limit + 1,
      include: { permissions: { where: { organizationId } } },
    });
    const items = rows.slice(0, query.limit).map((row) => ({
      id: row.id,
      name: row.name,
      key: row.key,
      isSystem: row.isSystem,
      permissions: row.permissions
        .map((permission) => permission.permissionCode)
        .filter(isPermission),
    }));
    return { items, nextCursor: rows.length > query.limit ? items.at(-1)!.id : null };
  }
}
