# Stage 7: Expenses and Financial Overview

Stage 7 records operating expenses and provides a cash-oriented view of existing Sales Payments. It is not an accounting ledger. Purchase Orders and Goods Receipts represent orders and physical receipt, not a supplier payment, so they do not enter the cash figures.

## Categories and expense lifecycle

`ExpenseCategory` belongs to one Organization. Display names are trimmed and repeated whitespace is collapsed. `normalizedName` additionally uses Unicode NFKC and lowercase; the database unique key on `(organizationId, normalizedName)` resolves concurrent duplicate creation. Categories are flat. Archiving sets `isActive=false`; historical Expenses retain their category relation. An archived category cannot be chosen for a new Expense or used to post a draft.

An Expense starts as `DRAFT`, may be edited, and does not enter Finance totals. Posting rechecks the active category and optional active Location, then moves it to `POSTED`. Financial fields become immutable. A posted Expense can be moved to `VOIDED` with a required reason, user and timestamp. Its amount and original details remain in history, but it leaves active expense totals. There is no deletion endpoint. A database constraint and trigger reinforce the transition and immutability rules.

Each Organization allocates `EXP-000001` style numbers through its own `ExpenseSequence` row. `expenseDate` is a PostgreSQL `DATE`, represented in HTTP as a validated `YYYY-MM-DD` string. `amount` is `numeric(19,4)` and must be positive; HTTP uses decimal strings. The Expense captures `Organization.defaultCurrency` at creation. `paymentMethod` is a classification (`CASH`, `CARD`, `BANK_TRANSFER`, `QR`, `OTHER`); no card or bank credentials are stored. `payeeName` is free text rather than a Supplier Payment relationship.

## Idempotency, locking and tenant integrity

Create, post and void require a UUID `Idempotency-Key`. The request is normalized and hashed. A matching replay returns the existing Expense; reuse of a key with different data returns `409 IDEMPOTENCY_KEY_CONFLICT`. Advisory locks follow command key → Expense → category → Location resource gate. Category archiving takes the exclusive category gate; posting takes a shared gate and rechecks active state. Location deactivation uses the existing Inventory resource gate. A unique database index backs each idempotency key and the organization sequence number.

All reads and commands scope by Organization. Composite foreign keys bind Expense to its category, optional Location, creator membership and voiding membership in the same Organization. API DTO whitelisting rejects status, currency, totals, sequence and other server-owned fields. Lists use bounded, deterministic cursor pagination.

## Financial formulas

For the selected `from`/`to` business dates and optional Location:

- `salesAmount` = sum of `SalesOrder.total` for `COMPLETED` orders whose `completedAt` falls in the period.
- `paymentsCollected` = sum of `SalesPayment.amount` whose `createdAt` falls in the period. A Location filter follows each payment's Sales Order.
- `expensesPaid` = sum of `Expense.amount` for `POSTED` expenses whose `expenseDate` falls in the period. `DRAFT` and `VOIDED` are excluded.
- `netCashFlow` = `paymentsCollected - expensesPaid`.
- `outstandingReceivablesCurrent` = sum of `max(SalesOrder.total - all its Sales Payments, 0)` over currently `COMPLETED` orders. It is **current**, independent of the selected dates. A Location filter applies to the Sales Orders.

The selected business dates are interpreted in `Organization.timezone` for Sales and Payment timestamps. PostgreSQL converts the inclusive dates to UTC timestamp boundaries, including daylight saving transitions. Expense `DATE` values are compared as calendar dates. An Organization-wide Expense (`locationId=null`) appears in the all-location view and is excluded from every specific Location view. The database performs numeric sums; the API emits four-decimal strings and `0.0000` for empty sums.

`Net Cash Flow` is **not Net Profit**. It excludes inventory valuation, COGS, taxes and unpaid supplier obligations. No currency conversion is performed: if a requested summary combines records with different currency snapshots, the API returns `FINANCE_MIXED_CURRENCY` instead of adding unlike amounts.

`expenses-by-category` groups only posted Expenses by category, sorts by amount descending and category name ascending, and returns exact decimal amounts and counts. Historical categories remain readable after archiving.

## Permissions and API

`OWNER` and `ADMIN` receive `expenses.view`, `expenses.manage` and `finance.view`. `MEMBER` receives none of these by default. The migration backfills existing system roles; new Organizations use the same central role registry. API guards enforce access independently of navigation visibility.

Under `/api/v1/organizations/:organizationId`:

- `GET/POST /expense-categories`, `GET/PATCH /expense-categories/:categoryId`
- `GET/POST /expenses`, `GET/PATCH /expenses/:expenseId`
- `POST /expenses/:expenseId/post`, `POST /expenses/:expenseId/void`
- `GET /finance/summary`, `GET /finance/expenses-by-category`

The Finance and Expenses pages show the formulas, state transitions and void history. Development Swagger documents the endpoints; production Swagger remains disabled.
