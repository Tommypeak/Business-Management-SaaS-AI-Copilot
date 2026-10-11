# Stage 11 — Returns & Refunds: исторический proposal и принятые изменения

Первоначальный proposal: **2026-10-11**, аудит commit `e7f0bcd`. Обновление: **2026-10-12**. Пользователь последующим подробным запросом разрешил реализацию Stage 11 и уточнил правила; этап реализован в `codex/stage-11-customer-returns-refunds`. Актуальный контракт и проверки: [Stage 11 report](stage-11-returns-refunds.md), [PROJECT_CONTEXT](PROJECT_CONTEXT.md). Разделы ниже таблицы сохраняют первоначальное предложение для истории; не использовать их как действующие API/финансовые правила.

## Принятые изменения относительно первоначального proposal

| Первоначальное предложение                         | Реализованное требование пользователя                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Allocation на original SalesPayment                | RefundAllocation на один/несколько POSTED SalesReturn одной original sale и организации                       |
| Refund только в размере отрицательной net position | Cash cap P−F и unused credit каждого return; unpaid debt не уменьшает этот payout cap                         |
| O=1000, P=600, C=800                               | Выплата 400 разрешена; следующая 300 запрещена; 200 разрешена, F=600                                          |
| Один destination, restockQuantity                  | RESTOCK/NO_RESTOCK и destination на строке; RESTOCK возвращает всю quantity строки при original stockDeducted |
| returnDate/refundDate                              | Return event = фактический postedAt в org timezone; refund event = paymentDate DATE, createdAt отдельно       |
| SalesRefund / SalesRefundAllocation / SALES_RETURN | CustomerRefund / RefundAllocation / SALE_RETURN                                                               |
| routes sales/returns и return-options              | routes /returns, /refunds и original order /returns, /return-eligibility                                      |
| Предварительные permissions                        | returns.view, returns.manage, refunds.manage; деньги null без finance.view, включая writes/replays            |
| SQL reversal gap открыт                            | Исправлен первым слоем Stage 11: allowlist OPENING_BALANCE/ADJUSTMENT/TRANSFER, direct SQL rejection/rollback |
| Будущая реализация после согласования              | Реализована; три новые migrations, API/Web/Finance/Analytics/readonly AI и regression gates                   |

Net outstanding остаётся max(O−C−P+F,0) и ограничивает новые SalesPayments. Original order/payment history immutable; gross analytics/AOV сохраняются. Внешний acquiring, supplier returns, destructive posted correction и Stage 12 не реализованы. Commit/push не выполнялись.

Рекомендуемый scope первой реализации: **возвраты покупателя по COMPLETED Sales и ручная регистрация выплаты клиенту**. Supplier returns, credit notes и получение денег от поставщика требуют отдельного согласованного домена. Completed Sales, GoodsReceipts, SalesPayments и SupplierPayments сохраняются неизменными.

## 1. Архитектурный аудит

Есть подходящая основа: tenant-scoped modular monolith, Decimal arithmetic, idempotent commands, advisory/resource/stock locks, immutable ledger и DB history guards. Sales completion и Purchasing receive уже вызывают Inventory writer в той же DB transaction. Finance и Analytics агрегируют бизнес-факты, AI читает эти сервисы через allowlist.

Новый ReturnsModule должен хранить свои документы и ссылаться на original sale/line/payment. Он использует общий Inventory writer для нового компенсирующего движения. Исходный order status, totals, items, payments и original SALE не изменяются. Отдельный query service выдаёт remaining returnable quantity и текущее положение расчётов с клиентом.

Возврат и выплата — два события: первый уменьшает обязательство покупателя и при необходимости возвращает stock, второй фиксирует фактический денежный outflow. GoodsReceipt относится к поступлению от поставщика, SupplierPayment — к его bill. Их void/reverse нельзя использовать для клиентских компенсаций.

## 2. Проблемы, которые необходимо учесть

