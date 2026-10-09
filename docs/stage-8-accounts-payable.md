# Stage 8: Accounts Payable

## Domain boundaries

A Purchase Order records intent to purchase. A Goods Receipt records physical receipt. A Supplier Bill records an obligation. A Supplier Payment records money paid. An Expense records a separate operating outflow. Goods Receipt and Bill posting do not create a cash payment. Net Cash Flow is not accounting profit.

## Supplier Bills

Bills belong to one organization and supplier. They may link to a Purchase Order belonging to the same organization and supplier. A Bill may differ from the PO total; Goods Receipts never create Bills automatically. Posting requires an active supplier and a PO that is neither DRAFT nor CANCELLED. Historical links remain after a PO changes status. The Bill currency is a creation-time snapshot of the organization's default currency, or of the linked PO currency. A draft cannot be switched to a PO with another currency.

The lifecycle is `DRAFT → POSTED → VOIDED`. Only DRAFT commercial fields can be edited. Posting makes the obligation and its commercial fields immutable. Voiding requires a reason and is allowed only while no Supplier Payment exists. The original amount and posting history remain after voiding. Bills use an organization-scoped transactional sequence, displayed as `BILL-000001`.

An optional supplier invoice number is whitespace-collapsed for display and normalized with Unicode NFKC and lowercase for duplicate detection. Only non-null, exact normalized references on active POSTED Bills are unique for an organization and supplier. DRAFT and VOIDED references do not reserve a number.

Money is PostgreSQL `numeric(19,4)` and API decimal strings; positive amounts are required. Issue and due dates are PostgreSQL `DATE`, exposed as `YYYY-MM-DD`, with due date on or after issue date. They are business dates, not UTC timestamps.

## Payments and balances

Only POSTED Bills accept Supplier Payments. Methods are `CASH`, `CARD`, `BANK_TRANSFER`, `QR`, and `OTHER`. Each payment has a PostgreSQL `DATE` payment date and a separate creation timestamp. Payments cannot be updated, deleted, or reversed in Stage 8. Neither card details nor bank credentials are stored.

`paidAmount = SUM(SupplierPayment.amount)` and `outstandingAmount = Bill.amount - paidAmount`. `UNPAID`, `PARTIALLY_PAID`, and `PAID` are derived payment states, separate from Bill lifecycle status. Overpayment is rejected both by the transaction and by a database trigger. The trigger locks the Bill row before checking its current payments. A paid Bill cannot be voided. No payment is entered as an Expense.

AP summary counts POSTED Bills only. `totalOutstanding` and `overdueOutstanding` are PostgreSQL numeric aggregates. A Bill is overdue when its due date is strictly before today's date in the organization's IANA timezone and its outstanding balance is positive. A Bill due today is not overdue. VOIDED and fully paid Bills are excluded from overdue totals.

## Idempotency and concurrency

Creation, posting, voiding, and payment commands require a UUID `Idempotency-Key`. The key and normalized request hash are stored with the result. Repeating the same request returns that result; reusing a key with different content returns `409 IDEMPOTENCY_KEY_CONFLICT`. Clients should retain the same key and payload after an uncertain network response.

Commands use transactional PostgreSQL advisory locks. The canonical order is command idempotency key, Bill, linked PO, then Supplier. Bill creation has no existing Bill to lock, so it locks the idempotency key, then PO and Supplier, followed by the organization sequence row. Payment takes a per-Bill lock before aggregating and inserting. The database payment trigger also locks the Bill row, including for direct SQL writes. The transactional sequence row prevents duplicate Bill numbers. Independent Bills do not share a payment lock.

## Permissions and tenant boundaries

`accountsPayable.view` protects Bills, payments, and summary reads. `accountsPayable.manage` protects Bill create, edit, post, and void. `accountsPayable.payments.manage` protects payment creation. OWNER and ADMIN receive all three permissions; MEMBER receives none. The migration backfills existing system roles and new organizations use the same role defaults.

Every API query scopes to the authenticated organization and requires membership and its permission. Composite foreign keys bind Bill to its organization and supplier, optional PO to that same organization and supplier, and Payment to its organization and Bill. Database constraints and history triggers protect dates, amounts, state transitions, immutable fields, and payment limits. The API accepts explicit DTO fields and rejects client-supplied status, currency, and ownership fields.

## Finance

Organization-wide `supplierPaymentsPaid` sums Supplier Payments by `paymentDate` within the requested date range. `outstandingPayablesCurrent` sums current outstanding balances of POSTED Bills regardless of the date range. `netCashFlow = customerPaymentsCollected - postedOperatingExpenses - supplierPaymentsPaid`. Posting a Bill changes outstanding payables, not cash flow. A Goods Receipt changes neither cash flow nor payables by itself.

Supplier Bills and Payments have no location. When Finance is filtered by `locationId`, `supplierPaymentsPaid` and `outstandingPayablesCurrent` are `null`, `supplierPaymentsLocationScoped` is `false`, and location net cash flow excludes supplier payments. The UI explains that these values are organization-wide. Mixed-currency financial aggregation without conversion returns a conflict instead of adding unlike currencies.

## API and UI

Under `/api/v1/organizations/:organizationId/accounts-payable`:

| Method | Path                      | Purpose                    |
| ------ | ------------------------- | -------------------------- |
| GET    | `/bills`                  | Paginated list and filters |
| GET    | `/bills/:billId`          | Detail and payment history |
| POST   | `/bills`                  | Create DRAFT               |
| PATCH  | `/bills/:billId`          | Edit DRAFT                 |
| POST   | `/bills/:billId/post`     | Post obligation            |
| POST   | `/bills/:billId/void`     | Void unpaid posted Bill    |
| GET    | `/bills/:billId/payments` | Paginated payment history  |
| POST   | `/bills/:billId/payments` | Add immutable payment      |
| GET    | `/summary`                | Current AP totals          |

The web app provides AP list/summary, create, and detail pages. The detail page supports draft editing, posting, voiding, and payments according to status and permission. PO and Supplier detail pages link to related Bills. Finance displays supplier cash outflow and outstanding payables alongside its existing metrics.
