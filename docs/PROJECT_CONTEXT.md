# Business Management SaaS + AI Copilot — контекст проекта

Актуализировано **2026-10-12** после реализации Stage 11. Источник истины — код текущего checkout, SQL migrations и фактически выполненные проверки. Stage 1–11 реализованы; текущая ветка `codex/stage-11-customer-returns-refunds`. Подробный результат и проверки: [Stage 11 — Returns & Refunds](stage-11-returns-refunds.md). Первоначальный аудит Stage 10 от 2026-10-11 сохранён ниже как история; его прежние findings о reversal и отсутствии returns закрыты Stage 11.

## Stage 11: актуальный handoff

- Новые SalesReturn/SalesReturnItem и CustomerRefund/RefundAllocation; один refund распределяется между POSTED returns одной original sale. Политика первоначального proposal заменена требованиями пользователя; allocation на SalesPayment не используется.
- DRAFT → POSTED или CANCELLED. POSTED и выплаты immutable. Credit считается из discounted source snapshots; cumulative rounding до 4 знаков, Decimal precision 60. RESTOCK/NO_RESTOCK и destination задаются для каждой строки.
- Physical restock определяется original `stockDeducted` и snapshot PRODUCT. Архивный исторический товар допустим; active destination и совпадающая unit обязательны. Положительный `SALE_RETURN` с собственным FK создаётся общим writer атомарно с post.
- Generic reversal теперь допускает только OPENING_BALANCE/ADJUSTMENT/TRANSFER на API и SQL уровнях. Новые migrations: `20261011000000_inventory_reversal_guard`, `20261011010000_customer_returns_refunds`, `20261011020000_return_metadata_guard`; всего **12 applied migrations**. Applied история не переписана.
- Cash cap = original payments − refunds; allocation cap = return credit − previous allocations. Refund amount = sum allocations. Net outstanding = max(original total − credits − payments + refunds, 0); новые SalesPayments ограничены этим значением. Original total/paidAmount/paymentStatus остаются gross историческими показателями; новый net показывается отдельно.
- Права `returns.view`, `returns.manage`, `refunds.manage`: OWNER/ADMIN все, MEMBER view. Денежные response fields без `finance.view` равны null, включая mutation/replay. Custom roles автоматически не расширяются.
- API `/returns`, `/refunds`, order `/returns` и `/return-eligibility`, analytics `/returns/summary`. Web returns/refunds list/new/detail, подтверждения, immutable detail, reuse retry key, source links, light/dark/mobile.
- Credit event по фактическому postedAt в timezone организации; cash event по paymentDate DATE. Net Cash Flow вычитает customerRefundsPaid; gross sales/AOV сохраняют прежнюю семантику. Return list from/to тоже фильтрует календарную дату проведения, refund list — дату выплаты.
- AI tool `get_customer_returns_summary` только читает, требует `ai.use` + `returns.view`; деньги дополнительно finance.view. Существующие fresh authorization, tenant scoping и bounded output сохраняются.
- Git: Stage 11 изменения не закоммичены и не отправлены. Stage 10 локальный commit `e7f0bcd`, main/origin/main Stage 9 `c70b3f4`; прежний workflow-scope publication blocker не обходился. Stage 12 не начат.
- Проверки и известные ограничения приведены в [полном отчёте](stage-11-returns-refunds.md). Live LLM без credentials остаётся отдельной manual acceptance проверкой.

## 1. Состояние Git

На начало аудита рабочее дерево было чистым. После `git fetch origin --prune` и проверки remote refs:

| Ref                                | Состояние                                        |
| ---------------------------------- | ------------------------------------------------ |
| `codex/stage-10-ai-copilot` / HEAD | `e7f0bcd`, `feat: implement AI business copilot` |
| `main`                             | `c70b3f4`, Stage 9                               |
| `origin/main`                      | `c70b3f4`, Stage 9                               |
| Remote branches Stage 2–9          | Присутствуют; их изменения входят в историю main |
| `origin/codex/stage-10-ai-copilot` | Отсутствует                                      |

`origin/main` является предком HEAD; Stage 10 добавляет один локальный коммит. Поэтому Stage 10 реализован локально, но ещё не опубликован и не объединён с main. Предыдущая попытка push отклонена GitHub: OAuth-токен не имеет `workflow` scope для изменения `.github/workflows/ci.yml`. Это ограничение публикации, не ошибка Git merge. Не удалять CI-изменение ради обхода отказа и не переписывать историю.

Исторический аудит Stage 10 создавал только документы. По последующему запросу пользователя Stage 11 реализован в отдельной ветке от `e7f0bcd`; commit/push не выполнялись. Перед публикацией снова проверить refs и рабочее дерево. Для публикации нужна отдельная авторизация пользователя и подходящая GitHub credential.

