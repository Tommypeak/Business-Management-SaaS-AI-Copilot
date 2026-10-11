# Stage 11 — Customer Returns & Refunds

Дата завершения: **2026-10-12**. База: Stage 10 `e7f0bcd`. Ветка: `codex/stage-11-customer-returns-refunds`. Изменения локальные, **commit/push не выполнялись**. Stage 12 не начат.

## Created

Реализован домен клиентских возвратов и ручной регистрации фактической выплаты: Prisma/SQL, Nest command/query module, shared contracts, Web, Finance, Analytics и readonly AI. Partial/full/multiple returns используют immutable original COMPLETED sale. Original SalesOrder, SalesOrderItem, SalesPayment и SALE ledger не переписываются. Выплата фиксирует денежный факт; подключение acquiring и выполнение банковского перевода не входят в этап.

Первоначальный proposal заменён уточнёнными требованиями пользователя. Особенно важны allocations **на POSTED returns**, independent collected-cash cap, per-line disposition/destination и реальные posting timestamps. Список заменённых решений сохранён в [плане](stage-11-returns-refunds-plan.md). [PROJECT_CONTEXT](PROJECT_CONTEXT.md) актуализирован.

## SQL Vulnerability Fix

Старый `validate_inventory_entries()` запрещал generic reversal SALE/REVERSAL, но добавленный позднее PURCHASE_RECEIPT не входил в запрет. API отклонял операцию, тогда как прямой SQL writer мог вставить REVERSAL receipt и противоположные entries. Это нарушало DB defense и связь purchasing history со stock.

Новая migration `20261011000000_inventory_reversal_guard` вводит BEFORE INSERT source allowlist: **OPENING_BALANCE, ADJUSTMENT, TRANSFER**. SALE, PURCHASE_RECEIPT, SALE_RETURN и будущий business source автоматически запрещены. API использует ту же политику. Applied migrations не изменены; schema identifiers берутся из TG_TABLE_SCHEMA, значения параметризованы.

`apps/api/test/purchasing.scenarios.ts` создаёт реальную receipt, проверяет HTTP rejection и выполняет прямую SQL transaction с reversal/entries. БД возвращает SQLSTATE 23514. Проверены rollback количества transactions/entries, неизменность receipt и balances, equality balance с ledger sum.

## Database

Новые модели: SalesReturnSequence, SalesReturn, SalesReturnItem, CustomerRefundSequence, CustomerRefund, RefundAllocation. Enums: SalesReturnStatus DRAFT/POSTED/CANCELLED, RestockDisposition RESTOCK/NO_RESTOCK, InventoryTransaction SALE_RETURN.

Tenant/order composite FKs связывают source order, source line, return, refund и allocation с одной организацией и исходной продажей. Actors используют `(organizationId,userId)` OrganizationMembership. Unique ключи защищают org sequences, command idempotency и один inventory transaction на salesReturnId. Индексы покрывают org/order/status/createdAt, posting/payment dates, original line и return allocations.

CHECK/trigger guards проверяют положительные quantities/refunds/allocations, finite numeric values, source currency/snapshots, metadata state, допустимую disposition и immutable history. Deferred validators требуют 1–100 строк, header total = line credits, cumulative quantity/credit caps, точное совпадение restocked lines с положительными ledger entries и payout allocation total = refund amount. UPDATE/DELETE/TRUNCATE immutable history запрещены; append allocations/entries не позволяет нарушить исходный документ.

Три новые migrations:

1. `20261011000000_inventory_reversal_guard` — исправление reversal.
2. `20261011010000_customer_returns_refunds` — schema, guards, source FK, payment cap, system-role backfill.
3. `20261011020000_return_metadata_guard` — явные NOT NULL conditions для posting/cancellation hashes, чтобы SQL UNKNOWN не обходил CHECK.

Всего 12 migrations. Dev deploy/status/diff и fresh isolated schema deploy/repeat/diff проверены. Временная schema удалена; существующие dev volumes сохранены.

