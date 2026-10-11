# Stage 10 — AI Business Copilot

## Architecture

The authenticated Next.js application calls NestJS through server actions. NestJS owns Clerk verification, organization membership, RBAC, conversation storage, quotas and business tool execution. FastAPI performs inference only: it has no business database connection and never executes a tool. The model proposes a structured function call; NestJS validates it and calls an existing read service in the original organization context.

Sequence: browser → Next.js server → NestJS orchestrator → authenticated internal FastAPI → configured provider. Tool results return through the same path. A final answer is stored only after fresh authorization and organization enablement checks. No database transaction stays open during a provider request.

## LLM provider and FastAPI integration

`OpenAICompatibleProvider` implements non-streaming Chat Completions with strict function schemas. The standard endpoint is `https://api.openai.com/v1/chat/completions`; the default configurable model is `gpt-4.1-mini`. Actual model access depends on the operator's provider account. Other compatible endpoints are not certified by this implementation.

The adapter follows the official [function calling guide](https://developers.openai.com/api/docs/guides/function-calling) and [Chat Completions contract](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create). Requests set `store: false`, include a fixed server prompt, and use `max_completion_tokens`. There is no fallback to an unstructured or simulated answer. Unsupported responses become controlled errors. Provider retention is governed by its own terms; `store: false` is not a promise of zero retention.

Provider URL/model/key are trusted server configuration, never chat arguments. HTTPS is required for the provider URL; URL credentials, query strings and fragments are rejected. Redirects and environment HTTP proxies are disabled. API keys live only in the Python service configuration, never browser props or model messages. Reflected credentials are rejected. Internal endpoints require a constant-time shared-secret check, are absent from OpenAPI, and enforce a streamed request body limit before parsing.

Missing credentials leave health checks and existing modules working. Status reports `AI_PROVIDER_NOT_CONFIGURED`; inference does not fabricate a response. Usage comes from validated provider metadata. Missing usage is `null`; failed turns mark usage incomplete because a timed-out provider request may still have incurred a charge.

## Tool registry and contracts

Every tool requires `ai.use`, active membership and enabled AI in the caller's organization, in addition to the permissions below. Tools visible to the model are filtered by current permissions; execution repeats authorization even for a forged model call. Unknown names and argument keys are rejected.

Period arguments are `from`, `to` (inclusive organization-local `YYYY-MM-DD`) and optional `locationId`. Null dates default to the last 30 days. Maximum range is 366 days. Strict provider schemas require all declared keys, with nullable optional values; backend validation also accepts omitted optional keys. UUIDs must belong to the original organization. No tool accepts `organizationId` or arbitrary query text.

| Tool                           | Arguments                                   | Additional permissions                                              | Trusted source / result limit                                                            |
| ------------------------------ | ------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `get_business_overview`        | Period                                      | `analytics.view`, `sales.view`, `inventory.view`, `purchasing.view` | AnalyticsService operational KPI; FinanceService fields only with `finance.view`         |
| `get_sales_summary`            | Period, `comparePrevious`                   | `analytics.view`, `sales.view`, `finance.view`                      | SalesAnalyticsService completed amount/count/AOV and previous-period comparison          |
| `get_sales_trend`              | Period, `granularity`                       | Same sales permissions                                              | SalesAnalyticsService; DAY/WEEK/MONTH buckets, bounded period                            |
| `get_top_selling_variants`     | Period, `limit`                             | Same sales permissions                                              | SalesAnalyticsService snapshots; 1–20 rows, default 10                                   |
| `get_inventory_summary`        | `locationId`                                | `analytics.view`, `inventory.view`                                  | InventoryAnalyticsService counts and at most 20 stock warnings                           |
| `get_variant_stock`            | Required `variantId`, optional `locationId` | `inventory.view`                                                    | InventoryStockService; current total and at most 20 locations, truncation flag           |
| `get_purchasing_summary`       | Period                                      | `analytics.view`, `purchasing.view`, `finance.view`                 | PurchasingAnalyticsService cohort totals/progress and at most 20 receiving lines         |
| `get_finance_summary`          | Period                                      | `finance.view`                                                      | FinanceService authoritative receipts, expenses, supplier payments, receivables/payables |
| `get_cash_flow_trend`          | Period, `granularity`                       | `analytics.view`, `finance.view`                                    | FinanceAnalyticsService bounded calendar buckets                                         |
| `get_accounts_payable_summary` | None                                        | `accountsPayable.view`, `finance.view`                              | AccountsPayableQueryService current totals/counts, no supplier contacts/bank details     |

Each serialized result is capped at 24,000 characters. Source metadata is generated by NestJS: tool name, existing application route, refresh time and applicable period/location/currency. Model-generated URLs are not rendered as source links. Results reuse Decimal strings, snapshots and current-stock rules from Stages 5–9. Mixed currency remains an explicit error; missing supplier attribution under a location filter remains unavailable rather than zero. Current stock and current outstanding debt are not historical balances. Cash flow is not profit. Quantities retain their units; unlike units are not added together.

## Permission matrix and tenant isolation

OWNER receives `ai.use` and `ai.manage`; ADMIN receives `ai.use`; MEMBER receives neither. Custom roles use the existing permission registry. The migration backfills existing system roles with conflict-safe inserts; newly created organizations use the same defaults. Neither a permission grant nor migration enables AI.

`ai.manage` controls organization settings. `ai.use` alone exposes no financial data. All monetary tools additionally require `finance.view`; supplier debt details additionally require `accountsPayable.view`. The operational overview omits financial fields without finance permission.

Conversation queries are scoped by organization AND authenticated local user. Owners/admins cannot read other members' conversations through these endpoints. Foreign IDs return not found. Tools use only the organization supplied by trusted NestJS request context. A membership-only context endpoint lets custom roles open the application shell without requiring `organization.view`; business endpoints retain their individual guards.

## System prompt and prompt injection protection

The fixed versioned prompt supports Russian, English and Kazakh. It tells the model to obtain current metrics through tools, preserve currency/period/unit qualifications, distinguish unavailable data from zero, avoid unsupported causal claims, and treat questions, history and business record names as untrusted data.

Prompt instructions are defense in depth. Enforced controls are the fixed tool registry, strict validation, fresh permissions, tenant-scoped services and read-only capabilities. An injected record cannot register a tool, change an organization, run SQL/code/shell or modify a business record. Ordinary static application queries remain in trusted services. AI does not execute arbitrary SQL. AI cannot modify business data.

Model prose can still be wrong or manipulated; no semantic verifier guarantees every natural-language claim. The UI explicitly identifies backend records as the source of truth and links to verified source pages. Output is escaped plain text, without executable HTML or model-controlled links.

## Data minimization, privacy and provider disclosure

Only a bounded recent conversation, date/timezone/currency context, permitted tool definitions and necessary result fields are sent for inference. No full tables, Clerk tokens, raw database connection strings, provider secrets, customer contact fields or supplier banking details are included. Product/location names can appear when necessary. Tool results are transient; stored source references are compact. Request logs contain IDs, tool names, status, durations and available usage, not message bodies, arguments, tool payloads or provider error bodies.

AI is disabled by default. AI Settings explains external processing, potentially included business names, costs, model mistakes, local history and provider retention. Enabling requires `ai.manage` and disclosure version `v1`; the UI requires acknowledgement. Deleting local history does not erase provider-side processing records.

## Conversation storage, ownership and retry

Prisma models: `AiSettings`, `AiConversation`, `AiMessage`, with organization/user relations, composite conversation-organization foreign key, role/status enums, timestamps, JSON source/usage metadata and request IDs. Unique `(conversationId, clientMessageId, role)` and `(conversationId, sequence)` enforce idempotency and ordering. Indexes support bounded own-conversation and ordered-message pagination. Organization deletion cascades; deleting a conversation cascades its messages.

History pages default to 20 and allow at most 50 records. A conversation is capped at 200 messages; inference uses at most 20 preceding completed messages. Completed duplicate submissions return the stored result without another model call. Changing text for the same client ID is a conflict. A failed latest turn can be retried using the same ID. Retrying an older failed turn is rejected to preserve order.

An atomic conversation lease serializes turns, expires after the turn budget plus 15 seconds and uses request-ID fencing against stale completion. Busy conversations cannot be deleted. Expired interrupted turns can be retried. No exactly-once billing promise is possible after an ambiguous provider network failure, so the adapter does not retry automatically.

Stored user and assistant messages conservatively record all permissions present at turn creation. Removing any of those permissions redacts that turn and excludes it from future model context; replay is denied. Membership and required permissions are rechecked per tool and before returning the final answer. This intentionally may hide a non-financial old turn after an unrelated permission is removed.

## Rate limits, cost controls and timeouts

| Control                | Default                                    |
| ---------------------- | ------------------------------------------ |
| User requests          | 15 / UTC hour / organization               |
| Organization requests  | 200 / UTC day                              |
| User message           | 2,000 characters                           |
| Context payload        | 48,000 characters                          |
| Output token cap       | 1,500 per inference request                |
| Tool executions        | 6 per turn                                 |
| Tool rounds            | 4, followed by at most one final inference |
| Provider request       | 20 seconds                                 |
| Whole turn             | 60 seconds                                 |
| Provider response body | 64,000 bytes                               |

Redis atomically tests and increments both quota keys in one Lua script with expiration and shared organization hash slot. Failure to reach Redis fails closed. Completed duplicate replays do not consume quota; attempted inference failures do. Limits are configurable within validated server bounds. Character and call caps bound context and work; they are not an exact monetary spending cap. Provider-side budgets are recommended for hard account-level controls. A turn deadline aborts inference and prevents late results from being released; an already running database query is not forcibly cancelled.

## HTTP API and frontend

Under `/api/v1/organizations/:organizationId/ai`: GET/PATCH `settings`, GET `status`, GET/POST `conversations`, GET/DELETE `conversations/:id`, POST `conversations/:id/messages`. Swagger documents requests and success schemas; all routes use existing authentication and organization guards.

The application exposes AI Copilot and AI Settings according to permissions. Chat includes bounded history pagination, suggested business questions, composer count, processing status, copy, retry and deletion confirmation. Source cards use backend paths. Unconfigured/disabled/unavailable/quota/timeout/access errors have explicit UI states. Styling reuses existing light/dark tokens and collapses the two-column history/chat layout on narrow screens. No fake response appears when a provider is absent.

## Deployment

1. Apply all Prisma migrations, including `20261010020000_ai_copilot`.
2. Configure a random shared `AI_SERVICE_SECRET` of at least 32 characters in NestJS and FastAPI. Do not use a provider key as this secret.
3. Set `AI_PROVIDER_API_KEY` only for FastAPI, plus trusted `AI_PROVIDER_BASE_URL`, `AI_PROVIDER`, `AI_MODEL` and desired bounds. Keep all of them outside browser environment variables.
4. Set NestJS `AI_SERVICE_URL` to the internal FastAPI address. Local services default to loopback. The optional `docker-compose.ai.yml` overlay adds an AI container with no published port; a deployed API container should use `http://ai:8000` on that network.
5. Keep PostgreSQL and Redis available. Production FastAPI and NestJS documentation endpoints stay disabled.
6. An authorized organization owner reviews the disclosure and explicitly enables AI. Enabling alone does not configure provider credentials.

Local commands and environment examples are in the root README. Never expose the internal inference service to the public internet as an unauthenticated proxy. No real secrets belong in `.env.example`, tests, logs or Git.

## Testing and verification

FastAPI tests use an HTTP transport mock for protocol, authentication, bounded bodies, malformed responses, missing configuration, tool calls, provider failures and usage handling. NestJS integration tests use an authenticated local provider stub and real isolated PostgreSQL schemas/Redis; no external model receives fixture or user data. Tests exercise exact business totals, tenancy, custom roles, permission revocation, concurrency, replay, retries, prompt injection, tool validation, mixed currency, archived stock and quota behavior. Existing Stage 1–9 suites remain part of the regression gate.

Real provider verification required. No provider credentials were available during implementation. Mock protocol tests are not evidence of successful live inference. With credentials and explicit organization enablement, verify a simple answer, one tool, multiple tools, financial question, denied data, provider errors, source links and history/retry in the browser. Record the actual model/account used; do not claim other providers are compatible without testing them.

## Known limitations and architecture decisions

- Non-streaming answers keep bounded tool orchestration and error handling simple; the UI shows processing while waiting.
- Permission snapshots deliberately favor privacy over preserving every old message after role changes.
- Stock lookup requires a known UUID; there is no broad catalog search tool or guessed-ID fallback.
- Conversation history is user-owned and explicitly deletable; automated retention policies are outside this stage.
- External model answers are advisory; backend Decimal metrics and existing business workflows remain authoritative.
- Read-only tools cannot settle debts, post expenses, change inventory or change organization settings.
- Stage 11 is not implemented.

## Verification record — 2026-10-11

| Check                             | Observed result                                                                                                                         |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline lint/typecheck/test      | Passed before Stage 10 changes; 97 API tests and 1 Python test                                                                          |
| Final lint / TypeScript / mypy    | Passed                                                                                                                                  |
| Full regression tests             | 118 API tests and 26 Python tests passed; no failures or skips                                                                          |
| Production monorepo build         | Passed for NestJS, Next.js and Python distribution                                                                                      |
| Formatting and `git diff --check` | Passed                                                                                                                                  |
| Development Prisma schema         | Validation, migration deploy and empty schema diff passed                                                                               |
| Clean isolated PostgreSQL schema  | All 9 migrations applied, repeated deployment passed, diff empty; verification schema removed                                           |
| Docker builds                     | API, web and AI images built successfully                                                                                               |
| Docker runtime                    | All three containers healthy; API readiness, web health and AI health returned 200; temporary verification containers removed           |
| Swagger                           | Development: 5 AI paths / 8 operations with response schemas; production API docs/docs-json and FastAPI docs/openapi returned 404       |
| Internal service auth             | Unauthenticated status returned 401; authenticated status returned 200 with configured=false                                            |
| Secrets                           | Current configured secret values absent from changed Git files and browser static assets; provider key absent                           |
| Browser                           | Existing Clerk session, Copilot and Settings, empty history, suggestions, disabled send, status refresh and collapsible history checked |
| Responsive                        | 1440×1000, 768×1024 and 390×844 inspected; no page-wide horizontal overflow                                                             |
| Themes / console                  | Light and dark inspected; no application console errors or hydration errors observed; Clerk development-key warning remains             |
| Live external LLM                 | Not run: provider credentials absent. Real provider verification required                                                               |

Browser checks did not enable data sharing or create business fixtures in the signed-in organization. Answer rendering with live tools, source navigation after a real answer, live history/delete/retry and browser quota errors still require configured credentials and organization consent. Their backend workflows and controlled failures were exercised with integration fixtures. Physical devices, additional browser engines and production-scale load testing were not exercised.

On Windows, an existing temporary `uv.cmd` wrapper worked in package scripts but could not be spawned directly by Node's service launcher. Putting the installed native `uv.exe` directory on PATH resolved local startup; no shell execution fallback was introduced. Local development still uses Clerk development credentials. Docker builds exclude `.env` files and production runtime checks used only the required service configuration.