## 2. Продукт и стек

Продукт управляет организациями, каталогом товаров и услуг, складом, продажами, закупками, расходами и расчётами с поставщиками. Executive Dashboard объединяет операционные и финансовые показатели. Copilot читает разрешённые пользователю агрегаты и помогает интерпретировать их. Поддерживаются несколько организаций на одного пользователя, несколько locations, разные business types, locale и timezone.

Это modular monolith на стороне бизнес-API с отдельным inference service. Платёжного acquiring, бухгалтерского double-entry ledger и автоматического принятия решений AI сейчас нет.

| Область        | Реализация в manifests                                                                 |
| -------------- | -------------------------------------------------------------------------------------- |
| Workspace      | pnpm `10.34.6`, Turborepo `2.11.5`                                                     |
| Runtime JS     | Node `^22.13.0` или `^24.0.0`; `.node-version`: 22; локально проверялся Node `24.21.0` |
| Web            | Next.js `16.3.6`, React `19.3.0`, TypeScript `5.9.3`, Tailwind `4.3.3`                 |
| API            | NestJS `11.2.6`, Fastify `5.11.3`, Prisma `7.10.0`, PostgreSQL driver adapter          |
| AI             | Python `>=3.12,<3.14`, FastAPI `0.141.1`, Pydantic `2.13.5`, `httpx2` `2.13.1`         |
| Python tooling | uv `0.12.19` в CI/Docker, Ruff, mypy, pytest                                           |
| Infra          | PostgreSQL `17-alpine`, Redis `7.4-alpine`, Docker, GitHub Actions                     |
| Identity       | Clerk frontend SDK `7.9.7`; JWT/JWKS через jose на API                                 |

Точные транзитивные зависимости закреплены в `pnpm-lock.yaml` и `apps/ai/uv.lock`. Обновления зависимостей требуют отдельной проверки совместимости.

## 3. Monorepo и точки входа

```text
apps/web/                   Next App Router, server actions, UI
apps/api/src/               Nest modules и бизнес-команды/запросы
apps/api/prisma/             schema.prisma, SQL migrations
apps/api/test/               node:test, интеграционные scenario suites
apps/ai/app/                FastAPI, internal inference, provider adapter
apps/ai/tests/              pytest, transport mocks
packages/types/src/         DTO response contracts, enums, permissions
packages/config/            общие TypeScript configs
packages/eslint-config/     общие ESLint configs
infrastructure/docker/      три multi-stage Dockerfiles
scripts/run-service.mjs     launcher с корневым локальным .env
docs/                       история этапов и актуальный handoff
.github/workflows/ci.yml    quality и container jobs
```

Prisma Client генерируется в `apps/api/src/generated/prisma`, исключён из Git. Build output, Python venv, `.tools`, кэши и `.env` также исключены. В Docker build context `.env` не попадает. `.env.example` содержит только примеры и пустые поля секретов.

Основные Next routes:

- `/sign-in`, `/sign-up`, `/app` — Clerk и выбор/создание организации.
- `/app/[organizationId]` — общий shell; собственные permissions получает через organization context API.
- `dashboard`, `analytics/sales`, `analytics/inventory`, `analytics/purchasing`, `finance`.
- `catalog` с item detail, new, categories, custom fields; `locations`.
- `inventory`, `inventory/operations`, `inventory/settings`, `inventory/history/[transactionId]`.
- `customers`, `sales`, `sales/new`, `sales/[orderId]`.
- `suppliers`, `purchasing`, `purchasing/new`, purchase detail и receipt detail.
- `expenses`, new/detail/categories; `accounts-payable`, bill detail/new.
- `settings`, `ai`, `ai/settings`.

Важные read wrappers: `apps/web/lib/api.ts`, остальные domain-specific файлы в `lib`. Они являются `server-only`, передают Clerk Bearer token и используют `cache: no-store`. Обычный API timeout 10 секунд, AI wrapper 130 секунд. Скрытая кнопка в UI не является проверкой доступа: права проверяет API.

UI сохраняет общие CSS tokens в `app/globals.css`, бирюзовые акценты, light/dark, responsive shell, charts и KPI из Stage 9. Новые страницы должны переиспользовать эти компоненты и состояния loading/empty/error.

## 4. Архитектура и зависимости

`AppModule` подключает Environment, Health, Auth, Organizations, Locations, Catalog, Inventory, Sales, Purchasing, Expenses, Finance, AccountsPayable, Analytics и AI. PrismaModule и AuthorizationModule импортируются нужными модулями; бизнес-правила остаются в command/query services.

