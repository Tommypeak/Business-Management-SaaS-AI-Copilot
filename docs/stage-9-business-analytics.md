# Stage 9 — Executive Dashboard & Business Analytics

## Dashboard Architecture

The authenticated organization shell contains a permission-aware sidebar, organization switcher and persistent theme control. `/app/[organizationId]` redirects analytics users to `/dashboard`; users without analytics permission retain the existing organization overview. Server-rendered Dashboard, Sales, Inventory, Purchasing and the existing Finance page share `AnalyticsScreen`, KPI cards, filters, accessible charts and error/empty states. Every widget reads real authenticated API data. No sample business metrics are bundled into production.

## Analytics API

All routes are read-only GET requests under `/api/v1/organizations/:organizationId/analytics`. Membership and `analytics.view` are required for every endpoint. Monetary endpoints additionally require `finance.view`.

| Path                    | Purpose                                                           | Additional permission   |
| ----------------------- | ----------------------------------------------------------------- | ----------------------- |
| `/overview`             | Completed order count and current stock signals                   | —                       |
| `/sales/summary`        | Sales, order count, AOV, comparison, location and historical type | `finance.view`          |
| `/sales/trend`          | Calendar series including empty buckets                           | `finance.view`          |
| `/sales/top-variants`   | Bounded snapshot-based ranking                                    | `finance.view`          |
| `/inventory/summary`    | Current stock health and top moving variants                      | —                       |
| `/inventory/movements`  | Ledger flows grouped by calendar bucket, unit and operation       | —                       |
| `/inventory/locations`  | Current stock counts and period movement counts per location      | —                       |
| `/purchasing/summary`   | Ordered value, lifecycle counts, suppliers and receipt trend      | `finance.view`          |
| `/purchasing/receiving` | Current progress of a bounded set of order lines                  | —                       |
| `/finance/summary`      | Shared Stage 8 summary, comparison and expense categories         | `finance.view`          |
| `/finance/cash-flow`    | Customer payments, expenses, supplier payments and net            | `finance.view`          |
| `/activity`             | Permission-filtered recording chronology                          | Source view permissions |

Queries: optional `from` and `to` together, `locationId`, `granularity=DAY|WEEK|MONTH`, `limit` from 1 to 50 (default 10), top-list `itemType=PRODUCT|SERVICE|UNKNOWN`, activity `kind=SALE|RECEIPT|INVENTORY|EXPENSE|SUPPLIER_PAYMENT`. Unknown keys, invalid business dates, unsupported enum values and foreign locations are rejected. The UI uses six rows for ranked lists; API consumers can request up to 50. Swagger documents query parameters, response structures and permissions.

## Metric Definitions / Sales Calculations

- Completed Sales = `SUM(SalesOrder.total)` for COMPLETED orders, filtered by `completedAt`.
- Completed Orders = the number of those orders. Drafts and cancelled orders are excluded.
- Average Order Value = completed sales / completed orders, or `null` when no orders exist.
- Top variants are ranked by sales amount, separately for variant, snapshot unit and snapshot item type. Quantities use snapshot units; labels use the latest sale snapshot in the selected period, with an ID tie-breaker.
- Sales by location uses historical order location; product/service breakdown uses line type snapshots.

Sales names, variant names, SKU, units and prices are read from order line snapshots. The migration adds nullable `snapshotItemType`; new sales capture it when the draft line is created, following the existing snapshot lifecycle. Existing lines remain UNKNOWN rather than being inferred from today's catalog. Existing database immutability triggers protect the new column on completed sales. Archived catalog records remain in historical sales totals.

## Inventory Calculations

Current stock comes from `InventoryBalance`, regardless of the date range. Candidate variants are active tracked PRODUCT variants, plus any variant with a nonzero balance, including archived resources. Missing balances count as zero. Organization-level negative-stock count is based on the sum across locations; a separate negative-location-balances count prevents a positive location from hiding a negative one. Archived stock with offsetting positive/negative locations remains included.

Movements come from immutable `InventoryLedgerEntry` rows, grouped by `createdAt` in the organization timezone, variant unit and transaction type. Inbound sums positive deltas; outbound is the positive magnitude of negative deltas; net sums signed deltas. Transfers produce both legs and conserve organization stock; a location filter selects its own leg. Reversals are retained as their own entries. Top moving variants rank by ledger entry count, not incomparable quantities. Current catalog names identify movement rows; unit changes are already blocked once a ledger entry exists.

No low-stock threshold is invented: zero and negative stock are the available signals. Quantities in different units must never be added as equivalent values. Inventory valuation, COGS and stock-as-of-date reconstruction are outside Stage 9.

