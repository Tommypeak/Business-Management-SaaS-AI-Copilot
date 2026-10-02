# Stage 5 — Sales, Orders, Customers & Payments

Продолжение Stage 1–4: основной NestJS backend остаётся modular monolith.
Новых зависимостей, auth/permission frameworks, очередей и сервисов не добавлено.
AI service не изменён. Returns, refunds, reservations, taxes, purchasing,
valuation, acquiring и Stage 6 в эту реализацию не входят.

## Database

Миграция: `20260930170000_sales_orders`. Применять `pnpm --filter @saas/api db:migrate`;
предыдущие migrations не изменены. Финальный механизм — `prisma migrate deploy`.

Новые модели:

- `Customer`: tenant-owned, INDIVIDUAL/BUSINESS, имя, необязательные email/phone/notes,
  архивирование через `isActive`. Email/phone не уникальны. Физического DELETE API нет.
- `SalesSequence`: одна строка на организацию, создаётся лениво, атомарный upsert/increment.
- `SalesOrder`: sequence, DRAFT/COMPLETED/CANCELLED, customer/location, currency,
  totals, timestamps, actor и ключи/хеши создания и completion.
- `SalesOrderItem`: variant, quantity, price/discount/total, snapshot названий/SKU/unit.
  Внутренний `stockDeducted` фиксируется при completion для проверки соответствия
  SALE ledger и строк продажи в БД. Через API он не принимается.
- `SalesPayment`: положительная сумма, method/reference/note, actor, key/hash.

`InventoryTransactionType` расширен значением `SALE`. Nullable `salesOrderId`
и composite foreign key `(salesOrderId, organizationId)` связывают движение с
заказом того же tenant. Unique ограничение позволяет максимум одно SALE движение
на заказ. Для заказа без tracked products движения нет.

Customer/order/variant/location/payment relationships используют composite FK.
Unique индексы: tenant + sequence, tenant + creation key, tenant + completion key,
tenant + payment key, order + variant, inventory sale source.
Списки индексированы по tenant, createdAt/id и подходящим status/customer/location.
Payment aggregation использует индекс tenant/order. Email/phone не индексируются
как уникальная identity; поиск подстроки на Stage 5 без дополнительной search infrastructure.

SQL constraints/triggers дополнительно проверяют:

- положительную quantity, неотрицательные money, отсутствие NaN;
- ROUND_HALF_UP line arithmetic, totals и не более 100 строк;
- согласованность status/timestamps/completion key;
- запрет UPDATE/DELETE payments и изменения terminal orders/их lines;
- оплаты только COMPLETED, sum(payments) не выше total;
- SALE entries точно совпадают с отмеченными строками и Location заказа;
- запрет прямого inventory reversal для SALE;
- запрет дописывать entries в уже зафиксированное SALE движение.

## Customers

Архивный Customer остаётся доступен по detail/history, но недоступен для нового
назначения. Picker по умолчанию запрашивает active customers. Архивация клиента
после назначения не мешает completion ранее созданного draft. Search по имени,
email и телефону всегда ограничен organizationId. Изменение клиента и назначение
заказу согласованы через shared/exclusive customer advisory lock.
Customer detail показывает sales history обычным customerId filter; суммы разных
валют не складываются в вводящий в заблуждение общий total.

## Order lifecycle and snapshots

Создание выдаёт номер внутри организации. UI отображает `SO-000001`, storage — Int.
Counter обновляется в той же transaction; failed creation не расходует номер.
Это внутренняя нумерация, без обещаний фискальной нумерации.

Draft может быть пустым и без Location. Он не резервирует stock.
PATCH меняет только customer/location/note. PUT items принимает `{ "items": [...] }`
и атомарно заменяет весь набор, максимум 100 уникальных variants.
Пустой набор разрешён до completion. Повтор variantId, включая разный регистр UUID,
отклоняется. Клиент не может передавать unitPrice/subtotal/lineTotal/total.