| Модуль                    | Ответственность и зависимости                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| Auth / Authorization      | JWT → local User; ACTIVE membership → permissions из БД                                            |
| Organizations / Locations | tenant settings, роли/участники для чтения, операционные locations                                 |
| Catalog                   | универсальные items, variants, categories, options, custom fields                                  |
| Inventory                 | ledger writer, stock projection, resource gates, настройки отрицательного остатка                  |
| Sales                     | Customers, Orders, Payments; импортирует Inventory для атомарного completion                       |
| Purchasing                | Suppliers, PurchaseOrders, GoodsReceipts; импортирует Inventory                                    |
| Expenses                  | Categories, Expense draft/post/void; без складских движений                                        |
| AccountsPayable           | Bills и SupplierPayments; проверяет ссылки на Purchasing через Prisma и shared locks               |
| Finance                   | агрегирует SalesPayment, Expense, SupplierPayment, SalesOrder, SupplierBill; не пишет документы    |
| Analytics                 | агрегаты доменов; использует FinanceService для единых финансовых определений                      |
| AI                        | Prisma, Redis, Authorization, Analytics, Finance, AP, Inventory; orchestrator и registry читателей |
| FastAPI                   | не имеет бизнес-БД; получает bounded context/tools/messages от Nest и обращается к провайдеру      |

Сервисные вызовы внутри Nest не запускают HTTP guards автоматически. Например, AiToolsService самостоятельно проверяет permissions до и после вызова читателя. Новый интегратор обязан сохранять это свойство.

Существующий ledger writer используется внутри уже открытой PostgreSQL transaction. Не создавать вторую независимую транзакцию для stock при завершении продажи или приёмке. Generic CRUD, arbitrary SQL interface, queues/outbox/event bus в архитектуру сейчас не введены.

## 5. Сущности и состояния

| Группа     | Основные сущности и связи                                                                                                                                                                           |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity   | User уникален по provider/subject; OrganizationMembership связывает User и Organization; MembershipRole → tenant Role → RolePermission                                                              |
| Catalog    | CatalogCategory с parent; CatalogItem PRODUCT/SERVICE; CatalogVariant с unit, prices, SKU/barcode; CatalogOption/Value и VariantOptionValue; типизированные custom field definitions/options/values |
| Inventory  | InventorySettings на org; InventoryTransaction → signed InventoryLedgerEntry; InventoryBalance на org/location/variant                                                                              |
| Sales      | Customer; SalesSequence; SalesOrder → SalesOrderItem и SalesPayment                                                                                                                                 |
| Purchasing | Supplier; PurchaseSequence/GoodsReceiptSequence; PurchaseOrder → PurchaseOrderItem; GoodsReceipt → GoodsReceiptItem исходной PO line                                                                |
| Expenses   | ExpenseCategory; ExpenseSequence; Expense                                                                                                                                                           |
| AP         | SupplierBillSequence; SupplierBill с optional PO; SupplierPayment относится к одному Bill                                                                                                           |
| AI         | AiSettings на org; AiConversation принадлежит org и user; AiMessage имеет client ID, sequence, permissions snapshot, sources, status и optional usage                                               |

SalesOrder: `DRAFT → COMPLETED` или `DRAFT → CANCELLED`. Изменение metadata/items возможно только в DRAFT. Completion фиксирует цены, скидки, currency, names/SKU/unit/item type и `stockDeducted` для фактически списанных строк. Completion и optional initial payments атомарны. SalesPayment — положительная immutable ручная запись, только для completed order; нельзя превысить original outstanding. На order действует предел 100 строк и 1000 платежей. Прямого refund нет.

PurchaseOrder: `DRAFT → ORDERED → PARTIALLY_RECEIVED → RECEIVED`. Можно отменить DRAFT/ORDERED без receipt. Коммерческие данные после ordering защищены. Receiving допускает несколько частичных receipt, не больше ordered quantity. Receipt и его строки immutable; tracked PRODUCT создаёт положительное движение `PURCHASE_RECEIPT`. SERVICE закупать нельзя. Валюта заказа фиксируется при создании.

Expense: `DRAFT → POSTED → VOIDED`. Posted commercial data immutable, void сохраняет actor/reason/time. В Finance участвуют только POSTED. Это текущая модель операционного расхода, не универсальный ledger фактических банковских операций.

SupplierBill: `DRAFT → POSTED → VOIDED`; void разрешён только без SupplierPayment. Bill amount/currency/dates и данные после post защищены. Optional PO обязан принадлежать тому же tenant/supplier и иметь совместимую валюту; DRAFT PO нельзя использовать при posting bill. Нормализованный внешний invoice number уникален среди POSTED bills данного org/supplier. SupplierPayment immutable, positive, допускает частичные платежи, не больше unpaid bill amount. Приёмка и bill сами по себе не являются cash outflow.