## Customer Returns

Создание только из COMPLETED sale. DRAFT не резервирует количество; metadata/items доступны для изменения под order lock, каждое изменение увеличивает revision. POST повторно проверяет доступный остаток и сохраняет окончательный credit. CANCEL доступен только DRAFT. POSTED/CANCELLED history неизменна, destructive correction отсутствует.

Несколько partial returns разрешены, пока сумма POSTED quantities каждой source line не превышает sold quantity. SERVICE и legacy unknown type допускают NO_RESTOCK. Source snapshots сохраняют historic item/variant/SKU/unit/type; текущая цена и название каталога не меняют расчёт. Quote invalid/stale сообщает конфликт, UI требует пересмотреть строки. Optional expected revision/credit обнаруживает изменение подтверждённого preview.

Для discounted source line total L, sold quantity Q, prior posted quantity qPrev и prior credit CPrev:

```text
newCredit = roundHalfUp(L × (qPrev + qNew) / Q, 4) − CPrev
```

Decimal precision 60, quantity scale 6, money scale 4. Последний полный возврат даёт ровно original discounted line total. Regression L=1,Q=3 даёт .3333,.3334,.3333. Zero-price return допускается; zero payout запрещён.

## Inventory

RESTOCK/NO_RESTOCK и destination определяются на каждой строке. Physical movement создаётся только когда original `stockDeducted=true`, snapshot PRODUCT и disposition RESTOCK. SERVICE/untracked/unknown lines не создают stock; переключение current tracking не превращает старую продажу в новую stock source.

Archived historic item/variant можно вернуть без реактивации. Destination должна быть active в той же org, current unit совпадает с immutable source unit. Shared resource gates и sorted stock locks переиспользованы с ограниченным historical-return режимом; общие проверки новых stock commands сохраняются.

Один положительный SALE_RETURN с собственным salesReturnId, агрегированными entries и projection записывается общим Inventory writer в **той же transaction**, что line stockRestocked/header POSTED. Original SALE не меняется. Injected writer failure полностью откатывает status, facts, transaction, entries и projection. Generic reversal этого движения запрещён.

## Customer Refunds

CustomerRefund сразу immutable. Методы: CASH, CARD, BANK_TRANSFER, QR, OTHER. `paymentDate` — настоящий YYYY-MM-DD DATE, `createdAt` — audit timestamp. Неверные календарные даты отвергаются. Запись payout не выполняет внешний перевод.

Allocation ссылается на один или несколько POSTED SalesReturn одной original sale и org. Сумма положительных allocations равна payout amount. Draft/cancelled/foreign/mismatched-order returns отвергаются.

```text
O = original sale total
P = original collected SalesPayments
C = posted return credits
F = recorded CustomerRefunds
cashCap = P − F
returnCreditCap = return.credit − SUM(allocations for that return)
adjustedSalesAmount = O − C
netPaidAmount = P − F
netOutstandingAmount = max(O − C − P + F, 0)
```

Проверяется cashCap и credit cap каждого allocation. Net outstanding ограничивает будущие SalesPayments; он не уменьшает cashCap выплат. Обязательный scenario O=1000,P=600,C=800: 400 разрешено, следующая 300 отклонена, 200 разрешено; итог F=600. Historical original payment amounts/timestamps и gross order totals сохранены.

## Concurrency

Command lock order: idempotency key → original SalesOrder advisory gate + scoped row FOR UPDATE → sorted shared resources → sorted stock pairs. Refund uses key → original order → allocations; sequences upsert внутри той же transaction. Source order сериализует return posts, refunds и новые payments.

SQL triggers тоже берут parent order row lock до aggregate checks. Проверены competing API posts/refunds, concurrent direct DB writers и final caps. В прямой гонке только один POST и один payout 75/100 committed; второй writer rejected и rollback не оставляет пустой refund. Arbitrary privileged writers могут отключить triggers; такая административная возможность не является поддерживаемым API.

