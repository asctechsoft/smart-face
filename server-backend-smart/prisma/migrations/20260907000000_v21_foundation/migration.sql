-- ============================================================================
--  v2.1 FOUNDATION — docs/13 muc 5
--
--  1. RBAC + Data Scope 6 muc      (§5.1 · BR-13 · E-V21.1)
--  2. Owner cong ty                (§5.2 · BR-15 · E-V21.8)
--  3. Workflow versioning          (§5.3 · BR-16 · E-V21.2)
--  4. State machine ky cong        (§5.4 · BR-07/BR-12 · E-V21.3)
--  5. Du lieu hieu luc theo tg     (§5.5 · BR-17 · E-V21.10)
--  6. Step-up & support access     (§5.6 · BR-18/BR-08 · E-V21.7)
--  7. Goi dich vu + wizard khoi tao (docs/07 §7 · E-V21.9)
--  8. Optimistic lock (rowVersion)  (kiem #5 cua BR-13)
--
--  Sinh bang `prisma migrate diff` roi sua tay hai cho co the lam vo du lieu —
--  xem chu thich tai cho.
-- ============================================================================

-- CreateEnum
CREATE TYPE "ScopeLevel" AS ENUM ('SELF', 'TEAM', 'DEPARTMENT', 'BRANCH', 'COMPANY', 'PLATFORM');

-- AlterEnum: PayrollPeriodStatus (docs/13 §5.4)
--   OPEN / REVIEWING / CLOSED  ->  OPEN / CALCULATING / PENDING_APPROVAL / LOCKED / REOPENED
--
-- Hai sua so voi SQL Prisma sinh ra:
--   1. Prisma dung `USING (status::text::PayrollPeriodStatus_new)` — cast do
--      NEM LOI ngay khi gap mot dong 'CLOSED' hay 'REVIEWING'. Phai ha ve TEXT,
--      anh xa du lieu, roi moi nang len enum moi.
--   2. Prisma sinh ALTER TABLE "period_transition" o day, nhung bang do duoc
--      CREATE o phia duoi CUNG MIGRATION nay — chay se bao relation khong ton
--      tai. Da bo; bang moi sinh ra da mang dung kieu enum moi.
--
-- Anh xa: CLOSED -> LOCKED (ky da chot). REVIEWING -> OPEN (dang ra soat,
-- chua chot; trong mo hinh moi viec "gui de nghi chot" moi tao PENDING_APPROVAL
-- va viec do phai do Ke toan bam, khong duoc suy dien tu du lieu cu).
BEGIN;
CREATE TYPE "PayrollPeriodStatus_new" AS ENUM ('OPEN', 'CALCULATING', 'PENDING_APPROVAL', 'LOCKED', 'REOPENED');
ALTER TABLE "payroll_period" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "payroll_period" ALTER COLUMN "status" TYPE TEXT USING ("status"::text);
UPDATE "payroll_period" SET "status" = 'LOCKED' WHERE "status" = 'CLOSED';
UPDATE "payroll_period" SET "status" = 'OPEN'   WHERE "status" = 'REVIEWING';
ALTER TABLE "payroll_period" ALTER COLUMN "status" TYPE "PayrollPeriodStatus_new" USING ("status"::"PayrollPeriodStatus_new");
ALTER TYPE "PayrollPeriodStatus" RENAME TO "PayrollPeriodStatus_old";
ALTER TYPE "PayrollPeriodStatus_new" RENAME TO "PayrollPeriodStatus";
DROP TYPE "PayrollPeriodStatus_old";
ALTER TABLE "payroll_period" ALTER COLUMN "status" SET DEFAULT 'OPEN';
COMMIT;

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RequestStatus" ADD VALUE 'SUBMITTED';
ALTER TYPE "RequestStatus" ADD VALUE 'PENDING_LEVEL_1';
ALTER TYPE "RequestStatus" ADD VALUE 'PENDING_NEXT_LEVEL';
ALTER TYPE "RequestStatus" ADD VALUE 'NEED_MORE_INFO';
ALTER TYPE "RequestStatus" ADD VALUE 'EFFECTIVE';
ALTER TYPE "RequestStatus" ADD VALUE 'EXPIRED';

-- AlterTable
ALTER TABLE "approval_flow" ADD COLUMN     "currentVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "approval_flow_step" ADD COLUMN     "fallbackApproverId" TEXT;

-- AlterTable
ALTER TABLE "attendance_daily" ADD COLUMN     "rowVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "audit_log" ADD COLUMN     "correlationId" TEXT,
ADD COLUMN     "stepUpChallengeId" TEXT,
ADD COLUMN     "supportSessionId" TEXT;

-- AlterTable
ALTER TABLE "company_policy" ADD COLUMN     "rowVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "employee" ADD COLUMN     "directManagerId" TEXT,
ADD COLUMN     "positionId" TEXT,
ADD COLUMN     "rowVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "leave_request" ADD COLUMN     "approvalSnapshot" JSONB,
ADD COLUMN     "flowVersionId" TEXT,
ADD COLUMN     "rowVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "payroll_period" ADD COLUMN     "currentVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rowVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "shift" ADD COLUMN     "rowVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "subscription_plan" ADD COLUMN     "code" TEXT,
ADD COLUMN     "dataRetentionDays" INTEGER NOT NULL DEFAULT 365,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maxAdminAccounts" INTEGER,
ADD COLUMN     "maxDepartments" INTEGER,
ADD COLUMN     "maxShifts" INTEGER,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- Backfill `code` cho cac goi da ton tai roi moi siet NOT NULL. Prisma sinh
-- thang NOT NULL khong default, se vo neu bang da co du lieu.
UPDATE "subscription_plan"
   SET "code" = upper(regexp_replace("name", '[^a-zA-Z0-9]+', '_', 'g'))
 WHERE "code" IS NULL;
ALTER TABLE "subscription_plan" ALTER COLUMN "code" SET NOT NULL;

-- CreateTable
CREATE TABLE "role" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permission" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "role_permission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "role_assignment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "scopeLevel" "ScopeLevel" NOT NULL,
    "scopeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "grantedById" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "role_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_owner" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedBy" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,
    "revokeReason" TEXT,

    CONSTRAINT "company_owner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "position" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_assignment_history" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "departmentId" TEXT,
    "branchId" TEXT,
    "directManagerId" TEXT,
    "positionId" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "changedBy" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_assignment_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_flow_version" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "steps" JSONB NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_flow_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_delegation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "delegatorId" TEXT NOT NULL,
    "delegateId" TEXT NOT NULL,
    "requestTypeId" TEXT,
    "scopeLevel" "ScopeLevel" NOT NULL DEFAULT 'COMPANY',
    "scopeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "createdBy" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_delegation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_period_version" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "calculatedBy" TEXT NOT NULL,
    "policySnapshot" JSONB NOT NULL,
    "summary" JSONB NOT NULL,

    CONSTRAINT "payroll_period_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "period_transition" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "fromStatus" "PayrollPeriodStatus" NOT NULL,
    "toStatus" "PayrollPeriodStatus" NOT NULL,
    "actorId" TEXT NOT NULL,
    "reason" TEXT,
    "affectedScope" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "period_transition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "step_up_challenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT,
    "action" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "step_up_challenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_access_session" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "ticketRef" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "endedBy" TEXT,
    "readOnly" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_access_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_feature_override" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "reason" TEXT,
    "setBy" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_feature_override_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_setup_state" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "steps" JSONB NOT NULL DEFAULT '{}',
    "currentStep" INTEGER NOT NULL DEFAULT 1,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_setup_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "role_companyId_idx" ON "role"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "role_companyId_code_key" ON "role"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "permission_code_key" ON "permission"("code");

-- CreateIndex
CREATE INDEX "permission_module_idx" ON "permission"("module");

-- CreateIndex
CREATE INDEX "role_permission_permissionId_idx" ON "role_permission"("permissionId");

-- CreateIndex
CREATE INDEX "role_assignment_companyId_employeeId_validTo_idx" ON "role_assignment"("companyId", "employeeId", "validTo");

-- CreateIndex
CREATE INDEX "role_assignment_roleId_idx" ON "role_assignment"("roleId");

-- CreateIndex
CREATE INDEX "role_assignment_grantedById_idx" ON "role_assignment"("grantedById");

-- CreateIndex
CREATE INDEX "company_owner_companyId_revokedAt_idx" ON "company_owner"("companyId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "company_owner_companyId_employeeId_key" ON "company_owner"("companyId", "employeeId");

-- CreateIndex
CREATE INDEX "position_companyId_isActive_idx" ON "position"("companyId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "position_companyId_code_key" ON "position"("companyId", "code");

-- CreateIndex
CREATE INDEX "employee_assignment_history_companyId_employeeId_effectiveF_idx" ON "employee_assignment_history"("companyId", "employeeId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "employee_assignment_history_positionId_idx" ON "employee_assignment_history"("positionId");

-- CreateIndex
CREATE UNIQUE INDEX "approval_flow_version_flowId_version_key" ON "approval_flow_version"("flowId", "version");

-- CreateIndex
CREATE INDEX "approval_delegation_companyId_delegateId_validTo_idx" ON "approval_delegation"("companyId", "delegateId", "validTo");

-- CreateIndex
CREATE INDEX "approval_delegation_companyId_delegatorId_validTo_idx" ON "approval_delegation"("companyId", "delegatorId", "validTo");

-- CreateIndex
CREATE INDEX "payroll_period_version_companyId_periodId_idx" ON "payroll_period_version"("companyId", "periodId");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_period_version_periodId_version_key" ON "payroll_period_version"("periodId", "version");

-- CreateIndex
CREATE INDEX "period_transition_periodId_createdAt_idx" ON "period_transition"("periodId", "createdAt");

-- CreateIndex
CREATE INDEX "period_transition_companyId_createdAt_idx" ON "period_transition"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "step_up_challenge_userId_action_expiresAt_idx" ON "step_up_challenge"("userId", "action", "expiresAt");

-- CreateIndex
CREATE INDEX "support_access_session_companyId_expiresAt_idx" ON "support_access_session"("companyId", "expiresAt");

-- CreateIndex
CREATE INDEX "support_access_session_adminUserId_createdAt_idx" ON "support_access_session"("adminUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "company_feature_override_companyId_key_key" ON "company_feature_override"("companyId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "company_setup_state_companyId_key" ON "company_setup_state"("companyId");

-- CreateIndex
CREATE INDEX "audit_log_correlationId_idx" ON "audit_log"("correlationId");

-- CreateIndex
CREATE INDEX "audit_log_supportSessionId_idx" ON "audit_log"("supportSessionId");

-- CreateIndex
CREATE INDEX "employee_companyId_directManagerId_idx" ON "employee"("companyId", "directManagerId");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_plan_code_key" ON "subscription_plan"("code");

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_directManagerId_fkey" FOREIGN KEY ("directManagerId") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_flowVersionId_fkey" FOREIGN KEY ("flowVersionId") REFERENCES "approval_flow_version"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role" ADD CONSTRAINT "role_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignment" ADD CONSTRAINT "role_assignment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignment" ADD CONSTRAINT "role_assignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignment" ADD CONSTRAINT "role_assignment_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignment" ADD CONSTRAINT "role_assignment_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_owner" ADD CONSTRAINT "company_owner_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_owner" ADD CONSTRAINT "company_owner_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "position" ADD CONSTRAINT "position_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_assignment_history" ADD CONSTRAINT "employee_assignment_history_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_assignment_history" ADD CONSTRAINT "employee_assignment_history_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_flow_version" ADD CONSTRAINT "approval_flow_version_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "approval_flow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_delegation" ADD CONSTRAINT "approval_delegation_delegatorId_fkey" FOREIGN KEY ("delegatorId") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_delegation" ADD CONSTRAINT "approval_delegation_delegateId_fkey" FOREIGN KEY ("delegateId") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_period_version" ADD CONSTRAINT "payroll_period_version_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "payroll_period"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_transition" ADD CONSTRAINT "period_transition_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "payroll_period"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_access_session" ADD CONSTRAINT "support_access_session_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_feature_override" ADD CONSTRAINT "company_feature_override_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_setup_state" ADD CONSTRAINT "company_setup_state_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

