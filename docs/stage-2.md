# Stage 2 — Identity, Organizations & Multi-Tenancy

## Scope

Clerk выполняет authentication. Наш PostgreSQL хранит глобальную локальную
identity, организации, memberships, роли, permissions и Locations. Clerk
Organizations не используются. AI service не изменён. Приглашения, управление
участниками, custom role CRUD и бизнес-модули относятся к следующим этапам.

## Clerk configuration

1. Создайте приложение в Clerk Dashboard и выберите нужные способы входа.
   Используйте development instance для локальной разработки.
2. Перенесите publishable key и secret key в корневой `.env`:
   `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` и `CLERK_SECRET_KEY`.
   Secret key нужен только web-серверу, не API и не браузеру.
3. Задайте `AUTH_ISSUER` равным точному issuer session token этой instance,
   а `AUTH_JWKS_URL` — её опубликованному JWKS endpoint (обычно путь
   `/.well-known/jwks.json` на issuer). Не смешивайте разные instances.
4. `AUTH_AUDIENCE` оставьте пустым, если session token не содержит audience.
   Если provider настроен выпускать `aud`, задайте ожидаемое значение;
   backend обязательно сверяет его. Отдельный JWT template не требуется.
5. В `AUTH_AUTHORIZED_PARTIES` перечислите frontend origins, которым разрешён
   вход: проверяется подписанный `azp`. Для production задайте реальные HTTPS
   origins и согласуйте их с Clerk и `API_CORS_ORIGINS`.
6. `API_BASE_URL` — server-side URL NestJS с `/api/v1`. Он не берётся из формы
   или query string. Перезапустите приложения после изменения конфигурации.

