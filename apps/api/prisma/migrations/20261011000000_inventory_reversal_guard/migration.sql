-- Generic reversal is limited to manual stock commands. Business documents
-- require their own compensating workflow, including any future source type.
CREATE FUNCTION validate_inventory_reversal_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original_kind text;
BEGIN
  IF NEW.type::text = 'REVERSAL' THEN
    EXECUTE format('SELECT type::text FROM %I."InventoryTransaction" WHERE id=$1 AND "organizationId"=$2', TG_TABLE_SCHEMA)
      INTO original_kind USING NEW."reversesTransactionId", NEW."organizationId";
    IF original_kind IS NULL OR original_kind NOT IN ('OPENING_BALANCE','ADJUSTMENT','TRANSFER') THEN
      RAISE EXCEPTION 'Inventory source cannot be reversed by a generic command' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER inventory_reversal_source_guard BEFORE INSERT ON "InventoryTransaction"
  FOR EACH ROW EXECUTE FUNCTION validate_inventory_reversal_source();
