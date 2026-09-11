import type { Prisma, PrismaClient } from '@prisma/client';
import {
  ALL_PERMISSION_CODES,
  PERMISSION_CATALOG,
  SYSTEM_ROLE_DEFINITIONS,
  permissionModule,
} from '../access/permission.constants';

/**
 * Dữ liệu nền mà mọi môi trường đều cần, kể cả production.
 *
 * Tách khỏi `prisma/seed.ts` vì seed còn tạo công ty demo và tài khoản mẫu với
 * mật khẩu nằm công khai trong mã nguồn — thứ không bao giờ được chạy trên
 * production. Trước khi tách, production không có đường nào để có gói dịch vụ
 * hay danh mục quyền: không migration nào chèn chúng, và màn Gói dịch vụ chỉ
 * cho xem.
 *
 * Hai kiểu đồng bộ khác nhau, có chủ đích:
 *
 * | Dữ liệu            | Cách đồng bộ            | Vì sao                                        |
 * |--------------------|-------------------------|-----------------------------------------------|
 * | Quyền + vai trò HT | Ghi đè mỗi lần chạy     | Code là nguồn sự thật; bản mới thêm quyền thì |
 * |                    |                         | DB phải có ngay, nếu không guard từ chối       |
 * | Gói dịch vụ        | Chỉ tạo khi bảng TRỐNG  | Quản trị nền tảng sửa giá/giới hạn trên web;  |
 * | Model AI           |                         | ghi đè mỗi lần deploy là xoá công sức của họ  |
 */

/**
 * Catalog Free / Plus / Max theo bản thiết kế v2.1 (màn "Chỉnh sửa gói dịch vụ"
 * của Quản trị nền tảng).
 *
 * `features` là nguồn sự thật cho feature flag; các cột `max*` là bản sao được
 * trải phẳng để ràng buộc ở tầng DB và query nhanh. Giới hạn phải được CƯỠNG
 * CHẾ Ở BACKEND, không phải chỉ ẩn nút trên UI (`FR-ADM-PKG-03`).
 */
export const DEFAULT_PLANS = [
  {
    code: 'FREE',
    name: 'Free',
    description: 'Dùng thử: chấm công cơ bản cho nhóm nhỏ.',
    maxEmployees: 20,
    maxBranches: 1,
    maxDepartments: 1,
    maxShifts: 1,
    maxAdminAccounts: 1,
    maxRecognitionsPerMonth: 2_000,
    storageGb: 5,
    photoRetentionDays: 30,
    dataRetentionDays: 30,
    features: {
      appAccount: true,
      leaveApproval: false,
      advancedScheduling: false,
      excelExport: false,
      advancedReport: false,
      apiIntegration: false,
      fullAuditLog: false,
    },
    pricePerMonth: 0,
    isDefault: true,
    sortOrder: 1,
  },
  {
    code: 'PLUS',
    name: 'Plus',
    description: 'Doanh nghiệp vừa: đơn từ, phân ca nâng cao, xuất Excel.',
    maxEmployees: 200,
    maxBranches: 5,
    maxDepartments: 20,
    maxShifts: 10,
    maxAdminAccounts: 5,
    maxRecognitionsPerMonth: 50_000,
    storageGb: 100,
    photoRetentionDays: 180,
    dataRetentionDays: 365,
    features: {
      appAccount: true,
      leaveApproval: true,
      advancedScheduling: true,
      excelExport: true,
      advancedReport: true,
      apiIntegration: false,
      fullAuditLog: false,
    },
    pricePerMonth: 5_000_000,
    isDefault: false,
    sortOrder: 2,
  },
  {
    code: 'MAX',
    name: 'Max',
    description: 'Không giới hạn quy mô, tích hợp API và audit log đầy đủ.',
    maxEmployees: null,
    maxBranches: null,
    maxDepartments: null,
    maxShifts: null,
    maxAdminAccounts: null,
    maxRecognitionsPerMonth: null,
    storageGb: 500,
    photoRetentionDays: 365,
    dataRetentionDays: 1825,
    features: {
      appAccount: true,
      leaveApproval: true,
      advancedScheduling: true,
      excelExport: true,
      advancedReport: true,
      apiIntegration: true,
      fullAuditLog: true,
    },
    pricePerMonth: null,
    isDefault: false,
    sortOrder: 3,
  },
] satisfies Prisma.SubscriptionPlanCreateInput[];

export const DEFAULT_AI_MODEL = {
  name: 'buffalo_l',
  version: '2.1',
  isActive: true,
  defaultMatchThreshold: 0.45,
  defaultLivenessThreshold: 0.7,
  notes:
    'Giá trị khởi điểm. PHẢI đo FAR/FRR trên dữ liệu thật của khách hàng và hiệu chỉnh lại ngưỡng TRƯỚC khi go-live.',
} satisfies Omit<Prisma.AiModelVersionCreateInput, 'deployedAt'>;

