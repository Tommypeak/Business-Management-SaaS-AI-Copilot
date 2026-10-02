import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthGuard } from './auth.guard.js';
import { JwtVerifierService } from './jwt-verifier.service.js';
import { AuthenticatedUserService } from './authenticated-user.service.js';
import { MeController } from './me.controller.js';

@Module({
  imports: [PrismaModule],
  controllers: [MeController],
  providers: [
    JwtVerifierService,
    AuthenticatedUserService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AuthModule {}
