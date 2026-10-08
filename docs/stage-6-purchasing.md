# Stage 6: Suppliers, Purchasing and Goods Receiving

Stage 6 adds purchasing to the existing modular monolith. It does not create supplier payments, invoices, returns or inventory valuation.

## State and history

Suppliers are scoped to an organization. Archiving sets `isActive=false`; existing purchase orders keep the supplier relation and remain readable. An archived supplier cannot be selected for a new draft or moved from `DRAFT` to `ORDERED`. Archiving a supplier after an order was placed does not block receipt of that order.

Purchase orders move through `DRAFT → ORDERED → PARTIALLY_RECEIVED → RECEIVED`. A draft may also be cancelled, and an ordered purchase with no receipts may be cancelled. Commercial fields and lines are immutable after ordering. The order keeps its currency and item names, variant names, SKU, unit, and unit cost as snapshots. A draft line may contain only an active `PRODUCT` variant; both tracked and untracked products are accepted. The current catalog `costPrice` is only a suggestion for the purchase's editable `unitCost`.

Money uses `numeric(19,4)` and quantity uses `numeric(19,6)`. The API accepts and returns decimal strings. Each line total is rounded half up to four decimal places before the subtotal is summed. Receipt progress is summed with Prisma Decimal / PostgreSQL numeric aggregation. The client never supplies totals or progress.

Goods receipts are append-only. One PO may have multiple receipts; each receipt records positive quantities against specific PO lines. The API rejects any quantity above the remaining amount. Destination is always the order's location. An inactive destination, item or variant blocks a new receipt and can be reactivated. Historical snapshots and receipts remain readable after later catalog, location or supplier changes.

## Transactions and concurrency

Purchase creation, ordering and receipt use PostgreSQL interactive transactions. Advisory lock order is command idempotency key, purchase order, shared resource gates, then sorted stock keys. The order lock serializes receipts for one PO, so concurrent requests cannot exceed remaining quantities. Separate organization scoped sequence rows allocate PO and GR numbers atomically; unique indexes are a second defense.

The receipt and stock increase commit in one database transaction. Purchasing calls the existing `InventoryCommandsService` writer with the same Prisma transaction. It writes one `PURCHASE_RECEIPT` transaction for tracked lines, positive ledger entries and updated balances. Untracked lines remain in the receipt but have no inventory movement. A failure at any point rolls back receipt, items, transaction, ledger, balances and order status. The existing inventory reversal endpoint rejects purchase receipt movements; returns are outside this stage.

Creation, ordering and receipt require UUID `Idempotency-Key` headers. A normalized request hash distinguishes retries from key reuse with different payloads. Concurrent retries take the same advisory key lock, return the existing resource and create no second sequence number or stock effect.

## Access and integrity

`OWNER` and `ADMIN` receive `suppliers.view`, `suppliers.manage`, `purchasing.view`, `purchasing.create`, `purchasing.manage`, and `purchasing.receive`. `MEMBER` receives only both view permissions. `purchasing.manage` does not bypass `purchasing.receive`. The migration backfills existing system roles; new organizations receive the same permissions through central role definitions.

Every query and command scopes by organization. Composite foreign keys prevent cross-tenant supplier, location, variant, order, receipt and inventory source assignments. Receipt item triggers also ensure the PO line belongs to the receipt's order and has the same variant and unit. Database checks and triggers enforce positive quantities, line totals, immutable receipt history, purchase transitions and inventory source linkage. HTTP DTO whitelisting rejects backend-owned fields. Lists have a maximum page size of 100 and deterministic cursors.

## API

Under `/api/v1/organizations/:organizationId`:

- `GET/POST /suppliers`, `GET/PATCH /suppliers/:supplierId`
- `GET/POST /purchasing/orders`, `GET/PATCH /purchasing/orders/:purchaseOrderId`
- `PUT /purchasing/orders/:purchaseOrderId/items`
- `POST /purchasing/orders/:purchaseOrderId/order`, `POST /purchasing/orders/:purchaseOrderId/cancel`
- `GET/POST /purchasing/orders/:purchaseOrderId/receipts`, `GET /purchasing/receipts/:receiptId`

Development Swagger discovers the controllers. The production Swagger setting is unchanged.
