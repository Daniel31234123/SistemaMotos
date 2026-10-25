CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE "MotorcycleStatus" AS ENUM ('REGISTERED', 'AVAILABLE', 'SOLD');
CREATE TYPE "SaleStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');
CREATE TYPE "SaleType" AS ENUM ('CASH', 'CREDIT');
CREATE TYPE "RecordStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'VOIDED');
CREATE TYPE "IdentifierType" AS ENUM ('ENGINE', 'CHASSIS', 'PLATE');
CREATE TYPE "IdentifierStatus" AS ENUM ('ACTIVE', 'REPLACED');
CREATE TYPE "ExpenseScope" AS ENUM ('MOTORCYCLE', 'GENERAL', 'BOTH');
CREATE TYPE "ApplicationStatus" AS ENUM ('APPLIED', 'REVIEW_REQUIRED');

CREATE TABLE "Brand" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "name" VARCHAR(80) NOT NULL,
  "normalized" VARCHAR(80) NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Brand_pkey" PRIMARY KEY ("id"), CONSTRAINT "Brand_normalized_key" UNIQUE ("normalized")
);
CREATE TABLE "Motorcycle" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "brandId" UUID NOT NULL, "line" VARCHAR(100) NOT NULL,
  "modelYear" INTEGER NOT NULL, "color" VARCHAR(60) NOT NULL, "displacementCc" INTEGER NOT NULL,
  "salePriceCop" DECIMAL(14,2) NOT NULL, "acquisitionCostCop" DECIMAL(14,2) NOT NULL,
  "status" "MotorcycleStatus" NOT NULL DEFAULT 'REGISTERED', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "Motorcycle_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Motorcycle_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Motorcycle_salePriceCop_check" CHECK ("salePriceCop" >= 0),
  CONSTRAINT "Motorcycle_acquisitionCostCop_check" CHECK ("acquisitionCostCop" >= 0),
  CONSTRAINT "Motorcycle_displacementCc_check" CHECK ("displacementCc" > 0),
  CONSTRAINT "Motorcycle_modelYear_check" CHECK ("modelYear" BETWEEN 1950 AND 2100)
);
CREATE TABLE "MotorcycleIdentifier" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "motorcycleId" UUID NOT NULL, "type" "IdentifierType" NOT NULL,
  "value" VARCHAR(100) NOT NULL, "normalized" VARCHAR(100) NOT NULL, "status" "IdentifierStatus" NOT NULL DEFAULT 'ACTIVE',
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "replacedAt" TIMESTAMP(3), "reason" VARCHAR(500),
  CONSTRAINT "MotorcycleIdentifier_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MotorcycleIdentifier_motorcycleId_fkey" FOREIGN KEY ("motorcycleId") REFERENCES "Motorcycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MotorcycleIdentifier_active_unique" ON "MotorcycleIdentifier"("type", "normalized") WHERE "status" = 'ACTIVE';