## Purchasing Calculations

Ordered value and order lifecycle counts use the cohort of ORDERED, PARTIALLY_RECEIVED and RECEIVED orders whose `orderedAt` falls within the period. Draft and cancelled orders are excluded. Open means ORDERED or PARTIALLY_RECEIVED. Supplier ranking sums ordered value and counts orders.

Receiving progress is the proportion of order lines fully received, not a sum of unlike quantities. Each line shows exact ordered, received and remaining quantity in its snapshot unit. Receipts over the full history determine the cohort's current receiving progress. Goods-receipt charts separately count receipt events by `receivedAt` within the selected period; they need not belong to POs ordered within that same period. Goods receipt is not payment.

## Finance Calculations

The analytics summary calls the existing `FinanceService`; decimal arithmetic, period predicates and cash-flow subtraction are shared helpers. Stage 7/8 endpoint behavior is retained. Source-currency metadata distinguishes an empty period from actual zero-valued currency records when comparing periods.

- Customer Payments = `SUM(SalesPayment.amount)` by payment recording timestamp.
- Operating Expenses = `SUM(Expense.amount)` for POSTED expenses by `expenseDate`.
- Supplier Payments = `SUM(SupplierPayment.amount)` by `paymentDate`.
- Net Cash Flow = Customer Payments − Operating Expenses − Supplier Payments.
- Current Outstanding Receivables = current unpaid balances on completed sales.
- Current Outstanding Payables = current unpaid balances on posted supplier bills.

**Net Cash Flow != Net Profit.** No COGS, inventory valuation, depreciation, full bank reconciliation or accounting profit is claimed. Supplier Bills create obligations, and Goods Receipts record receipt of goods; neither creates a cash outflow. Current receivables and payables deliberately ignore the selected period. Expense categories use a bounded top-50 list.

## Currency Handling

Money is aggregated by PostgreSQL numeric operations and serialized as decimal strings with four places; quantities have six places. Decimal arithmetic is used for ratios and comparisons. The browser uses string/BigInt formatting; floating point is used only to draw chart coordinates, never to calculate financial metrics.

Currencies must not be added without conversion. All contributing currencies are checked before aggregation is presented, including previous periods and current financial balances where applicable. Mixed currencies return `409 FINANCE_MIXED_CURRENCY`; there is no implicit exchange rate. An empty result uses the organization currency as display metadata. A zero-valued record still retains its source currency.

## Timezone Rules / Comparison Period

The organization IANA timezone is authoritative. Default range is today and the preceding 29 local calendar days. Ranges must contain 1–366 inclusive days, between 1900 and 9998. Both bounds are required when either is supplied. Timestamp filters use local start-of-day inclusive and the local start of the following day exclusive, converted by PostgreSQL. This supports 23- and 25-hour DST days. PostgreSQL DATE business fields use inclusive date predicates and are never shifted as timestamps.

DAY uses local midnight; WEEK uses ISO Monday; MONTH uses calendar month start. Partial first/last buckets retain the selected range predicates. Sales, receipt and cash series include empty calendar buckets. Inventory returns only recorded unit/operation buckets; it does not fabricate zero rows for every combination.

Previous period has the same number of inclusive calendar days, immediately preceding `from`. Absolute change is current minus previous; percentage is that difference / absolute previous × 100. Previous zero produces a `null` percentage, rendered as no prior baseline. No Infinity or fabricated growth percentage is returned. The comparison selector controls display; currency checks remain enforced.

## Location Rules

Sales use order location; inventory uses ledger/balance location; purchasing uses destination location; expenses use their own location. All supplied locations must belong to the authenticated organization. Archived locations remain valid historical filters.

Supplier Bills and Supplier Payments have no location. Under a location filter their payment/payable totals are `null`, `supplierPaymentsLocationScoped=false`, and location cash flow excludes supplier payments. The interface explicitly explains this. Supplier payment activity is also excluded from a location-filtered feed.

## Permissions / Tenant Isolation

OWNER and ADMIN receive `analytics.view` through both role initialization and migration backfill. MEMBER does not. An analytics-only custom role can see operational analytics but monetary endpoints return 403. Aggregate supplier cash/payables follow the existing `finance.view` policy; individual supplier payments require both `finance.view` and `accountsPayable.view` in the activity feed. Expense activity requires both `finance.view` and `expenses.view`; sale, receipt and inventory activities require their source view permissions. Links and quick actions follow permissions.

The existing authentication, organization membership and permission guards protect all routes. SQL binds every source to the authenticated organization, including aggregate subqueries and joins. All external query values are bound Prisma SQL parameters. The schema identifier comes from the validated internal Prisma configuration. No analytics route changes domain data or weakens idempotency, locks or history protection.

