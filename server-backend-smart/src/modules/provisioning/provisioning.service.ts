import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CompanyStatus, ScopeLevel, SystemRole } from '@prisma/client';
import { AppException } from 'src/common/errors';
import { buildEmployeeCode, normalizeFullName } from 'src/common/utils';
import { FirebaseService } from 'src/infra/firebase/firebase.service';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { TransactionManager } from 'src/infra/prisma/transaction.manager';
import { AccessRepository } from '../access/access.repository';
import { AccessService } from '../access/access.service';
import { SYSTEM_ROLE_CODES } from '../access/permission.constants';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import type { RequestContext } from 'src/common/types/request-context';

export interface BootstrapInput {
  fullName: string;
  email: string;
  phone: string;
  password: string;
}

export interface ProvisionTenantInput {
  /** Bước 1 — thông tin công ty */
  company: {
    name: string;
    code: string;
    domain: string;
    taxCode?: string;
    timezone?: string;
    planCode?: string;
  };
  /** Bước 2 — tài khoản Tổng giám đốc */
  director: {
    fullName: string;
    email: string;
    phone: string;
  };
}

/** Năm bước của wizard "Thiết lập ban đầu" (mockup Figma `67:75`). */
export const SETUP_STEPS = [
  'companyInfo',
  'departments',
  'shifts',
  'accountantAccount',
  'handover',
] as const;

export type SetupStep = (typeof SETUP_STEPS)[number];

/**
 * Khởi tạo nền tảng và khởi tạo tenant (docs/07 · docs/19).
 *
 * Ba mắt xích của một chuỗi:
 *
 * ```
 *  bootstrap        Quản trị nền tảng đầu tiên  (một lần duy nhất cho cả hệ thống)
 *      │
 *      ▼
 *  provisionTenant  Công ty + tài khoản Tổng giám đốc + Owner + trạng thái wizard
 *      │
 *      ▼
 *  CompanySetup     TGĐ tự chạy 5 bước rồi mời Kế toán/HR
 * ```
 */
