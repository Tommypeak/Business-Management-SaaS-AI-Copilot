import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { after, before, test } from 'node:test';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaPg } from '@prisma/adapter-pg';
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import {
  Permission,
  type OrganizationResponse,
  type OrganizationDetailResponse,
  type LocationResponse,
  type UserResponse,
  type PageResponse,
} from '@saas/types';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { OrganizationsService } from '../src/organizations/organizations.service.js';
import { configureApplication } from '../src/bootstrap.js';
import { validateEnvironment } from '../src/config/environment.js';
import { registerCatalogTests } from './catalog.scenarios.js';
import { registerInventoryTests } from './inventory.scenarios.js';
import { registerSalesTests } from './sales.scenarios.js';

const envPath = resolve('../../.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const schema = `stage2_${randomUUID().replaceAll('-', '')}`;
let admin: PrismaClient;
let prisma: PrismaService;
let app: NestFastifyApplication;
let jwks: Server;
let issuer: string;
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let tokenA: string;
let tokenB: string;
let tokenMember: string;
let userA: UserResponse;
let userB: UserResponse;
let member: UserResponse;
let orgA: OrganizationResponse;
let orgB: OrganizationResponse;
let locationB: LocationResponse;
let legacyOrganizationId: string;
const input = {
  name: 'Organization',
  businessType: 'RETAIL' as const,
  defaultCurrency: 'KZT',
  timezone: 'Asia/Almaty',
  locale: 'ru-KZ',
};

async function token(subject: string, claims: JWTPayload = {}) {
  return new SignJWT({
    iss: issuer,
    sub: subject,
    aud: 'saas-api',
    azp: 'http://localhost:3000',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 600,
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'integration-key' })
    .sign(privateKey);
}
function call(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  bearer?: string,
  payload?: Record<string, unknown>,
) {
  return app.inject({
    method,
    url,
    ...(bearer ? { headers: { authorization: `Bearer ${bearer}` } } : {}),
    ...(payload ? { payload } : {}),
  });
}

before(async () => {
  assert.ok(
    testDatabaseUrl,
    'Set TEST_DATABASE_URL to a dedicated PostgreSQL test database; integration tests never silently skip.',
  );
  assert.match(schema, /^stage2_[a-f0-9]{32}$/);
  const url = new URL(testDatabaseUrl);
  url.searchParams.set('schema', schema);
  admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl }) });
  // Identifier is generated above, never supplied by HTTP requests or environment.
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  const require = createRequire(import.meta.url);
  // Execute the actual Stage 2 SQL, seed an existing organization, then upgrade.
  for (const args of [
    ['db', 'execute', '--file', 'prisma/migrations/20260929084943_identity_tenancy/migration.sql'],
    ['migrate', 'resolve', '--applied', '20260929084943_identity_tenancy'],
  ]) {
    const result = spawnSync(
      process.execPath,
      [require.resolve('prisma/build/index.js'), ...args],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 60000,
        env: { ...process.env, DATABASE_URL: url.toString() },
      },
    );
    assert.equal(result.status, 0, `Stage 2 migration setup failed: ${args[0]}`);
  }
  const legacy = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url.toString() }, { schema }),
  });
  try {
    const organization = await legacy.organization.create({
      data: { ...input, name: 'Pre-Stage-3 organization' },
    });
    legacyOrganizationId = organization.id;
    for (const key of ['OWNER', 'ADMIN', 'MEMBER'])
      await legacy.role.create({
        data: { organizationId: organization.id, key, name: key, isSystem: true },
      });
  } finally {
    await legacy.$disconnect();
  }
  const migration = spawnSync(
    process.execPath,
    [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 60000,
      env: { ...process.env, DATABASE_URL: url.toString() },
    },
  );
  assert.equal(migration.status, 0, 'Migration deploy failed for the isolated integration schema');
  const keys = await generateKeyPair('RS256');
  privateKey = keys.privateKey;
  const publicKey = {
    ...(await exportJWK(keys.publicKey)),
    kid: 'integration-key',
    alg: 'RS256',
    use: 'sig',
  };
  jwks = createServer((request, response) => {
    if (request.url !== '/.well-known/jwks.json') {
      response.writeHead(404).end();
      return;
    }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ keys: [publicKey] }));
  });
  await new Promise<void>((resolve) => jwks.listen(0, '127.0.0.1', resolve));
  const address = jwks.address();
  assert.ok(address && typeof address !== 'string');
  issuer = `http://127.0.0.1:${address.port}`;
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: url.toString(),
    AUTH_ISSUER: issuer,
    AUTH_JWKS_URL: `${issuer}/.well-known/jwks.json`,
    AUTH_AUDIENCE: 'saas-api',
    AUTH_AUTHORIZED_PARTIES: 'http://localhost:3000',
  });
  const { AppModule } = await import('../src/app.module.js');
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    logger: false,
  });
  await configureApplication(app, ['http://localhost:3000']);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  prisma = app.get(PrismaService);
  [tokenA, tokenB, tokenMember] = await Promise.all([
    token('user-a'),
    token('user-b'),
    token('member'),
  ]);
});