Пути приложения: `/sign-in`, `/sign-up`, после входа `/app`, после выхода `/`.
В production включите production instance Clerk и настройте домен по
[официальной инструкции Clerk](https://clerk.com/docs/deployments/overview).
SDK подключён через Next.js `proxy.ts`, async `auth()` и `ClerkProvider`.

Без двух web-ключей auth routes закрыты с 503. Отсутствие backend issuer/JWKS
допустимо только вне production; это не включает auth bypass. API production
не стартует без этих настроек. HTTPS обязателен для provider URLs, кроме
loopback HTTP в development/test.

## Identity and authorization

`jose` проверяет подпись по кешируемому remote JWKS, issuer, expiration,
subject, наличие iat, nbf при его наличии, настроенные audience и authorized
parties. Допустимы только RS256/ES256, допуск часов — 5 секунд. API не хранит
private signing key provider. Token не декодируется для доверенного доступа
до проверки подписи.

Локальный `User.id` — UUID. Unique `(authProvider, authSubject)` связывает его
с configured issuer и verified `sub`. Первый запрос создаёт identity с обработкой
гонки unique constraint; последующие не выполняют записи. Email/имя из
непроверенного профиля не копируются. `/me` возвращает только UUID и createdAt.

Authorization pipeline:

```text
AuthGuard (global, protected by default)
  → OrganizationMembershipGuard (ACTIVE membership from PostgreSQL)
  → PermissionsGuard (permissions from tenant-scoped database roles)
  → Controller → Service (organizationId-scoped queries)
```

JWT claims `role`, `permissions`, `organizationId`, `userId` и одноимённые
заголовки не являются источником authorization. Context строится заново на
каждый запрос; suspension действует со следующего запроса. Кеш membership
не используется. Нет доступа по одному лишь знанию UUID.

401 означает отсутствие/невалидность token, 403 — недостаток permission
у участника, 404 — отсутствие ACTIVE membership, чужой или отсутствующий
tenant resource. SQL errors и JWT internals не возвращаются клиенту.

## Database

Migration: `apps/api/prisma/migrations/20260929084943_identity_tenancy/migration.sql`.

| Model                  | Назначение и ограничения                                                |
| ---------------------- | ----------------------------------------------------------------------- |
| User                   | Глобальная identity, unique provider + subject                          |
| Organization           | Название, businessType, ISO 4217 currency, IANA timezone, BCP 47 locale |
| OrganizationMembership | User ↔ organization, ACTIVE/SUSPENDED, unique organization + user       |
| Role                   | Роль конкретной organization, unique organization + key, isSystem       |
| RolePermission         | Permission code роли; составной FK role + organization                  |
| MembershipRole         | Назначение роли; оба FK включают organizationId                         |
| Location               | Tenant-owned помещение/точка, type и isActive                           |

Все tenant-owned таблицы содержат organizationId. Composite foreign keys
не позволяют назначить membership роль другой организации даже при прямой
ошибке в коде записи. Индексы покрывают identity lookup, membership lookup,
tenant role lookup и списки Locations. Application authorization является
основным уровнем изоляции; PostgreSQL RLS пока не включён.

Создание организации, membership, трёх ролей, permissions и OWNER assignment
выполняется одной PostgreSQL transaction. `userId` приходит только из auth
context. DTO запрещают лишние поля, null обязательных значений, неверные enum,
currency и timezone. PATCH меняет только переданные поля: archive не сбрасывается
при переименовании, locale не сбрасывается при других обновлениях.

## Roles and permissions

| Permission          | OWNER | ADMIN | MEMBER |
| ------------------- | ----- | ----- | ------ |
| organization.view   | Да    | Да    | Да     |
| organization.update | Да    | Да    | Нет    |
| members.view        | Да    | Да    | Нет    |
| members.manage      | Да    | Нет   | Нет    |
| roles.view          | Да    | Да    | Нет    |
| roles.manage        | Да    | Нет   | Нет    |
| locations.view      | Да    | Да    | Да     |
| locations.manage    | Да    | Да    | Нет    |

Registry находится в `packages/types`, серверные role presets — в
`apps/api/src/authorization/permissions.ts`. Frontend использует permission
constants только для UX. OWNER не обходит guards специальным условием.

На этом этапе роли и участники доступны только для чтения. API удаления ролей,
смены system key, owner transfer, изменения assignments и invitations нет.
Таким образом system roles и ownership нельзя изменить через Stage 2 API.
`members.manage` и `roles.manage` зарезервированы в foundation registry;
они ещё не открывают дополнительных write endpoints.

## API

Все пути ниже начинаются с `/api/v1`, требуют Bearer token.

| Method | Path                                                 | Permission                              |
| ------ | ---------------------------------------------------- | --------------------------------------- |
| GET    | /me                                                  | Authenticated identity                  |
| GET    | /organizations                                       | Только свои ACTIVE memberships          |
| POST   | /organizations                                       | Authenticated identity становится OWNER |
| GET    | /organizations/:organizationId                       | organization.view                       |
| PATCH  | /organizations/:organizationId                       | organization.update                     |
| GET    | /organizations/:organizationId/members               | members.view                            |
| GET    | /organizations/:organizationId/roles                 | roles.view                              |
| GET    | /organizations/:organizationId/locations             | locations.view                          |
| POST   | /organizations/:organizationId/locations             | locations.manage                        |
| PATCH  | /organizations/:organizationId/locations/:locationId | locations.manage                        |

Списки: `{ items, nextCursor }`, query `limit` 1–100 (default 50), `cursor` UUID.
Cursor применяется внутри tenant/membership scope и не ищет чужую запись.
Физического удаления Locations нет; архивирование — PATCH `isActive: false`.
Все API responses имеют `Cache-Control: no-store`.

Публичные `/api/health` и `/api/health/ready` сохранены. Swagger UI доступен
по `/api/docs`, JSON по `/api/docs-json` только в development. Bearer schema
присутствует; production не регистрирует documentation routes.

## Web

- `/`: минимальная landing с переходом ко входу/регистрации/приложению.
- `/sign-in`, `/sign-up`: managed Clerk flows.
- `/app`: список организаций; onboarding при пустом списке и создание новой.
- `/app/[organizationId]`: сведения, текущие роли, tenant-aware switcher.
- `/app/[organizationId]/settings`: редактирование разрешённых настроек.
- `/app/[organizationId]/locations`: список, создание, изменение и архивирование.

Logout через Clerk UserButton. Next server components/actions используют единый
server-only API client с timeout, no-store, typed responses и обработкой ошибок.
Token получается через Clerk `auth().getToken()` и отправляется только сервером
к настроенному API. Приложение не сохраняет token в localStorage. Tenant в URL —
выбор навигации; backend заново проверяет membership и permission.

## Tests and operational limits

`pnpm test` запускает исходные health smoke tests и integration suite с реальной
test database. На каждый прогон создаётся schema со случайным UUID, применяется
настоящая migration и поднимается loopback JWKS с временной RSA key pair.
Используется обычный production JWT verifier; test auth bypass отсутствует.
Schema удаляется в teardown. При аварийном завершении процесса случайная schema
может остаться в dedicated test database и потребовать ручной очистки.

Проверяются invalid JWT/signature/issuer/audience/expiration/azp, гонка первого
входа, duplicate identity, tenant IDOR, role/header spoofing, suspension,
multi-organization membership, FK isolation, DTO mass assignment и транзакционный
rollback через принудительную ошибку БД на assignment. CI не требует Clerk secrets.

Browser login с реальным provider требует ваших credentials и отдельного
ручного smoke test: вход → организация → location → настройки → выход.
Backend integration tests проверяют весь JWT/authorization pipeline, но не
являются проверкой внешнего Clerk Dashboard, OAuth/email или cookies реального
production домена. Offline JWT verification признаёт отзыв session после истечения
короткоживущего token; live provider introspection на этом этапе не добавлен.

Перед production release применяйте migrations отдельным job, ограничивайте
сетевой доступ к БД, задавайте точные origins и секреты через runtime secret store.
Future tenant modules обязаны подключать оба authorization guards, объявлять
permissions и сохранять organizationId в каждом resource query.
