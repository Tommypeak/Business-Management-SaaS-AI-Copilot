# Stage 4 — Inventory & Stock Ledger

Inventory — модуль существующего NestJS modular monolith. Он использует Stage 2
identity, permissions и Locations, а также `CatalogVariant` Stage 3. Количества
не добавлены в CatalogItem/CatalogVariant. AI service не изменён.

## Данные и источник истины

- `InventoryTransaction`: immutable command record, tenant, type, actor,
  idempotency key, request hash, note, adjustment reason, reversal link, createdAt.
- `InventoryLedgerEntry`: immutable signed movement на location + variant.
- `InventoryBalance`: mutable projection, unique organization/location/variant,
  quantity и updatedAt. Создаётся только при первом движении.
- `InventorySettings`: одна запись на организацию, `allowNegativeStock=false`
  по умолчанию. Создаётся внутри organization creation transaction.

Источник истины — ledger. Для каждого stock key projection должна равняться
`SUM(quantityDelta)`; integration tests проверяют это после операций и ошибок.
Projection можно восстановить SQL-агрегацией ledger. Публичного rebuild endpoint
и maintenance framework нет.

Enums: `InventoryTransactionType` (OPENING_BALANCE, ADJUSTMENT, TRANSFER, REVERSAL),
`InventoryAdjustmentReason` (COUNT_CORRECTION, DAMAGE, LOSS, FOUND, OTHER).
Direction INCREASE/DECREASE — API command enum; signed delta вычисляет backend.

Миграция `20260930140000_inventory_ledger` добавляет четыре таблицы, enums,
composite foreign keys, unique constraints и indexes. Основные индексы:

- balance: unique tenant/location/variant и tenant/variant;
- ledger: tenant/location/variant/date, tenant/variant/date и unique transaction/location/variant;
- transaction: tenant/date/id, unique tenant/idempotencyKey, unique reversesTransactionId;
- compound unique id/tenant для ссылок на transaction, variant и location.

Таблицы history запрещают UPDATE, DELETE и TRUNCATE PostgreSQL triggers.
Deferred constraint triggers проверяют на commit cardinality, transfer conservation
и точную компенсацию original entries при reversal. Нельзя дописать дополнительный
entry к завершённой transaction. Исторические references используют RESTRICT:
физическое удаление организаций/locations/variants с историей не поддерживается.
DROP временной test schema остаётся допустимым для изолированных integration tests.

Backfill создаёт настройки существующих организаций и выдаёт permissions старым
системным OWNER/ADMIN/MEMBER, с `ON CONFLICT DO NOTHING`. Предыдущие migrations
не переписаны. Применение: `pnpm --filter @saas/api db:migrate`.

## Quantity и precision

PostgreSQL numeric(19,6), Prisma.Decimal, 13 целых и 6 дробных цифр.
Input quantity — строго положительная decimal string, максимум
`9999999999999.999999`. Отрицательные inputs, zero, JS numbers, scientific notation,
NaN/Infinity и лишняя precision отклоняются. Signed delta появляется только внутри
command handler. Balance может быть отрицательным по настройке организации.

Выход всегда содержит шесть знаков: `"10.123456" + "0.000001" → "10.123457"`.
Переполнение отдельного stock key отклоняется с 409 до записи. Aggregate stock
считается SUM в PostgreSQL и может превышать диапазон одной balance row; возвращается
точной decimal string. В Node/browser суммы не считаются через JS number.

Unit принадлежит CatalogVariant. После первого ledger entry unit неизменен.
CostPrice остаётся метаданными каталога, не оценкой inventory.

## Команды

Каждая команда проверяет tenant/resource, получает locks, проверяет domain rules,
создаёт transaction/entries и обновляет balances внутри одной DB transaction.
Чтение response выполняется после commit; ответ не содержит изменчивого current
balance, поэтому replay возвращает тот же transaction ID и movements.

| Команда         | Правила и результат                                                                     |
| --------------- | --------------------------------------------------------------------------------------- |
| Opening balance | Только если у stock key нет ни одного ledger entry, включая reversed history; +quantity |
| Adjustment      | INCREASE/DECREASE + положительная quantity + обязательный reason                        |
| Transfer        | Разные active Locations, один variant, две entries −q/+q, SUM=0                         |
| Reversal        | Новая transaction с точной противоположностью original entries                          |

Для всех четырёх команд требуется активный PRODUCT с trackInventory=true,
активный variant и активные Locations. Любая Location type допустима.
Inactive resources доступны в history; для новых операций, включая reversal,
сначала нужно восстановить их активность.

Reversal нельзя отменять, создавать дважды или применять к чужому tenant.
Unique reversesTransactionId подкрепляет проверку backend. Нельзя редактировать
или удалять original transaction. Если компенсация нарушает negative-stock policy,
она полностью откатывается.

## Concurrency и порядок блокировок

Используются ReadCommitted и PostgreSQL transaction-scoped advisory locks:

1. Exclusive lock `inventory:idempotency:<org>:<key>`.
2. Shared resource gates для item, variant, Locations и settings, в sorted order.
3. Exclusive stock locks `<org>:<location>:<variant>`, в sorted order.
4. Чтение balances/history под locks, проверка и запись, commit.

