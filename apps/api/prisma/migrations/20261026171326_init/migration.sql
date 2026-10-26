-- CreateEnum
CREATE TYPE "Role" AS ENUM ('INSTITUTION_USER', 'RO_OFFICER', 'BUREAU_OFFICER', 'COMPETENT_AUTHORITY', 'FINANCE_OFFICER', 'BANK_OFFICER', 'AUDITOR', 'SYS_ADMIN');

-- CreateEnum
CREATE TYPE "InstrumentType" AS ENUM ('FDR', 'ONLINE_DEPOSIT', 'OTHER');

-- CreateEnum
CREATE TYPE "LifecycleStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_SCRUTINY', 'DISCREPANCY_RAISED', 'OFFICER_VERIFIED', 'BANK_CONFIRMATION_PENDING', 'BANK_CONFIRMED', 'ACTIVE', 'RENEWAL_PENDING', 'RENEWED', 'RELEASE_REQUESTED', 'RELEASE_RECOMMENDED', 'RELEASE_APPROVED', 'RELEASED', 'RELEASE_REJECTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ValidityStatus" AS ENUM ('VALID', 'EXPIRING_SOON', 'MATURED', 'OVERDUE_RENEWAL');

-- CreateEnum
CREATE TYPE "TrustLevel" AS ENUM ('DECLARED', 'OCR_EXTRACTED', 'OFFICER_VERIFIED', 'BANK_CONFIRMED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('FDR_SCAN', 'BANK_LETTER', 'AFFIDAVIT', 'NOC', 'OTHER');

-- CreateEnum
CREATE TYPE "DiscrepancyStatus" AS ENUM ('OPEN', 'RESPONDED', 'RESOLVED', 'WAIVED');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "BankRequestStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DENIED', 'FAILED');

-- CreateEnum
CREATE TYPE "BankChannel" AS ENUM ('DESK', 'MOCK_API');

-- CreateEnum
CREATE TYPE "ReleaseStatus" AS ENUM ('REQUESTED', 'RECOMMENDED', 'APPROVED', 'REJECTED', 'EXECUTED');

-- CreateEnum
CREATE TYPE "RuleType" AS ENUM ('ELIGIBILITY', 'REQUIRED_AMOUNT', 'VALIDITY', 'REMINDER_OFFSETS', 'ESCALATION_SLA', 'RELEASE_PRECONDITIONS', 'DISCREPANCY');

-- CreateEnum
CREATE TYPE "LegacyItemStatus" AS ENUM ('PENDING_REVIEW', 'CONFIRMED', 'REJECTED');

-- CreateTable
CREATE TABLE "Region" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Region_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bank" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "apiEnabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Bank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Institution" (
    "id" UUID NOT NULL,
    "aicteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trustName" TEXT NOT NULL,
    "regionId" UUID NOT NULL,
    "state" TEXT NOT NULL,
    "district" TEXT,
    "yearEstablished" INTEGER NOT NULL,
    "programmes" TEXT[],
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Institution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "regionId" UUID,
    "institutionId" UUID,
    "bankId" UUID,
    "phone" TEXT,
    "mfaSecretEnc" TEXT,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(3),
    "lastLoginAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Instrument" (
    "id" UUID NOT NULL,
    "refNo" TEXT NOT NULL,
    "type" "InstrumentType" NOT NULL DEFAULT 'FDR',
    "institutionId" UUID NOT NULL,
    "bankId" UUID,
    "bankCode" TEXT,
    "branch" TEXT,
    "ifsc" TEXT,
    "fdrNumber" TEXT,
    "amount" DECIMAL(14,2),
    "issueDate" DATE,
    "maturityDate" DATE,
    "depositorNames" TEXT,
    "jointName" BOOLEAN NOT NULL DEFAULT false,
    "lienMarked" BOOLEAN NOT NULL DEFAULT false,
    "autoRenewal" BOOLEAN NOT NULL DEFAULT false,
    "status" "LifecycleStatus" NOT NULL DEFAULT 'DRAFT',
    "validityStatus" "ValidityStatus",
    "trustScore" INTEGER NOT NULL DEFAULT 0,
    "mismatchCount" INTEGER NOT NULL DEFAULT 0,
    "legacy" BOOLEAN NOT NULL DEFAULT false,
    "replacesInstrumentId" UUID,
    "createdById" UUID,
    "submittedAt" TIMESTAMPTZ(3),
    "scrutinyStartedAt" TIMESTAMPTZ(3),
    "verifiedAt" TIMESTAMPTZ(3),
    "activatedAt" TIMESTAMPTZ(3),
    "closedAt" TIMESTAMPTZ(3),
    "statusChangedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Instrument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusTransition" (
    "id" UUID NOT NULL,
    "instrumentId" UUID NOT NULL,
    "from" "LifecycleStatus",
    "to" "LifecycleStatus" NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" UUID,
    "actorRole" TEXT NOT NULL,
    "note" TEXT,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatusTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldAssertion" (
    "id" UUID NOT NULL,
    "instrumentId" UUID NOT NULL,
    "field" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "trust" "TrustLevel" NOT NULL,
    "actorId" UUID,
    "source" TEXT,
    "confidence" DOUBLE PRECISION,
    "evidenceDocumentId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FieldAssertion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" UUID NOT NULL,
    "instrumentId" UUID,
    "institutionId" UUID,
    "type" "DocumentType" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "originalName" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersedesId" UUID,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "uploadedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Discrepancy" (
    "id" UUID NOT NULL,
    "instrumentId" UUID NOT NULL,
    "ruleCode" TEXT NOT NULL,
    "field" TEXT,
    "severity" "Severity" NOT NULL,
    "description" TEXT NOT NULL,
    "status" "DiscrepancyStatus" NOT NULL DEFAULT 'OPEN',
    "autoRaised" BOOLEAN NOT NULL DEFAULT false,
    "raisedById" UUID,
    "dueAt" TIMESTAMPTZ(3),
    "respondedAt" TIMESTAMPTZ(3),
    "resolvedAt" TIMESTAMPTZ(3),
    "resolvedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Discrepancy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscrepancyComment" (
    "id" UUID NOT NULL,
    "discrepancyId" UUID NOT NULL,
    "authorId" UUID,
    "authorRole" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscrepancyComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankConfirmationRequest" (
    "id" UUID NOT NULL,
    "instrumentId" UUID NOT NULL,
    "bankId" UUID NOT NULL,
    "channel" "BankChannel" NOT NULL DEFAULT 'DESK',
    "requestedFields" TEXT[],
    "snapshot" JSONB NOT NULL,
    "status" "BankRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" UUID NOT NULL,
    "slaDueAt" TIMESTAMPTZ(3) NOT NULL,
    "respondedById" UUID,
    "respondedAt" TIMESTAMPTZ(3),
    "response" JSONB,
    "letterDocumentId" UUID,
    "failureReason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankConfirmationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseRequest" (
    "id" UUID NOT NULL,
    "instrumentId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ReleaseStatus" NOT NULL DEFAULT 'REQUESTED',
    "checklist" JSONB NOT NULL,
    "checklistPassed" BOOLEAN NOT NULL,
    "requestedById" UUID NOT NULL,
    "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recommendedById" UUID,
    "recommendedAt" TIMESTAMPTZ(3),
    "recommendationNote" TEXT,
    "decidedById" UUID,
    "decidedAt" TIMESTAMPTZ(3),
    "decisionNote" TEXT,
    "executionRef" TEXT,
    "executionDate" DATE,
    "executedById" UUID,
    "executedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ReleaseRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "channels" TEXT[],
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reminder" (
    "id" UUID NOT NULL,
    "instrumentId" UUID NOT NULL,
    "offsetDays" INTEGER NOT NULL,
    "dueDate" DATE NOT NULL,
    "sentAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Escalation" (
    "id" UUID NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "instrumentId" UUID,
    "level" INTEGER NOT NULL,
    "toRole" "Role" NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Escalation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rule" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "type" "RuleType" NOT NULL,
    "version" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "effectiveFrom" TIMESTAMPTZ(3) NOT NULL,
    "source" TEXT NOT NULL,
    "note" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" UUID,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "MetricBaseline" (
    "metricKey" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "updatedById" UUID,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MetricBaseline_pkey" PRIMARY KEY ("metricKey")
);

-- CreateTable
CREATE TABLE "SavedFilter" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "query" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedFilter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegacyBatch" (
    "id" UUID NOT NULL,
    "regionId" UUID NOT NULL,
    "uploadedById" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "fileCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegacyBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegacyItem" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "ocr" JSONB NOT NULL,
    "ocrError" TEXT,
    "status" "LegacyItemStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "instrumentId" UUID,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegacyItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "seq" BIGINT NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "actorId" UUID,
    "actorRole" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "ip" TEXT,
    "data" JSONB NOT NULL,
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("seq")
);

-- CreateIndex
CREATE UNIQUE INDEX "Region_code_key" ON "Region"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Bank_code_key" ON "Bank"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Institution_aicteId_key" ON "Institution"("aicteId");

-- CreateIndex
CREATE INDEX "Institution_regionId_idx" ON "Institution"("regionId");

-- CreateIndex
CREATE INDEX "Institution_name_idx" ON "Institution"("name");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Instrument_refNo_key" ON "Instrument"("refNo");

-- CreateIndex
CREATE UNIQUE INDEX "Instrument_replacesInstrumentId_key" ON "Instrument"("replacesInstrumentId");

-- CreateIndex
CREATE INDEX "Instrument_institutionId_idx" ON "Instrument"("institutionId");

-- CreateIndex
CREATE INDEX "Instrument_status_idx" ON "Instrument"("status");

-- CreateIndex
CREATE INDEX "Instrument_validityStatus_idx" ON "Instrument"("validityStatus");

-- CreateIndex
CREATE INDEX "Instrument_maturityDate_idx" ON "Instrument"("maturityDate");

-- CreateIndex
CREATE INDEX "Instrument_bankCode_fdrNumber_idx" ON "Instrument"("bankCode", "fdrNumber");

-- CreateIndex
CREATE INDEX "StatusTransition_instrumentId_at_idx" ON "StatusTransition"("instrumentId", "at");

-- CreateIndex
CREATE INDEX "FieldAssertion_instrumentId_field_idx" ON "FieldAssertion"("instrumentId", "field");

-- CreateIndex
CREATE UNIQUE INDEX "Document_storageKey_key" ON "Document"("storageKey");

-- CreateIndex
CREATE INDEX "Document_instrumentId_idx" ON "Document"("instrumentId");

-- CreateIndex
CREATE INDEX "Document_sha256_idx" ON "Document"("sha256");

-- CreateIndex
CREATE INDEX "Discrepancy_instrumentId_status_idx" ON "Discrepancy"("instrumentId", "status");

-- CreateIndex
CREATE INDEX "Discrepancy_status_severity_idx" ON "Discrepancy"("status", "severity");

-- CreateIndex
CREATE INDEX "DiscrepancyComment_discrepancyId_idx" ON "DiscrepancyComment"("discrepancyId");

-- CreateIndex
CREATE INDEX "BankConfirmationRequest_bankId_status_idx" ON "BankConfirmationRequest"("bankId", "status");

-- CreateIndex
CREATE INDEX "BankConfirmationRequest_instrumentId_idx" ON "BankConfirmationRequest"("instrumentId");

-- CreateIndex
CREATE INDEX "ReleaseRequest_instrumentId_idx" ON "ReleaseRequest"("instrumentId");

-- CreateIndex
CREATE INDEX "ReleaseRequest_status_idx" ON "ReleaseRequest"("status");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "Reminder_instrumentId_offsetDays_key" ON "Reminder"("instrumentId", "offsetDays");

-- CreateIndex
CREATE INDEX "Escalation_toRole_resolvedAt_idx" ON "Escalation"("toRole", "resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Escalation_entityType_entityId_level_key" ON "Escalation"("entityType", "entityId", "level");

-- CreateIndex
CREATE INDEX "Rule_code_effectiveFrom_idx" ON "Rule"("code", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "Rule_code_version_key" ON "Rule"("code", "version");

-- CreateIndex
CREATE INDEX "SavedFilter_userId_idx" ON "SavedFilter"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LegacyItem_documentId_key" ON "LegacyItem"("documentId");

-- CreateIndex
CREATE INDEX "LegacyItem_batchId_status_idx" ON "LegacyItem"("batchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "audit_events_hash_key" ON "audit_events"("hash");

-- CreateIndex
CREATE INDEX "audit_events_entityType_entityId_idx" ON "audit_events"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_events_actorId_idx" ON "audit_events"("actorId");

-- CreateIndex
CREATE INDEX "audit_events_action_idx" ON "audit_events"("action");

-- CreateIndex
CREATE INDEX "audit_events_occurredAt_idx" ON "audit_events"("occurredAt");

-- AddForeignKey
ALTER TABLE "Institution" ADD CONSTRAINT "Institution_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "Bank"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Instrument" ADD CONSTRAINT "Instrument_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Instrument" ADD CONSTRAINT "Instrument_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "Bank"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Instrument" ADD CONSTRAINT "Instrument_replacesInstrumentId_fkey" FOREIGN KEY ("replacesInstrumentId") REFERENCES "Instrument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusTransition" ADD CONSTRAINT "StatusTransition_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldAssertion" ADD CONSTRAINT "FieldAssertion_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldAssertion" ADD CONSTRAINT "FieldAssertion_evidenceDocumentId_fkey" FOREIGN KEY ("evidenceDocumentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Discrepancy" ADD CONSTRAINT "Discrepancy_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscrepancyComment" ADD CONSTRAINT "DiscrepancyComment_discrepancyId_fkey" FOREIGN KEY ("discrepancyId") REFERENCES "Discrepancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankConfirmationRequest" ADD CONSTRAINT "BankConfirmationRequest_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankConfirmationRequest" ADD CONSTRAINT "BankConfirmationRequest_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "Bank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseRequest" ADD CONSTRAINT "ReleaseRequest_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedFilter" ADD CONSTRAINT "SavedFilter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegacyBatch" ADD CONSTRAINT "LegacyBatch_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegacyItem" ADD CONSTRAINT "LegacyItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "LegacyBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegacyItem" ADD CONSTRAINT "LegacyItem_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