## Performance Considerations

Aggregations execute in PostgreSQL; the frontend receives bounded series and ranked results. There are no per-row database calls or full transaction-history loads into JavaScript. Existing tenant indexes are supplemented by organization/completion, organization/location/completion, payment recording date, ledger date and purchase-order ordered-date indexes. Core aggregate methods use repeatable-read transactions. Separate widgets are independent read snapshots, not one globally atomic dashboard snapshot.

Top lists and activity are limited to 50; location breakdowns to 50; calendar series to at most 366 daily buckets. Inventory unit/operation series has a 5,000-row cap and asks for a coarser interval rather than silently truncating. Activity limits each source before merging and applies its kind filter before limiting. Receiving progress reads aggregate receipt history; current outstanding balances necessarily inspect historical obligations. These are live aggregate queries, not a materialized reporting warehouse; production-scale load benchmarking remains a deployment consideration.

## UI Design / Responsive Layout / Light and Dark Theme

The supplied executive-dashboard reference was inspected. Its pale surfaces, compact navigation, teal accent, strong KPI hierarchy and prominent main chart are adapted without copying brand assets. Shared semantic color tokens define light and dark themes. A cookie persists the theme and server rendering applies it before hydration.

Desktop uses a 226px sidebar, four KPI columns and a two-column card grid; wide charts span both columns. Tablet reduces density and KPI columns. Mobile collapses navigation, stacks cards/filters, and confines wide tables to their own horizontal scroll areas. SVG charts resize without fixed viewport widths. Legends, exact-value tooltips, keyboard point selectors, accessible data tables, focus rings and reduced-motion styles support access beyond pointer interaction.

The dashboard shows completed sales, customer receipts, expenses and net cash flow; sales and cash charts; stock/order highlights; top products/services; purchasing; current commitments; recent activity and permitted quick actions. Drill-down pages keep filters in the URL. Loading skeletons, empty data, restricted widgets and per-widget API errors are distinct states. The existing Finance page uses the shared analytics view for analytics users and retains its original view for finance-only users.

## Known Limitations

- No currency conversion, accounting profit, inventory valuation or historical stock reconstruction.
- Pre-migration sales without item-type snapshots remain UNKNOWN.
- Movement and supplier/location labels use current names where no historical name snapshot exists.
- Receiving progress is current state for the selected order cohort, not an as-of-period-end reconstruction.
- Results are intentionally bounded; top lists are not exports of every record.
- A real signed-in Clerk session is required for protected browser verification; integration JWT fixtures are confined to isolated API tests.
- Stage 10 AI functionality is not included.

## Verification

Verified on 2026-10-10. Integration tests use a unique temporary PostgreSQL schema, apply the historical migration chain, verify legacy role backfills, and drop only that generated schema on completion. No production or development business fixtures are modified by the test suite.

| Check                                                            | Result                                                                                                                                              |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm format:check` | Passed                                                                                                                                              |
| `pnpm test`                                                      | 97 API tests (9 analytics, 88 existing regression tests), plus 1 AI test; no API skips                                                              |
| Prisma validate and migration deploy                             | Passed; eight migrations applied                                                                                                                    |
| Fresh temporary schema                                           | All eight migrations applied; schema diff empty; temporary schema removed                                                                           |
| Development schema diff                                          | Empty                                                                                                                                               |
| Docker builds                                                    | API, Web and AI images built                                                                                                                        |
| Docker runtime                                                   | All three containers healthy; API health/readiness, Web health and AI health returned 200                                                           |
| Swagger                                                          | 12 analytics paths in development; documentation disabled in production (404)                                                                       |
| Browser                                                          | Real Clerk session; Dashboard, Sales, Inventory, Purchasing and Finance inspected                                                                   |
| Responsive                                                       | 1440×1000 desktop, 768×1024 tablet, 390×844 mobile; no page-wide overflow at tablet/mobile sizes                                                    |
| Theme and interaction                                            | Light/dark, theme reload persistence, organization switching, date/location/week filters, mobile navigation and keyboard chart/table access checked |

Browser checks used existing organization data (one completed sale and inventory movements) and honest empty purchasing/expense states. Rich purchasing, supplier-payment and multi-currency scenarios are covered by API integration fixtures rather than added to the signed-in organization's business data. The final production-browser check reported no console errors.

The Windows build completed successfully but Turbo reported a long-link-name cache warning for a standalone dependency. Linux Docker builds passed. An earlier regression run timed out while Docker builds were also running; the complete subsequent test run passed. Production-scale load tests, physical devices and additional browser engines were not exercised.