| Наблюдение                                                                                            | Влияние на Stage 11                                                                              |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| SQL допускает generic reversal PURCHASE_RECEIPT, хотя API запрещает; воспроизведено в isolated schema | Сначала новая guard migration + direct SQL test; расширение enum не должно создавать новый обход |
| InventoryTransaction unique salesOrderId — один original SALE                                         | Return получает отдельный salesReturnId; несколько возвратов не используют original link         |
| SalesPayment cap и OrdersQuery paymentStatus используют original total − paid                         | Нужны net receivable/customer credit расчёты для команд и чтения                                 |
| Finance/cash-flow и Analytics не знают refunds                                                        | Refund outflow должен включаться ровно один раз; return credit сам не cash outflow               |
| Snapshot `stockDeducted` есть, но return resource policy отсутствует                                  | Решение по stock опирается на исходный факт, а не текущий tracking flag                          |
| Source line/payment не имеют составного unique с org/order для новых FK                               | Добавить unique и tenant/order FK новой migration                                                |
| Applied SQL contains business validators, не только Prisma DDL                                        | Новая migration должна сохранить и расширить validators; empty Prisma diff недостаточен          |
| Live LLM не проверен; Stage 10 не опубликован                                                         | Отдельные незавершённые release checks; не блокируют подготовку схемы на согласованной базе      |

## 3. Зависимости и согласуемые правила

Зависимости: Sales source snapshots/payments/order locks; Catalog/Locations/Inventory gates и writer; Authorization registry/system-role backfill; Finance/Analytics/types/Swagger; Web sales detail и общие UI tokens; readonly AI tools.

Предлагаемые правила первого scope:

- Partial/multiple returns допускаются. DRAFT не резервирует количество; POST заново проверяет остаток. Только POSTED возвраты участвуют в лимитах, stock и finance.
- Сумма returned quantity по original line не больше sold quantity. Сумма credits не больше original discounted lineTotal. Клиент не выбирает произвольную credit price.
- Refund только по POSTED SalesReturn той же продажи, с allocation на исходные SalesPayments. Store credit между разными заказами, exchange, goodwill refund без возвращённой строки и внешнее acquiring не входят в этот scope.
- Credit сначала уменьшает неоплаченный долг данного order. Денежная выплата допустима только для образовавшейся задолженности бизнеса клиенту. Это предложенная продуктовая политика, её нужно подтвердить.
- `restockQuantity` от 0 до returned quantity позволяет отделить пригодный товар от повреждённого. SERVICE/non-stock line: restock=0. Учёт повреждений/утилизации как отдельного склада пока не вводится.
- Для изначально списанной строки restock может принять archived item/variant или отключённый сейчас tracking, если unit совпадает с immutable snapshot. Destination location активна и принадлежит org; ресурс не активируется автоматически. Такой stock остаётся видимым как historical nonzero stock. Нужен отдельный ограниченный resource gate path, не отключение всех inventory checks.
- Один destination location на return, по умолчанию original sale location; при наличии restock обязательно выбрать действующую location. Finance location наследует original sale, даже при другом destination.
- `returnDate`/`refundDate` — business DATE, `postedAt`/`createdAt` — audit timestamps. Предлагается запрет future date, return date раньше локального дня sale completion и refund date раньше return date. Backdating в этих границах явно показывается в UI; original payment сейчас использует createdAt.
- POSTED return/refund нельзя редактировать, удалять или void без компенсации. В первой версии доступна отмена только DRAFT. Исправление ошибочного POSTED return требует отдельно спроектированного append-only correction; нельзя молча включить destructive undo.

### Расчёты

Для original discounted lineTotal `L`, sold quantity `Q`, уже posted returned quantity `qPrev` и новой `q`:

```text
cumulativeCredit(qTotal) = roundHalfUp(L × qTotal / Q, 4)
newCredit = cumulativeCredit(qPrev + q) − cumulativeCredit(qPrev)
```

Decimal precision 60; quantities 6 знаков. Последний полный возврат даёт ровно L, без потери последнего денежного разряда. Это поддерживает line discount, дробные количества и zero-value lines. Zero credit return возможен; zero-amount refund не создаётся. Draft quote информативен: финальный credit вычисляется под order lock при POST, stale quote должен быть показан до подтверждения нового результата, а не молча менять обещанную клиенту сумму.

Положение клиента по order:

```text
O = original completed total
C = sum posted return credits
P = sum original SalesPayments
F = sum recorded SalesRefunds
adjustedSalesAmount = O − C
customerPosition = (O − C) − (P − F)
receivable = max(customerPosition, 0)
refundable = customerCredit = max(−customerPosition, 0)
```

Новый payment ограничивается receivable; refund ограничивается refundable, оставшимися исходными payments и remaining credit выбранного return. Каждый payment allocation нельзя refund более его original amount. Например, O=100, P=40, C=30 даёт receivable=30 и refundable=0; при C=70 refundable=10, после refund 10 позиция равна нулю. Cash flow меняется только при выплате 10.

## 4. Предлагаемые модели БД

