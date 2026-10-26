-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "emailError" TEXT,
ADD COLUMN     "emailStatus" TEXT NOT NULL DEFAULT 'SKIPPED',
ADD COLUMN     "instrumentId" UUID;

-- CreateIndex
CREATE INDEX "Notification_emailStatus_idx" ON "Notification"("emailStatus");
