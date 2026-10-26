-- AlterTable
ALTER TABLE "Discrepancy" ADD COLUMN     "key" TEXT;

-- CreateIndex
CREATE INDEX "Discrepancy_instrumentId_key_idx" ON "Discrepancy"("instrumentId", "key");
