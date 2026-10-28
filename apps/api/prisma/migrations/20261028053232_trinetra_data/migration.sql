-- TRINETRA rule defaults (placeholders; verify against AICTE APH 2024-27) and backfills.

INSERT INTO "Rule" ("id", "code", "type", "version", "config", "effectiveFrom", "source", "note")
SELECT gen_random_uuid(), v.code, v.type::"RuleType", 1, v.config::jsonb, '2020-01-01T00:00:00+05:30',
       'ASSUMPTION – verify against AICTE APH 2024-27', 'Seeded placeholder (TRINETRA addendum).'
FROM (VALUES
  ('verification.signals', 'VERIFICATION',
   '{"bankStaleMonths":12,"gateBankPassMaxAgeDays":30,"maturityTolerancePct":1,"defaultCompounding":"QUARTERLY","taxTolerancePct":10,"aisRequestMonthDay":"06-15"}'),
  ('trust.weights', 'TRUST',
   '{"weights":{"provenance":40,"bank":30,"tax":15,"document":15},"credit":{"PASS":1,"STALE":0.4,"NOT_AVAILABLE":0.5,"FAIL":0},"ageDecayMonths":12,"minAgeFactor":0.5}'),
  ('risk.weights', 'RISK',
   '{"lowTrust":4,"openHighDiscrepancy":3,"failedSignal":3,"nearMaturityDays":30,"nearMaturity":1,"matured":2,"mediumAt":3,"highAt":6}')
) AS v(code, type, config)
WHERE NOT EXISTS (SELECT 1 FROM "Rule" r WHERE r."code" = v.code);

-- Bank eye history from bank answers already on record (valid 12 months).
INSERT INTO "VerificationSignal" ("id", "instrumentId", "eye", "result", "details", "checkedAt", "validUntil")
SELECT gen_random_uuid(), b."instrumentId", 'BANK',
       CASE WHEN b."status" = 'CONFIRMED' THEN 'PASS'::"SignalResult" ELSE 'FAIL'::"SignalResult" END,
       jsonb_build_object('requestId', b."id", 'backfilled', true),
       b."respondedAt", b."respondedAt" + interval '12 months'
FROM "BankConfirmationRequest" b
WHERE b."status" IN ('CONFIRMED', 'DENIED') AND b."respondedAt" IS NOT NULL;

-- Common short names banks report under (AIS matching).
UPDATE "Bank" SET "aliases" = ARRAY['SBI', 'STATE BANK OF INDIA'] WHERE "code" = 'SBIN';
UPDATE "Bank" SET "aliases" = ARRAY['PNB'] WHERE "code" = 'PUNB';
UPDATE "Bank" SET "aliases" = ARRAY['BOB', 'BANK OF BARODA'] WHERE "code" = 'BARB';
UPDATE "Bank" SET "aliases" = ARRAY['AXIS BANK', 'AXIS BANK LIMITED'] WHERE "code" = 'UTIB';