## Idempotency

Create/post/cancel/refund имеют org-scoped UUID key и normalized payload hash. Decimal formatting и deterministic line/allocation sort обеспечивают стабильный hash. Same key/payload возвращает существующий результат, другой payload — 409. Fresh membership/permissions проверяются и при replay.

Concurrent same-key create/post/refund возвращают один document/movement/payout; balance меняется один раз. Failed transaction не расходует sequence/key. UI сохраняет исходный FormData и key при uncertain timeout: retry отправляет исходную команду; pending disables controls и предотвращает обычный double click. Revision защищает подтверждение POST от устаревшего preview; PATCH/PUT черновика сериализованы, отдельного expected revision для редактирования нет.

## Finance Integration

Finance summary добавляет postedReturnCredits, customerRefundsPaid, adjustedSalesAmount и net customer receivables. Cash flow trend включает customerRefunds.

```text
netCashFlow = collectedPayments − postedExpenses − supplierPaymentsPaid − customerRefundsPaid
```

POSTED return меняет credit/receivable и возможно stock, но не cash. Cash уменьшается при записи CustomerRefund, по paymentDate. Return credits считаются по фактическому postedAt в timezone org. Location scope наследует original sale location, не destination warehouse. Mixed currencies дают controlled conflict для финансовых агрегатов; FX отсутствует.

Period adjusted sales = completed gross sales in period − return credit events in period. Возврат продажи прошлого периода может дать отрицательное adjusted period amount; это event metric, а не rewriting sales cohort. Gross completed sales, original AOV/top-sales snapshots не переписаны. Existing gross paidAmount/paymentStatus original sale остаются историческими; новый net отображается отдельно.

## Analytics

Returns summary содержит posted count, returned line count, credit/payout amount, cash/credit trend и top returned historic variants с units/type/snapshots. DAY/WEEK/MONTH zero-filled series, bounded periods/results и RepeatableRead сохраняются. Без finance.view operational counts доступны, money null. Financial mixes reject без скрытой конвертации.

Returns list from/to фильтрует local posting date организации, refund list — business paymentDate. Timezone boundary regression проверяет ситуацию, когда UTC day отличается от local day: list и analytics относятся к одному периоду. Dashboard/Sales/Finance показывают return/refund widgets, а исходные sales charts сохраняют прежнюю gross семантику.

## AI Integration

Новый `get_customer_returns_summary` читает разрешённый агрегат. Требует global ai.use + returns.view; money дополнительно finance.view. Tool arguments allowlist: bounded period/granularity/location/limit; arbitrary tenant/SQL/write arguments запрещены. Источники ведут в Returns/Refunds того же org и периода. Python instructions различают return credit и payout, gross revenue/AOV и adjusted figures.

Existing active membership/AI enablement rechecks, allowlist, bounded output, same-tenant sources и final response authorization сохранены. Nest tool/mock orchestration и 26 Python tests выполнены; **реальный provider inference не проверен, credentials отсутствуют**, runtime status configured=false. У AI нет mutation tool, даже когда пользователь имеет manage permissions.

## Security

- Global JWT auth, ACTIVE membership, explicit endpoint permissions; foreign IDs дают 404.
- OWNER/ADMIN получают returns.view/manage и refunds.manage, MEMBER только returns.view. Legacy backfill и новая org initialization проверены; custom roles не расширены.
- Денежные list/detail/eligibility/refund/allocation/mutation/replay fields без finance.view равны null. Optional expectedCredit требует finance.view, чтобы не стать денежным comparison oracle.
- Server owns actor, org, currency, snapshots, credit totals, status metadata. DTO whitelist/forbid extra properties, duplicate IDs, bounds и real dates проверяются.
- Composite FK/row locks/SQL guards сохраняют source/payment/ledger integrity независимо от command service checks.
- Secrets/env/build/test fixtures не добавлены в Git. `.tools` и `.env*` ignored; `.dockerignore` исключает их из build context. Изменений auth/config/CI dependencies Stage 11 не требует.

