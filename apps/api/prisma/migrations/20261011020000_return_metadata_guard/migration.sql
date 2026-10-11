-- Explicit non-null checks avoid PostgreSQL CHECK's acceptance of UNKNOWN.
ALTER TABLE "SalesReturn" ADD CONSTRAINT return_state_hash_required CHECK (
  (status::text <> 'POSTED' OR "postingRequestHash" IS NOT NULL)
  AND (status::text <> 'CANCELLED' OR "cancellationRequestHash" IS NOT NULL)
);