При записи набора строк используются текущие Catalog prices/names/SKU/unit.
Сохранение всего набора явно обновляет snapshots всех его строк; UI это объясняет.
Изменение Catalog само по себе snapshots не обновляет. Completion пересчитывает
итоги из сохранённых prices, не из новых Catalog prices.
Если единица измерения изменилась, completion возвращает `ORDER_UNIT_CHANGED`:
нужно явно пересохранить строки и подтвердить количество в новой единице.

Currency берётся из Organization.defaultCurrency при создании. Последующие изменения
валюты организации не меняют старые orders. Customer/location labels остаются
живыми справочными ссылками; historical line display использует только snapshots.

Completion требует active Location и active item/variant текущей организации.
SERVICE и PRODUCT без tracking не создают складских entries.
COMPLETED нельзя редактировать или отменять. CANCEL возможен только для DRAFT;
CANCELLED тоже неизменяемый. Возвраты и refunds отсутствуют.

## Decimal totals

Quantity: numeric(19,6), вход/выход — decimal string, строго > 0.
Money: numeric(19,4), вход/выход — decimal string.
Для вычислений используется существующий Prisma.Decimal с локальным clone,
precision 60: произведение двух 19-значных чисел и сумма до 100 строк сохраняются
без преждевременной потери точности. Глобальная конфигурация Decimal не меняется.

Политика — ROUND_HALF_UP до 4 знаков **на каждой gross line**:

```text
gross = round(quantity × unitPrice, 4)
lineTotal = gross − discountAmount
subtotal = SUM(gross)
discountTotal = SUM(discountAmount)
total = subtotal − discountTotal
```

Discount от 0 до округлённого gross. Проверяется также переполнение итогов.
PostgreSQL `round(numeric,4)` для неотрицательных gross использует ту же политику.
Пример: 10.1234 × 2.500000 − 1.0000 = 24.3085, subtotal 25.3085.
Пограничный пример: 0.0001 × 0.500000 = 0.0001.
Frontend отображает полученные strings и не выполняет финансовые расчёты через Number.

## Inventory atomicity and locking

`InventoryCommandsService.recordSale(tx, ...)` работает в переданном TransactionClient.
Sales не вызывает Inventory по HTTP и не открывает второй transaction для склада.
Обычные команды Stage 4 и SALE переиспользуют один writer ledger/projection и одну
negative-stock policy. Shared gates проверяют active/tracking state; sorted stock
locks защищают balances. SALE и entries неизменяемы так же, как остальная history.

В одном commit находятся stockDeducted flags, SALE transaction/entries, balances,
COMPLETED order и optional initial payments. Ошибка любого шага откатывает всё.
`INSUFFICIENT_STOCK` и остальные domain conflicts сохраняют HTTP 409 и code.

Порядок блокировок:

1. Operation-specific tenant idempotency key.
2. Конкретный SalesOrder (advisory); затем customer gate, если он назначается.
3. Все shared Inventory resource gates: item, variant, location, settings,
   с deduplication и сортировкой.
4. Все stock keys в отсортированном порядке.
5. Записи order/ledger/balances/payments и commit.

Draft mutation, completion, cancellation и payment используют один order lock.
Payments не захватывают stock locks. Inventory не захватывает sales order locks.
Catalog/location/settings mutations используют прежние exclusive resource gates.
Customer mutation использует только customer gate. Counter row блокируется только
при создании order; нет общего organization lock для sales/payment/completion.
SQL triggers дополнительно блокируют parent order при записи item/payment.

UUID tenant/path/header/body нормализуются, чтобы PostgreSQL UUID equality,
advisory locks и request hash трактовали регистр одинаково.
Transactions: READ COMMITTED, timeout 20 s, maxWait 10 s. Detail/list read transactions
используют REPEATABLE READ, чтобы totals и payments соответствовали одному snapshot.

## Idempotency

Create, complete и add payment требуют `Idempotency-Key: UUID`.
Ключ scoped по tenant и виду команды. Completion/payment hash также содержит orderId.
Create нормализует порядок lines по variantId, decimal scale, optional text/nulls.
Completion сохраняет порядок массива payments — он является частью команды.

