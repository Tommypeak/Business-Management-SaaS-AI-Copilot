import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { UserResponse } from '@saas/types';
import { CurrentUser } from './current-user.decorator.js';
import type { LocalUser } from './auth-context.js';

@ApiTags('Identity')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  @Get()
  me(@CurrentUser() user: LocalUser): UserResponse {
    return { id: user.id, createdAt: user.createdAt.toISOString() };
  }
}