| Модель                         | Поля/связи                                                                                                                                                                                                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SalesReturnSequence            | organizationId PK, lastNumber; последовательность org-local                                                                                                                                                                                                       |
| SalesReturn                    | id/org/original salesOrderId, sequenceNumber, DRAFT/POSTED/CANCELLED, destinationLocationId optional, currency snapshot, returnDate, reason/note, Decimal creditTotal, createdBy/postedBy membership, timestamps, creation/post idempotency keys и payload hashes |
| SalesReturnItem                | id/org/returnId/originalOrderId/originalSalesOrderItemId, returnedQuantity Decimal(19,6), restockQuantity Decimal(19,6), creditAmount Decimal(19,4), historical display snapshots; unique return/original line                                                    |
| SalesRefund                    | id/org/originalOrderId/salesReturnId, amount Decimal(19,4), currency snapshot, method, refundDate, reference/note, actor, createdAt, org idempotency key/hash; сразу immutable recorded event                                                                     |
| SalesRefundAllocation          | id/org/refundId/originalOrderId/originalSalesPaymentId, amount Decimal(19,4); unique refund/payment                                                                                                                                                               |
| InventoryTransaction extension | enum SALES_RETURN; optional unique salesReturnId + composite FK same org; original salesOrderId/goodsReceiptId semantics сохраняются                                                                                                                              |

Добавить source unique `(id, organizationId, salesOrderId)` для SalesOrderItem и SalesPayment, аналогичные triples на return/refund. Composite FK связывают return/refund/line/payment с тем же org **и original order**, включая allocation → refund. Actor FK на membership, currency и price определяются backend.

CHECK: finite/nonnegative credit, strictly positive returned quantity/refund/allocation, `0 ≤ restock ≤ returned`, valid states/timestamps/hash pairs. Для POSTED запрет UPDATE/DELETE/TRUNCATE, включая строки и allocations. Deferred validators проверяют final totals, matching inventory entries/source state, распределение refund, cumulative quantities/credits и отсутствующий либо единственный корректный return movement. Для возврата без restock InventoryTransaction не создаётся.

Aggregate bounds требуют сериализации parent order, а не только CHECK суммы в одной строке. DB validators должны брать parent row lock до чтения агрегатов; concurrency tests включают direct SQL. New source type запрещён в generic reversal, source metadata взаимоисключающая. Indexes: org/order/state; org/returnDate/id; org/refundDate/id; org/originalLine; org/originalPayment; org/destination; idempotency/sequence unique.

Старая история не преобразуется в returns; financial fields вычисляются из новых записей. Не переписывать исходные totals/payment records и старые migration checksums.

## 5. API design

Prefix: `/api/v1/organizations/:organizationId`. Контракты предложены, не существуют сейчас.

| Method / path                                   | Назначение                                                                                                     |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| GET `sales/orders/:orderId/return-options`      | Original lines, sold/returned/remaining, stockDeducted, payment availability, net settlement; разрешённые refs |
| GET `sales/returns` / `sales/returns/:returnId` | Bounded list/detail с tenant/date/status/source filters                                                        |
| POST `sales/returns`                            | Create DRAFT по completed order; Idempotency-Key                                                               |
| PATCH `sales/returns/:returnId`                 | Draft metadata с revision/expectedVersion                                                                      |
| PUT `sales/returns/:returnId/items`             | Atomic replace draft lines, revision check                                                                     |
| POST `sales/returns/:returnId/post`             | Commit credit + inventory; key + expectedVersion + expectedCreditTotal                                         |
| POST `sales/returns/:returnId/cancel`           | Cancel DRAFT; ключ повтора команды                                                                             |
| GET `sales/returns/:returnId/refunds`           | Bounded refunds и allocations                                                                                  |
| POST `sales/returns/:returnId/refunds`          | Record manual refund с amount/method/date/reference/allocations; key                                           |
| GET `sales/refunds` / `sales/refunds/:refundId` | Bounded financial audit list/detail                                                                            |

`expectedCreditTotal` используется только для обнаружения stale quote, сумма всё равно считается backend. При другой сумме/revision POST возвращает 409 и актуальный безопасный quote, без side effects. Canonical hash включает source ID, ожидаемую revision, normalized items/restock, dates/reasons/allocations; одинаковый key + другой payload → conflict. UUID normalizing и deterministic sorting сохраняют текущий подход.

Responses: денежные значения strings4, количества strings6, currency, business dates, original snapshots, status, remaining quantities, net receivable/customer credit, refund availability и source links. Historical SalesOrder total/paidAmount сохраняют значения; добавить явные returnedCreditAmount/refundedAmount/netPaidAmount/adjustedSalesAmount/netOutstanding/customerCredit, определить производный settlement status. Existing paid status и filters нельзя оставить неучитывающими новые события или поменять без обновления contracts/UI.

