import { randomUUID } from 'node:crypto';
import { HttpException, Injectable, Logger } from '@nestjs/common';
import {
  Permission,
  type AiMessageResponse,
  type AiSource,
  type AiTurnResponse,
  type AiStatusResponse,
} from '@saas/types';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma, type AiMessage } from '../generated/prisma/client.js';
import { RedisService } from '../redis/redis.service.js';
import { AiAccessService } from './ai-access.service.js';
import { AiConfig, aiError } from './ai.config.js';
import { AiProviderClient, type ModelMessage, isObject } from './ai-provider.client.js';
import { AiToolsService } from './ai-tools.service.js';
import { permittedTools } from './ai-tools.js';
import { analyticsContext } from '../analytics/analytics-query.js';
import { AnalyticsQueryDto } from '../analytics/analytics.dto.js';
import type { AiCreateDto, AiMessageDto, AiPageDto, AiSettingsDto } from './ai.dto.js';

const visible = (m: AiMessage, permissions: readonly string[]) =>
  m.requiredPermissions.every((p) => permissions.includes(p));
function message(m: AiMessage, permissions: readonly string[]): AiMessageResponse {
  const restricted = !visible(m, permissions);
  return {
    id: m.id,
    clientMessageId: m.clientMessageId,
    role: m.role,
    content: restricted ? 'This message is unavailable with your current permissions.' : m.content,
    status: m.status,
    errorCode: restricted ? 'AI_HISTORY_RESTRICTED' : m.errorCode,
    sources: restricted ? [] : (m.sources as unknown as AiSource[]),
    createdAt: m.createdAt.toISOString(),
    restricted,
  };
}
const conversation = (c: { id: string; title: string; createdAt: Date; updatedAt: Date }) => ({
  id: c.id,
  title: c.title,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
});
function safeCode(error: unknown) {
  if (error instanceof HttpException) {
    const body = error.getResponse();
    if (
      isObject(body) &&
      typeof body.code === 'string' &&
      /^(AI_|FINANCE_MIXED_CURRENCY|AP_MIXED_CURRENCY)/.test(body.code)
    )
      return body.code;
    if (error.getStatus() === 400) return 'AI_INVALID_TOOL_ARGUMENTS';
    if ([403, 404].includes(error.getStatus())) return 'AI_ACCESS_DENIED';
  }
  return 'AI_ANALYTICS_UNAVAILABLE';
}
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AiAccessService,
    private readonly config: AiConfig,
    private readonly provider: AiProviderClient,
    private readonly tools: AiToolsService,
    private readonly redis: RedisService,
  ) {}
  async settings(org: string, user: string) {
    await this.access.permissions(org, user, [Permission.AI_MANAGE]);
    const s = await this.prisma.aiSettings.findUnique({ where: { organizationId: org } });
    return {
      enabled: s?.enabled ?? false,
      disclosureVersion: 'v1',
      updatedAt: s?.updatedAt.toISOString() ?? null,
    };
  }
  async updateSettings(org: string, user: string, input: AiSettingsDto) {
    await this.access.permissions(org, user, [Permission.AI_MANAGE]);
    await this.prisma.aiSettings.upsert({
      where: { organizationId: org },
      create: { organizationId: org, ...input },
      update: input,
    });
    return this.settings(org, user);
  }
  async status(org: string, user: string): Promise<AiStatusResponse> {
    const p = await this.access.permissions(org, user, []);
    if (!p.includes(Permission.AI_USE) && !p.includes(Permission.AI_MANAGE))
      aiError('AI_PERMISSION_DENIED', 403);
    const enabled =
      (await this.prisma.aiSettings.findUnique({ where: { organizationId: org } }))?.enabled ??
      false;
    const limits = {
      messageCharacters: 2000,
      userRequestsPerHour: this.config.userHourly,
      organizationRequestsPerDay: this.config.orgDaily,
      maxToolCalls: this.config.maxToolCalls,
      maxToolRounds: this.config.maxToolRounds,
      turnTimeoutMs: this.config.turnTimeoutMs,
    };
    try {
      const s = await this.provider.status();
      return {
        enabled,
        available: enabled && s.configured,
        code: !s.configured ? 'AI_PROVIDER_NOT_CONFIGURED' : !enabled ? 'AI_DISABLED' : null,
        provider: s.provider,
        model: s.model,
        providerHost: s.providerHost,
        limits,
      };
    } catch (error) {
      return {
        enabled,
        available: false,
        code: safeCode(error),
        provider: null,
        model: null,
        providerHost: null,
        limits,
      };
    }
  }
  async create(org: string, user: string, input: AiCreateDto) {
    await this.access.permissions(org, user);
    if (input.title !== undefined && !input.title.trim()) aiError('AI_INVALID_TITLE', 400);
    return conversation(
      await this.prisma.aiConversation.create({
        data: {
          organizationId: org,
          userId: user,
          title: input.title?.trim() ?? 'New conversation',
        },
      }),
    );
  }
  private async owned(org: string, user: string, id: string) {
    const c = await this.prisma.aiConversation.findFirst({
      where: { id, organizationId: org, userId: user },
    });
    if (!c) aiError('AI_CONVERSATION_NOT_FOUND', 404);
    return c;
  }
  async list(org: string, user: string, q: AiPageDto) {
    await this.access.permissions(org, user);
    const cursor = q.cursor ? await this.owned(org, user, q.cursor) : null;
    const rows = await this.prisma.aiConversation.findMany({
      where: {
        organizationId: org,
        userId: user,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    return {
      items: rows.slice(0, q.limit).map(conversation),
      nextCursor: rows.length > q.limit ? rows[q.limit - 1]!.id : null,
    };
  }
  async read(org: string, user: string, id: string, q: AiPageDto) {
    const permissions = await this.access.permissions(org, user);
    const c = await this.owned(org, user, id);
    const cursor = q.cursor
      ? await this.prisma.aiMessage.findFirst({
          where: { organizationId: org, conversationId: id, id: q.cursor },
          select: { sequence: true },
        })
      : null;
    if (q.cursor && !cursor) aiError('AI_INVALID_CURSOR', 400);
    const rows = await this.prisma.aiMessage.findMany({
      where: {
        organizationId: org,
        conversationId: id,
        ...(cursor ? { sequence: { lt: cursor.sequence } } : {}),
      },
      orderBy: { sequence: 'desc' },
      take: q.limit + 1,
    });
    return {
      conversation: conversation(c),
      items: rows
        .slice(0, q.limit)
        .reverse()
        .map((m) => message(m, permissions)),
      nextCursor: rows.length > q.limit ? rows[q.limit - 1]!.id : null,
    };
  }
  async remove(org: string, user: string, id: string) {
    await this.access.permissions(org, user);
    await this.owned(org, user, id);
    const result = await this.prisma.aiConversation.deleteMany({
      where: {
        id,
        organizationId: org,
        userId: user,
        OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }],
      },
    });
    if (!result.count) aiError('AI_CONVERSATION_BUSY', 409);
    return { deleted: true };
  }
  async turn(org: string, user: string, id: string, input: AiMessageDto): Promise<AiTurnResponse> {
    if (!input.content.trim()) aiError('AI_EMPTY_MESSAGE', 400);
    const permissions = await this.access.permissions(org, user);
    const c = await this.owned(org, user, id);
    const old = await this.prisma.aiMessage.findMany({
      where: { organizationId: org, conversationId: id, clientMessageId: input.clientMessageId },
      orderBy: { sequence: 'asc' },
    });
    if (old.length && old[0]!.content !== input.content) aiError('AI_IDEMPOTENCY_CONFLICT', 409);
    if (old.some((m) => !visible(m, permissions))) aiError('AI_HISTORY_RESTRICTED', 403);
    const done = old.find((m) => m.role === 'ASSISTANT' && m.status === 'COMPLETED');
    if (done)
      return { messages: old.map((m) => message(m, permissions)), requestId: done.requestId };
    await this.access.enabled(org);
    const provider = await this.provider.status();
    if (!provider.configured) aiError('AI_PROVIDER_NOT_CONFIGURED');
    const requestId = randomUUID(),
      started = Date.now(),
      deadline = AbortSignal.timeout(this.config.turnTimeoutMs);
    const claimed = await this.prisma.aiConversation.updateMany({
      where: {
        id,
        organizationId: org,
        userId: user,
        OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }],
      },
      data: {
        activeTurnId: requestId,
        lockedUntil: new Date(started + this.config.turnTimeoutMs + 15000),
      },
    });
    if (!claimed.count) aiError('AI_CONVERSATION_BUSY', 409);
    let persisted = false;
    let usageKnown = true;
    let inputTokens = 0,
      outputTokens = 0,
      callCount = 0;
    try {
      // Re-read under the lease: a completed request may have raced our initial lookup.
      const current = await this.prisma.aiMessage.findMany({
        where: { organizationId: org, conversationId: id, clientMessageId: input.clientMessageId },
        orderBy: { sequence: 'asc' },
      });
      if (current.length && current[0]!.content !== input.content)
        aiError('AI_IDEMPOTENCY_CONFLICT', 409);
      if (current.some((m) => !visible(m, permissions))) aiError('AI_HISTORY_RESTRICTED', 403);
      if (current.some((m) => m.role === 'ASSISTANT' && m.status === 'COMPLETED'))
        return {
          messages: current.map((m) => message(m, permissions)),
          requestId: current.at(-1)!.requestId,
        };
      const last = await this.prisma.aiMessage.findFirst({
        where: { organizationId: org, conversationId: id },
        orderBy: { sequence: 'desc' },
      });
      if (current.length && last?.clientMessageId !== input.clientMessageId)
        aiError('AI_RETRY_NOT_LATEST', 409);
      if (!current.length && c.nextSequence >= 200) aiError('AI_CONVERSATION_LIMIT', 409);
      let quota: boolean;
      try {
        quota = await this.redis.consumeAiQuota(
          org,
          user,
          this.config.userHourly,
          this.config.orgDaily,
        );
      } catch {
        aiError('AI_RATE_LIMIT_UNAVAILABLE');
      }
      if (!quota) aiError('AI_RATE_LIMITED', 429);
      await this.prisma.$transaction(async (tx) => {
        if (current.length) {
          await tx.aiMessage.updateMany({
            where: {
              organizationId: org,
              conversationId: id,
              clientMessageId: input.clientMessageId,
              role: 'ASSISTANT',
            },
            data: {
              status: 'PENDING',
              content: '',
              errorCode: null,
              requestId,
              sources: [],
              requiredPermissions: permissions,
            },
          });
        } else {
          const counter = await tx.aiConversation.update({
            where: { id },
            data: { nextSequence: { increment: 2 } },
          });
          await tx.aiMessage.createMany({
            data: [
              {
                organizationId: org,
                conversationId: id,
                clientMessageId: input.clientMessageId,
                sequence: counter.nextSequence - 2,
                role: 'USER',
                content: input.content,
                status: 'COMPLETED',
                requiredPermissions: permissions,
              },
              {
                organizationId: org,
                conversationId: id,
                clientMessageId: input.clientMessageId,
                sequence: counter.nextSequence - 1,
                role: 'ASSISTANT',
                content: '',
                status: 'PENDING',
                requestId,
                requiredPermissions: permissions,
              },
            ],
          });
        }
      });
      persisted = true;
      const history = await this.prisma.aiMessage.findMany({
        where: {
          organizationId: org,
          conversationId: id,
          clientMessageId: { not: input.clientMessageId },
          status: 'COMPLETED',
        },
        orderBy: { sequence: 'desc' },
        take: 20,
      });
      const messages: ModelMessage[] = history
        .reverse()
        .filter((m) => visible(m, permissions))
        .map((m) => ({ role: m.role === 'USER' ? 'user' : 'assistant', content: m.content }));
      messages.push({ role: 'user', content: input.content });
      const context = await analyticsContext(this.prisma, org, new AnalyticsQueryDto());
      const sources: AiSource[] = [];
      const definitions = permittedTools(permissions);
      let content = '';
      for (let round = 0; round <= this.config.maxToolRounds; round++) {
        if (deadline.aborted) aiError('AI_TURN_TIMEOUT');
        await this.access.permissions(org, user, permissions);
        await this.access.enabled(org);
        const result = await this.provider.infer(
          {
            messages,
            tools: definitions,
            context: {
              today: context.to,
              timezone: context.timezone,
              defaultFrom: context.from,
              defaultTo: context.to,
              currency: context.defaultCurrency,
            },
          },
          deadline,
        );
        if (result.usage) {
          inputTokens += result.usage.inputTokens;
          outputTokens += result.usage.outputTokens;
        } else usageKnown = false;
        if (!result.calls.length) {
          content = result.content ?? '';
          break;
        }
        if (
          round === this.config.maxToolRounds ||
          callCount + result.calls.length > this.config.maxToolCalls
        )
          aiError('AI_TOOL_LIMIT', 400);
        messages.push({
          role: 'assistant',
          content: result.content,
          tool_calls: result.calls.map((call) => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: call.arguments },
          })),
        });
        for (const call of result.calls) {
          if (deadline.aborted) aiError('AI_TURN_TIMEOUT');
          await this.access.permissions(org, user, permissions);
          const toolResult = await this.tools.execute(
            org,
            user,
            call.name,
            call.arguments,
            requestId,
          );
          callCount++;
          sources.push(toolResult.source);
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(toolResult),
          });
        }
      }
      if (!content.trim()) aiError('AI_MALFORMED_RESPONSE');
      if (deadline.aborted) aiError('AI_TURN_TIMEOUT');
      await this.access.permissions(org, user, permissions);
      await this.access.enabled(org);
      await this.prisma.$transaction(async (tx) => {
        const fenced = await tx.aiConversation.updateMany({
          where: { id, organizationId: org, userId: user, activeTurnId: requestId },
          data: { activeTurnId: null, lockedUntil: null },
        });
        if (!fenced.count) aiError('AI_CONVERSATION_BUSY', 409);
        await tx.aiMessage.updateMany({
          where: {
            organizationId: org,
            conversationId: id,
            clientMessageId: input.clientMessageId,
            role: 'ASSISTANT',
            requestId,
          },
          data: {
            content,
            status: 'COMPLETED',
            sources: sources as unknown as Prisma.InputJsonValue,
            usage: {
              provider: provider.provider,
              model: provider.model,
              inputTokens: usageKnown ? inputTokens : null,
              outputTokens: usageKnown ? outputTokens : null,
              usageComplete: usageKnown,
              toolCalls: callCount,
              durationMs: Date.now() - started,
            },
          },
        });
      });
      this.logger.log({
        requestId,
        organizationId: org,
        userId: user,
        status: 'completed',
        latency: Date.now() - started,
        inputTokens: usageKnown ? inputTokens : null,
        outputTokens: usageKnown ? outputTokens : null,
        toolCalls: callCount,
      });
    } catch (error) {
      const code = safeCode(error);
      if (persisted)
        await this.prisma.aiMessage.updateMany({
          where: {
            organizationId: org,
            conversationId: id,
            clientMessageId: input.clientMessageId,
            role: 'ASSISTANT',
            requestId,
            status: 'PENDING',
          },
          data: {
            status: 'FAILED',
            content: '',
            errorCode: code,
            sources: [],
            usage: {
              provider: provider.provider,
              model: provider.model,
              inputTokens: usageKnown ? inputTokens : null,
              outputTokens: usageKnown ? outputTokens : null,
              usageComplete: false,
              toolCalls: callCount,
              durationMs: Date.now() - started,
            },
          },
        });
      this.logger.warn({
        requestId,
        organizationId: org,
        userId: user,
        status: 'failed',
        code,
        latency: Date.now() - started,
      });
      if (
        !persisted ||
        ['AI_ACCESS_DENIED', 'AI_PERMISSION_DENIED', 'AI_HISTORY_RESTRICTED'].includes(code)
      )
        aiError(code, error instanceof HttpException ? error.getStatus() : 503);
    } finally {
      await this.prisma.aiConversation.updateMany({
        where: { id, organizationId: org, userId: user, activeTurnId: requestId },
        data: { activeTurnId: null, lockedUntil: null },
      });
    }
    const finalPermissions = await this.access.permissions(org, user);
    const rows = await this.prisma.aiMessage.findMany({
      where: { organizationId: org, conversationId: id, clientMessageId: input.clientMessageId },
      orderBy: { sequence: 'asc' },
    });
    return { messages: rows.map((m) => message(m, finalPermissions)), requestId };
  }
}
