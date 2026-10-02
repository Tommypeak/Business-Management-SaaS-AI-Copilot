import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { OrganizationController, OrganizationsController } from './organizations.controller.js';
import { OrganizationsService } from './organizations.service.js';

@Module({
  imports: [PrismaModule, AuthorizationModule],
  controllers: [OrganizationsController, OrganizationController],
  providers: [OrganizationsService],
})
export class OrganizationsModule {}