Максимум 100 return lines, страницы до 100; refunds/allocations bounded, без загрузки всех исходных платежей в response. Ошибки с codes: source not completed, over-return, stale draft/quote, refund exceeds credit/payment, immutable posted document, tenant resource missing, idempotency conflict. Swagger описывает success/error и отличия zero/null/unavailable.

### Finance / Analytics / AI integration

Сохранить gross completed sales и добавить return credits по returnDate и net sales flow за период (gross − returns, может быть отрицательным при возврате прошлой продажи). Это event-period metric, а не net результат когорты продаж; cohort отчёт имеет другое определение.

Collected customer payments остаются gross receipts, добавить customerRefundsAmount по refundDate и net customer receipts. Net Cash Flow = receipts − refunds − posted expenses − supplier payments. Current receivable/customer credit считаются по всем posted событиям вне периода; customer credit — отдельная liability, не Supplier outstanding. Original sales count/gross AOV/top ranking сохраняются, новые net metrics маркируются отдельно. Inventory movement filters/series/source types/activity учитывают SALES_RETURN, units и actual ledger timestamp.

API/types/Swagger/Frontend Finance/Dashboard/Analytics и существующие AI tools обновляются одновременно. AI читает authoritative net fields и новые definitions, не получает tools posting return/refund. В location scope return/refund finance относится к original sale, stock относится к destination; supplier null semantics сохраняется.

## 6. Transaction boundaries и concurrency

Create draft: tenant/source проверка → source order lock → draft/lines/sequence в одной transaction. Quote read не резервирует quantity. Draft edit/cancel: order → draft lock/revision check, без ledger/cash.

POST return: idempotency gate → original sales order gate **тот же, что у SalesPayment** → parent row lock → draft gate/revision/quote checks → cumulative posted quantity/credit checks → sorted shared resources → sorted stocks → insert/update posted facts + SALES_RETURN entries + InventoryBalance в одной transaction. Order lock берётся всеми return/refund/payment командами раньше source-dependent locks; row/advisory порядок одинаков и в SQL validators. Resource gate policy сохраняет unit/history invariants для archived исходных ресурсов.

Record refund: key → original order gate/row lock → posted return → sorted payment references → recompute credit/net position/remaining allocations → immutable refund+allocations. Stock не затрагивается. Любая ошибка откатывает все writes. До lookup replay и после guard проверки доступ tenant одинаков; source existence не раскрывается чужому пользователю.

Рекомендуется **два отдельных действия** POST return и record refund: физическое принятие товара не доказывает выплату денег. UI показывает available refund/pending settlement. Сбой выплаты не отменяет уже проведённый приём товара. Combined command не входит в первый scope; если понадобится, весь DB-only return+refund должен быть одной transaction и требовать обе группы permissions.

Manual record не вызывает банковский API и не гарантирует внешнюю exactly-once выплату. В будущем acquiring потребует provider idempotency, durable outbox/state machine и внешнего вызова вне DB transaction; не добавлять эти механизмы без такого scope.

## 7. Permissions

Добавить отдельные permissions, не разрешать refund через existing sales.manage или inventory.adjust:

| Новое право            | Дополнительный контекст                                      |
| ---------------------- | ------------------------------------------------------------ |
| `sales.returns.view`   | `sales.view`; информация по original sale и возврату         |
| `sales.returns.manage` | `sales.view`; create/edit/cancel DRAFT                       |
| `sales.returns.post`   | `sales.view`; bounded credit/restock по source lines         |
| `sales.refunds.view`   | `sales.view` + `finance.view`                                |
| `sales.refunds.manage` | `sales.view` + `finance.view`; manual monetary payout record |

Returns post включает ограниченную domain stock compensation; arbitrary stock adjust права не добавляет. Выбор destination/возвратных ресурсов делается через bounded authorized return-options, без выдачи полного каталога/списка складов чужого tenant. Inventory history view по-прежнему требует inventory.view.

Предлагаемые defaults: OWNER/ADMIN получают новые права (кроме зарезервированных owner-only существующих прав); MEMBER получает только returns.view вместе с имеющимся sales.view. Refund и posting отсутствуют у MEMBER. Обновить registry, new org system roles и idempotent migration backfill; custom roles не расширять. Finance/Analytics snapshots и AI checks используют свои текущие monetary permissions.