Inventory **не берёт exclusive lock на всю организацию**. Shared gates совместимы
между inventory-командами; разные stock keys выполняются параллельно. Два transfers
получают stock locks в одном порядке независимо от направления.

Catalog item/variant update и Location update получают exclusive resource gate
перед проверкой stock/history. Изменение settings получает exclusive settings gate.
Поэтому проверка catalog/archive/unit не может пройти одновременно с добавлением
первого движения или ненулевого остатка. Эти операции не берут stock locks и не
нарушают lock hierarchy. Существующая catalog write lock остаётся только в Catalog.

UUID нормализуются в lock keys; command IDs и Idempotency-Key нормализуются до
lowercase до hashing. Все advisory queries параметризованы. Locks освобождаются
при commit/rollback автоматически. Command transaction: maxWait=10s, timeout=15s;
существующий PostgreSQL driver query timeout=5s ограничивает ожидание отдельного SQL.
При неопределённом сетевом результате повторяется тот же command с прежним key.

Документация механизма: [PostgreSQL advisory locks](https://www.postgresql.org/docs/17/explicit-locking.html#ADVISORY-LOCKS),
[Prisma 7 transactions](https://docs.prisma.io/docs/orm/v7/prisma-client/queries/transactions).

## Idempotency

Opening/adjustment/transfer/reversal требуют header `Idempotency-Key: <UUID>`.
SHA-256 requestHash вычисляется из явного ordered command tuple: type, resource IDs,
quantity.toFixed(6), direction/reason при наличии и trimmed note (empty → null).
Reversal включает original transaction ID. Hash не зависит от порядка JSON keys.

- Тот же tenant + key + normalized request возвращает уже сохранённую transaction.
- Тот же key с другим command возвращает 409 IDEMPOTENCY_KEY_CONFLICT.
- Разные tenants могут использовать один UUID key независимо.
- Ошибка с rollback не резервирует key; повтор может быть выполнен после исправления причины.
- Auth/membership/permission checks выполняются и при replay.
- Replay успешной команды не проверяет ресурсы повторно: её эффекты уже записаны.

Frontend генерирует UUID для попытки команды, сохраняет его и введённые данные
при ошибке/повторе, меняет key после подтверждённого успеха или изменения payload.
Command forms не используют автоматический reset ввода после error state.
Состояние попытки хранится в памяти открытой формы; после полной перезагрузки
при неоднозначном результате сначала нужно проверить history. Tokens в browser
storage не сохраняются. Idempotency не заменяет authorization.

## Negative stock

По умолчанию любая операция с результирующим balance < 0 возвращает
409 INSUFFICIENT_STOCK. Ни ledger, ни projection не меняются. Разрешение отрицательных
остатков распространяется на adjustment, transfer source и reversal.

Настройку нельзя выключить, пока хотя бы одна balance row отрицательна:
409 INVENTORY_NEGATIVE_STOCK_EXISTS. Изменение policy и выполняющиеся команды
согласованы shared/exclusive settings gate.

## Cross-module правила

| Изменение            | Ограничение                                               |
| -------------------- | --------------------------------------------------------- |
| trackInventory=false | Запрещено при любой non-zero balance variants item        |
| Archive item         | Запрещено при любой non-zero balance variants item        |
| Archive variant      | Запрещено при любой non-zero balance variant              |
| Deactivate Location  | Запрещено при любой non-zero balance location             |
| Change variant unit  | Запрещено после любой inventory history, даже при stock=0 |
| PRODUCT → SERVICE    | Запрещено после любой inventory history variants item     |

Для archive сознательно проверяются отдельные Locations, а не net sum: +5 в одной
и −5 в другой не позволяют скрыть физический stock. После нулевых balances tracking
можно выключить; archive разрешён согласно Stage 3 (default variant отдельно не
архивируется). Unit/type history rules остаются.

Прямые административные SQL изменения activity flags не являются поддерживаемым
application write path. Но stock API обнаруживает archived/nontrackable variants
с non-zero balances, чтобы остатки не исчезли при ранее неконсистентных данных.
Исправление через UI: reactivate → bring stock to zero → archive.

## Permissions и tenant isolation

Новые permissions: inventory.view, inventory.adjust, inventory.transfer,
inventory.settings.manage. OWNER/ADMIN получают все четыре; MEMBER — только view.
Reversal требует permission исходной команды: transfer для TRANSFER, adjust
для OPENING_BALANCE/ADJUSTMENT, плюс inventory.view для доступа к route.

Все routes защищены существующими JWT, ACTIVE membership и permission guards.
createdByUserId берётся из authenticated context. organizationId берётся из
проверенного route context. Чужие resource IDs не дают доступ к данным.
Composite FKs связывают entry с transaction/location/variant одного tenant,
balance с location/variant одного tenant, reversal с original того же tenant.

## API

Префикс: `/api/v1/organizations/:organizationId/inventory`.

| Метод | Путь                                   | Permission                         |
| ----- | -------------------------------------- | ---------------------------------- |
| GET   | `/stock`                               | inventory.view                     |
| GET   | `/transactions`                        | inventory.view                     |
| GET   | `/transactions/:transactionId`         | inventory.view                     |
| GET   | `/settings`                            | inventory.view                     |
| PATCH | `/settings`                            | inventory.settings.manage          |
| POST  | `/opening-balances`                    | inventory.adjust                   |
| POST  | `/adjustments`                         | inventory.adjust                   |
| POST  | `/transfers`                           | inventory.transfer                 |
| POST  | `/transactions/:transactionId/reverse` | view + permission исходной команды |

Stock filters: q (item/variant name, SKU/barcode), locationId, categoryId, itemId,
cursor, limit. Без locationId — сумма по всем Locations; с locationId — остаток
конкретной Location, включая inactive. Активные trackable variants без balance
возвращаются с `"0.000000"`, без создания записи. Variant pagination идёт по UUID.

History filters: type, locationId, variantId, from, to, cursor, limit. Сортировка
createdAt DESC + id DESC; cursor — ограниченный base64 JSON timestamp/id.
Date filters ISO8601, from <= to; значения без timezone трактуются в UTC.
Pagination default=50, max=100; UI pages=25. Изменения данных между страницами
не образуют snapshot. Filters следует сохранять при переходе по cursor.

History response: actor ID (локальная identity пока не хранит display name),
note, reason, entries с variant/item/location names и unit, обе reversal-ссылки.
Названия отражают текущее состояние справочника; immutable quantities и unit meaning
сохраняются. requestHash и idempotencyKey не раскрываются.

Stock reads используют bounded variant page + PostgreSQL groupBy SUM, без N+1.
History загружает связанные записи пакетно, максимум две entries и одну reversal
на transaction. Ввод ограничен DTO; note<=2000, q<=100, cursor<=256, body<=1 MiB.
Неизвестные body fields и raw signed delta отклоняются.

Domain errors: 409 INSUFFICIENT_STOCK, OPENING_BALANCE_ALREADY_INITIALIZED,
INVENTORY_STOCK_EXISTS, INVENTORY_UNIT_IMMUTABLE, INVENTORY_ITEM_TYPE_IMMUTABLE,
INVENTORY_TRANSACTION_ALREADY_REVERSED, INVENTORY_REVERSAL_NOT_ALLOWED,
IDEMPOTENCY_KEY_CONFLICT, INVENTORY_TRACKING_DISABLED, INVENTORY_RESOURCE_INACTIVE,
INVENTORY_QUANTITY_OVERFLOW, INVENTORY_NEGATIVE_STOCK_EXISTS.
Validation=400, missing auth=401, missing permission=403, foreign resource=404.
Prisma/SQL internals не включаются в error response.

Development Swagger `/api/docs` и `/api/docs-json` описывает Inventory DTOs,
Bearer authentication и обязательный Idempotency-Key. Production Swagger закрыт.

## Frontend

Organization navigation показывает Inventory при inventory.view.

- `/inventory`: stock, поиск, фильтры Location/category, aggregate view, pagination.
- `/inventory/operations`: поиск/выбор variant, opening, adjustment и transfer forms.
  Source stock читается с сервера при выборе Location; backend перепроверяет его
  в transaction. Разрешены только active resources.
- `/inventory/history`: movements, даты UTC, actor, notes, reversal status и filters.
- `/inventory/history/[transactionId]`: detail и reversal с явным checkbox confirmation.
- `/inventory/settings`: negative-stock policy и предупреждение о её последствиях.

Frontend использует общий server-only authenticated API client Stage 2/3. Команды
отправляются через server actions; HTTP слой и authorization не дублируются.
MEMBER видит read-only stock/history. Настройки доступны settings.manage.

## Проверки

Inventory scenarios расширяют существующий реальный PostgreSQL + local JWKS suite.
Нет Clerk bypass, artificial sleeps для синхронизации или mocked persistence.

Покрыты ledger/projection consistency, точность и overflow, RBAC, tenant FKs/IDOR,
negative stock, opening history, reversals, forced transfer rollback, DB immutability,
20 concurrent increments, competing decrements/transfers, встречные transfers,
concurrent duplicate/different-key requests, double reversals, resource mutation races,
independent stock keys, archived stock visibility и migration/backfill.

Основные проверки:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
pnpm --filter @saas/api db:validate
pnpm --filter @saas/api db:migrate
```

CI уже выполняет migrations, integration tests и container checks; новых production
secrets не требуется. Backend tests создают временную schema в отдельной test DB,
применяют старую migration, создают legacy tenant, затем применяют последующие
migrations. Это проверяет как создание inventory tables, так и upgrade/backfill.

Для browser end-to-end проверки нужны настоящие Clerk credentials из инструкции
Stage 2. Нужно проверить вход, inventory forms, source stock refresh, explicit reversal
confirmation, MEMBER read-only, error handling и retry при разрыве сети.
Отсутствие credentials не отменяет backend integration/concurrency tests.

## Граница этапа

Sales, Purchases, valuation/COGS, reservations, lots/batches/serials, accounting,
notifications, audit subsystem, AI и Stage 5 не реализованы.