Same key + canonical request возвращает существующий результат без новых записей.
Different payload возвращает 409 `IDEMPOTENCY_KEY_CONFLICT`. Completion key уникален
внутри организации, поэтому его нельзя переиспользовать для другого заказа.
Initial payments получают внутренние UUID и защищены внешней completion idempotency.
Read after replay показывает актуальное состояние order, включая последующие оплаты.

Frontend сохраняет ключ и исходный FormData в памяти формы. При неизвестном результате
поля блокируются, Retry отправляет исходный payload/key, даже если ввод был изменён
до получения ошибки. Не закрывайте и не перезагружайте страницу до подтверждения:
персистентного offline/recovery хранилища на Stage 5 нет. После reload сначала
проверьте список заказов/оплат. Токены по-прежнему только в server API layer.

## Payments

Методы: CASH, CARD, BANK_TRANSFER, QR, OTHER. Это ручная регистрация факта оплаты,
без acquiring, card numbers, CVV или банковских credentials.
Currency наследуется от order, отдельной изменяемой payment currency нет.
Payment неизменяем; refund/reversal/update/delete endpoints отсутствуют.

Paid amount вычисляется SUM в PostgreSQL, outstanding = total − paid.
Статусы derived: PAID при paid = total (включая zero-total order), UNPAID при
paid = 0 и total > 0, иначе PARTIALLY_PAID. Overpayment запрещён.
До 20 initial payments в completion, до 1,000 payment records на заказ;
последний предел ограничивает размер полного detail/payment history response.

## Permissions

| Permission            | Operation                                   |
| --------------------- | ------------------------------------------- |
| customers.view        | List/detail/search                          |
| customers.manage      | Create/update/archive                       |
| sales.view            | List/detail/payments/history                |
| sales.create          | Create draft                                |
| sales.manage          | PATCH draft, PUT items, cancel              |
| sales.complete        | Complete                                    |
| sales.payments.manage | Add payment, initial payments in completion |

OWNER/ADMIN получают все семь; MEMBER — sales.view и customers.view.
SQL backfill для существующих system roles использует ON CONFLICT DO NOTHING.
Новые организации используют общий permission registry. Initial payments требуют
**обоих** permissions: sales.complete и sales.payments.manage. Granular API write
permissions не подразумевают другие write permissions. UI selectors используют
существующие catalog.view/locations.view/customers.view; future custom roles должны
получить соответствующие read permissions для этих selector flows.

## API

Все пути относительно `/api/v1/organizations/:organizationId`, Bearer authentication.

| Method | Path                            | Notes                                     |
| ------ | ------------------------------- | ----------------------------------------- |
| GET    | /customers                      | q/type/isActive/cursor/limit              |
| POST   | /customers                      | Create                                    |
| GET    | /customers/:customerId          | Includes archived                         |
| PATCH  | /customers/:customerId          | isActive=false archives                   |
| GET    | /sales/orders                   | Filters below                             |
| POST   | /sales/orders                   | Idempotency-Key; empty or prefilled draft |
| GET    | /sales/orders/:orderId          | Snapshots, totals, payments               |
| PATCH  | /sales/orders/:orderId          | Draft metadata                            |
| PUT    | /sales/orders/:orderId/items    | `{items:[...]}`; draft only               |
| POST   | /sales/orders/:orderId/complete | Idempotency-Key; `{payments?: [...]}`     |
| POST   | /sales/orders/:orderId/cancel   | Draft only                                |
| GET    | /sales/orders/:orderId/payments | Immutable payment records                 |
| POST   | /sales/orders/:orderId/payments | Idempotency-Key                           |

Sales filters: q, status, customerId, locationId, from, to, paymentStatus, cursor, limit.
q ищет точный sequence/SO-number либо подстроку customer name.
Customer q ищет подстроку name/email/phone.
Max page size 100; cursor — bounded base64url `{id, at}`. Порядок createdAt DESC/id DESC.
Dates без timezone интерпретируются как UTC. from/to включительные, from <= to.
PaymentStatus filtering выполняется в SQL до LIMIT. List не загружает lines/payments;
SQL aggregation и bounded relation queries устраняют прикладной N+1.
Идентификатор SQL schema берётся из server configuration и экранируется как identifier;
все пользовательские SQL values передаются параметрами.