## 8. Security constraints

Tenant/user берутся из verified guards; org/source/actor/currency/totals нельзя mass assign. Every source lookup и aggregate scoped по org; composite FK дополнительно проверяют same order. Finite Decimal и limits проверяются DTO, сервисом и DB. Причины/reference bounded plain text; frontend escape, никаких HTML/LLM-generated executable instructions.

До refund нужны fresh membership/permissions непосредственно у command execution, audit actor/date/key/source; handling revocation inside already-running transaction должно быть определено и проверено. Не логировать tokens, provider key, customer banking details или full request bodies. UI confirmation показывает original sale, credit, restock destination и actual cash payout отдельно; submit retries сохраняют тот же key.

API/service запрет immutable mutations подкрепляется SQL triggers. Право на direct DB writes само по себе не делает bypass допустимым. Новый тип исключается из generic reversal на всех уровнях. Исторические ledger entries и completed documents не удаляются, source fields не переименовываются ради обхода constraints.

## 9. Test plan

1. Decimal: discounts, quantities6/prices4, cumulative rounding, последняя часть ровно original lineTotal, tiny zero credit, zero-value item, overflow/NaN.
2. State/quantity: только completed sale; partial/multiple returns; draft не резервирует; over-return, repeated line, service/non-stock restock запрещён; unit/history preserved.
3. Inventory: один корректный SALES_RETURN на posted restock, damaged restock0, destination scope; archived/tracking changed ресурс по согласованной policy; negative balance recovery; projection равна ledger SUM.
4. Money: unpaid/partial/full sale, credit сначала покрывает долг; partial/multiple refunds; allocation cap и total match; no unlinked/zero refund, mixed source order/currency rejected.
5. Race: два POST сверх sold qty; два refunds сверх credit; refund vs payment vs return; replay с тем же key, changed payload; draft edit vs POST/quote revision; устойчивый lock order при нескольких variants/locations.
6. Atomicity: injected failure после первого stock update, после return facts и после первой allocation; отсутствие partial return/ledger/balance/refund; повтор после rollback.
7. Direct SQL: immutable posted docs/lines/refunds/payments; malformed FK и numeric/state constraints; matching ledger; generic SALE/PURCHASE_RECEIPT/SALES_RETURN reversal запрет; concurrent aggregate bounds.
8. Tenant/RBAC: foreign org/sale/line/payment/location/return/refund, signed role claim/mass assignment, MEMBER/custom roles, fresh revocation, source links без IDOR.
9. Finance/Analytics: refund ровно один outflow, return без cash, old sale return в новом периоде, current debt independent period, dates/DST/location scope, supplier semantics unchanged, cashflow != profit.
10. AI/UI: authoritative new fields, permissions/mixed currency, no write tools; loading/empty/conflict/retry, confirmations, source history, light/dark/responsive/accessibility. Live provider — отдельный smoke с настоящей разрешённой конфигурацией.
11. Gates: root lint/typecheck/full test/build/format; fresh и upgrade migrations/backfill/redeploy/diff; three Docker builds/runtime; existing Stage 1–10 regressions без сокращения coverage.

## 10. Implementation plan и критерии завершения

1. Подтвердить клиентский scope и продуктовые правила раздела 3; зафиксировать финансовые definitions и permission matrix. Проверить Git base и публикацию Stage 10 перед созданием ветки.
2. Устранить подтверждённый PURCHASE_RECEIPT SQL reversal gap отдельной новой migration и regression. Existing history не менять.
3. Добавить Prisma models/FK/indexes/DB validators и permission backfill; validate fresh schema и upgrade existing org.
4. Реализовать Returns commands/query services с parent order locking, cumulative Decimal credit, quote revision и одной stock transaction.
5. Реализовать immutable manual Refund+Allocation и net payment bounds; проверять races и rollback до UI.
6. Обновить Sales/Finance/Analytics/API contracts/Swagger/AI readonly mappings согласованными monetary fields, period/location semantics.
7. Добавить pages/actions/confirmations/history в существующие sales/finance flows и tokens, без нового UI стиля.
8. Выполнить acceptance suite раздела 9, recorded verification и Stage 11 docs; подготовить reviewable diff. Commit/push только после разрешения.

Stage завершён, когда multiple/partial returns и payouts не превышают source limits при concurrency, stock/credit/cash записываются атомарно в соответствующих командах, immutable originals и tenant boundaries сохранены, Finance/Analytics/AI согласованы и каждый заявленный gate выполнен. До подтверждения этого плана сохраняются только документы аудита.