after(async () => {
  if (app) await app.close();
  if (jwks)
    await new Promise<void>((resolve, reject) =>
      jwks.close((error) => (error ? reject(error) : resolve())),
    );
  if (admin) {
    assert.match(schema, /^stage2_[a-f0-9]{32}$/);
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.$disconnect();
  }
});

void test('health remains public and readiness uses real PostgreSQL and Redis', async () => {
  assert.equal((await call('GET', '/api/health')).statusCode, 200);
  assert.equal((await call('GET', '/api/health/ready')).statusCode, 200);
  assert.equal((await call('GET', '/api/docs')).statusCode, 404);
});

void test('authentication rejects missing, malformed, expired and incorrectly signed JWTs', async () => {
  const now = Math.floor(Date.now() / 1000);
  const otherKey = await generateKeyPair('RS256');
  const wrongSignature = await new SignJWT({
    iss: issuer,
    sub: 'attacker',
    aud: 'saas-api',
    iat: now,
    exp: now + 600,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'integration-key' })
    .sign(otherKey.privateKey);
  const symmetric = await new SignJWT({ iss: issuer, sub: 'attacker', iat: now, exp: now + 600 })
    .setProtectedHeader({ alg: 'HS256' })
    .sign(new Uint8Array(32));
  const invalid = [
    undefined,
    'not-a-jwt',
    await token('user-a', { exp: now - 60 }),
    await token('user-a', { iss: 'https://other.example' }),
    await token('user-a', { aud: 'another-api' }),
    await token('user-a', { sub: '' }),
    await token('user-a', { exp: undefined }),
    await token('user-a', { nbf: now + 600 }),
    await token('user-a', { azp: 'https://attacker.example' }),
    wrongSignature,
    symmetric,
  ];
  for (const bearer of invalid) {
    const response = await call('GET', '/api/v1/me', bearer);
    assert.equal(response.statusCode, 401);
    assert.ok(!response.body.includes('JWKS'));
  }
  assert.equal(await prisma.user.count(), 0);
});

void test('valid JWT creates local UUID identity once, including concurrent first requests', async () => {
  const replies = await Promise.all(
    Array.from({ length: 6 }, () => call('GET', '/api/v1/me', tokenA)),
  );
  for (const response of replies) assert.equal(response.statusCode, 200);
  userA = replies[0]!.json<UserResponse>();
  assert.equal(new Set(replies.map((response) => response.json<UserResponse>().id)).size, 1);
  assert.match(userA.id, /^[0-9a-f-]{36}$/);
  assert.notEqual(userA.id, 'user-a');
  assert.deepEqual(Object.keys(userA).sort(), ['createdAt', 'id']);
  const stored = await prisma.user.findUniqueOrThrow({ where: { id: userA.id } });
  await call('GET', '/api/v1/me', tokenA);
  const again = await prisma.user.findUniqueOrThrow({ where: { id: userA.id } });
  assert.equal(stored.updatedAt.getTime(), again.updatedAt.getTime());
  assert.equal(
    await prisma.user.count({ where: { authProvider: issuer, authSubject: 'user-a' } }),
    1,
  );
  userB = (await call('GET', '/api/v1/me', tokenB)).json<UserResponse>();
  member = (await call('GET', '/api/v1/me', tokenMember)).json<UserResponse>();
});