Удаление immutable business history запрещается сервисами и/или SQL triggers/FK; вместо удаления используются предусмотренные состояния. AI history имеет иной lifecycle: пользователь может удалить собственную conversation вне активного turn.

## 6. Authentication, RBAC и multi-tenancy

Глобальный AuthGuard защищает маршруты по умолчанию. Исключение — явно public health. JWT проверяется по server-configured issuer/JWKS; допустимы RS256/ES256, проверяются временные claims, subject, optional audience и authorized parties. Production не допускает HTTP issuer/JWKS. AuthenticatedUserService создаёт локальную UUID identity один раз и обрабатывает конкурентную регистрацию.

OrganizationMembershipGuard заново читает ACTIVE membership и tenant roles из БД. PermissionsGuard требует объявленные permissions; отсутствие tenant/permission metadata закрывает доступ. JWT claims и request body не назначают права. Organization context endpoint проверяет membership и сообщает собственный контекст; он не требует `organization.view`, чтобы ограниченные custom roles могли открыть shell.

Источник registry: `packages/types/src/index.ts`; системные defaults: `apps/api/src/authorization/permissions.ts`.

| Role   | Defaults                                                                                                                         |
| ------ | -------------------------------------------------------------------------------------------------------------------------------- |
| OWNER  | Все известные permissions, включая `ai.manage`                                                                                   |
| ADMIN  | Все, кроме `roles.manage`, `members.manage`, `ai.manage`; `ai.use` есть                                                          |
| MEMBER | view organizations, locations, catalog, inventory, sales, customers, suppliers, purchasing; без finance/expenses/AP/analytics/AI |

Registry покрывает organization/members/roles/locations, catalog, inventory view/adjust/transfer/settings, sales create/manage/complete/payments, customers, suppliers, purchasing create/manage/receive, expenses, finance, AP/payments, analytics и AI. `members.manage`/`roles.manage` зарезервированы: полноценный management API этих операций не реализован. Backfill migrations добавляют новые права только соответствующим system roles; custom roles не расширяются автоматически.

Фактическая политика Analytics REST: operational endpoints требуют `analytics.view`, денежные sales/purchasing/finance endpoints дополнительно `finance.view`; activity фильтруется по source permissions. AI registry для этих же читателей требует также source-domain permissions. Эти политики отличаются намеренно в существующем коде; не приписывать REST более строгую AI-политику.

Tenant isolation обеспечивают guards, org-scoped queries/aggregates, составные FK и уникальные ключи. PostgreSQL RLS не включён. SQL identifiers строятся только из доверенного schema config/trigger metadata; значения запросов параметризованы. User/health/global org-list являются отдельными identity/system контрактами и не требуют business tenant path.

Не все actor FK используют membership: старые Sales/Purchasing/Inventory ссылаются на User; Expenses/AP используют `(organizationId, userId)` membership. Значит DB FK сам по себе не доказывает текущую ACTIVE membership. Обычные команды проверяются HTTP guard при входе; AI дополнительно перепроверяет доступ в процессе долгого turn. Немедленная отмена любой уже начавшейся бизнес-транзакции при отзыве роли не реализована.

## 7. Inventory ledger и транзакционные инварианты

InventoryTransaction types: `OPENING_BALANCE`, `ADJUSTMENT`, `TRANSFER`, `REVERSAL`, `SALE`, `PURCHASE_RECEIPT`, `SALE_RETURN`. Entries содержат signed `quantityDelta`; balances — проекция суммы этих entries, отсутствие balance означает ноль. Projection обновляет command writer, а не DB trigger; прямые записи в balance вне writer запрещены архитектурой.

- History immutable: UPDATE/DELETE/TRUNCATE ledger и transactions запрещены triggers.
- Opening допускается только без предыдущей истории пары location/variant; adjustment имеет reason, transfer две противоположные записи.
- Reversal создаёт новый документ и точно противоположные entries; повторный reversal и reversal самого reversal запрещены.
- API и SQL разрешают generic reversal только `OPENING_BALANCE`, `ADJUSTMENT`, `TRANSFER`. `SALE`, `PURCHASE_RECEIPT`, `SALE_RETURN` запрещены; исходный SQL gap исправлен первой Stage 11 migration.
- SALE имеет единственный original order link и entries, соответствующие `stockDeducted` исходных строк. PURCHASE_RECEIPT имеет единственный receipt link, отдельный deferred validator.
- Политика negative stock по org: обычная команда не может уйти ниже нуля при выключенной опции. Приёмка может улучшить ранее отрицательный остаток; не следует блокировать её только из-за сохранённого отрицательного баланса.
- Activity/tracking changes требуют zero balance на каждой location; unit/type нельзя изменить при inventory history. Исторический ненулевой stock архивных ресурсов остаётся видимым.