@Injectable()
export class ProvisioningService {
  private readonly logger = new Logger(ProvisioningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionManager,
    private readonly firebase: FirebaseService,
    private readonly passwords: PasswordService,
    private readonly access: AccessService,
    private readonly accessRepo: AccessRepository,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  // ===========================================================================
  //  Khởi tạo nền tảng
  // ===========================================================================

  /**
   * Tạo quản trị viên nền tảng ĐẦU TIÊN.
   *
   * Endpoint này `@Public` — bắt buộc phải thế, vì chưa có ai để đăng nhập. Thứ
   * giữ cho nó an toàn là điều kiện dưới đây: chỉ chạy được khi hệ thống chưa có
   * bất kỳ tài khoản nền tảng nào. Sau lần gọi thành công đầu tiên, mọi lần gọi
   * sau đều trả `PLATFORM_ALREADY_BOOTSTRAPPED`.
   *
   * ⚠ Vẫn còn một cửa sổ rủi ro thật: giữa lúc deploy và lúc chủ hệ thống bấm
   * tạo, bất kỳ ai biết đường dẫn đều tạo được tài khoản đó. Cách bịt là chạy
   * bootstrap NGAY trong quy trình triển khai, trước khi mở cổng ra ngoài —
   * xem docs/22. Không có cách nào bịt bằng code mà không cần một bí mật cấp
   * sẵn, và bí mật đó thì lại phải cấp bằng quy trình triển khai.
   */
  async bootstrapPlatform(input: BootstrapInput) {
    const existing = await this.prisma.userAccount.count({ where: { companyId: null } });
    if (existing > 0) {
      throw new AppException('PLATFORM_ALREADY_BOOTSTRAPPED');
    }

    const email = input.email.trim().toLowerCase();
    this.passwords.assertStrong(input.password, { email, fullName: input.fullName });

    const firebaseUid = await this.firebase.createUser({
      email,
      password: input.password,
      displayName: input.fullName,
    });

    try {
      const account = await this.prisma.userAccount.create({
        data: {
          companyId: null,
          email,
          phone: input.phone,
          fullName: input.fullName,
          firebaseUid,
          // Người này TỰ đặt mật khẩu nên không có gì để buộc đổi.
          mustChangePassword: false,
        },
        select: { id: true, email: true, fullName: true },
      });

      await this.audit.recordSystem({
        companyId: null,
        actorName: input.fullName,
        action: 'PLATFORM_BOOTSTRAP',
        targetType: 'USER_ACCOUNT',
        targetId: account.id,
        after: { email, role: SYSTEM_ROLE_CODES.PLATFORM_ADMIN },
      });

      return {
        userId: account.id,
        email: account.email,
        fullName: account.fullName,
        // docs/07 §5: MFA bắt buộc với tài khoản nền tảng. Bật ở bước tiếp theo
        // qua `POST /v1/auth/2fa/setup`; ở đây chỉ báo cho client biết là phải làm.
        mfaRequired: true,
        loginDomain: this.config.get<string>('app.systemAdminDomain', 'system'),
      };
    } catch (error) {
      await this.firebase.deleteUser(firebaseUid).catch(() => undefined);
      throw error;
    }
  }

  // ===========================================================================
  //  Khởi tạo tenant (wizard 3 bước của Quản trị nền tảng)
  // ===========================================================================

  /**
   * Tạo công ty kèm tài khoản Tổng giám đốc trong MỘT giao dịch.
   *
   * Tách hai bước ra hai lần gọi API là để lại được trạng thái nửa vời: công ty
   * tồn tại nhưng không có ai đăng nhập được vào, và cũng không ai xoá được vì
   * xoá tenant là thao tác đặc quyền. Wizard trên giao diện có ba bước, nhưng
   * bước cuối mới là lần duy nhất chạm vào dữ liệu.
   *
   * Mật khẩu tạm trả về ĐÚNG MỘT LẦN và không lưu lại ở đâu — đúng như cảnh báo
   * trên màn hình thiết kế.
   */
  async provisionTenant(ctx: RequestContext, input: ProvisionTenantInput) {
    const code = normalizeFullName(input.company.code).replace(/\s/g, '');
    if (!code) {
      throw new AppException('SYS_VALIDATION_ERROR', { reason: 'Mã công ty không hợp lệ.' });
    }

    const domain = input.company.domain.trim().toLowerCase();
    const systemDomain = this.config.get<string>('app.systemAdminDomain', 'system');
    if (domain === systemDomain) {
      throw new AppException('TEN_DOMAIN_TAKEN', {
        domain,
        reason: 'Tên miền này dành riêng cho quản trị viên nền tảng.',
      });
    }

    const [codeTaken, domainTaken] = await Promise.all([
      this.prisma.company.findUnique({ where: { code } }),
      this.prisma.company.findUnique({ where: { domain } }),
    ]);
    if (codeTaken) throw new AppException('TEN_CODE_TAKEN', { code });
    if (domainTaken) throw new AppException('TEN_DOMAIN_TAKEN', { domain });

    const plan = await this.resolvePlan(input.company.planCode);
    const email = input.director.email.trim().toLowerCase();
    const temporaryPassword = this.passwords.generateTemporary();

    // Firebase TRƯỚC, database SAU. Email đã tồn tại ở đâu đó trong dự án thì
    // Firebase từ chối ngay và ta chưa ghi gì — thứ tự ngược lại để lại một công
    // ty có Tổng giám đốc không bao giờ đăng nhập được.
    const firebaseUid = await this.firebase.createUser({
      email,
      password: temporaryPassword,
      displayName: input.director.fullName,
    });

    try {
      const result = await this.transactions.run(async (tx) => {
        const company = await tx.company.create({
          data: {
            code,
            domain,
            name: input.company.name,
            taxCode: input.company.taxCode ?? null,
            timezone: input.company.timezone ?? 'Asia/Ho_Chi_Minh',
            planId: plan?.id ?? null,
            status: CompanyStatus.TRIAL,
            trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        });

        const account = await tx.userAccount.create({
          data: {
            companyId: company.id,
            email,
            phone: input.director.phone,
            fullName: input.director.fullName,
            firebaseUid,
            mustChangePassword: true,
          },
        });

        const employee = await tx.employee.create({
          data: {
            companyId: company.id,
            userId: account.id,
            employeeCode: buildEmployeeCode(input.director.fullName, code),
            fullName: input.director.fullName,
            phone: input.director.phone,
            email,
            position: 'Tổng giám đốc',
            status: 'PENDING_ACTIVATION',
            // Giữ vai trò cũ song song với RoleAssignment mới: token hiện tại
            // vẫn mang `roles`, và `AccessService` rơi về vai trò cũ khi chưa có
            // assignment nào. Bỏ được khi lớp tương thích ngược được gỡ.
            roles: [SystemRole.COMPANY_ADMIN],
          },
        });

        await tx.companyOwner.create({
          data: { companyId: company.id, employeeId: employee.id, grantedBy: ctx.userId },
        });

        const ownerRole = await tx.role.findFirst({
          where: { companyId: null, code: SYSTEM_ROLE_CODES.OWNER },
        });
        if (ownerRole) {
          await tx.roleAssignment.create({
            data: {
              companyId: company.id,
              employeeId: employee.id,
              roleId: ownerRole.id,
              scopeLevel: ScopeLevel.COMPANY,
              scopeIds: [],
              grantedById: employee.id,
              reason: 'Owner khởi tạo cùng tenant',
            },
          });
        } else {
          // Không chặn việc tạo tenant: công ty vẫn dùng được nhờ lớp tương thích
          // vai trò cũ. Nhưng phải kêu, vì nghĩa là danh mục vai trò chưa seed.
          this.logger.error(
            `Chưa seed vai trò hệ thống ${SYSTEM_ROLE_CODES.OWNER} — tenant ${company.code} tạo ra không có RoleAssignment.`,
          );
        }

        await tx.companySetupState.create({
          data: { companyId: company.id, steps: {}, currentStep: 1 },
        });

        return { company, account, employee };
      });

      await this.audit.record(ctx, {
        companyId: result.company.id,
        action: 'TENANT_PROVISION',
        targetType: 'COMPANY',
        targetId: result.company.id,
        after: {
          code,
          domain,
          name: input.company.name,
          planCode: plan?.code ?? null,
          directorEmail: email,
        },
      });

      return {
        company: {
          id: result.company.id,
          code: result.company.code,
          domain: result.company.domain,
          name: result.company.name,
          planCode: plan?.code ?? null,
        },
        director: {
          userId: result.account.id,
          employeeId: result.employee.id,
          employeeCode: result.employee.employeeCode,
          email,
          fullName: input.director.fullName,
        },
        /**
         * Trả về ĐÚNG MỘT LẦN. Không lưu ở đâu, không đọc lại được — mất thì
         * phải dùng luồng đặt lại mật khẩu.
         */
        temporaryPassword,
        loginUrl: `${this.config.get<string>('app.webBaseUrl', '')}/login?domain=${domain}`,
      };
    } catch (error) {
      await this.firebase.deleteUser(firebaseUid).catch(() => undefined);
      throw error;
    }
  }

  private async resolvePlan(planCode?: string) {
    if (planCode) {
      const plan = await this.prisma.subscriptionPlan.findUnique({ where: { code: planCode } });
      if (!plan || !plan.isActive) {
        throw new AppException('PLAN_NOT_FOUND', { planCode });
      }
      return plan;
    }
    return this.prisma.subscriptionPlan.findFirst({
      where: { isDefault: true, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }
}
