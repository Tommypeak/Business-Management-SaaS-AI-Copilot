import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Permission } from '@saas/types';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { LocalUser, OrganizationContext } from '../auth/auth-context.js';
import { CurrentOrganization } from '../authorization/current-organization.decorator.js';
import { OrganizationMembershipGuard } from '../authorization/organization-membership.guard.js';
import { PermissionsGuard, RequirePermissions } from '../authorization/permissions.guard.js';
import { CanonicalUuidPipe } from '../common/canonical-uuid.pipe.js';
import { AiService } from './ai.service.js';
import { AiCreateDto, AiMessageDto, AiPageDto, AiSettingsDto } from './ai.dto.js';
import { aiSchemas } from './ai.schemas.js';
@ApiTags('AI Copilot')
@ApiBearerAuth()
@ApiParam({ name: 'organizationId', format: 'uuid' })
@UseGuards(OrganizationMembershipGuard, PermissionsGuard)
@RequirePermissions(Permission.AI_USE)
@Controller('organizations/:organizationId/ai')
export class AiController {
  constructor(private readonly ai: AiService) {}
  @Get('status')
  @ApiOperation({ summary: 'Copilot availability and limits. Requires ai.use.' })
  @ApiOkResponse({
    schema: aiSchemas.status,
    description: 'enabled, available, controlled code, provider/model/host and limits. No secrets.',
  })
  status(@CurrentOrganization() t: OrganizationContext, @CurrentUser() u: LocalUser) {
    return this.ai.status(t.organizationId, u.id);
  }
  @Get('settings')
  @ApiOkResponse({ schema: aiSchemas.settings })
  @RequirePermissions(Permission.AI_MANAGE)
  @ApiOperation({ summary: 'Organization AI settings (ai.manage).' })
  settings(@CurrentOrganization() t: OrganizationContext, @CurrentUser() u: LocalUser) {
    return this.ai.settings(t.organizationId, u.id);
  }
  @Patch('settings')
  @ApiOkResponse({ schema: aiSchemas.settings })
  @RequirePermissions(Permission.AI_MANAGE)
  @ApiOperation({
    summary: 'Explicitly enable or disable data sharing with the configured provider (ai.manage).',
  })
  update(
    @CurrentOrganization() t: OrganizationContext,
    @CurrentUser() u: LocalUser,
    @Body() d: AiSettingsDto,
  ) {
    return this.ai.updateSettings(t.organizationId, u.id, d);
  }
  @Get('conversations')
  @ApiOkResponse({ schema: aiSchemas.conversations })
  @ApiOperation({
    summary: 'List only the current user’s conversations, with bounded cursor pagination.',
  })
  list(
    @CurrentOrganization() t: OrganizationContext,
    @CurrentUser() u: LocalUser,
    @Query() q: AiPageDto,
  ) {
    return this.ai.list(t.organizationId, u.id, q);
  }
  @Post('conversations')
  @ApiCreatedResponse({ schema: aiSchemas.conversation })
  @ApiOperation({ summary: 'Create a private conversation. Does not contact a provider.' })
  create(
    @CurrentOrganization() t: OrganizationContext,
    @CurrentUser() u: LocalUser,
    @Body() d: AiCreateDto,
  ) {
    return this.ai.create(t.organizationId, u.id, d);
  }
  @Get('conversations/:conversationId')
  @ApiOkResponse({ schema: aiSchemas.history })
  @ApiParam({ name: 'conversationId', format: 'uuid' })
  @ApiOperation({ summary: 'Read history with current permission redaction; no LLM request.' })
  read(
    @CurrentOrganization() t: OrganizationContext,
    @CurrentUser() u: LocalUser,
    @Param('conversationId', CanonicalUuidPipe) id: string,
    @Query() q: AiPageDto,
  ) {
    return this.ai.read(t.organizationId, u.id, id, q);
  }
  @Delete('conversations/:conversationId')
  @ApiOkResponse({ schema: aiSchemas.deleted })
  @ApiParam({ name: 'conversationId', format: 'uuid' })
  @ApiOperation({ summary: 'Delete own conversation and messages. Busy conversations return 409.' })
  remove(
    @CurrentOrganization() t: OrganizationContext,
    @CurrentUser() u: LocalUser,
    @Param('conversationId', CanonicalUuidPipe) id: string,
  ) {
    return this.ai.remove(t.organizationId, u.id, id);
  }
  @Post('conversations/:conversationId/messages')
  @ApiCreatedResponse({ schema: aiSchemas.turn })
  @ApiParam({ name: 'conversationId', format: 'uuid' })
  @ApiOperation({
    summary:
      'Run a bounded read-only turn. clientMessageId provides retry safety; failed turns retain a safe error code.',
  })
  turn(
    @CurrentOrganization() t: OrganizationContext,
    @CurrentUser() u: LocalUser,
    @Param('conversationId', CanonicalUuidPipe) id: string,
    @Body() d: AiMessageDto,
  ) {
    return this.ai.turn(t.organizationId, u.id, id, d);
  }
}