Складские команды берут transaction advisory lock idempotency key, resource gates в устойчивом порядке и sorted stock locks. Catalog/location/settings mutations используют exclusive resource gates, stock commands — shared. Sales берёт key → order → customer/resources → stocks. Purchasing берёт key → PO → resources → stocks. AP берёт command key → bill → optional PO → supplier. Нельзя вводить обратный порядок и создавать deadlocks.

Writes выполняются с ReadCommitted и явной сериализацией критических ресурсов; `runSalesTransaction`: maxWait 10s, timeout 20s. Многие read aggregates/details выполняются с RepeatableRead. Между отдельными Dashboard widgets нет единой общей snapshot transaction.

Idempotency keys — UUID, unique внутри org и команды; payload нормализуется и хешируется. Повтор с тем же payload возвращает существующий результат, другой payload под тем же key даёт conflict. Сначала проверить существующий результат под lock, затем менять бизнес-состояние. Network/provider calls не помещать в долгую DB transaction.

SQL CHECK, partial unique indexes, history guards и deferred validators входят в контракт. Prisma schema diff не проверяет смысл trigger functions: обязательны прямые SQL regression tests. Старые applied migrations не редактируются; исправления делаются новой migration.

## 8. Деньги и Finance

Money/prices: `Decimal(19,4)`, quantities: `Decimal(19,6)`. HTTP использует decimal strings; frontend отображает, backend считает. Sales arithmetic использует Decimal clone precision 60 и ROUND_HALF_UP. Gross каждой строки округляется до 4 знаков, затем вычитается line discount; order totals — суммы этих строк. NaN, overflow, отрицательная/нулевая сумма там, где она запрещена, отклоняются. Не использовать JS Number для денежных инвариантов.

Валюта фиксируется на business documents. Default currency change не переписывает историю. Mixed currencies вызывают conflict; FX conversion отсутствует. Разные units не суммируются в общий физический stock.

| Метрика              | Текущее определение                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------- |
| Completed sales      | SUM completed order total по `completedAt`                                                    |
| Collected payments   | SUM SalesPayment по `createdAt`                                                               |
| Posted expenses      | SUM POSTED Expense по business `expenseDate`                                                  |
| Supplier payments    | SUM SupplierPayment по business `paymentDate`                                                 |
| Customer refunds     | SUM CustomerRefund по business `paymentDate`                                                  |
| Return credits       | SUM POSTED SalesReturn по `postedAt` в timezone организации                                   |
| Net Cash Flow        | collected payments − posted expenses − supplier payments − customer refunds                   |
| Customer outstanding | SUM max(original completed total − posted credits − payments + refunds, 0), вне period filter |
| Supplier outstanding | Текущие POSTED bill amount − все supplier payments, вне period filter                         |
| Profit / COGS        | Не рассчитываются; нет valuation/налогов/полного accounting ledger                            |

Period для timestamp переводится через organization timezone в интервал от начала `from` включительно до начала дня после `to` исключительно; business DATE сравнивается напрямую. Analytics default — последние 30 календарных дней, максимум 366; previous period той же длины. Серии zero-filled по DAY/WEEK/MONTH. Percentage при zero baseline и AOV без продаж возвращаются как null.

Location scoping для customer payments наследует location original sale. Supplier payments/payables не распределены по locations: при location filter соответствующие поля null и scope flag false, не ноль. GoodsReceipt и SupplierBill не уменьшают cash flow. Void Expense исключает расход из прошлых расчётов; это не запись фактического возврата денег на дату void. Новые refunds должны иметь собственную cash event, а не переиспользовать void/negative expense.

Sales Analytics используют snapshots при продаже. `snapshotItemType` для продаж до Stage 9 остаётся unknown; текущий каталог не восстанавливает исторический тип. Purchasing ordered cohort и receipt event counts имеют разные даты/семантику. Activity показывает chronology записи событий, не заменяет business-date cashflow.

## 9. AI architecture и ограничения

Web → Nest AiService → internal FastAPI → OpenAI-compatible Chat Completions. FastAPI получает messages/context/tool definitions, не SQL или прямой доступ к БД. Nest исполняет только registry allowlist читателей и возвращает bounded tool results. Provider key потребляет Python; shared service secret проверяет internal status/infer. Доступность status означает наличие конфигурации, не проверенную платную inference.

| Tool                                                               | Дополнительные права сверх `ai.use`                                               |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `get_business_overview`                                            | analytics, sales, inventory, purchasing view; finance часть только с finance.view |
| `get_sales_summary`, `get_sales_trend`, `get_top_selling_variants` | analytics.view + sales.view + finance.view                                        |
| `get_inventory_summary`                                            | analytics.view + inventory.view                                                   |
| `get_variant_stock`                                                | inventory.view                                                                    |
| `get_purchasing_summary`                                           | analytics.view + purchasing.view + finance.view                                   |
| `get_finance_summary`                                              | finance.view                                                                      |
| `get_cash_flow_trend`                                              | finance.view + analytics.view                                                     |
| `get_accounts_payable_summary`                                     | accountsPayable.view + finance.view                                               |