export interface ReferenceDataOptions {
  /**
   * `true` = ghi đè gói dịch vụ theo `DEFAULT_PLANS` kể cả khi đã có. Chỉ dành
   * cho seed môi trường phát triển, nơi reset về trạng thái chuẩn là điều muốn.
   */
  overwritePlans?: boolean;
}

export interface ReferenceDataResult {
  permissions: number;
  roles: number;
  /** Số gói vừa tạo/ghi đè. `0` = bảng đã có dữ liệu, không đụng tới. */
  plansWritten: number;
  aiModelCreated: boolean;
}

/** Idempotent: chạy lại bao nhiêu lần cũng cho cùng một kết quả. */
export async function syncReferenceData(
  prisma: PrismaClient,
  options: ReferenceDataOptions = {},
): Promise<ReferenceDataResult> {
  await syncPermissionCatalog(prisma);
  const plansWritten = await syncPlans(prisma, options.overwritePlans ?? false);
  const aiModelCreated = await ensureAiModel(prisma);

  return {
    permissions: ALL_PERMISSION_CODES.length,
    roles: SYSTEM_ROLE_DEFINITIONS.length,
    plansWritten,
    aiModelCreated,
  };
}

/**
 * Cùng logic với `AccessService.syncCatalog`, nhưng chạy bằng PrismaClient trần
 * để dùng được ngoài Nest (seed, lệnh chạy lúc container khởi động).
 *
 * KHÔNG xoá gì: quyền bị gỡ khỏi code mà vẫn còn dòng trong bảng chỉ là rác vô
 * hại, còn xoá nhầm là gỡ quyền của người đang dùng thật.
 */
async function syncPermissionCatalog(prisma: PrismaClient): Promise<void> {
  for (const code of ALL_PERMISSION_CODES) {
    await prisma.permission.upsert({
      where: { code },
      create: { code, module: permissionModule(code), description: PERMISSION_CATALOG[code] },
      update: { module: permissionModule(code), description: PERMISSION_CATALOG[code] },
    });
  }

  for (const definition of SYSTEM_ROLE_DEFINITIONS) {
    // `companyId = null` là vai trò dùng chung mọi tenant. Postgres coi mọi NULL
    // là khác nhau nên `@@unique([companyId, code])` KHÔNG áp cho hàng có null —
    // phải tự tra trước thay vì dựa vào upsert.
    const data = { name: definition.name, description: definition.description, isSystem: true };
    const existing = await prisma.role.findFirst({
      where: { companyId: null, code: definition.code },
    });
    const role = existing
      ? await prisma.role.update({ where: { id: existing.id }, data: { ...data, deletedAt: null } })
      : await prisma.role.create({ data: { companyId: null, code: definition.code, ...data } });

    const permissions = await prisma.permission.findMany({
      where: { code: { in: definition.permissions } },
      select: { id: true },
    });
    // Xoá rồi ghi lại trong MỘT giao dịch: lệnh này chạy lúc khởi động khi
    // worker vẫn đang phục vụ, không được để lộ ra khoảnh khắc vai trò rỗng quyền.
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: role.id } }),
      ...(permissions.length > 0
        ? [
            prisma.rolePermission.createMany({
              data: permissions.map((permission) => ({
                roleId: role.id,
                permissionId: permission.id,
              })),
            }),
          ]
        : []),
    ]);
  }
}

async function syncPlans(prisma: PrismaClient, overwrite: boolean): Promise<number> {
  if (overwrite) {
    for (const plan of DEFAULT_PLANS) {
      await prisma.subscriptionPlan.upsert({
        where: { code: plan.code },
        create: plan,
        update: plan,
      });
    }
    return DEFAULT_PLANS.length;
  }

  // Chỉ lần cài đặt đầu tiên. Tạo bù từng gói còn thiếu thì một gói quản trị
  // viên đã chủ động xoá sẽ sống lại sau mỗi lần deploy.
  if ((await prisma.subscriptionPlan.count()) > 0) return 0;
  await prisma.subscriptionPlan.createMany({ data: DEFAULT_PLANS });
  return DEFAULT_PLANS.length;
}

async function ensureAiModel(prisma: PrismaClient): Promise<boolean> {
  if ((await prisma.aiModelVersion.count()) > 0) return false;
  await prisma.aiModelVersion.create({ data: { ...DEFAULT_AI_MODEL, deployedAt: new Date() } });
  return true;
}