CREATE INDEX "MotorcycleIdentifier_motorcycleId_type_status_idx" ON "MotorcycleIdentifier"("motorcycleId", "type", "status");
CREATE TABLE "Customer" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "fullName" VARCHAR(160) NOT NULL, "documentType" VARCHAR(40) NOT NULL,
  "documentNumber" VARCHAR(80) NOT NULL, "normalizedDocType" VARCHAR(40) NOT NULL, "normalizedDocNumber" VARCHAR(80) NOT NULL,
  "phone" VARCHAR(40), "email" VARCHAR(254), "address" VARCHAR(250), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "Customer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Customer_normalizedDocType_normalizedDocNumber_key" UNIQUE ("normalizedDocType", "normalizedDocNumber")
);
CREATE INDEX "Customer_fullName_idx" ON "Customer"("fullName");
CREATE TABLE "Sale" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "motorcycleId" UUID NOT NULL, "customerId" UUID NOT NULL,
  "type" "SaleType" NOT NULL, "status" "SaleStatus" NOT NULL DEFAULT 'DRAFT', "motorcyclePriceCop" DECIMAL(14,2) NOT NULL,
  "saleDate" TIMESTAMP(3), "cancellationReason" VARCHAR(500), "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Sale_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Sale_motorcycleId_fkey" FOREIGN KEY ("motorcycleId") REFERENCES "Motorcycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Sale_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Sale_motorcyclePriceCop_check" CHECK ("motorcyclePriceCop" >= 0)
);
CREATE UNIQUE INDEX "Sale_one_confirmed_per_motorcycle" ON "Sale"("motorcycleId") WHERE "status" = 'CONFIRMED';
CREATE INDEX "Sale_status_saleDate_idx" ON "Sale"("status", "saleDate");
CREATE INDEX "Sale_motorcycleId_status_idx" ON "Sale"("motorcycleId", "status");
CREATE INDEX "Sale_customerId_saleDate_idx" ON "Sale"("customerId", "saleDate");
CREATE TABLE "ProcedureType" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "name" VARCHAR(100) NOT NULL, "normalized" VARCHAR(100) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "ProcedureType_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProcedureType_name_key" UNIQUE ("name"), CONSTRAINT "ProcedureType_normalized_key" UNIQUE ("normalized")
);
CREATE TABLE "SaleProcedure" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "saleId" UUID NOT NULL, "procedureTypeId" UUID NOT NULL,
  "nameSnapshot" VARCHAR(100) NOT NULL, "description" VARCHAR(500), "customerAmountCop" DECIMAL(14,2) NOT NULL,
  "businessCostCop" DECIMAL(14,2) NOT NULL, "procedureDate" DATE NOT NULL, "status" "RecordStatus" NOT NULL DEFAULT 'DRAFT',
  "voidReason" VARCHAR(500), "replacesId" UUID, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "SaleProcedure_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SaleProcedure_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SaleProcedure_procedureTypeId_fkey" FOREIGN KEY ("procedureTypeId") REFERENCES "ProcedureType"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SaleProcedure_replacesId_fkey" FOREIGN KEY ("replacesId") REFERENCES "SaleProcedure"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SaleProcedure_customerAmountCop_check" CHECK ("customerAmountCop" >= 0),
  CONSTRAINT "SaleProcedure_businessCostCop_check" CHECK ("businessCostCop" >= 0)
);
CREATE INDEX "SaleProcedure_saleId_procedureDate_status_idx" ON "SaleProcedure"("saleId", "procedureDate", "status");
CREATE INDEX "SaleProcedure_replacesId_idx" ON "SaleProcedure"("replacesId");
CREATE UNIQUE INDEX "SaleProcedure_replacesId_key" ON "SaleProcedure"("replacesId");
CREATE TABLE "ExpenseCategory" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "name" VARCHAR(100) NOT NULL, "normalized" VARCHAR(100) NOT NULL,
  "scope" "ExpenseScope" NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExpenseCategory_normalized_key" UNIQUE ("normalized")
);
CREATE TABLE "MotorcycleExpense" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "motorcycleId" UUID NOT NULL, "categoryId" UUID NOT NULL,
  "expenseDate" DATE NOT NULL, "description" VARCHAR(500) NOT NULL, "amountCop" DECIMAL(14,2) NOT NULL,
  "status" "RecordStatus" NOT NULL DEFAULT 'DRAFT', "voidReason" VARCHAR(500), "replacesId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MotorcycleExpense_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MotorcycleExpense_motorcycleId_fkey" FOREIGN KEY ("motorcycleId") REFERENCES "Motorcycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MotorcycleExpense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MotorcycleExpense_replacesId_fkey" FOREIGN KEY ("replacesId") REFERENCES "MotorcycleExpense"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MotorcycleExpense_amountCop_check" CHECK ("amountCop" >= 0)
);
CREATE INDEX "MotorcycleExpense_motorcycleId_expenseDate_status_idx" ON "MotorcycleExpense"("motorcycleId", "expenseDate", "status");
CREATE INDEX "MotorcycleExpense_categoryId_expenseDate_idx" ON "MotorcycleExpense"("categoryId", "expenseDate");
CREATE UNIQUE INDEX "MotorcycleExpense_replacesId_key" ON "MotorcycleExpense"("replacesId");
CREATE TABLE "GeneralExpense" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "categoryId" UUID NOT NULL, "expenseDate" DATE NOT NULL,
  "description" VARCHAR(500) NOT NULL, "amountCop" DECIMAL(14,2) NOT NULL, "status" "RecordStatus" NOT NULL DEFAULT 'DRAFT',
  "voidReason" VARCHAR(500), "replacesId" UUID, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "GeneralExpense_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GeneralExpense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "GeneralExpense_replacesId_fkey" FOREIGN KEY ("replacesId") REFERENCES "GeneralExpense"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "GeneralExpense_amountCop_check" CHECK ("amountCop" >= 0)
);
CREATE INDEX "GeneralExpense_categoryId_expenseDate_status_idx" ON "GeneralExpense"("categoryId", "expenseDate", "status");
CREATE UNIQUE INDEX "GeneralExpense_replacesId_key" ON "GeneralExpense"("replacesId");
CREATE TABLE "PercentageRule" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "brandId" UUID NOT NULL, "ratePercent" DECIMAL(7,4) NOT NULL,
  "effectiveFrom" DATE NOT NULL, "effectiveTo" DATE, "version" INTEGER NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "PercentageRule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PercentageRule_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PercentageRule_brandId_version_key" UNIQUE ("brandId", "version"),
  CONSTRAINT "PercentageRule_ratePercent_check" CHECK ("ratePercent" > 0 AND "ratePercent" <= 100),
  CONSTRAINT "PercentageRule_dates_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom")
);
CREATE INDEX "PercentageRule_brandId_effectiveFrom_effectiveTo_idx" ON "PercentageRule"("brandId", "effectiveFrom", "effectiveTo");
CREATE TABLE "PercentageApplication" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "saleId" UUID NOT NULL, "ruleId" UUID NOT NULL,
  "brandNameSnapshot" VARCHAR(80) NOT NULL, "ratePercentSnapshot" DECIMAL(7,4) NOT NULL,
  "baseCop" DECIMAL(14,2) NOT NULL, "amountCop" DECIMAL(14,2) NOT NULL, "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" "ApplicationStatus" NOT NULL DEFAULT 'APPLIED', "manualReason" VARCHAR(500),
  CONSTRAINT "PercentageApplication_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PercentageApplication_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PercentageApplication_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "PercentageRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "PercentageApplication_saleId_appliedAt_idx" ON "PercentageApplication"("saleId", "appliedAt");
CREATE UNIQUE INDEX "PercentageApplication_saleId_key" ON "PercentageApplication"("saleId");
CREATE TABLE "PercentageAdjustment" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "applicationId" UUID NOT NULL, "amountDeltaCop" DECIMAL(14,2) NOT NULL,
  "reason" VARCHAR(500) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PercentageAdjustment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PercentageAdjustment_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "PercentageApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "PercentageAdjustment_applicationId_createdAt_idx" ON "PercentageAdjustment"("applicationId", "createdAt");
CREATE TABLE "AuditEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "entityType" VARCHAR(80) NOT NULL, "entityId" UUID NOT NULL,
  "operation" VARCHAR(80) NOT NULL, "changes" JSONB NOT NULL, "reason" VARCHAR(500),
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "saleId" UUID,
  CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuditEvent_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "AuditEvent_entityType_entityId_occurredAt_idx" ON "AuditEvent"("entityType", "entityId", "occurredAt");