Settings по умолчанию disabled, OWNER явно принимает disclosure/включает org AI. Наличие API key не включает AI для всех. Доступ и enabled settings проверяются перед/после tools и перед финальным ответом; tool args не могут задать tenant/user/provider URL/SQL. Unknown fields/tools, неверные UUID/date/range/limit отклоняются. Source links строятся backend из разрешённых путей, не из ответа модели.

Conversation принадлежит конкретному user внутри org. Lease и activeTurnId сериализуют turns, clientMessageId обеспечивает replay без новых сообщений. Retry допускается для последнего failed turn. Permissions snapshots скрывают старую историю после сокращения прав и не позволяют включить её в новый prompt. Максимум 200 сообщений в conversation; используется до 20 предыдущих completed messages, страницы истории bounded.

Defaults: 15 попыток/user/hour и 200/org/day через атомарный Redis quota; 6 tool calls, 4 tool rounds, 48 000 context characters, 1500 output tokens/call, 60s/turn, 20s/provider request. Redis failure закрывает доступ. Answers не streaming. HTTP redirects/proxy inheritance отключены у provider adapter; HTTPS provider URL задаётся сервером, bodies/outputs ограничены, provider errors/usage валидируются и sanitizируются. Unknown usage остаётся null.

Prompt маркирует business strings как недоверенные, запрещает SQL/code/write и требует свежие authoritative metrics. Это defense in depth: запрет действий обеспечивают registry и RBAC, а фактическая точность текста модели не гарантируется prompt. История удаляется локально; внешнее хранение определяется провайдером.

Для production provider key передавать только AI container, shared secret — API/AI. Локальный launcher загружает общий root `.env` и наследует его всем child processes; потребление key только Python не означает изоляцию environment между локальными процессами. Не публиковать ключ через `NEXT_PUBLIC_*` и не печатать env/authorization headers.

**Live provider smoke ещё не выполнен.** Тесты protocol transport mock и Nest stub не подтверждают валидность внешнего ключа, доступ модели, реальные tool calling или совместимость другого provider. В текущем runtime smoke provider configured=false.

## 10. Основные API contracts

Базовый путь API — `/api/v1`, business prefix — `/organizations/:organizationId`. DTO whitelist + forbidNonWhitelisted, server-owned actor/org/currency/totals, Bearer auth, no-store и security headers. Public health: `/api/health`, `/api/health/ready`; Web `/api/health`; AI `/health`.

| Группа            | Контракты                                                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity          | `/me`, GET/POST `/organizations`, tenant GET/PATCH; GET `/context`, `/members`, `/roles`                                                             |
| Locations/Catalog | scoped CRUD/archive ресурсов; варианты/options/custom fields с tenant relations                                                                      |
| Inventory         | GET stock/transactions/detail/settings; PATCH settings; POST opening-balances/adjustments/transfers/transaction reverse                              |
| Sales             | customers; orders create/read/draft metadata/items/cancel/complete; GET/POST order payments                                                          |
| Purchasing        | suppliers; orders create/read/draft metadata/items/order/cancel; GET/POST receipts и receipt detail                                                  |
| Expenses          | expense-categories; expenses draft/post/void                                                                                                         |
| AP                | accounts-payable bills draft/post/void; bill payments; summary                                                                                       |
| Finance           | finance summary, expenses-by-category                                                                                                                |
| Analytics         | overview; sales summary/trend/top-variants; inventory summary/movements/locations; purchasing summary/receiving; finance summary/cash-flow; activity |
| AI                | settings GET/PATCH, status GET; conversations GET/POST/detail/DELETE; POST conversation messages                                                     |

Mutation command endpoints используют `Idempotency-Key` там, где предусмотрена новая запись/post/completion. Draft metadata updates не являются universal idempotent command API. Decimal fields сериализуются fixed strings, dates как ISO timestamps или YYYY-MM-DD. Lists bounded, `nextCursor` opaque/deterministic для соответствующего domain; не смешивать курсоры разных API. Общий helper Web `list()` загружает все страницы некоторых reference lists: это потенциальный масштабный расход, не unbounded SQL page.

Ошибки: 400 invalid DTO, 401 auth, 403 permission, 404 absent/foreign resource, 409 domain/idempotency conflict. AI имеет дополнительные controlled codes и 429 quota. Подробнее: domain controllers/DTOs, `packages/types/src/*`, dev Swagger. Production Swagger выключен.

