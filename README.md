# Business Management SaaS + AI Copilot

## Project

Технический фундамент будущей multi-tenant SaaS-платформы. Stage 1 содержит только
инфраструктуру, конфигурацию приложений, health endpoints и проверки качества.
Бизнес-функции, authentication, multi-tenancy и AI-интеграции пока не реализованы.

## Architecture

```text
Next.js → NestJS → PostgreSQL
                 ↘ Redis

NestJS → FastAPI AI Service
```

Это целевое направление взаимодействия. На Stage 1 web не вызывает API, а API ещё
не вызывает AI. NestJS уже подключается к PostgreSQL и Redis.

Основной backend — modular monolith. Будущие бизнес-модули будут размещаться внутри
NestJS. Python-сервис выделен отдельно для Python/ML ecosystem.

```text
apps/
  web/                   Next.js App Router, Tailwind, frontend health
  api/
    prisma/              Схема Prisma без моделей
    prisma.config.ts     Настройки Prisma CLI
    src/
      config/            Проверка переменных окружения
      prisma/            PrismaModule / PrismaService
      redis/             Подключение Redis и ping
      health/            Liveness / readiness
      generated/         Сгенерированный Prisma Client, исключён из Git
    test/                HTTP smoke tests через Fastify injection
  ai/
    app/api/             HTTP routes
    app/core/            Pydantic settings
    app/services/        Место для будущих Python services
    tests/               Health smoke test
    pyproject.toml
    uv.lock
packages/
  types/                 Только общие TypeScript types
  config/                Общая строгая конфигурация TypeScript
  eslint-config/         Конфигурации для web, API и shared packages
infrastructure/docker/   Production Dockerfiles
scripts/                 Запуск приложений с корневым .env
.github/workflows/       CI: quality checks и container smoke tests
docker-compose.yml       Локальные PostgreSQL и Redis
```

Frontend импортирует только общие типы из `@saas/types`, без импорта backend source.
`@saas/config` не содержит runtime-настроек или секретов.

## Requirements

- Node.js **22 LTS, не ниже 22.13**; также поддерживается Node.js 24 LTS.
  CI и Docker используют ветку 22, указанную в `.node-version`.
- pnpm **10.34.6**, закреплённый в `packageManager`.
- Python **3.12** (проект допускает 3.13; CI/local default — `.python-version`).
- uv **0.12.19**; CI и Docker используют ту же версию.
- Docker Engine / Docker Desktop с Compose v2.
- Git.

Установите pnpm указанной версии через Corepack или официальный установщик pnpm.
Для Corepack: `corepack enable`, затем `corepack install` в корне репозитория.
Проверьте `node --version`, `pnpm --version`, `uv --version`, `docker version`.
uv автоматически установит подходящий Python при его отсутствии.

## Development setup

1. Клонируйте репозиторий:

   ```sh
   git clone <repository-url> business-management-saas
   cd business-management-saas
   ```

2. Создайте `.env` из `.env.example`:

   ```sh
   cp .env.example .env
   ```

   В PowerShell используйте `Copy-Item .env.example .env`.
   Замените `replace_with_local_password` в `POSTGRES_PASSWORD` и `DATABASE_URL`
   одним локальным паролем. Спецсимволы в URL должны быть percent-encoded.
   Реальные `.env` исключены из Git и Docker build context.

3. Установите зависимости из lockfiles:

   ```sh
   pnpm install --frozen-lockfile
   pnpm ai:install
   ```

4. Запустите инфраструктуру:

   ```sh
   pnpm infra:up
   docker compose ps
   ```

   Оба контейнера должны иметь статус `healthy`. Порты публикуются только на
   `127.0.0.1`. Если `5432` занят, измените `POSTGRES_PORT`, например на `55432`,
   и соответствующий порт в `DATABASE_URL`. Для Redis аналогично измените
   `REDIS_PORT` и `REDIS_URL`.

