-- CreateEnum
CREATE TYPE "SignalEye" AS ENUM ('BANK', 'TAX', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "SignalResult" AS ENUM ('PASS', 'FAIL', 'STALE', 'NOT_AVAILABLE');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "TrustTier" AS ENUM ('BANK_CONFIRMED', 'OFFICER_VERIFIED', 'UNVERIFIED');

-- CreateEnum
CREATE TYPE "Compounding" AS ENUM ('MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "ForfeitureStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED', 'EXECUTED');

-- CreateEnum
CREATE TYPE "BankRequestPurpose" AS ENUM ('INITIAL', 'REATTESTATION');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LifecycleStatus" ADD VALUE 'FORFEITURE_PROPOSED';
ALTER TYPE "LifecycleStatus" ADD VALUE 'FORFEITURE_APPROVED';
ALTER TYPE "LifecycleStatus" ADD VALUE 'FORFEITED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RuleType" ADD VALUE 'VERIFICATION';
ALTER TYPE "RuleType" ADD VALUE 'TRUST';
ALTER TYPE "RuleType" ADD VALUE 'RISK';

-- AlterTable
ALTER TABLE "Bank" ADD COLUMN     "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "compounding" "Compounding";

-- AlterTable
ALTER TABLE "BankConfirmationRequest" ADD COLUMN     "purpose" "BankRequestPurpose" NOT NULL DEFAULT 'INITIAL',
ADD COLUMN     "reason" TEXT,
ALTER COLUMN "requestedById" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Instrument" ADD COLUMN     "interestRate" DECIMAL(5,2),
ADD COLUMN     "maturityValue" DECIMAL(14,2),
ADD COLUMN     "riskLevel" "RiskLevel" NOT NULL DEFAULT 'LOW',
ADD COLUMN     "riskScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "trustTier" "TrustTier" NOT NULL DEFAULT 'UNVERIFIED';

-- CreateTable
CREATE TABLE "VerificationSignal" (
    "id" UUID NOT NULL,
    "instrumentId" UUID NOT NULL,
    "eye" "SignalEye" NOT NULL,
    "result" "SignalResult" NOT NULL,
    "fy" TEXT,
    "details" JSONB NOT NULL,
    "evidenceDocumentId" UUID,
    "checkedAt" TIMESTAMPTZ(3) NOT NULL,
    "validUntil" TIMESTAMPTZ(3),

    CONSTRAINT "VerificationSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IfscBranch" (
    "ifsc" TEXT NOT NULL,
    "bankCode" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "city" TEXT,
    "state" TEXT,

    CONSTRAINT "IfscBranch_pkey" PRIMARY KEY ("ifsc")
);

-- CreateTable
CREATE TABLE "ForfeitureRequest" (
    "id" UUID NOT NULL,
    "instrumentId" UUID NOT NULL,
    "status" "ForfeitureStatus" NOT NULL DEFAULT 'PROPOSED',
    "reason" TEXT NOT NULL,
    "orderReference" TEXT NOT NULL,
    "proposedById" UUID NOT NULL,
    "proposedAt" TIMESTAMPTZ(3) NOT NULL,
    "decidedById" UUID,
    "decidedAt" TIMESTAMPTZ(3),
    "decisionNote" TEXT,
    "executedById" UUID,
    "executedAt" TIMESTAMPTZ(3),
    "executionRef" TEXT,
    "executionDate" DATE,

    CONSTRAINT "ForfeitureRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AisStatement" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "fy" TEXT NOT NULL,
    "documentId" UUID NOT NULL,
    "parser" TEXT NOT NULL,
    "pan" TEXT,
    "interestByBank" JSONB NOT NULL,
    "unmatched" JSONB NOT NULL,
    "uploadedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AisStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AisRequest" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "fy" TEXT NOT NULL,
    "requestedAt" TIMESTAMPTZ(3) NOT NULL,
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "fulfilledAt" TIMESTAMPTZ(3),

    CONSTRAINT "AisRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VerificationSignal_instrumentId_eye_checkedAt_idx" ON "VerificationSignal"("instrumentId", "eye", "checkedAt");

-- CreateIndex
CREATE INDEX "VerificationSignal_eye_result_idx" ON "VerificationSignal"("eye", "result");

-- CreateIndex
CREATE INDEX "IfscBranch_bankCode_idx" ON "IfscBranch"("bankCode");

-- CreateIndex
CREATE INDEX "ForfeitureRequest_instrumentId_idx" ON "ForfeitureRequest"("instrumentId");

-- CreateIndex
CREATE INDEX "ForfeitureRequest_status_idx" ON "ForfeitureRequest"("status");

-- CreateIndex
CREATE INDEX "AisStatement_institutionId_fy_idx" ON "AisStatement"("institutionId", "fy");

-- CreateIndex
CREATE UNIQUE INDEX "AisRequest_institutionId_fy_key" ON "AisRequest"("institutionId", "fy");

-- CreateIndex
CREATE INDEX "Instrument_riskScore_idx" ON "Instrument"("riskScore");

-- AddForeignKey
ALTER TABLE "VerificationSignal" ADD CONSTRAINT "VerificationSignal_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForfeitureRequest" ADD CONSTRAINT "ForfeitureRequest_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AisStatement" ADD CONSTRAINT "AisStatement_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AisRequest" ADD CONSTRAINT "AisRequest_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