## 11. История Stage 1–10 и миграции

| Stage              | Реализовано                                                       | Документация / migration                                                      |
| ------------------ | ----------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1 Foundation       | Monorepo, services, health, tooling, infra, CI                    | README; отдельного stage-1.md нет; DB migration нет                           |
| 2 Identity         | Clerk/JWT, org, membership, roles, locations                      | [Stage 2](stage-2.md); `20260929084943_identity_tenancy`                      |
| 3 Catalog          | PRODUCT/SERVICE, categories/variants/options/custom fields        | [Stage 3](stage-3.md); `20260929182020_universal_catalog`                     |
| 4 Inventory        | immutable ledger, balances, locks, negative stock                 | [Stage 4](stage-4.md); `20260930140000_inventory_ledger`                      |
| 5 Sales            | customers, completed orders, stock, manual payments               | [Stage 5](stage-5.md); `20260930170000_sales_orders`                          |
| 6 Purchasing       | suppliers, PO, partial goods receiving                            | [Stage 6](stage-6-purchasing.md); `20261009000000_purchasing_goods_receiving` |
| 7 Expenses/Finance | expense categories/draft/post/void, finance aggregates            | [Stage 7](stage-7-expenses-finance.md); `20261009010000_expenses_finance`     |
| 8 AP               | supplier bills, payments, outstanding/overdue                     | [Stage 8](stage-8-accounts-payable.md); `20261009020000_accounts_payable`     |
| 9 Analytics        | executive dashboard, snapshots, indexes, charts                   | [Stage 9](stage-9-business-analytics.md); `20261010010000_business_analytics` |
| 10 AI              | readonly copilot, history/settings/tools, orchestration/inference | [Stage 10](stage-10-ai-business-copilot.md); `20261010020000_ai_copilot`      |

К Stage 10 было девять migrations; Stage 11 добавил три, всего **12 applied SQL migrations**. Migrations содержат ограничения, которые не отражаются полностью в Prisma DSL. Permission backfills idempotent. Исторические stage docs описывают состояние на дату этапа; фразы о ещё не начатых следующих stages не заменяют нынешний checkout. [Pre-Stage-6 stabilization](pre-stage-6-stabilization.md) объясняет порт PostgreSQL 5433 и Clerk proxy fix.

## 12. Исторические проверки Stage 10 от 2026-10-11

| Проверка                      | Фактически наблюдавшийся результат                                                                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                   | PASS, ESLint/Ruff; часть Turbo tasks из cache                                                                                                             |
| `pnpm typecheck`              | PASS, TypeScript/Next typegen/mypy; часть tasks из cache                                                                                                  |
| `pnpm test`                   | PASS: **118 API + 26 Python**, API skipped=0; suites выполнены с real PG/Redis и stub provider                                                            |
| `pnpm build`                  | PASS Nest/Next/Python; часть tasks из cache                                                                                                               |
| Prisma validate/status        | PASS; dev DB up to date                                                                                                                                   |
| Prisma dev diff               | PASS, exit 0, schema diff пуст                                                                                                                            |
| Clean schema migration deploy | PASS, девять migrations применены; repeat deploy PASS; schema diff пуст                                                                                   |
| Tenant/RBAC/regressions       | Включены в выполненный full API suite: JWT, tenant FK/IDOR, denied writes/tools, permissions revocation                                                   |
| Transactions/concurrency      | Suite проверяет rollback ledger/order/receipt/payments, over-receipt/overpayment, idempotency, stock gates и AI leases                                    |
| Docker builds                 | PASS, заново собраны API/Web/AI images                                                                                                                    |
| Docker runtime                | API readiness/Web health/AI health HTTP 200; internal auth 401 без secret и 200 с secret, configured=false                                                |
| Production docs               | API docs/docs-json и AI docs/openapi HTTP 404                                                                                                             |
| SQL audit reproduction        | API/service отклонил PURCHASE_RECEIPT reversal; прямой SQL-equivalent insert через Prisma в изолированной схеме успешно committed — проблема подтверждена |

После подготовки документов `pnpm format:check` прошёл: Prettier и Python Ruff format без ошибок. `git diff --check` прошёл; tracked business files не изменены, новые документы отформатированы. В сборке наблюдалось нефатальное Turbo IO warning о длинном link name в Windows Next standalone cache; build exit code 0, отдельные Docker builds прошли. Временная схема SQL-аудита и runtime containers удалены; существующие dev PostgreSQL/Redis остались healthy.

Интеграционный entrypoint `identity.integration.test.ts` регистрирует Catalog/Inventory/Sales/Purchasing/Expenses/AP/Analytics/AI suites. Требуется dedicated TEST_DATABASE_URL, тесты не делают silent skip. Генерируются isolated schema и local signed JWT/JWKS, migration backfill проверяется от legacy org; schema удаляется после прогона. Python использует transport mocks; это не live provider тест.

