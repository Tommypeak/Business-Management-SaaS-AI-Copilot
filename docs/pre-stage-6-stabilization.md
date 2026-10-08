# Проверка перед Stage 6 — 7–9 октября 2026

Локальная проверка Stage 2–5, включая настоящий Clerk login, защищённые браузерные
сценарии и logout, завершена. Ready for Stage 6: **YES** в рамках локальной
стабилизации. Подробности фактически выполненных браузерных сценариев приведены ниже.
Stage 6 не начинался. Commit и push не выполнялись.

## Git и изменения

В начале checkout находился на `main`, рабочее дерево было чистым, локальной ветки
стабилизации не было. Создана `codex/pre-stage-6-stabilization` от
`15dbfe0` (`Merge Stage 2-5: identity, catalog, inventory and sales`).

Изменения для review:

| Файл                                | Назначение                                                         |
| ----------------------------------- | ------------------------------------------------------------------ |
| `.env.example`                      | Внешний порт PostgreSQL и DATABASE_URL изменены на 5433            |
| `docker-compose.yml`                | Порт PostgreSQL по умолчанию 5433, внутренний остаётся 5432        |
| `README.md`                         | Адрес PostgreSQL и инструкция сосуществования с Windows PostgreSQL |
| `docs/pre-stage-6-stabilization.md` | Этот отчёт, ограничения и воспроизводимые команды                  |

Дополнительно изменён `apps/web/next.config.ts`: включён `skipProxyUrlNormalize`
для исправления подтверждённого цикла proxy при активном Clerk (подробности ниже).
Бизнес-код, зависимости, lockfiles и существующие migrations не изменены.
Создан локальный `.env` со случайным dev-паролем и отдельным TEST_DATABASE_URL.
Файл исключён из Git; credentials в отчёт не включены.
Логи проверки находятся в игнорируемой `.tools/stabilization/`.

## Фактическая архитектура

Monorepo использует pnpm workspace и Turborepo. Node.js на машине — 24.21.0;
Corepack автоматически выбрал закреплённый проектом pnpm 10.34.6.

| Область                                     | Реализация                                                                              |
| ------------------------------------------- | --------------------------------------------------------------------------------------- |
| `apps/web`                                  | Next.js 16.3.6, React 19.3.0, App Router, Clerk; server components/actions вызывают API |
| `apps/api`                                  | NestJS 11.2.6, Fastify 5.11.3, modular monolith, versioned REST `/api/v1`               |
| ORM                                         | Prisma 7.10.0, PostgreSQL adapter, schema и SQL migrations внутри API                   |
| `apps/ai`                                   | FastAPI 0.141.1; отдельный Python-сервис с health, без реализованных AI-вызовов         |
| `packages/types`                            | Общие API contracts, enums и permission constants                                       |
| `packages/config`, `packages/eslint-config` | Общая конфигурация TypeScript и ESLint                                                  |
| `infrastructure/docker`                     | Dockerfiles приложений; локальный Compose содержит только PostgreSQL и Redis            |
| `scripts/run-service.mjs`                   | Штатный launcher, загружающий корневой `.env`                                           |
| Redis                                       | Соединение и readiness PING; cache abstraction, очередей и background jobs пока нет     |

Authentication: Clerk, JWT/JWKS через jose. Identity хранится локально по паре
issuer/subject. Authorization: ACTIVE membership и permissions из tenant-scoped
ролей БД. Изоляция обеспечивается guards, scoped queries и составными foreign keys;
PostgreSQL RLS не включён.

Catalog: товары/услуги, категории, варианты, единицы enum, SKU/barcode, цены
Decimal(19,4), options и custom fields. Inventory: Locations, включая WAREHOUSE,
неизменяемый ledger, projection balances Decimal(19,6), opening/adjustment/transfer/reversal.
Продажи: customers, DRAFT/COMPLETED/CANCELLED orders, price/name snapshots,
атомарное списание tracked products и ручные payments. Платёжного acquiring нет.
Завершение заказа и изменение stock выполняются в одной транзакции PostgreSQL.

## Окружение и инфраструктура

Docker Desktop был установлен, но Engine не работал. Он запущен, конфигурация
Compose проверена до старта. Выполнен `docker compose up -d --wait postgres redis`.