## API

Prefix: `/api/v1/organizations/:organizationId`; Bearer auth. Mutation create/post/cancel/refund требуют `Idempotency-Key`.

| Method | Path                                      | Permission                    |
| ------ | ----------------------------------------- | ----------------------------- |
| GET    | /returns                                  | returns.view                  |
| GET    | /returns/:returnId                        | returns.view                  |
| POST   | /returns                                  | returns.manage                |
| PATCH  | /returns/:returnId                        | returns.manage                |
| PUT    | /returns/:returnId/items                  | returns.manage                |
| POST   | /returns/:returnId/post                   | returns.manage                |
| POST   | /returns/:returnId/cancel                 | returns.manage                |
| GET    | /sales/orders/:orderId/returns            | returns.view                  |
| GET    | /sales/orders/:orderId/return-eligibility | returns.view                  |
| GET    | /refunds                                  | returns.view                  |
| GET    | /refunds/:refundId                        | returns.view                  |
| POST   | /refunds                                  | refunds.manage                |
| GET    | /analytics/returns/summary                | analytics.view + returns.view |

Lists use bounded pagination with stable createdAt/id cursor and org/source/customer/location/date filters; return status filter available. Amounts Decimal strings/null, timestamp ISO, business date YYYY-MM-DD. Invalid input 400; auth 401/403; absent/foreign 404; domain/idempotency/stale quote conflict 409. Dev Swagger response schemas document nullable money and source links; production docs disabled.

## Frontend

New org-scoped Returns/Customer refunds navigation and list/new/detail routes, loading/error/empty states. Draft forms select COMPLETED sale, original lines, quantity, disposition, destination, reason/note. Metadata/items revision, server quote, explicit confirmation for post/cancel/payout. Refund allocation table shows unused credit and original collected/refunded/available totals when permitted.

Sales detail displays net metrics, recorded returns and payout links; payment input uses net outstanding. Return detail links original sale, restock transaction, payout; inventory SALE_RETURN links source return and offers no generic reverse. Posted documents/payouts have readonly details.

Browser verification used actual Clerk OWNER session and separate **Stage 11 isolated UI verification** org. Test fixture opening 10 → sale 4 → return 2 RESTOCK produced stock **8**; SR-000001 POSTED credit 100 USD, CR-000001 payout 100 USD allocation, available payout 0. Original sale remains COMPLETED. Local test recordings do not transfer money. Light desktop/default viewport and dark mobile **390×844** visually checked; viewport/theme restored. Tables scroll within their container. Proof screenshots retained locally under ignored `.tools`.

UI review fixed incorrect DRAFT null-money label and shared `.organization-content` vertical auto margin causing short pages to start too low. Invalid quote now displays an actionable alert. Responsive shell and existing tokens retained.

## Tests

Final full test suite: **136 API tests + 26 Python tests**, failures 0, API skipped 0. API tests use real dedicated PostgreSQL/Redis, isolated schema, signed JWT/JWKS; schema cleaned after run. Existing Stage 1–10 suites remain enabled.

Stage 11 adds 17 return/refund scenarios plus purchasing SQL reversal regression: partial/full/multiple/discount rounding; zero/unpaid/service/legacy; historic archive/current tracking; source links/ledger; allocations/caps/dates; sequential and concurrent idempotency; competing API/direct DB writes; injected rollback; direct SQL mutation/append/snapshot/quantity/allocation rejection; tenant/RBAC/money masking; fresh Finance/Analytics/AI/date-boundary/net-payment behavior.

## Verification