В текущем аудите браузерные UI checks, physical devices, дополнительные browser engines, внешние Clerk/LLM integration, production load/backup restore и GitHub CI run не выполнялись. Предыдущие UI checks с размерами viewport и themes отражены в Stage 10 verification record; их нельзя выдавать за новый прогон. Локальные CLI logs и диагностические helper scripts находятся вне tracked deliverables.

## 13. Findings аудита Stage 10 и их статус после Stage 11

Finding 1 исправлен guard migration и direct SQL regression. Finding 4 закрыт ReturnsModule, новыми моделями, net calculations, UI/Finance/Analytics/AI. Прочие ограничения сохраняются; описание ниже фиксирует исходное состояние аудита.

1. **DB guard gap, подтвердилось воспроизведением.** `validate_inventory_entries()` в Stage 5 migration исключает reversal original kind REVERSAL/SALE, но после добавления PURCHASE_RECEIPT в Stage 6 список не расширен. В новой пустой схеме созданы PO и receipt штатным Purchasing service; Inventory service отказал в reverse, а отдельная transaction с REVERSAL + противоположной entry успешно committed. Это не доступный HTTP bypass, но DB defense нарушает правило запрета generic receipt reversal для privileged writers. Нужны новая migration и direct-SQL regression, без изменения applied SQL.
2. **Stage 10 publication gap.** Local commit ещё отсутствует в origin/main и remote feature branch; workflow credential problem описан выше.
3. **README tree устарел частично.** Некоторые подразделы описывают AI как future services и tests как health smoke, хотя вступление/Stage 10 уже отражают текущую реализацию. Обновить эти подразделы при следующем documentation cleanup.
4. **Return/refund domain отсутствует.** Нет return/refund models, inventory source type, permissions или net customer position. Current payment cap, order paymentStatus, Finance и Sales Analytics считают original totals/payments без компенсаций. Это ожидаемый scope gap Stage 11, не регрессия Stage 10.
5. **Finance не полный accounting ledger.** Expense void пересчитывает прошлый расход; нет COGS, tax, FX, банковских счетов, refund/supplier credit events. Название Net Cash Flow не должно превращаться в обещание Net Profit или bank reconciliation.
6. **Live AI acceptance незавершён.** Provider credentials отсутствуют; text correctness/prompt resistance на реальной модели не проверялись. Policy не разрешает модели записи независимо от качества prompt.
7. **Масштаб/эксплуатация не подтверждены.** Ограниченные запросы и correctness tests не заменяют load tests, индексы требуют EXPLAIN на реальных объёмах; общего Dashboard snapshot нет, reference list() может загрузить много страниц. RLS/retention/job recovery/backup restore вне текущего доказанного coverage.

Найденная SQL-проблема не исправлялась во время исходного аудита; последующая реализация Stage 11 исправила её новой migration без изменения applied SQL.

## 14. Продолжение разработки

Stage 11 реализован по последующему запросу пользователя. Актуальные решения и результаты находятся в [отчёте Stage 11](stage-11-returns-refunds.md); [исходный proposal](stage-11-returns-refunds-plan.md) помечен историческим и содержит список заменённых решений. Ready for Stage 12; следующий этап не начат. Публикация изменений требует отдельного разрешения.

При любом новом этапе:

- Проверять текущие Git refs, local changes и документы; сохранять чужие изменения.
- Читателю сервиса передавать проверенный tenant; не доверять org/actor/permission/currency/totals из body или LLM.
- Использовать исходные immutable snapshots и append-only compensating documents.
- Сохранять существующий порядок advisory/resource/stock locks и одну DB transaction для business + inventory.
- Выражать суммы Decimal strings; фиксировать semantics каждого нового finance/analytics field и даты события.
- Обновлять registry, system-role creation и migration backfill одновременно; custom roles не расширять.
- Учитывать новые показатели в API/types/Swagger/Web/AI readers без добавления AI write tools.
- После разрешённых изменений запускать root lint/typecheck/test/build/format, fresh migrations, Docker и tenant regressions; live provider отмечать отдельно.
- Не выполнять commit/push/merge без соответствующего разрешения пользователя.

Локальный запуск: native uv должен находиться в PATH; установить `pnpm install --frozen-lockfile`, `pnpm ai:install`, скопировать env example и настроить ignored credentials, `pnpm infra:up`, `pnpm --filter @saas/api db:migrate`, `pnpm dev`. PostgreSQL dev по умолчанию `127.0.0.1:5433`, Redis `6379`; API `3001`, Web `3000`, AI `8000`. В production migrations выполняются отдельным release job; API runtime image Prisma CLI не содержит.