| Контейнер                             | Image                | Статус                   | Публикация порта         |
| ------------------------------------- | -------------------- | ------------------------ | ------------------------ |
| `business-management-saas-postgres-1` | `postgres:17-alpine` | healthy, restart count 0 | `127.0.0.1:5433 -> 5432` |
| `business-management-saas-redis-1`    | `redis:7.4-alpine`   | healthy, restart count 0 | `127.0.0.1:6379 -> 6379` |

PostgreSQL: host `127.0.0.1`, port `5433`, database `business_management`, user `saas`.
Тестовая БД: `business_management_test` в этом же проектном контейнере.
Redis: `127.0.0.1:6379`, фактический ответ `PONG`.
Windows PostgreSQL продолжает слушать `5432`; процесс, пароль и данные не изменялись.
Volumes не удалялись, destructive reset/prune не выполнялись.

Настроены DATABASE_URL, TEST_DATABASE_URL, POSTGRES_*, REDIS_URL/REDIS_PORT,
API/WEB/AI host и port, NODE_ENV, AI_ENVIRONMENT, API_CORS_ORIGINS, API_BASE_URL.
При первом проходе Clerk web keys, AUTH_ISSUER и AUTH_JWKS_URL были пустыми.
После получения разрешения и development keys заполнены только соответствующие
четыре строки локального `.env`. Секретные значения не включены в Git или отчёт.
AUTH_AUTHORIZED_PARTIES содержит локальные frontend origins; AUTH_AUDIENCE пустой.

`uv` отсутствовал; установлен uv 0.12.19 через пользовательский pip.
Системный Python 3.14 не удовлетворяет `>=3.12,<3.14` в pyproject.toml.
Установлен отдельный Python 3.12.14; системный Python не менялся.
uv сообщил ошибку minor-version link, хотя сам интерпретатор установлен.
Первый `uv sync --locked` успешно выполнен с явным UV_PYTHON; создана `apps/ai/.venv`.
После этого `uv run --locked python --version` успешно работает и без UV_PYTHON.
Глобальный PATH и ExecutionPolicy не менялись: путь uv добавлялся только в процессы
проверки и запуска. Для нового PowerShell приведены команды ниже.

## Database

Prisma validate прошёл. Штатный `pnpm.cmd --filter @saas/api db:migrate`
успешно применил все четыре миграции; результат дополнительно проверен в
`_prisma_migrations`:

1. `20260929084943_identity_tenancy`
2. `20260929182020_universal_catalog`
3. `20260930140000_inventory_ledger`
4. `20260930170000_sales_orders`

Seed отсутствует в scripts/config проекта и не выполнялся. Для запуска он не нужен.
Системные роли создаются при создании организации; migrations выполняют backfill.
Интеграционные тесты создавали собственную случайную schema в отдельной test DB,
применяли настоящие migrations и удаляли только эту schema через штатный teardown.
После завершения временных `stage2_*` schemas не осталось. Автоматические тесты
не использовали dev-базу. Для браузерной проверки позднее создан минимальный
набор dev-данных через штатный UI, перечисленный ниже.

## Приложения и smoke test

Приложения запущены штатной общей командой `pnpm.cmd dev`. После первоначальной
компиляции API запуск завершился успешно; ранняя попытка HTTP до окончания старта
не смогла подключиться, повторная проверка прошла. Повторные health-проверки успешны,
циклических падений за период наблюдения не обнаружено.

| Проверка                               | Результат                                                            |
| -------------------------------------- | -------------------------------------------------------------------- |
| Web `http://127.0.0.1:3000/`           | 200; главная страница также открыта и визуально проверена в браузере |
| Web `/api/health`                      | 200, `status=ok`, `service=web`                                      |
| Web `/sign-in`, `/sign-up`, `/app`     | Auth pages 200; `/app` с сессией 200, без сессии redirect на sign-in |
| API `http://127.0.0.1:3001/api/health` | 200, `status=ok`, `service=api`                                      |
| API `/api/health/ready`                | 200; реальный PostgreSQL SELECT 1 и Redis PING                       |
| API `/api/v1/me` без токена            | 401                                                                  |
| API `http://127.0.0.1:3001/api/docs`   | Swagger 200                                                          |
| API `/api/docs-json`                   | 200; 39 paths, Bearer scheme, 13 Stage 5 operations                  |
| AI `http://127.0.0.1:8000/health`      | 200, `status=ok`, `service=ai`                                       |
| AI `http://127.0.0.1:8000/docs`        | 200                                                                  |

## Stage 2–5 и quality checks

