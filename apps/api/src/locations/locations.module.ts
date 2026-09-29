import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { LocationsController } from './locations.controller.js';
import { LocationsService } from './locations.service.js';

@Module({
  imports: [PrismaModule, AuthorizationModule],
  controllers: [LocationsController],
  providers: [LocationsService],
})
export class LocationsModule {}
