-- Tamper-evident audit log (Section 3.5): audit_events is append-only.
-- UPDATE and DELETE are refused row by row; TRUNCATE is refused per statement.
-- Only a superuser who explicitly disables these triggers can alter history, and the
-- sha256 hash chain then exposes the change ("Verify audit chain").

CREATE OR REPLACE FUNCTION audit_events_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER audit_events_no_update
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_immutable();

CREATE TRIGGER audit_events_no_truncate
  BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit_events_immutable();
