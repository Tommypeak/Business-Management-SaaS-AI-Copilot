import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { ModelMessage, ModelResult } from '../src/ai/ai-provider.client.js';
export interface StubRequest {
  messages: ModelMessage[];
  tools: { function: { name: string } }[];
  context: { today: string; timezone: string };
}
export const aiStub = {
  configured: true,
  calls: [] as StubRequest[],
  handler: (() => aiCompletion()) as (request: StubRequest) => unknown,
  reset() {
    this.configured = true;
    this.calls = [];
    this.handler = () => aiCompletion();
  },
};
export function aiCompletion(content = 'Ответ основан на доступных данных.'): ModelResult {
  return {
    content,
    calls: [],
    usage: { inputTokens: 100, outputTokens: 20 },
    provider: 'test',
    model: 'deterministic-test-only',
  };
}
export function aiCalls(...calls: { name: string; arguments?: string }[]): ModelResult {
  return {
    ...aiCompletion(),
    content: null,
    calls: calls.map((c, i) => ({ id: `call_${i}`, name: c.name, arguments: c.arguments ?? '{}' })),
  };
}
let server: Server | undefined;
export async function startAiStub() {
  const secret = randomUUID() + randomUUID();
  server = createServer((req, res) => {
    void (async () => {
      if (req.headers['x-ai-service-secret'] !== secret) {
        res.writeHead(401).end('{}');
        return;
      }
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/internal/status') {
        res.end(
          JSON.stringify({
            configured: aiStub.configured,
            provider: 'test',
            model: 'deterministic-test-only',
            providerHost: 'test.invalid',
          }),
        );
        return;
      }
      if (req.url !== '/internal/infer') {
        res.writeHead(404).end('{}');
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk as Uint8Array));
      const input = JSON.parse(Buffer.concat(chunks).toString()) as StubRequest;
      aiStub.calls.push(input);
      try {
        res.end(JSON.stringify(await aiStub.handler(input)));
      } catch {
        res.writeHead(503).end(JSON.stringify({ code: 'AI_PROVIDER_UNAVAILABLE' }));
      }
    })();
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Stub address');
  Object.assign(process.env, {
    AI_SERVICE_SECRET: secret,
    AI_SERVICE_URL: `http://127.0.0.1:${address.port}`,
    AI_USER_REQUESTS_PER_HOUR: '1000',
    AI_ORG_REQUESTS_PER_DAY: '10000',
  });
}
export async function stopAiStub() {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
}