void test('organization creation assigns system roles, permissions and OWNER membership atomically', async () => {
  const a = await call('POST', '/api/v1/organizations', tokenA, { ...input, name: 'A' });
  assert.equal(a.statusCode, 201);
  orgA = a.json<OrganizationResponse>();
  orgB = (
    await call('POST', '/api/v1/organizations', tokenB, { ...input, name: 'B' })
  ).json<OrganizationResponse>();
  const membership = await prisma.organizationMembership.findUniqueOrThrow({
    where: { organizationId_userId: { organizationId: orgA.id, userId: userA.id } },
    include: { roles: { include: { role: true } } },
  });
  assert.equal(membership.status, 'ACTIVE');
  assert.deepEqual(
    membership.roles.map(({ role }) => role.key),
    ['OWNER'],
  );
  assert.equal(await prisma.role.count({ where: { organizationId: orgA.id, isSystem: true } }), 3);
  const detail = (
    await call('GET', `/api/v1/organizations/${orgA.id}`, tokenA)
  ).json<OrganizationDetailResponse>();
  assert.deepEqual(
    [...detail.currentMembership.permissions].sort(),
    Object.values(Permission).sort(),
  );
  const ownerRole = membership.roles[0]!.role;
  assert.equal(
    (
      await call('PATCH', `/api/v1/organizations/${orgA.id}/roles/${ownerRole.id}`, tokenA, {
        key: 'MEMBER',
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (await call('DELETE', `/api/v1/organizations/${orgA.id}/roles/${ownerRole.id}`, tokenA))
      .statusCode,
    404,
  );
});

void test('late database failure rolls back organization, membership, roles and permissions', async () => {
  const before = await Promise.all([
    prisma.organization.count(),
    prisma.organizationMembership.count(),
    prisma.role.count(),
    prisma.rolePermission.count(),
  ]);
  await admin.$executeRawUnsafe(
    `CREATE FUNCTION "${schema}".reject_assignment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test transaction failure'; END $$`,
  );
  await admin.$executeRawUnsafe(
    `CREATE TRIGGER reject_assignment BEFORE INSERT ON "${schema}"."MembershipRole" FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_assignment()`,
  );
  try {
    const response = await call('POST', '/api/v1/organizations', tokenA, {
      ...input,
      name: 'Must roll back',
    });
    assert.equal(response.statusCode, 500);
    assert.ok(!response.body.includes('test transaction failure'));
    assert.deepEqual(
      await Promise.all([
        prisma.organization.count(),
        prisma.organizationMembership.count(),
        prisma.role.count(),
        prisma.rolePermission.count(),
      ]),
      before,
    );
  } finally {
    await admin.$executeRawUnsafe(`DROP TRIGGER reject_assignment ON "${schema}"."MembershipRole"`);
    await admin.$executeRawUnsafe(`DROP FUNCTION "${schema}".reject_assignment()`);
  }
  assert.ok(app.get(OrganizationsService));
});

void test('tenant isolation rejects foreign organization and location UUIDs, including a forged own-tenant URL', async () => {
  const location = await call('POST', `/api/v1/organizations/${orgB.id}/locations`, tokenB, {
    name: 'Private B',
    type: 'WAREHOUSE',
  });
  assert.equal(location.statusCode, 201);
  locationB = location.json<LocationResponse>();
  assert.equal((await call('GET', `/api/v1/organizations/${orgA.id}`, tokenA)).statusCode, 200);
  for (const suffix of ['', '/locations', '/members', '/roles'])
    assert.equal(
      (await call('GET', `/api/v1/organizations/${orgB.id}${suffix}`, tokenA)).statusCode,
      404,
    );
  assert.equal(
    (await call('PATCH', `/api/v1/organizations/${orgB.id}`, tokenA, { name: 'Hacked' }))
      .statusCode,
    404,
  );
  assert.equal(
    (
      await call('POST', `/api/v1/organizations/${orgB.id}/locations`, tokenA, {
        name: 'Hacked',
        type: 'OTHER',
      })
    ).statusCode,
    404,
  );
  for (const id of [orgA.id, orgB.id])
    assert.equal(
      (
        await call('PATCH', `/api/v1/organizations/${id}/locations/${locationB.id}`, tokenA, {
          name: 'Hacked',
        })
      ).statusCode,
      404,
    );
  const list = (await call('GET', '/api/v1/organizations', tokenA)).json<
    PageResponse<OrganizationResponse>
  >();
  assert.deepEqual(
    list.items.map((item) => item.id),
    [orgA.id],
  );
  assert.equal(
    (await prisma.location.findUniqueOrThrow({ where: { id: locationB.id } })).name,
    'Private B',
  );
});

void test('MEMBER permissions cannot be bypassed by REST, request bodies, headers or signed role claims', async () => {
  const role = await prisma.role.findUniqueOrThrow({
    where: { organizationId_key: { organizationId: orgA.id, key: 'MEMBER' } },
  });
  const membership = await prisma.organizationMembership.create({
    data: { organizationId: orgA.id, userId: member.id },
  });
  await prisma.membershipRole.create({
    data: { membershipId: membership.id, roleId: role.id, organizationId: orgA.id },
  });
  const forged = await token('member', {
    userId: userA.id,
    role: 'OWNER',
    organizationId: orgB.id,
    permissions: Object.values(Permission),
  });
  assert.equal((await call('GET', `/api/v1/organizations/${orgA.id}`, forged)).statusCode, 200);
  assert.equal((await call('GET', `/api/v1/organizations/${orgB.id}`, forged)).statusCode, 404);
  assert.equal(
    (await call('PATCH', `/api/v1/organizations/${orgA.id}`, forged, { name: 'Hacked' }))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await call('POST', `/api/v1/organizations/${orgA.id}/locations`, forged, {
        name: 'Hacked',
        type: 'STORE',
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await call('GET', `/api/v1/organizations/${orgA.id}/members`, forged)).statusCode,
    403,
  );
  assert.equal(
    (await call('GET', `/api/v1/organizations/${orgA.id}/roles`, forged)).statusCode,
    403,
  );
  const response = await app.inject({
    method: 'PATCH',
    url: `/api/v1/organizations/${orgA.id}`,
    headers: {
      authorization: `Bearer ${tokenMember}`,
      'x-user-id': userA.id,
      'x-role': 'OWNER',
      'x-organization-id': orgA.id,
    },
    payload: { name: 'Hacked' },
  });
  assert.equal(response.statusCode, 403);
});

void test('database constraints prevent cross-tenant role assignment and duplicate membership', async () => {
  const membership = await prisma.organizationMembership.findUniqueOrThrow({
    where: { organizationId_userId: { organizationId: orgA.id, userId: member.id } },
  });
  const foreignRole = await prisma.role.findUniqueOrThrow({
    where: { organizationId_key: { organizationId: orgB.id, key: 'OWNER' } },
  });
  await assert.rejects(
    prisma.membershipRole.create({
      data: { organizationId: orgA.id, membershipId: membership.id, roleId: foreignRole.id },
    }),
  );
  await assert.rejects(
    prisma.organizationMembership.create({ data: { organizationId: orgA.id, userId: member.id } }),
  );
});

void test('suspended memberships disappear immediately and one user can join multiple organizations', async () => {
  await prisma.organizationMembership.update({
    where: { organizationId_userId: { organizationId: orgA.id, userId: member.id } },
    data: { status: 'SUSPENDED' },
  });
  assert.equal(
    (await call('GET', `/api/v1/organizations/${orgA.id}`, tokenMember)).statusCode,
    404,
  );
  assert.equal(
    (await call('GET', '/api/v1/organizations', tokenMember)).json<
      PageResponse<OrganizationResponse>
    >().items.length,
    0,
  );
  const membership = await prisma.organizationMembership.create({
    data: { organizationId: orgB.id, userId: userA.id },
  });
  const role = await prisma.role.findUniqueOrThrow({
    where: { organizationId_key: { organizationId: orgB.id, key: 'MEMBER' } },
  });
  await prisma.membershipRole.create({
    data: { organizationId: orgB.id, membershipId: membership.id, roleId: role.id },
  });
  const page = (await call('GET', '/api/v1/organizations?limit=1', tokenA)).json<
    PageResponse<OrganizationResponse>
  >();
  assert.equal(page.items.length, 1);
  assert.ok(page.nextCursor);
  const second = (
    await call('GET', `/api/v1/organizations?limit=1&cursor=${page.nextCursor}`, tokenA)
  ).json<PageResponse<OrganizationResponse>>();
  assert.equal(second.items.length, 1);
  assert.notEqual(page.items[0]!.id, second.items[0]!.id);
  assert.equal(
    (
      await call('PATCH', `/api/v1/organizations/${orgB.id}/locations/${locationB.id}`, tokenA, {
        name: 'Still forbidden',
      })
    ).statusCode,
    403,
  );
});

void test('DTOs reject mass assignment, invalid currency/timezone, null fields and tenant reassignment', async () => {
  for (const field of ['ownerId', 'userId', 'createdBy', 'organizationId', 'permissions'])
    assert.equal(
      (await call('POST', '/api/v1/organizations', tokenA, { ...input, [field]: userB.id }))
        .statusCode,
      400,
    );
  for (const bad of [
    { name: ' ' },
    { businessType: 'UNKNOWN' },
    { defaultCurrency: 'ZZZ' },
    { timezone: '+05:00' },
    { locale: 'not_a_locale' },
    { name: null },
  ])
    assert.equal(
      (await call('PATCH', `/api/v1/organizations/${orgA.id}`, tokenA, bad)).statusCode,
      400,
      `Expected rejection of ${JSON.stringify(bad)}`,
    );
  assert.equal(
    (
      await call('PATCH', `/api/v1/organizations/${orgB.id}/locations/${locationB.id}`, tokenB, {
        organizationId: orgA.id,
      })
    ).statusCode,
    400,
  );
  const archived = await call(
    'PATCH',
    `/api/v1/organizations/${orgB.id}/locations/${locationB.id}`,
    tokenB,
    { isActive: false },
  );
  assert.equal(archived.json<LocationResponse>().isActive, false);
  const renamed = await call(
    'PATCH',
    `/api/v1/organizations/${orgB.id}/locations/${locationB.id}`,
    tokenB,
    { name: 'Renamed' },
  );
  assert.equal(renamed.json<LocationResponse>().isActive, false);
  const updated = await call('PATCH', `/api/v1/organizations/${orgA.id}`, tokenA, {
    name: 'Renamed A',
  });
  assert.equal(updated.json<OrganizationResponse>().locale, 'ru-KZ');
  assert.equal((await call('GET', '/api/v1/organizations?limit=1000', tokenA)).statusCode, 400);
});

void test('production configuration rejects missing auth and HTTP JWKS', () => {
  const base = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://localhost/db',
    REDIS_URL: 'redis://localhost:6379',
  };
  assert.throws(() => validateEnvironment(base), /Authentication/);
  assert.throws(
    () =>
      validateEnvironment({
        ...base,
        AUTH_ISSUER: issuer,
        AUTH_JWKS_URL: `${issuer}/.well-known/jwks.json`,
      }),
    /HTTPS/,
  );
  assert.equal(
    validateEnvironment({
      ...base,
      AUTH_ISSUER: 'https://identity.example',
      AUTH_JWKS_URL: 'https://identity.example/jwks',
    }).AUTH_AUDIENCE,
    '',
  );
});

registerCatalogTests(() => ({ app, prisma, admin, schema, token, legacyOrganizationId }));
registerInventoryTests(() => ({ app, prisma, admin, schema, token, legacyOrganizationId }));
registerSalesTests(() => ({ app, prisma, admin, schema, token, legacyOrganizationId }));
