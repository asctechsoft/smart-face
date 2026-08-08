-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('TRIAL', 'ACTIVE', 'SUSPENDED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "SystemRole" AS ENUM ('SYSTEM_ADMIN', 'COMPANY_ADMIN', 'MANAGER', 'HR_PAYROLL', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "FaceProfileStatus" AS ENUM ('ACTIVE', 'REPLACED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ShiftType" AS ENUM ('FIXED', 'ROTATING', 'FLEXIBLE');

-- CreateEnum
CREATE TYPE "AttendanceType" AS ENUM ('CHECK_IN', 'CHECK_OUT', 'BREAK_OUT', 'BREAK_IN', 'RANDOM_CHECK');

-- CreateEnum
CREATE TYPE "AuthMethod" AS ENUM ('FACE', 'FINGERPRINT', 'MANUAL', 'KIOSK');

-- CreateEnum
CREATE TYPE "AttendanceDecision" AS ENUM ('ACCEPTED', 'FLAGGED', 'PENDING_REVIEW', 'REJECTED');

-- CreateEnum
CREATE TYPE "DailyStatus" AS ENUM ('ON_TIME', 'LATE', 'EARLY_LEAVE', 'LATE_AND_EARLY', 'OVERTIME', 'INSUFFICIENT', 'ON_LEAVE', 'HOLIDAY', 'ABSENT', 'MISSING_RECORD', 'WEEKEND');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayrollPeriodStatus" AS ENUM ('OPEN', 'REVIEWING', 'CLOSED');

-- CreateTable
CREATE TABLE "company" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taxCode" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    "status" "CompanyStatus" NOT NULL DEFAULT 'TRIAL',
    "planId" TEXT,
    "trialEndsAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "suspendReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_plan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "maxEmployees" INTEGER,
    "maxBranches" INTEGER,
    "maxRecognitionsPerMonth" INTEGER,
    "storageGb" INTEGER,
    "photoRetentionDays" INTEGER NOT NULL DEFAULT 90,
    "features" JSONB NOT NULL DEFAULT '{}',
    "pricePerMonth" DECIMAL(12,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "radiusMeters" INTEGER NOT NULL DEFAULT 100,
    "wifiSsids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "wifiBssids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "beaconUuids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowedIpCidrs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "timezone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "managerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_account" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "fullName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'vi',
    "passwordHash" TEXT NOT NULL,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "passwordChangedAt" TIMESTAMP(3),
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "twoFactorSecret" TEXT,
    "twoFactorConfirmedAt" TIMESTAMP(3),
    "twoFactorRecoveryCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isSystemAdmin" BOOLEAN NOT NULL DEFAULT false,
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "blockedReason" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "user_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "employeeCode" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "branchId" TEXT,
    "departmentId" TEXT,
    "position" TEXT,
    "contractType" TEXT,
    "joinedAt" TIMESTAMP(3),
    "terminatedAt" TIMESTAMP(3),
    "status" "EmployeeStatus" NOT NULL DEFAULT 'PENDING_ACTIVATION',
    "roles" "SystemRole"[] DEFAULT ARRAY['EMPLOYEE']::"SystemRole"[],
    "managedDepartmentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "codeLocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_token" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "replacedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "face_profile" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "embeddingRaw" BYTEA,
    "embeddingDim" INTEGER NOT NULL DEFAULT 512,
    "modelVersion" TEXT NOT NULL,
    "qualityScore" DOUBLE PRECISION,
    "photoKey" TEXT,
    "angle" TEXT,
    "status" "FaceProfileStatus" NOT NULL DEFAULT 'ACTIVE',
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,
    "revokedReason" TEXT,

    CONSTRAINT "face_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "biometric_key" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'ES256',
    "attestation" JSONB,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "biometric_key_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_binding" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "deviceModel" TEXT,
    "osName" TEXT,
    "osVersion" TEXT,
    "appVersion" TEXT,
    "deviceSecretHash" TEXT NOT NULL,
    "pushToken" TEXT,
    "isRooted" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,
    "revokedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_binding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ShiftType" NOT NULL DEFAULT 'FIXED',
    "startTime" TEXT,
    "endTime" TEXT,
    "crossesMidnight" BOOLEAN NOT NULL DEFAULT false,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "requiredMinutes" INTEGER,
    "lateToleranceMinutes" INTEGER NOT NULL DEFAULT 0,
    "earlyLeaveToleranceMinutes" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "weekdayMask" INTEGER NOT NULL DEFAULT 0,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_segment" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,

    CONSTRAINT "shift_segment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_assignment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shift_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holiday" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "substituteDate" DATE,
    "otMultiplier" DECIMAL(4,2) NOT NULL DEFAULT 3.0,
    "branchIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_policy" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_policy" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contractType" TEXT,
    "baseDaysPerYear" DECIMAL(5,2) NOT NULL DEFAULT 12,
    "seniorityBonusDays" DECIMAL(5,2) NOT NULL DEFAULT 1,
    "seniorityEveryYears" INTEGER NOT NULL DEFAULT 5,
    "allowCarryOver" BOOLEAN NOT NULL DEFAULT true,
    "maxCarryOverDays" DECIMAL(5,2),
    "carryOverExpireMonth" INTEGER DEFAULT 3,
    "accrualMode" TEXT NOT NULL DEFAULT 'YEARLY',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_balance" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "entitledDays" DECIMAL(5,2) NOT NULL,
    "carriedOverDays" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "usedDays" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "pendingDays" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_balance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_log" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "branchId" TEXT,
    "type" "AttendanceType" NOT NULL,
    "authMethod" "AuthMethod" NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientReportedAt" TIMESTAMP(3),
    "clockSkewSeconds" INTEGER,
    "workDate" DATE NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "gpsAccuracy" DOUBLE PRECISION,
    "locationProvider" TEXT,
    "isMockLocation" BOOLEAN NOT NULL DEFAULT false,
    "distanceToBranchM" DOUBLE PRECISION,
    "insideGeofence" BOOLEAN,
    "wifiBssid" TEXT,
    "beaconUuid" TEXT,
    "deviceId" TEXT,
    "deviceModel" TEXT,
    "osVersion" TEXT,
    "appVersion" TEXT,
    "isRootedDevice" BOOLEAN NOT NULL DEFAULT false,
    "attestationPassed" BOOLEAN,
    "ipAddress" TEXT,
    "matchScore" DOUBLE PRECISION,
    "livenessScore" DOUBLE PRECISION,
    "imageQuality" JSONB,
    "livenessChallenge" TEXT,
    "aiModelVersion" TEXT,
    "aiProcessingMs" INTEGER,
    "photoKey" TEXT,
    "photoHash" TEXT,
    "fraudScore" INTEGER NOT NULL DEFAULT 0,
    "decision" "AttendanceDecision" NOT NULL DEFAULT 'ACCEPTED',
    "isOffline" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fraud_flag" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "attendanceLogId" TEXT,
    "employeeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "details" JSONB,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewDecision" TEXT,
    "reviewReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fraud_flag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_adjustment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "attendanceLogId" TEXT,
    "adjustType" TEXT NOT NULL,
    "beforeValue" JSONB,
    "afterValue" JSONB,
    "reason" TEXT NOT NULL,
    "requestId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_adjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_daily" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "shiftId" TEXT,
    "firstCheckInAt" TIMESTAMP(3),
    "lastCheckOutAt" TIMESTAMP(3),
    "workedMinutes" INTEGER NOT NULL DEFAULT 0,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "lateMinutes" INTEGER NOT NULL DEFAULT 0,
    "earlyLeaveMinutes" INTEGER NOT NULL DEFAULT 0,
    "otMinutes" INTEGER NOT NULL DEFAULT 0,
    "otMultiplier" DECIMAL(4,2),
    "makeupMinutes" INTEGER NOT NULL DEFAULT 0,
    "standardDays" DECIMAL(5,3) NOT NULL DEFAULT 0,
    "status" "DailyStatus" NOT NULL DEFAULT 'ABSENT',
    "appliedRequestIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hasFraudFlag" BOOLEAN NOT NULL DEFAULT false,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "calcEngineVersion" TEXT,
    "breakdown" JSONB,

    CONSTRAINT "attendance_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_type" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deductFrom" TEXT NOT NULL DEFAULT 'NONE',
    "unit" TEXT NOT NULL DEFAULT 'DAY',
    "requiresAttachment" BOOLEAN NOT NULL DEFAULT false,
    "requiresPreApproval" BOOLEAN NOT NULL DEFAULT false,
    "maxDaysPerRequest" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "request_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_flow" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "requestTypeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_flow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_flow_step" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "approverRole" TEXT NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "condition" JSONB,

    CONSTRAINT "approval_flow_step_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_request" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "requestTypeId" TEXT NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'DRAFT',
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "quantity" DECIMAL(6,2) NOT NULL,
    "isHalfDay" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT NOT NULL,
    "expectedReturnAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_step" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "approverRole" TEXT NOT NULL,
    "approverId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedAt" TIMESTAMP(3),
    "comment" TEXT,
    "delegatedFrom" TEXT,

    CONSTRAINT "approval_step_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_attachment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "makeup_work_record" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "debtWorkDate" DATE NOT NULL,
    "debtMinutes" INTEGER NOT NULL,
    "makeupWorkDate" DATE,
    "makeupMinutes" INTEGER NOT NULL DEFAULT 0,
    "remainingMinutes" INTEGER NOT NULL,
    "dueDate" DATE,
    "requestId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "makeup_work_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_period" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "PayrollPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "closedBy" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenedBy" TEXT,
    "reopenReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_period_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_summary" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "standardDays" DECIMAL(6,2) NOT NULL,
    "workedMinutes" INTEGER NOT NULL,
    "otMinutesNormal" INTEGER NOT NULL DEFAULT 0,
    "otMinutesWeekend" INTEGER NOT NULL DEFAULT 0,
    "otMinutesHoliday" INTEGER NOT NULL DEFAULT 0,
    "lateCount" INTEGER NOT NULL DEFAULT 0,
    "lateMinutesTotal" INTEGER NOT NULL DEFAULT 0,
    "earlyLeaveCount" INTEGER NOT NULL DEFAULT 0,
    "leaveDays" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "unpaidLeaveDays" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "makeupMinutes" INTEGER NOT NULL DEFAULT 0,
    "penaltyAmount" DECIMAL(14,2),
    "violationCount" INTEGER NOT NULL DEFAULT 0,
    "breakdown" JSONB,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_summary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "employeeId" TEXT,
    "departmentId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "channel" TEXT NOT NULL DEFAULT 'PUSH',
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "actorUserId" TEXT,
    "actorName" TEXT,
    "actorRole" TEXT,
    "actorIp" TEXT,
    "actorUserAgent" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "reason" TEXT,
    "before" JSONB,
    "after" JSONB,
    "traceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemConfig" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ai_model_version" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "farMeasured" DOUBLE PRECISION,
    "frrMeasured" DOUBLE PRECISION,
    "latencyP95Ms" INTEGER,
    "defaultMatchThreshold" DOUBLE PRECISION,
    "defaultLivenessThreshold" DOUBLE PRECISION,
    "deployedAt" TIMESTAMP(3),
    "rolledBackAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_model_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_job" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "params" JSONB,
    "fileKey" TEXT,
    "fileName" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "export_job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_code_key" ON "company"("code");

-- CreateIndex
CREATE UNIQUE INDEX "company_domain_key" ON "company"("domain");

-- CreateIndex
CREATE INDEX "company_status_idx" ON "company"("status");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_plan_name_key" ON "subscription_plan"("name");

-- CreateIndex
CREATE INDEX "branch_companyId_idx" ON "branch"("companyId");

-- CreateIndex
CREATE INDEX "department_companyId_idx" ON "department"("companyId");

-- CreateIndex
CREATE INDEX "department_companyId_branchId_idx" ON "department"("companyId", "branchId");

-- CreateIndex
CREATE INDEX "user_account_companyId_idx" ON "user_account"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "user_account_companyId_email_key" ON "user_account"("companyId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "employee_userId_key" ON "employee"("userId");

-- CreateIndex
CREATE INDEX "employee_companyId_status_idx" ON "employee"("companyId", "status");

-- CreateIndex
CREATE INDEX "employee_companyId_departmentId_idx" ON "employee"("companyId", "departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "employee_companyId_employeeCode_key" ON "employee"("companyId", "employeeCode");

-- CreateIndex
CREATE UNIQUE INDEX "employee_companyId_phone_key" ON "employee"("companyId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_token_tokenHash_key" ON "refresh_token"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_token_userId_idx" ON "refresh_token"("userId");

-- CreateIndex
CREATE INDEX "refresh_token_tokenHash_idx" ON "refresh_token"("tokenHash");

-- CreateIndex
CREATE INDEX "face_profile_companyId_employeeId_status_idx" ON "face_profile"("companyId", "employeeId", "status");

-- CreateIndex
CREATE INDEX "face_profile_modelVersion_idx" ON "face_profile"("modelVersion");

-- CreateIndex
CREATE INDEX "biometric_key_companyId_employeeId_idx" ON "biometric_key"("companyId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "biometric_key_employeeId_deviceId_key" ON "biometric_key"("employeeId", "deviceId");

-- CreateIndex
CREATE INDEX "device_binding_companyId_userId_isActive_idx" ON "device_binding"("companyId", "userId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "device_binding_userId_deviceId_key" ON "device_binding"("userId", "deviceId");

-- CreateIndex
CREATE INDEX "shift_companyId_effectiveFrom_idx" ON "shift"("companyId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "shift_segment_shiftId_idx" ON "shift_segment"("shiftId");

-- CreateIndex
CREATE INDEX "shift_assignment_companyId_workDate_idx" ON "shift_assignment"("companyId", "workDate");

-- CreateIndex
CREATE UNIQUE INDEX "shift_assignment_employeeId_workDate_key" ON "shift_assignment"("employeeId", "workDate");

-- CreateIndex
CREATE INDEX "holiday_companyId_date_idx" ON "holiday"("companyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "holiday_companyId_date_key" ON "holiday"("companyId", "date");

-- CreateIndex
CREATE INDEX "company_policy_companyId_key_effectiveFrom_idx" ON "company_policy"("companyId", "key", "effectiveFrom");

-- CreateIndex
CREATE INDEX "leave_policy_companyId_effectiveFrom_idx" ON "leave_policy"("companyId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "leave_balance_companyId_year_idx" ON "leave_balance"("companyId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "leave_balance_employeeId_year_key" ON "leave_balance"("employeeId", "year");

-- CreateIndex
CREATE INDEX "attendance_log_companyId_employeeId_workDate_idx" ON "attendance_log"("companyId", "employeeId", "workDate");

-- CreateIndex
CREATE INDEX "attendance_log_companyId_workDate_idx" ON "attendance_log"("companyId", "workDate");

-- CreateIndex
CREATE INDEX "attendance_log_companyId_decision_idx" ON "attendance_log"("companyId", "decision");

-- CreateIndex
CREATE INDEX "attendance_log_employeeId_recordedAt_idx" ON "attendance_log"("employeeId", "recordedAt");

-- CreateIndex
CREATE INDEX "fraud_flag_companyId_createdAt_idx" ON "fraud_flag"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "fraud_flag_companyId_reviewedAt_idx" ON "fraud_flag"("companyId", "reviewedAt");

-- CreateIndex
CREATE INDEX "fraud_flag_attendanceLogId_idx" ON "fraud_flag"("attendanceLogId");

-- CreateIndex
CREATE INDEX "fraud_flag_companyId_employeeId_idx" ON "fraud_flag"("companyId", "employeeId");

-- CreateIndex
CREATE INDEX "attendance_adjustment_companyId_employeeId_workDate_idx" ON "attendance_adjustment"("companyId", "employeeId", "workDate");

-- CreateIndex
CREATE INDEX "attendance_daily_companyId_workDate_idx" ON "attendance_daily"("companyId", "workDate");

-- CreateIndex
CREATE INDEX "attendance_daily_companyId_employeeId_workDate_idx" ON "attendance_daily"("companyId", "employeeId", "workDate");

-- CreateIndex
CREATE INDEX "attendance_daily_companyId_status_idx" ON "attendance_daily"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_daily_employeeId_workDate_key" ON "attendance_daily"("employeeId", "workDate");

-- CreateIndex
CREATE INDEX "request_type_companyId_idx" ON "request_type"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "request_type_companyId_code_key" ON "request_type"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "approval_flow_requestTypeId_key" ON "approval_flow"("requestTypeId");

-- CreateIndex
CREATE INDEX "approval_flow_step_flowId_order_idx" ON "approval_flow_step"("flowId", "order");

-- CreateIndex
CREATE INDEX "leave_request_companyId_status_idx" ON "leave_request"("companyId", "status");

-- CreateIndex
CREATE INDEX "leave_request_companyId_employeeId_startAt_idx" ON "leave_request"("companyId", "employeeId", "startAt");

-- CreateIndex
CREATE INDEX "leave_request_employeeId_status_idx" ON "leave_request"("employeeId", "status");

-- CreateIndex
CREATE INDEX "approval_step_companyId_status_idx" ON "approval_step"("companyId", "status");

-- CreateIndex
CREATE INDEX "approval_step_requestId_order_idx" ON "approval_step"("requestId", "order");

-- CreateIndex
CREATE INDEX "approval_step_approverId_status_idx" ON "approval_step"("approverId", "status");

-- CreateIndex
CREATE INDEX "request_attachment_requestId_idx" ON "request_attachment"("requestId");

-- CreateIndex
CREATE INDEX "makeup_work_record_companyId_employeeId_status_idx" ON "makeup_work_record"("companyId", "employeeId", "status");

-- CreateIndex
CREATE INDEX "payroll_period_companyId_status_idx" ON "payroll_period"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_period_companyId_startDate_endDate_key" ON "payroll_period"("companyId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "payroll_summary_companyId_periodId_idx" ON "payroll_summary"("companyId", "periodId");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_summary_periodId_employeeId_key" ON "payroll_summary"("periodId", "employeeId");

-- CreateIndex
CREATE INDEX "notification_companyId_employeeId_readAt_idx" ON "notification"("companyId", "employeeId", "readAt");

-- CreateIndex
CREATE INDEX "notification_scheduledAt_sentAt_idx" ON "notification"("scheduledAt", "sentAt");

-- CreateIndex
CREATE INDEX "audit_log_companyId_createdAt_idx" ON "audit_log"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_log_actorUserId_createdAt_idx" ON "audit_log"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_log_action_createdAt_idx" ON "audit_log"("action", "createdAt");

-- CreateIndex
CREATE INDEX "audit_log_targetType_targetId_idx" ON "audit_log"("targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_model_version_name_version_key" ON "ai_model_version"("name", "version");

-- CreateIndex
CREATE INDEX "export_job_companyId_createdAt_idx" ON "export_job"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "company" ADD CONSTRAINT "company_planId_fkey" FOREIGN KEY ("planId") REFERENCES "subscription_plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch" ADD CONSTRAINT "branch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department" ADD CONSTRAINT "department_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department" ADD CONSTRAINT "department_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department" ADD CONSTRAINT "department_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_account" ADD CONSTRAINT "user_account_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "face_profile" ADD CONSTRAINT "face_profile_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "biometric_key" ADD CONSTRAINT "biometric_key_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_binding" ADD CONSTRAINT "device_binding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift" ADD CONSTRAINT "shift_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_segment" ADD CONSTRAINT "shift_segment_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_assignment" ADD CONSTRAINT "shift_assignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_assignment" ADD CONSTRAINT "shift_assignment_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holiday" ADD CONSTRAINT "holiday_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_policy" ADD CONSTRAINT "company_policy_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_balance" ADD CONSTRAINT "leave_balance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_log" ADD CONSTRAINT "attendance_log_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_flag" ADD CONSTRAINT "fraud_flag_attendanceLogId_fkey" FOREIGN KEY ("attendanceLogId") REFERENCES "attendance_log"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_adjustment" ADD CONSTRAINT "attendance_adjustment_attendanceLogId_fkey" FOREIGN KEY ("attendanceLogId") REFERENCES "attendance_log"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_daily" ADD CONSTRAINT "attendance_daily_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_type" ADD CONSTRAINT "request_type_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_flow" ADD CONSTRAINT "approval_flow_requestTypeId_fkey" FOREIGN KEY ("requestTypeId") REFERENCES "request_type"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_flow_step" ADD CONSTRAINT "approval_flow_step_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "approval_flow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_requestTypeId_fkey" FOREIGN KEY ("requestTypeId") REFERENCES "request_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_step" ADD CONSTRAINT "approval_step_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "leave_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_attachment" ADD CONSTRAINT "request_attachment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "leave_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "makeup_work_record" ADD CONSTRAINT "makeup_work_record_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_period" ADD CONSTRAINT "payroll_period_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_summary" ADD CONSTRAINT "payroll_summary_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "payroll_period"("id") ON DELETE CASCADE ON UPDATE CASCADE;