| Проверка                 | Фактически выполненный результат                                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| pnpm lint                | PASS, ESLint/Ruff; 5/5 Turbo tasks, 2 cached                                                                                                       |
| pnpm typecheck           | PASS, TypeScript/Next typegen/mypy; 6/6 tasks, 3 cached                                                                                            |
| pnpm test                | PASS, 136 API + 26 Python, API skipped=0; 4/4 tasks, types build cached                                                                            |
| pnpm build               | PASS, Nest/Next/Python; 5/5 tasks, 2 cached, fresh Web build                                                                                       |
| pnpm format:check        | PASS, root Prettier и 12 Python files Ruff format                                                                                                  |
| Prisma validate          | PASS                                                                                                                                               |
| Migration development    | PASS, 12 migrations applied, migrate status up to date                                                                                             |
| Migration clean schema   | PASS, 12 migrations, repeat deploy PASS; temporary schema removed                                                                                  |
| Schema diff              | PASS, dev и clean schema, exit 0                                                                                                                   |
| SQL direct tests         | PASS, receipt reversal SQLSTATE 23514/rollback; source/snapshot/immutability/quantity/allocation/cash checks                                       |
| Returns tests            | PASS, partial/full/rounding/legacy/untracked/archive/quote scenarios                                                                               |
| Refunds tests            | PASS, required 1000/600/800 policy, multi-return caps, dates, immutable payouts                                                                    |
| Concurrency tests        | PASS, competing API posts/refunds, direct DB writers, same-key concurrent replay                                                                   |
| Rollback tests           | PASS, injected inventory writer failure and rejected SQL transactions leave no partial state                                                       |
| Finance tests            | PASS, exact credits/payouts/net cash/current receivables and net future payment cap                                                                |
| Analytics tests          | PASS, timezone boundary, event dates/trends/historic snapshots/gross semantics                                                                     |
| AI tests                 | PASS, Nest tool authorization/allowlist/masking and existing orchestrator mocks; 26 Python transport/policy tests                                  |
| RBAC                     | PASS, system-role init/backfill, MEMBER operational view, denied mutations, money null                                                             |
| Tenant isolation         | PASS, foreign parent/line/return/refund/location IDs and tool tenant arguments rejected                                                            |
| Regression               | PASS, all Stage 1–10 API/Python suites still registered and executed                                                                               |
| Docker                   | PASS, rebuilt API/Web/AI images from Stage 11 source                                                                                               |
| Health/readiness         | PASS, three fresh runtime containers HTTP 200; internal AI 401 without secret / 200 with secret                                                    |
| Swagger                  | PASS, dev docs-json includes 10 new return/refund/eligibility/analytics paths and nullable schemas; production API/AI docs 404                     |
| Browser                  | PASS, authenticated isolated org: create → post → restock 8 → payout 100 → available 0 → Finance cash 100; source links, desktop light/mobile dark |
| Git diff --check         | PASS; no commit/push                                                                                                                               |
| Secret/local-file review | PASS, 58 changed files, no env/local artifacts or common token/private-key signatures; no ignored helpers staged                                   |

Logs сохранены в TEMP как `bms-stage11-{lint,root-typecheck,root-test,root-build,format-check,db-check,docker-api-build,docker-web-build,docker-ai-build,docker-runtime}.log`. Это локальные доказательства запуска, не tracked artifacts. Deterministic tests не подтверждают live provider или production load acceptance.

## Security Review

Manual review covered all new controller permissions, query tenant filters, source FKs, mutation fresh authorization including replay, optional quote oracle, financial serialization, allocation bounds, immutable history, SQL parent locks, generic reversal allowlist and AI registry. Direct SQL and racing-writer tests provide evidence for critical DB constraints; Prisma empty diff alone is not used as proof of trigger correctness.

No new AI writes, public endpoints, external services, credentials or dependency updates. RLS, full accounting ledger and operational/load certification are outside current implementation. DB projection must still be written through the established inventory writer; direct administrative balance tampering is unsupported.

## Problems

