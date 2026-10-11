import { Injectable, HttpException } from '@nestjs/common';
export function aiError(code: string, status = 503): never {
  throw new HttpException({ code, message: code }, status);
}
@Injectable()
export class AiConfig {
  readonly serviceUrl: string;
  readonly secret = process.env.AI_SERVICE_SECRET ?? '';
  readonly requestTimeoutMs = this.number('AI_REQUEST_TIMEOUT_MS', 20000, 1000, 30000);
  readonly turnTimeoutMs = this.number('AI_TURN_TIMEOUT_MS', 60000, 5000, 120000);
  readonly maxToolCalls = this.number('AI_MAX_TOOL_CALLS', 6, 1, 12);
  readonly maxToolRounds = this.number('AI_MAX_TOOL_ROUNDS', 4, 1, 6);
  readonly userHourly = this.number('AI_USER_REQUESTS_PER_HOUR', 15, 1, 1000);
  readonly orgDaily = this.number('AI_ORG_REQUESTS_PER_DAY', 200, 1, 10000);
  readonly maxContextChars = this.number('AI_MAX_CONTEXT_CHARACTERS', 48000, 4000, 100000);
  constructor() {
    const url = new URL(process.env.AI_SERVICE_URL ?? 'http://127.0.0.1:8000');
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    )
      throw new Error('Invalid AI_SERVICE_URL');
    if (this.secret && this.secret.length < 32)
      throw new Error('AI_SERVICE_SECRET must contain at least 32 characters');
    this.serviceUrl = url.origin;
  }
  private number(key: string, fallback: number, min: number, max: number) {
    const value = Number(process.env[key] ?? fallback);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${key}`);
    return value;
  }
}
