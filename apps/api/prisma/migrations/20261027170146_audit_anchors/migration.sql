-- CreateTable
CREATE TABLE "audit_anchors" (
    "id" SERIAL NOT NULL,
    "seq" BIGINT NOT NULL,
    "hash" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_anchors_pkey" PRIMARY KEY ("id")
);

-- Anchors are append-only, like the audit events they protect.
CREATE OR REPLACE FUNCTION audit_anchors_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_anchors is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER audit_anchors_no_update
  BEFORE UPDATE OR DELETE ON audit_anchors
  FOR EACH ROW EXECUTE FUNCTION audit_anchors_immutable();

CREATE TRIGGER audit_anchors_no_truncate
  BEFORE TRUNCATE ON audit_anchors
  FOR EACH STATEMENT EXECUTE FUNCTION audit_anchors_immutable();