| Область | Проверенные сценарии и результат                                                                                                                                                                                         |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stage 2 | JWT signature/issuer/audience/expiry, создание identity и organization, роли, RBAC, suspended membership, mass assignment, tenant A/B — прошли                                                                           |
| Stage 3 | Products/services/categories/variants/units/prices, decimal precision, SKU uniqueness, custom fields, cross-tenant API и SQL constraints — прошли                                                                        |
| Stage 4 | Opening, adjustment, transfer, reversal, negative-stock policy, ledger/projection consistency, concurrent updates, rollback, tenant isolation — прошли                                                                   |
| Stage 5 | Customers, lifecycle, snapshots/totals/rounding, mixed product/service order, atomic stock deduction, concurrent completion, partial/final payment, overpayment rejection, replay/idempotency, tenant isolation — прошли |

Функциональная цепочка identity → organization → catalog → inventory/location →
customer → order → completion → payment проверена существующими integration tests
через настоящий Nest/Fastify application и PostgreSQL/Redis с локально подписанными
JWT/JWKS. Это API-проверка через Fastify injection; браузерный Clerk login она не заменяет.
Обхода production authentication не добавлялось.

| Команда                                   | Результат                                    |
| ----------------------------------------- | -------------------------------------------- |
| `pnpm.cmd install --frozen-lockfile`      | успешно, lockfile не изменён                 |
| `pnpm.cmd ai:install`                     | успешно после настройки Python               |
| `pnpm.cmd --filter @saas/api db:validate` | успешно                                      |
| `pnpm.cmd lint`                           | успешно, ESLint и Ruff                       |
| `pnpm.cmd typecheck`                      | успешно, TypeScript/Next route types и mypy  |
| `pnpm.cmd test`                           | 59 API + 1 AI, failures 0, skipped 0         |
| `pnpm.cmd build`                          | успешно, Next.js, NestJS, Python wheel/sdist |
| `pnpm.cmd format:check`                   | успешно, Prettier и Ruff                     |

## Оставшиеся ограничения

- Реальные браузерные сценарии завершены; ниже явно отделены они от более широкого
  набора автоматических API-тестов. Все комбинации CRUD, browser/device matrix и
  production deployment этой проверкой не охвачены.
- Turbo после успешной сборки выдал предупреждение упаковки кэша о длинном имени
  ссылки `apps/web/.next/standalone/node_modules/.pnpm/node_modules/semver` в Windows.
  Это не ошибка компиляции. Восстановление standalone из этого кэша отдельно не проверялось.
- Clerk SDK выдал deprecation warning для `createRouteMatcher`. Версии и auth
  architecture не менялись. Backend permissions
  и web server-side API authentication существуют независимо от matcher.
- Production Docker images и GitHub CI в этой проверке не запускались. Проверены
  локальная сборка приложений, host runtime и Docker-инфраструктура.

Неизвестных critical/runtime ошибок в выполненных сценариях не осталось.
Подтверждённых дефектов бизнес-логики Stage 2–5 не найдено. Устранены препятствия
локального окружения и конфликт порта по умолчанию.

## Продолжение: реальная конфигурация Clerk

Предоставленные пользователем development keys сохранены в игнорируемом `.env`.
Issuer получен из publishable key; HTTPS OIDC metadata подтвердил точное совпадение
issuer и JWKS URL. Frontend JWKS и запрос к Clerk Backend API JWKS с secret key
вернули HTTP 200. Проверка ключа не считается проверкой пользовательской session.

При первом включении Clerk обнаружена воспроизводимая runtime-ошибка:
`/sign-in` зависал и Next.js сообщал `Failed to proxy http://localhost:3000/sign-in`.
NextURL нормализовал loopback IP `127.0.0.1` в `localhost`, а Clerk превращал
продолжение middleware в rewrite на этот адрес. При сравнении с исходным bind host
Next.js воспринимал rewrite как внешний proxy и повторно отправлял запрос самому себе.

Минимальное исправление в `apps/web/next.config.ts`: `skipProxyUrlNormalize: true`.
Авторизация не отключалась; зависимости не обновлялись. После автоматического
перезапуска проверены оба адреса — `127.0.0.1` и `localhost`:

- `/sign-in` и `/sign-up`: HTTP 200 вместо timeout;
- `/app` без session: HTTP 307 на `/sign-in`;
- в 96 JS/JSON/map файлах клиентской сборки фактический secret key не найден;
- в браузере достигнут Google OAuth confirmation; его завершение пользователем
  и возвращение в приложение ещё не зафиксированы;