1. PURCHASE_RECEIPT SQL reversal gap: fixed with new allowlist guard and rollback regression.
2. SQL CHECK UNKNOWN for null status hash: fixed by separate metadata migration with explicit presence checks.
3. Concurrent queries inside interactive transaction caused driver warning; new return aggregate queries execute sequentially under one snapshot/lock.
4. Draft null available payout incorrectly implied missing finance permission; corrected label. Invalid quote now tells user to update lines.
5. Shared vertical auto margin visually shifted short detail pages down; changed to `margin: 0 auto` and rechecked desktop/mobile.
6. Existing Windows Next standalone cache emits nonfatal long-link IO warning; root build exit 0 and Linux Docker build/runtime PASS. Local next-start runner also warns about NODE_ENV/standalone; production Docker uses standalone server.
7. First large integration run stalled once, then normal full runs completed; no persistent deadlock reproduced. Explicit API and direct SQL races now covered and passed.
8. Previous Stage 10 GitHub workflow-scope push blocker remains; publication not attempted during Stage 11.

## Manual Verification Required

Real configured LLM smoke remains open: provider auth/model/tool calling, natural-language response/source accuracy and adversarial prompting against actual model. Mock tests and configured=false status do not substitute for this. No credentials required to complete deterministic Stage 11 checks.

Physical devices/additional browser engines, production data scale/load, backup restore and hosted CI/release remain operational acceptance checks. External payment reconciliation/acquiring and compensation of erroneous POSTED returns require separate design; this stage records actual payouts manually. Local UI fixture remains available for review.

## Files Changed

- `apps/api/prisma/schema.prisma` and three new `apps/api/prisma/migrations/20261011*` directories.
- `apps/api/src/returns/`: controller, DTOs, response Swagger schemas, calculation, command/query services, module.
- `apps/api/src/inventory/{commands,transactions}.service.ts`, `sales/payments.service.ts`, `app.module.ts`, `authorization/permissions.ts`.
- `apps/api/src/finance/finance.service.ts`, `analytics/returns-analytics.service.ts`, analytics controller/module/schemas/finance trend.
- `apps/api/src/ai/ai-tools{,.service}.ts`, `apps/ai/app/services/prompt.py`.
- `apps/api/test/returns.scenarios.ts`, `purchasing.scenarios.ts`, `analytics.scenarios.ts`, integration registration.
- `packages/types/src/returns.ts`, index/analytics/expenses/inventory shared contracts.
- Web org routes `returns/`, `refunds/`, sales detail/forms, inventory history detail, finance page, shared analytics screen/navigation, `lib/returns.ts`, `lib/api.ts`, `app/globals.css`.
- This report, PROJECT_CONTEXT and historical Stage 11 plan. Diagnostic helpers/logs/screenshots in ignored `.tools`/TEMP are not deliverables for commit.

## Architecture Decisions

1. Separate return credit and payout events preserve immutable source history and correct cash timing.
2. Refund allocation on return credit enforces the requested independent P−F and per-return caps; net outstanding is derived separately.
3. Cumulative proportional rounding preserves discounted totals across partial/fractional returns.
4. Source stockDeducted/snapshots preserve physical history despite current catalog changes; restricted historical resource gates allow legitimate restock.
5. One shared Inventory writer/transaction preserves projection and rollback behavior; SALE_RETURN identifies new compensating source.
6. Order lock is the common serialization point for API and direct DB aggregate invariants; stable resource order avoids reversing existing locks.
7. SQL guards/deferred validators complement service validation; new migrations preserve applied checksums.
8. Response nullable money and fresh command/replay authorization keep manage and finance visibility separate.
9. Readonly AI consumes existing bounded aggregates; authorization policy remains in Nest, independently of prompt quality.
10. Original gross sales/AOV/paymentStatus and new net/event metrics are displayed with distinct semantics, preserving Stage 1–10 historical meaning.

## Next Stage

Ready for Stage 12.
