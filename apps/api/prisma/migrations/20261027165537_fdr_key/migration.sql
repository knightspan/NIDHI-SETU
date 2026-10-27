-- AlterTable
ALTER TABLE "Instrument" ADD COLUMN     "fdrKey" TEXT;

-- CreateIndex
CREATE INDEX "Instrument_fdrKey_idx" ON "Instrument"("fdrKey");