- единственное зафиксированное предупреждение клиентской консоли на этом шаге —
  штатное предупреждение Clerk об использовании development keys.

8 октября Docker Engine и host-приложения оказались остановлены. Инфраструктура
повторно запущена, обе базы и данные сохранены. Повторная проверка бизнес-данных
показала 0 users, organizations, customers и orders: успешный пользовательский
проход в dev-базе ещё не происходил.

После исправления URL 8 октября повторно выполнены все root-команды:
lint, typecheck, test (59 API + 1 AI, failures/skips 0), build и format:check —
успешно. Логи: `.tools/stabilization/clerk-fixed-*.log`. Предупреждение Turbo
об упаковке Windows symlink в кэш сохранилось; exit code build — 0.
Приложения снова запущены штатным `pnpm.cmd dev`; три health/readiness endpoint
вернули 200, PostgreSQL/Redis healthy. В 101 клиентском файле actual secret key
не обнаружен. В браузере отображается форма Clerk в Development mode;
пользователю передан интерактивный шаг входа. До его завершения session, logout,
приём настоящего session token backend и защищённые CRUD-сценарии не подтверждены.

## Итоговая браузерная проверка 8 октября

Предыдущий раздел фиксирует промежуточное состояние до интерактивного входа.
Пользователь завершил настоящий Google/Clerk login. После этого проверены:

| Проверка              | Фактический результат                                                                                                                                                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login / session       | `/app` открыл список организаций; Clerk UserButton показал вошедшего пользователя. Read-only Clerk Backend SDK подтвердил `active` session для того же subject.                                                                                |
| Backend real token    | Штатный server-side `auth().getToken()` → Bearer → Nest JWT guard → `/api/v1/organizations` и tenant endpoints работают. Это authenticated endpoint, эквивалентный запрошенной проверке `/me`; `/me` с реальным токеном отдельно не вызывался. |
| Identity / membership | Локальный user `ed945809-126b-4ca8-a3e3-3285bfd4b577`, Clerk issuer/subject, ACTIVE membership и OWNER подтверждены БД; тот же user записан автором продажи и ledger.                                                                          |
| Session lifecycle     | Переходы между страницами и повторное открытие после паузы и перезапуска приложений сохранили доступ; вручную JWT не подменялся.                                                                                                               |
| Logout                | Штатный Clerk Sign out → `/`; Clerk Backend SDK подтвердил session `removed`.                                                                                                                                                                  |
| Protected routes      | После logout прямая ссылка на существующий заказ перенаправляет на `/sign-in?redirect_url=...`; форма входа отображается, данные заказа недоступны.                                                                                            |
| API without auth      | `/api/v1/me` без Bearer и с некорректным Bearer вернул 401.                                                                                                                                                                                    |

Созданы только две тестовые организации: A (`547e324c-43ec-44b7-bd6e-9a3c09c4015d`)
и B (`7d89f8d6-321a-413a-893d-392f4a6fafdf`), обе с префиксом
`Stabilization 2026-10-08`. Существующая организация Tommy не изменялась.

Реально выполненные через браузер business flows:

- Stage 2: onboarding двух организаций, переключение tenant, overview с Owner;
  для A RETAIL/KZT/Asia/Qyzylorda/ru-KZ, создание `QA Warehouse` типа WAREHOUSE,
  открытие organization settings с сохранёнными значениями.
- Stage 3: создание `QA Product`, tracked inventory, SKU `QA-20261008`, PIECE,
  цена 1250.0000 KZT; открытие сохранённой карточки и выбор варианта в продаже.
- Stage 4: opening balance 10.000000; после завершения продажи stock 8.000000;
  history показывает OPENING_BALANCE +10 и SALE -2 с правильным автором.
- Stage 5: создание синтетического `QA Customer`, поиск и выбор в новой продаже;
  draft `SO-000001` (`48d7839f-5677-49be-8626-ced185cc5ad5`), 2 товара по 1250,
  фиксированная скидка 100, subtotal 2500, total 2400; completion с offline CASH
  payment 1000 → COMPLETED/PARTIALLY_PAID, outstanding 1400. Попытка оплатить 1401
  отклонена сообщением `Payment exceeds the outstanding amount. Refresh the order.`
  Затем offline BANK_TRANSFER 1400 → PAID, paid 2400, outstanding 0; две записи
  платежей в истории. Реального движения денег или acquiring не выполнялось.

Tenant isolation проверена в браузере с настоящей сессией:

1. У B пустые catalog, inventory, customers и sales: записи A не появились.
2. Подстановка ID товара, customer и sale A в routes B даёт страницу
   `Organization unavailable`, без данных ресурса и платежей.
3. Для отдельной тестовой A временно изменён membership ACTIVE → SUSPENDED:
   прямой URL её заказа недоступен, A исчезла из `/app`, B осталась доступной
   в списке. Membership восстановлен в ACTIVE, доступ к A повторно подтверждён.
   Это единственная прямая мутация БД в браузерной проверке: ограниченный тестовый
   fixture, поскольку изменение memberships через UI/API ещё не реализовано.
   Бизнес-записи создавались только через UI. Проверка с отдельным вторым Clerk
   пользователем не выполнялась; отсутствие active membership проверено suspension.

Console / network:

- Проверены browser console, Next access logs и ошибки backend; полного HAR
  браузерный инструмент не предоставляет. В нормальных сценариях не выявлены
  CORS, hydration, React/Next runtime errors или необъяснённые 401/403/500.
- После паузы Docker и приложения были остановлены: первая навигация дала
  ERR_CONNECTION_REFUSED. После запуска frontend опередил компиляцию API:
  error boundary показал `The service is unavailable` (web HTTP 500, внутренний
  ApiError 503). После готовности API
  reload успешно открыл тот же заказ. Это объяснённая недоступность при старте.
- Ожидаемы отказ переплаты (backend conflict), unavailable для cross-tenant и
  suspended membership, 401 для отсутствующего/невалидного токена и redirect
  после logout. Next может передавать not-found внутри streamed response с 200;
  сам HTTP 200 страницы не трактовался как доказательство разрешённого доступа.
- Clerk development-key warning ожидаем. Новых дефектов бизнес-логики не найдено.
- Секреты и JWT не выводились в отчёт; `.env` исключён из Git. Проверка клиентской
  сборки на фактический secret key выполнена повторно после сборки.

Доказательства: `.tools/stabilization/paid-sale.jpg`, `logout.jpg`,
`protected-after-logout.jpg`; логи финальных команд — `final-*.log`.
Заключительный повтор lint, typecheck, test (59 API + 1 AI, failures/skips 0),
build и format:check завершился с exit code 0. В 22 файлах production client
bundle фактический secret key не найден; diff и отчёт также проверены.
Приложения после проверки оставлены запущенными.

## Повторный запуск в PowerShell

Docker Desktop должен быть запущен. Команды для настроенной в этой проверке машины:

```powershell
Set-Location 'C:\Projects\Business-Management-SaaS-AI-Copilot'
$env:Path = "$env:APPDATA\Python\Python314\Scripts;$env:Path"
$env:UV_PYTHON = "$env:APPDATA\uv\python\cpython-3.12.14-windows-x86_64-none\python.exe"
pnpm.cmd infra:up
pnpm.cmd --filter @saas/api db:migrate
pnpm.cmd dev
```

Зависимости уже установлены. При необходимости восстановить их по lockfiles:

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd ai:install
```

Для повторной проверки остановите dev перед build/typecheck, поскольку Next.js
использует общий каталог `.next`. Затем в том же настроенном PowerShell:

```powershell
pnpm.cmd lint
pnpm.cmd typecheck
pnpm.cmd test
pnpm.cmd build
pnpm.cmd format:check
```

Обычная остановка: `Ctrl+C` в терминале с `pnpm.cmd dev` (при необходимости второй раз),
затем `pnpm.cmd infra:down`. Эта команда сохраняет volumes.

Текущий проверочный запуск оставлен в фоне; PID его cmd launcher записан в
`.tools/stabilization/dev.pid`, stdout/stderr — в `dev-final.log` и `dev-final-error.log` рядом.
Для остановки именно этого запуска проверяется ожидаемая команда процесса:

```powershell
$devLauncherId = [int](Get-Content .tools/stabilization/dev.pid)
$devLauncher = Get-CimInstance Win32_Process -Filter "ProcessId=$devLauncherId"
if ($devLauncher -and $devLauncher.Name -eq 'cmd.exe' -and
    $devLauncher.CommandLine -match '/d /c pnpm\.cmd dev$') {
    taskkill.exe /PID $devLauncherId /T /F
}
pnpm.cmd infra:down
```

Остановка не выполнялась при подготовке отчёта: приложения и контейнеры оставлены
работающими для просмотра. Не запускайте второй экземпляр `dev` до остановки первого.