5. Запустите все приложения:

   ```sh
   pnpm dev
   ```

   Turbo сначала генерирует Prisma Client и подготавливает shared types.
   Корневой `.env` загружается launcher-скриптом для всех трёх приложений;
   уже заданные переменные процесса имеют приоритет. `Ctrl+C` останавливает приложения.
   В Windows при зависшем ожидании batch wrappers в Turbo нажмите `Ctrl+C` повторно;
   это завершит оставшиеся оболочки после остановки сервисов.

   Можно запускать отдельно: `pnpm --filter @saas/web dev`,
   `pnpm --filter @saas/api dev`, `pnpm --filter @saas/ai dev`.
   Перед отдельным первым запуском API выполните `pnpm db:generate`.

6. Проверьте endpoints:

   ```sh
   curl http://127.0.0.1:3000/api/health
   curl http://127.0.0.1:3001/api/health
   curl http://127.0.0.1:3001/api/health/ready
   curl http://127.0.0.1:8000/health
   ```

## Commands

| Команда                               | Назначение                                                   |
| ------------------------------------- | ------------------------------------------------------------ |
| `pnpm dev`                            | Три приложения в режиме разработки                           |
| `pnpm build`                          | Next.js production build, NestJS compile, Python wheel/sdist |
| `pnpm lint`                           | ESLint для TypeScript и Ruff для Python                      |
| `pnpm typecheck`                      | Next route types + strict TypeScript, strict mypy            |
| `pnpm test`                           | API HTTP smoke tests и Python pytest                         |
| `pnpm format`                         | Prettier и Ruff formatter                                    |
| `pnpm format:check`                   | Проверка форматирования без изменений                        |
| `pnpm ai:install`                     | `uv sync --locked` для Python                                |
| `pnpm db:generate`                    | Генерация Prisma Client без подключения к БД                 |
| `pnpm --filter @saas/api db:validate` | Валидация Prisma schema                                      |
| `pnpm infra:up`                       | Compose up с ожиданием healthy                               |
| `pnpm infra:down`                     | Остановка инфраструктуры с сохранением volumes               |

После `pnpm build` доступны отдельные `pnpm --filter @saas/web start`,
`pnpm --filter @saas/api start`, `pnpm --filter @saas/ai start`.
Для полноценного production запуска предпочтительны Docker images ниже.

Web проверяется production-сборкой. API tests не требуют базы: проверяют реальные
Nest routes через Fastify injection с подменой инфраструктурных providers, включая
readiness failures и CORS. CI отдельно проверяет контейнеры с настоящими PostgreSQL
и Redis. Root-команды включают Python через небольшой package.json-адаптер для Turbo;
Python-зависимостями управляет исключительно uv.

Husky запускает lint-staged: изменённые TS/JS/JSON/Markdown/YAML/CSS форматируются
Prettier. Python туда не попадает; его Ruff/mypy/pytest проверки входят в root-команды
и CI. Полный ESLint запускается через `pnpm lint` и CI.

## Services

| Сервис     | Адрес по умолчанию                                                   |
| ---------- | -------------------------------------------------------------------- |
| Web        | <http://127.0.0.1:3000>                                              |
| API        | <http://127.0.0.1:3001/api> (корневого route пока нет)               |
| AI         | <http://127.0.0.1:8000> (корневого route пока нет)                   |
| AI docs    | <http://127.0.0.1:8000/docs> только при `AI_ENVIRONMENT=development` |
| PostgreSQL | `127.0.0.1:5432`                                                     |
| Redis      | `127.0.0.1:6379`                                                     |

`WEB_PORT`, `API_PORT`, `AI_PORT` управляют портами локального запуска.
При изменении frontend origin обновите `API_CORS_ORIGINS`.

## Health endpoints

