import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { configureApplication } from '../src/bootstrap.js';
import { HealthModule } from '../src/health/health.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { RedisService } from '../src/redis/redis.service.js';
import { validateEnvironment } from '../src/config/environment.js';

let app: NestFastifyApplication;
let databaseAvailable = true;
let redisAvailable = true;

before(async () => {
  const module = await Test.createTestingModule({ imports: [HealthModule] })
    .overrideProvider(PrismaService)
    .useValue({
      $queryRaw: () =>
        databaseAvailable
          ? Promise.resolve([{ value: 1 }])
          : Promise.reject(new Error('private connection details')),
    })
    .overrideProvider(RedisService)
    .useValue({
      ping: () =>
        redisAvailable
          ? Promise.resolve('PONG')
          : Promise.reject(new Error('private redis details')),
    })
    .compile();
  app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await configureApplication(app, ['http://localhost:3000']);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

after(async () => {
  await app.close();
});

void test('GET /api/health returns liveness and security headers', async () => {
  const response = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: 'ok', service: 'api' });
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['cache-control'], 'no-store');
});

void test('readiness checks both dependencies and hides failure details', async () => {
  assert.equal((await app.inject('/api/health/ready')).statusCode, 200);
  for (const dependency of ['database', 'redis']) {
    databaseAvailable = dependency !== 'database';
    redisAvailable = dependency !== 'redis';
    const response = await app.inject('/api/health/ready');
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { status: 'error', service: 'api' });
    assert.equal((await app.inject('/api/health')).statusCode, 200);
  }
  databaseAvailable = redisAvailable = true;
});

void test('CORS allows only configured origins', async () => {
  const allowed = await app.inject({
    url: '/api/health',
    headers: { origin: 'http://localhost:3000' },
  });
  assert.equal(allowed.headers['access-control-allow-origin'], 'http://localhost:3000');
  const denied = await app.inject({
    url: '/api/health',
    headers: { origin: 'https://untrusted.example' },
  });
  assert.equal(denied.headers['access-control-allow-origin'], undefined);
});

void test('environment fails fast on invalid database URLs, ports and wildcard CORS', () => {
  const env = { DATABASE_URL: 'postgresql://localhost/test', REDIS_URL: 'redis://localhost:6379' };
  assert.equal(validateEnvironment(env).API_PORT, 3001);
  assert.throws(() => validateEnvironment({ ...env, DATABASE_URL: 'invalid' }), /DATABASE_URL/);
  assert.throws(() => validateEnvironment({ ...env, API_PORT: '70000' }), /API_PORT/);
  assert.throws(() => validateEnvironment({ ...env, API_CORS_ORIGINS: '*' }), /API_CORS_ORIGINS/);
});
