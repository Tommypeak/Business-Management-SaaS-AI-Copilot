import { Injectable } from '@nestjs/common';
import { AiConfig, aiError } from './ai.config.js';
export interface ModelCall {
  id: string;
  name: string;
  arguments: string;
}
export interface ModelResult {
  content: string | null;
  calls: ModelCall[];
  usage: { inputTokens: number; outputTokens: number } | null;
  provider: string;
  model: string;
}
export interface ModelMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
}
export interface ProviderStatus {
  configured: boolean;
  provider: string;
  model: string;
  providerHost: string;
}
export const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
@Injectable()
export class AiProviderClient {
  constructor(private readonly config: AiConfig) {}
  private async request(path: string, payload?: unknown, signal?: AbortSignal): Promise<unknown> {
    if (!this.config.secret) aiError('AI_PROVIDER_NOT_CONFIGURED');
    try {
      const res = await fetch(`${this.config.serviceUrl}/internal/${path}`, {
        method: payload ? 'POST' : 'GET',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json', 'X-AI-Service-Secret': this.config.secret },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
        signal: AbortSignal.any([
          AbortSignal.timeout(this.config.requestTimeoutMs + 1000),
          ...(signal ? [signal] : []),
        ]),
      });
      const reader = res.body?.getReader();
      let text = '';
      if (reader) {
        const decoder = new TextDecoder();
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          text += decoder.decode(part.value, { stream: true });
          if (text.length > 64000) {
            await reader.cancel();
            aiError('AI_MALFORMED_RESPONSE');
          }
        }
      }
      const body: unknown = JSON.parse(text);
      if (!res.ok) {
        const code = isObject(body) && typeof body.code === 'string' ? body.code : '';
        if (
          [
            'AI_PROVIDER_NOT_CONFIGURED',
            'AI_PROVIDER_TIMEOUT',
            'AI_PROVIDER_RATE_LIMIT',
            'AI_PROVIDER_UNAVAILABLE',
            'AI_MALFORMED_RESPONSE',
            'AI_MODEL_REFUSAL',
            'AI_CONTEXT_TOO_LARGE',
            'AI_PROVIDER_INCOMPATIBLE',
            'AI_OUTPUT_LIMIT',
          ].includes(code)
        )
          aiError(code, code === 'AI_PROVIDER_RATE_LIMIT' ? 429 : 503);
        aiError('AI_SERVICE_UNAVAILABLE');
      }
      return body;
    } catch (error) {
      if (error instanceof Error && 'getStatus' in error) throw error;
      aiError(
        signal?.aborted ||
          (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name))
          ? 'AI_PROVIDER_TIMEOUT'
          : 'AI_SERVICE_UNAVAILABLE',
      );
    }
  }
  async status(): Promise<ProviderStatus> {
    const r = await this.request('status');
    if (
      !isObject(r) ||
      typeof r.configured !== 'boolean' ||
      ![r.provider, r.model, r.providerHost].every((v) => typeof v === 'string' && v.length <= 255)
    )
      aiError('AI_MALFORMED_RESPONSE');
    return r as unknown as ProviderStatus;
  }
  async infer(payload: unknown, signal: AbortSignal): Promise<ModelResult> {
    if (JSON.stringify(payload).length > this.config.maxContextChars)
      aiError('AI_CONTEXT_TOO_LARGE', 400);
    const r = await this.request('infer', payload, signal);
    if (
      !isObject(r) ||
      !(r.content === null || (typeof r.content === 'string' && r.content.length <= 12000)) ||
      !Array.isArray(r.calls) ||
      r.calls.length > this.config.maxToolCalls ||
      (r.usage !== null &&
        (!isObject(r.usage) ||
          ![r.usage.inputTokens, r.usage.outputTokens].every(
            (v) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 10000000,
          ))) ||
      typeof r.provider !== 'string' ||
      typeof r.model !== 'string' ||
      r.model.length > 120 ||
      r.provider.length > 80
    )
      aiError('AI_MALFORMED_RESPONSE');
    const ids = new Set<string>();
    for (const call of r.calls) {
      if (
        !isObject(call) ||
        typeof call.id !== 'string' ||
        !/^[\w-]{1,100}$/.test(call.id) ||
        ids.has(call.id) ||
        typeof call.name !== 'string' ||
        !/^[a-z_]{1,64}$/.test(call.name) ||
        typeof call.arguments !== 'string' ||
        call.arguments.length > 4000
      )
        aiError('AI_MALFORMED_RESPONSE');
      ids.add(call.id);
    }
    if (!r.calls.length && !(typeof r.content === 'string' && r.content.trim()))
      aiError('AI_MALFORMED_RESPONSE');
    return r as unknown as ModelResult;
  }
}