| Endpoint                       | Ответ / смысл                                                             |
| ------------------------------ | ------------------------------------------------------------------------- |
| `GET /api/health` на web       | `{"status":"ok","service":"web"}`                                         |
| `GET /api/health` на API       | `{"status":"ok","service":"api"}`; процесс жив                            |
| `GET /api/health/ready` на API | Тот же ответ только после PostgreSQL `SELECT 1` и Redis `PING`; иначе 503 |
| `GET /health` на AI            | `{"status":"ok","service":"ai"}`                                          |

API readiness имеет таймаут 5 секунд и не возвращает детали подключения.
Health routes нейтральны к версии; будущие API controllers по умолчанию будут
доступны под `/api/v1/...`.

## Database and runtime configuration

Prisma расположен внутри API. Версия 7 использует `prisma.config.ts` для
`DATABASE_URL` и PostgreSQL driver adapter в runtime. В schema только generator и
datasource: Prisma поддерживает raw SQL без моделей, поэтому техническая таблица
и пустая миграция не нужны. Миграции появятся вместе с первой реальной моделью.

`PrismaModule` экспортирует `PrismaService`; будущие модули смогут явно импортировать
его. Соединение и `SELECT 1` проверяются при старте; shutdown закрывает pool.
RedisService создаёт одно подключение, ограничивает reconnect и закрывает его при
shutdown. После исчерпания reconnect-проб требуется перезапуск процесса.
Cache abstraction и queues отсутствуют.

API валидирует обязательные URL, порт, режим и список CORS origins при старте.
Включены global validation pipe, Helmet, ограничение body 1 MiB, JSON application
logs и shutdown hooks. CORS по умолчанию закрыт; `.env.example` разрешает только
локальный frontend. `trustProxy` выключен; при будущем размещении за proxy следует
настроить доверенные proxy явно.

Изменение `POSTGRES_PASSWORD` не меняет пароль в уже инициализированном volume.
Для существующих данных меняйте пароль средствами PostgreSQL. Команда
`docker compose down --volumes` удаляет локальные данные — обычный `infra:down`
её не использует.

## Docker images

Все сборки выполняются из корня monorepo:

```sh
docker build -f infrastructure/docker/web.Dockerfile -t saas-web:local .
docker build -f infrastructure/docker/api.Dockerfile -t saas-api:local .
docker build -f infrastructure/docker/ai.Dockerfile -t saas-ai:local .
```

Образы используют multi-stage builds, непривилегированного пользователя и healthchecks.
Web содержит Next standalone output; API — compiled JS и production dependencies;
AI — готовый Python venv без dev tools. Build не требует секретов или запущенной БД.
Compose содержит только инфраструктуру для разработки.

В контейнере API передайте `DATABASE_URL` и `REDIS_URL` через окружение оркестратора;
имена хостов в Compose network — `postgres` и `redis`, внутренние порты — 5432/6379.
API image уже задаёт `API_HOST=0.0.0.0`, `API_PORT=3001`, `NODE_ENV=production`.
Web standalone использует `PORT` (3000) и `HOSTNAME` (0.0.0.0).
AI слушает 8000; при необходимости измените uvicorn command.
Пароли не передаются через build arguments и не сохраняются в image.

## CI

GitHub Actions запускается на push и pull request. Quality job устанавливает
зависимости по lockfiles и запускает format check, lint, typecheck, tests и build.
Container job поднимает изолированную инфраструктуру, собирает три Docker image
и проверяет HTTP health/readiness. CI генерирует временный пароль БД и не требует
production secrets. Настроены pnpm, uv и Docker build caches.

## Dependency references

- [Next.js installation](https://nextjs.org/docs/app/getting-started/installation)
- [NestJS Fastify adapter](https://docs.nestjs.com/techniques/performance)
- [Prisma 7 configuration and driver adapters](https://docs.prisma.io/docs/guides/upgrade-prisma-orm/v7)
- [uv installation](https://docs.astral.sh/uv/getting-started/installation/)

Версии Node/Python packages закреплены в manifests и lockfiles. Обновления major
версий выполняются отдельно с повторной проверкой совместимости.