## Frontend

- `/app/[organizationId]/customers`: поиск, active/archive, type, cursor, создание.
- `/app/[organizationId]/customers/[customerId]`: редактирование/архив и sales history.
- `/app/[organizationId]/sales`: поиск, status/location/date/payment filters, pagination.
- `/app/[organizationId]/sales/new`: metadata → create draft → открыть draft.
- `/app/[organizationId]/sales/[orderId]`: bounded Catalog search и variant selection,
  quantity/discount, сохранение с серверным пересчётом, completion с подтверждением,
  cancellation, readonly completed data, payment history и новая оплата.
- Inventory SALE detail ссылается на source order; reversal action скрыт для SALE.

Навигация и mutations видимы по permissions; API проверяет их независимо.
Next.js protected pages строятся без real Clerk secrets, auth bypass не добавлен.

## Tests and verification

`pnpm test` использует реальный PostgreSQL и local signed JWT/JWKS без Clerk account.
Stage 5 scenarios зарегистрированы в существующей isolated integration suite.
Она применяет настоящие migrations к отдельной schema, включая upgrade старой организации.
Не используются sleep для координации concurrency checks.

Покрыты customers/RBAC/archive/search, concurrent sequences, canonical creation replay,
decimal rounding/overflow/precision, mixed orders, snapshot integrity, atomic rollback
при недостатке stock/overpayment/принудительном сбое второй projection write,
concurrent completion, concurrent payment/replay, negative policy, immutable history,
cross-tenant API/SQL references, permission backfill, resource inactivity, unit change,
order lock independence, mutation/completion races, uppercase UUIDs и cursor/filter bounds.
Stage 4 regression suite выполняется вместе с ними.

Фактический результат на 30 сентября 2026: **59 API tests + 1 AI health test**,
без skipped tests. Выполнены lint, typecheck, build, format:check, Prisma validate,
development migrate deploy и deploy всех четырёх migrations в пустую временную
schema (25 application tables). Собраны Docker images web/api/ai. Health/readiness
вернули 200; PostgreSQL/Redis healthy. Development Swagger содержит 13 Stage 5
операций, Bearer security и три обязательных Idempotency-Key headers; production
Swagger возвращает 404. Неавторизованный Sales request возвращает 401.

В ходе проверки исправлены schema qualification параметризованного SQL списка,
канонизация UUID для locks/hashes и предупреждение драйвера pg: relation reads
внутри read transaction теперь выполняются последовательно и пакетно.

Для финальной проверки:

```sh
pnpm --filter @saas/api db:validate
pnpm --filter @saas/api db:migrate
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
```

CI уже выполняет эти проверки, migrations, Docker builds и health smoke; отдельный
Stage 5 workflow не нужен. GitHub-hosted CI не считается проверенным до push/run.

## Manual verification required

При отсутствии настоящих Clerk credentials protected browser flows остаются
непроверенными. После настройки Clerk вручную проверить sign in, create customer,
create draft, поиск и добавление product/service, пересчёт discounts, completion,
stock decrease, partial/final payment, повтор после сетевой ошибки, MEMBER read-only.
Также проверить layout на desktop/mobile, archive/customer history и фильтры.

## Architecture decisions

- Компактный sales module: отдельные customers/orders/queries/payments/totals services,
  без GenericCrud/CQRS/event sourcing и отдельной inventory implementation.
- Прямой composite salesOrder FK вместо polymorphic sourceType/sourceId.
- Сохраняется только technical stockDeducted flag; quantities остаются в ledger/balances.
- Локальный precision-60 Decimal clone, округление gross каждой строки.
- Zero-total order считается PAID, положительная дополнительная оплата запрещена.
- Удобный двухшаговый create flow: сначала draft metadata, затем Catalog items.
- Names/notes выводятся React text, без HTML injection; secrets и SQL errors не возвращаются.

Ready for Stage 6.
