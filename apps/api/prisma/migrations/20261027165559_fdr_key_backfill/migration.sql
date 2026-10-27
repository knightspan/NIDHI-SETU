-- Backfill the duplicate-detection key for existing instruments (same folding as src/domain/fdr-key.ts).
UPDATE "Instrument"
SET "fdrKey" = upper("bankCode") || ':' ||
  translate(regexp_replace(upper("fdrNumber"), '[^A-Z0-9]', '', 'g'), 'OQDILSBZ', '00011582')
WHERE "bankCode" IS NOT NULL
  AND "fdrNumber" IS NOT NULL
  AND regexp_replace(upper("fdrNumber"), '[^A-Z0-9]', '', 'g') <> '';
