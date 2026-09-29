import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { OrganizationMembershipGuard } from './organization-membership.guard.js';
import { PermissionsGuard } from './permissions.guard.js';

@Module({
  imports: [PrismaModule],
  providers: [OrganizationMembershipGuard, PermissionsGuard],
  exports: [OrganizationMembershipGuard, PermissionsGuard],
})
export class AuthorizationModule {}
