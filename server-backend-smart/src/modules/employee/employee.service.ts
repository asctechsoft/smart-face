import { Injectable, Logger } from '@nestjs/common';
import { EmployeeStatus, Prisma, SystemRole } from '@prisma/client';
import { PaginatedResult } from 'src/common/dto';
import { AppException } from 'src/common/errors';
import {
  buildUniqueEmployeeCode,
  buildEmployeeCode,
  isValidEmployeeCode,
  isValidVietnamesePhone,
  normalizePhone,
  buildMeta,
} from 'src/common/utils';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { JOBS } from 'src/infra/queue/queue.constants';
import { AuditService } from '../audit/audit.service';
import { NotificationService } from '../notification/notification.service';
import { PasswordService } from '../auth/password.service';
import { TokenService } from '../auth/token.service';
import { PolicyKeys } from '../policy/policy.constants';
import { PolicyService } from '../policy/policy.service';
import type {
  CreateEmployeeDto,
  EmployeeQueryDto,
  ImportRowDto,
  UpdateEmployeeDto,
} from './dto/employee.dto';
import type { TenantContext } from 'src/common/types/request-context';

export interface ImportRowResult {
  row: number;
  fullName: string;
  phone: string;
  generatedCode: string | null;
  valid: boolean;
  errors: Array<{ field: string; code: string; message: string }>;
}

/**
 * Quản lý nhân sự (FR-WEB-HR).
 *
 * Vòng đời: PENDING_ACTIVATION → ACTIVE → SUSPENDED / TERMINATED (docs/04 mục 8.3).
 * Chỉ hồ sơ PENDING_ACTIVATION mới xoá được; hồ sơ đã kích hoạt chỉ tạm ngưng/chấm dứt.
 */
@Injectable()
export class EmployeeService {
  private readonly logger = new Logger(EmployeeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
    private readonly tokens: TokenService,
    private readonly passwords: PasswordService,
  ) {}

  // ===========================================================================
  //  Đọc
  // ===========================================================================

  async list(companyId: string, query: EmployeeQueryDto, departmentScope: string[] | null) {
    const where: Prisma.EmployeeWhereInput = { companyId, deletedAt: null };

    if (query.status) where.status = query.status;
    if (query.departmentId) where.departmentId = query.departmentId;
    if (query.branchId) where.branchId = query.branchId;
    if (departmentScope) where.departmentId = { in: departmentScope };
    if (query.q) {
      where.OR = [
        { fullName: { contains: query.q, mode: 'insensitive' } },
        { employeeCode: { contains: query.q, mode: 'insensitive' } },
        { phone: { contains: query.q } },
        { email: { contains: query.q, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.employee.findMany({
        where,
        include: {
          department: { select: { id: true, name: true } },
          branch: { select: { id: true, name: true } },
          _count: { select: { faceProfiles: true, biometricKeys: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.employee.count({ where }),
    ]);

    return new PaginatedResult(items, buildMeta(query.page, query.pageSize, total));
  }

  async getById(companyId: string, employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId, deletedAt: null },
      include: {
        department: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        user: { select: { id: true, phone: true, lastLoginAt: true, isBlocked: true } },
        faceProfiles: {
          where: { status: 'ACTIVE' },
          select: { id: true, angle: true, modelVersion: true, enrolledAt: true, qualityScore: true },
        },
        biometricKeys: {
          where: { revokedAt: null },
          select: { id: true, deviceId: true, algorithm: true, createdAt: true },
        },
      },
    });
    if (!employee) {
      throw new AppException('EMP_NOT_FOUND');
    }
    return employee;
  }

  /** Hồ sơ cá nhân của chính nhân viên (FR-APP-PRO-01). */
  async getMyProfile(companyId: string, employeeId: string) {
    const employee = await this.getById(companyId, employeeId);
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, name: true, code: true, timezone: true },
    });
    return { ...employee, company };
  }

  // ===========================================================================
  //  Sinh mã nhân viên (docs/01 mục 8)
  // ===========================================================================

  /** FR-WEB-HR-06 — xem trước mã sinh ra, HR sửa được trước khi lưu. */
  async previewCode(companyId: string, fullName: string) {
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { code: true },
    });

    const base = buildEmployeeCode(fullName, company.code);
    const unique = await this.generateUniqueCode(companyId, company.code, fullName);

    // Trả cả `base` lẫn `unique` để HR hiểu chuyện gì đang xảy ra: `isAvailable:
    // false` nghĩa là công ty đã có người trùng tên, nên mã được thêm số thứ tự.
    // Chỉ trả mỗi `ducnv2.amobi` thì HR tưởng hệ thống lỗi và gõ đè thành
    // `ducnv.amobi`, rồi nhận lỗi trùng mã lúc lưu mà không hiểu vì sao.
    return {
      employeeCode: unique,
      baseCode: base,
      isAvailable: base === unique,
      companyCode: company.code,
    };
  }

  /**
   * Sinh mã nhân viên chưa bị dùng: `ducnv.amobi`, trùng thì `ducnv2.amobi`…
   *
   * `extraTaken` phục vụ nhập Excel hàng loạt. Các mã trong cùng một lô CHƯA nằm
   * trong database khi đang xử lý dòng thứ hai, nên hai người trùng tên trong
   * cùng file sẽ nhận cùng một mã và va nhau ở ràng buộc UNIQUE. Tham số này
   * mang theo các mã vừa cấp trong lô để tránh đúng tình huống đó.
   *
   * ⚠ Đọc TOÀN BỘ mã của công ty vào bộ nhớ. Chấp nhận được ở quy mô vài nghìn
   * nhân viên và thao tác này hiếm khi chạy, nhưng nếu có khách hàng chục nghìn
   * người thì đây là chỗ cần đổi sang truy vấn theo tiền tố.
   *
   * ⚠ Có khe hở tranh chấp: hai HR tạo nhân viên cùng lúc có thể cùng đọc ra một
   * mã trống. Ràng buộc UNIQUE ở database là chốt cuối — bắt lỗi đó và thử lại,
   * đừng coi hàm này là bảo đảm duy nhất.
   */
  private async generateUniqueCode(
    companyId: string,
    companyCode: string,
    fullName: string,
    extraTaken: ReadonlySet<string> = new Set(),
  ): Promise<string> {
    const existing = await this.prisma.employee.findMany({
      where: { companyId },
      select: { employeeCode: true },
    });
    const taken = new Set([...existing.map((row) => row.employeeCode), ...extraTaken]);
    return buildUniqueEmployeeCode(fullName, companyCode, taken);
  }

  /**
   * Cấp tài khoản đăng nhập cho nhân viên mới.
   *
   * Trả về mật khẩu tạm ở dạng gốc để HR đọc lại cho nhân viên — **một lần
   * duy nhất**. Server chỉ lưu bản băm nên không xem lại được; muốn cấp lại
   * phải đặt lại mật khẩu.
   *
   * Tài khoản bắt đầu với `mustChangePassword = true`, và `PasswordChangeGuard`
   * chặn mọi API khác cho tới khi nhân viên đổi mật khẩu. Mật khẩu tạm đi qua
   * nhiều tay — HR đọc qua điện thoại, ghi ra giấy — nên nó chỉ nên đủ để đổi
   * sang mật khẩu thật, không mở được gì khác.
   */
  private async provisionAccount(
    companyId: string,
    input: { email?: string | null; fullName: string; phone: string },
  ): Promise<{ userId: string; email: string; temporaryPassword: string }> {
    const email = input.email?.trim().toLowerCase();
    if (!email) {
      throw new AppException('SYS_VALIDATION_ERROR', {
        reason: 'Thiếu email — nhân viên đăng nhập bằng tên miền + email + mật khẩu.',
      });
    }

    const taken = await this.prisma.userAccount.findUnique({
      where: { companyId_email: { companyId, email } },
      select: { id: true },
    });
    if (taken) {
      throw new AppException('EMP_EMAIL_TAKEN', { email });
    }

    const temporaryPassword = this.passwords.generateTemporary();
    const account = await this.prisma.userAccount.create({
      data: {
        companyId,
        email,
        phone: input.phone,
        fullName: input.fullName,
        passwordHash: await this.passwords.hash(temporaryPassword),
        mustChangePassword: true,
      },
      select: { id: true },
    });

    return { userId: account.id, email, temporaryPassword };
  }

  // ===========================================================================
  //  Tạo & sửa (Luồng B)
  // ===========================================================================

  async create(ctx: TenantContext, dto: CreateEmployeeDto) {
    const companyId = ctx.companyId;
    const phone = normalizePhone(dto.phone);

    if (!isValidVietnamesePhone(phone)) {
      throw new AppException('AUTH_PHONE_INVALID', { phone: dto.phone });
    }

    const duplicate = await this.prisma.employee.findFirst({
      where: { companyId, phone, deletedAt: null },
    });
    if (duplicate) {
      throw new AppException('EMP_PHONE_TAKEN', { existingEmployeeCode: duplicate.employeeCode });
    }

    // FR-ADM-TEN-04: giới hạn gói enforce ở Backend.
    await this.assertEmployeeQuota(companyId);

    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { code: true, name: true, domain: true },
    });
    const companyDomain = company.domain;

    let employeeCode = dto.employeeCode?.trim().toLowerCase();
    if (employeeCode) {
      if (!isValidEmployeeCode(employeeCode)) {
        throw new AppException('SYS_VALIDATION_ERROR', {
          reason: 'Mã nhân viên chỉ gồm chữ thường/số và một dấu chấm, VD: ducnv.amobi',
        });
      }
      const taken = await this.prisma.employee.findFirst({
        where: { companyId, employeeCode },
      });
      if (taken) {
        throw new AppException('EMP_CODE_TAKEN', { employeeCode });
      }
    } else {
      employeeCode = await this.generateUniqueCode(companyId, company.code, dto.fullName);
    }

    // Cấp tài khoản đăng nhập cùng lúc với hồ sơ nhân viên.
    //
    // Tài khoản gắn với ĐÚNG MỘT công ty, nên dù người này đã làm ở công ty
    // khác trên nền tảng thì đây vẫn là một tài khoản hoàn toàn mới, mật khẩu
    // riêng. Công ty A không biết gì về việc họ còn làm ở đâu.
    const account = await this.provisionAccount(companyId, {
      email: dto.email,
      fullName: dto.fullName,
      phone,
    });

    const employee = await this.prisma.employee.create({
      data: {
        companyId,
        userId: account.userId,
        employeeCode,
        fullName: dto.fullName,
        phone,
        email: dto.email,
        departmentId: dto.departmentId,
        branchId: dto.branchId,
        position: dto.position,
        contractType: dto.contractType,
        joinedAt: dto.joinedAt ? new Date(dto.joinedAt) : new Date(),
        status: EmployeeStatus.PENDING_ACTIVATION,
        roles: dto.roles?.length ? dto.roles : [SystemRole.EMPLOYEE],
        managedDepartmentIds: dto.managedDepartmentIds ?? [],
      },
    });

    if (dto.sendInvite !== false) {
      await this.sendInviteSms(phone, company.name, employeeCode);
    }

    await this.audit.record(ctx, {
      action: 'EMPLOYEE_CREATE',
      targetType: 'EMPLOYEE',
      targetId: employee.id,
      // ⚠ KHÔNG ghi mật khẩu tạm vào audit log (NFR-OBS-08). Audit log được
      // giữ nhiều năm và nhiều người đọc được.
      after: { employeeCode, fullName: dto.fullName, phone, email: account.email },
    });

    return {
      ...employee,
      account: {
        email: account.email,
        // Hiển thị MỘT LẦN cho HR đọc lại cho nhân viên. Server chỉ lưu bản băm
        // nên không xem lại được; muốn cấp lại phải đặt lại mật khẩu.
        temporaryPassword: account.temporaryPassword,
        loginDomain: companyDomain,
      },
    };
  }

  async update(ctx: TenantContext, employeeId: string, dto: UpdateEmployeeDto) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId: ctx.companyId, deletedAt: null },
    });
    if (!employee) {
      throw new AppException('EMP_NOT_FOUND');
    }

    // BR-04: mã nhân viên BẤT BIẾN sau khi đã dùng chấm công.
    if (dto.employeeCode && dto.employeeCode !== employee.employeeCode) {
      if (employee.codeLocked) {
        throw new AppException('EMP_CODE_LOCKED', { employeeCode: employee.employeeCode });
      }
      if (!isValidEmployeeCode(dto.employeeCode)) {
        throw new AppException('SYS_VALIDATION_ERROR', { reason: 'Mã nhân viên không hợp lệ.' });
      }
      const taken = await this.prisma.employee.findFirst({
        where: { companyId: ctx.companyId, employeeCode: dto.employeeCode, id: { not: employeeId } },
      });
      if (taken) {
        throw new AppException('EMP_CODE_TAKEN');
      }
    }

    const updated = await this.prisma.employee.update({
      where: { id: employeeId },
      data: {
        fullName: dto.fullName,
        employeeCode: dto.employeeCode,
        email: dto.email,
        departmentId: dto.departmentId,
        branchId: dto.branchId,
        position: dto.position,
        contractType: dto.contractType,
        joinedAt: dto.joinedAt ? new Date(dto.joinedAt) : undefined,
        roles: dto.roles,
        managedDepartmentIds: dto.managedDepartmentIds,
      },
    });

    await this.audit.record(ctx, {
      action: 'EMPLOYEE_UPDATE',
      targetType: 'EMPLOYEE',
      targetId: employeeId,
      before: {
        fullName: employee.fullName,
        employeeCode: employee.employeeCode,
        departmentId: employee.departmentId,
        roles: employee.roles,
      },
      after: {
        fullName: updated.fullName,
        employeeCode: updated.employeeCode,
        departmentId: updated.departmentId,
        roles: updated.roles,
      },
    });

    return updated;
  }

  /** FR-WEB-HR-09 — chỉ xoá được hồ sơ chưa kích hoạt. */
  async remove(ctx: TenantContext, employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId: ctx.companyId, deletedAt: null },
    });
    if (!employee) {
      throw new AppException('EMP_NOT_FOUND');
    }
    if (employee.status !== EmployeeStatus.PENDING_ACTIVATION) {
      throw new AppException('EMP_DELETE_NOT_ALLOWED', { status: employee.status });
    }

    // D4: soft delete, giữ dấu vết cho kiểm toán.
    await this.prisma.employee.update({
      where: { id: employeeId },
      data: { deletedAt: new Date() },
    });

    await this.audit.record(ctx, {
      action: 'EMPLOYEE_DELETE',
      targetType: 'EMPLOYEE',
      targetId: employeeId,
      before: { employeeCode: employee.employeeCode, status: employee.status },
    });

    return { deleted: true };
  }

  async resendInvite(ctx: TenantContext, employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId: ctx.companyId, deletedAt: null },
      include: { company: { select: { name: true } } },
    });
    if (!employee) {
      throw new AppException('EMP_NOT_FOUND');
    }

    await this.sendInviteSms(employee.phone, employee.company.name, employee.employeeCode);
    return { sent: true };
  }

  // ===========================================================================
  //  Vòng đời (FR-WEB-HR-11, FR-WEB-HR-12)
  // ===========================================================================

  async suspend(ctx: TenantContext, employeeId: string, reason: string) {
    const employee = await this.requireEmployee(ctx.companyId, employeeId);

    await this.prisma.employee.update({
      where: { id: employeeId },
      data: { status: EmployeeStatus.SUSPENDED },
    });

    // Tạm ngưng → thu hồi phiên ngay, không cho đăng nhập/chấm công.
    if (employee.userId) {
      await this.tokens.revokeAllForUser(employee.userId, 'EMPLOYEE_SUSPENDED');
    }

    await this.audit.record(ctx, {
      action: 'EMPLOYEE_SUSPEND',
      targetType: 'EMPLOYEE',
      targetId: employeeId,
      reason,
      before: { status: employee.status },
      after: { status: EmployeeStatus.SUSPENDED },
    });

    await this.notifications.notify({
      companyId: ctx.companyId,
      employeeId,
      type: 'ACCOUNT_SUSPENDED',
      title: 'Tài khoản của bạn đã bị tạm ngưng',
      body: `Lý do: ${reason}. Liên hệ bộ phận nhân sự để được hỗ trợ.`,
    });

    return { status: EmployeeStatus.SUSPENDED };
  }

  async reactivate(ctx: TenantContext, employeeId: string, reason: string) {
    const employee = await this.requireEmployee(ctx.companyId, employeeId);
    if (employee.status === EmployeeStatus.TERMINATED) {
      throw new AppException('SYS_VALIDATION_ERROR', {
        reason: 'Hồ sơ đã chấm dứt hợp đồng thì không quay lại được (docs/04 mục 8.3).',
      });
    }

    await this.prisma.employee.update({
      where: { id: employeeId },
      data: { status: EmployeeStatus.ACTIVE },
    });

    await this.audit.record(ctx, {
      action: 'EMPLOYEE_REACTIVATE',
      targetType: 'EMPLOYEE',
      targetId: employeeId,
      reason,
      before: { status: employee.status },
      after: { status: EmployeeStatus.ACTIVE },
    });

    return { status: EmployeeStatus.ACTIVE };
  }

  /**
   * Chấm dứt hợp đồng (docs/04 mục 8.3).
   *
   *   1. Thu hồi toàn bộ token, vô hiệu refresh token
   *   2. Vô hiệu device binding
   *   3. Xoá/khoá dữ liệu sinh trắc học theo chính sách công ty
   *   4. GIỮ bản ghi chấm công và bảng công đã chốt (nghĩa vụ lưu trữ chứng từ)
   *   5. Ghi audit log
   */
  async terminate(ctx: TenantContext, employeeId: string, reason: string, effectiveDate?: string) {
    const employee = await this.requireEmployee(ctx.companyId, employeeId);
    const terminatedAt = effectiveDate ? new Date(effectiveDate) : new Date();

    const deleteBiometricNow = await this.policy.getBoolean(
      ctx.companyId,
      PolicyKeys.BIOMETRIC_DELETE_ON_TERMINATE,
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.employee.update({
        where: { id: employeeId },
        data: { status: EmployeeStatus.TERMINATED, terminatedAt },
      });

      // Luôn VÔ HIỆU dữ liệu sinh trắc học ngay; việc XOÁ hẳn theo chính sách.
      await tx.faceProfile.updateMany({
        where: { employeeId, status: 'ACTIVE' },
        data: {
          status: 'REVOKED',
          revokedAt: new Date(),
          revokedBy: ctx.userId,
          revokedReason: 'EMPLOYEE_TERMINATED',
        },
      });
      await tx.biometricKey.updateMany({
        where: { employeeId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'EMPLOYEE_TERMINATED' },
      });

      if (employee.userId) {
        await tx.deviceBinding.updateMany({
          where: { userId: employee.userId, companyId: ctx.companyId, isActive: true },
          data: {
            isActive: false,
            revokedAt: new Date(),
            revokedBy: ctx.userId,
            revokedReason: 'EMPLOYEE_TERMINATED',
          },
        });
      }
    });

    if (employee.userId) {
      await this.tokens.revokeAllForUser(employee.userId, 'EMPLOYEE_TERMINATED');
    }

    if (deleteBiometricNow) {
      const deleted = await this.prisma.faceProfile.deleteMany({ where: { employeeId } });
      this.logger.log(
        `Đã xoá ${deleted.count} embedding của nhân viên ${employeeId} theo chính sách công ty`,
      );
    }

    await this.audit.record(ctx, {
      action: 'EMPLOYEE_TERMINATE',
      targetType: 'EMPLOYEE',
      targetId: employeeId,
      reason,
      before: { status: employee.status },
      after: {
        status: EmployeeStatus.TERMINATED,
        terminatedAt: terminatedAt.toISOString(),
        biometricDeleted: deleteBiometricNow,
      },
    });

    return { status: EmployeeStatus.TERMINATED, biometricDeleted: deleteBiometricNow };
  }

  // ===========================================================================
  //  Import Excel (FR-WEB-HR-10)
  // ===========================================================================

  /**
   * Validate theo TỪNG DÒNG.
   *
   * ⚠ Nguyên tắc (docs/04 mục 8.2): import KHÔNG BAO GIỜ fail toàn bộ file vì một
   * dòng lỗi. Báo lỗi theo dòng, cho phép import phần hợp lệ.
   *
   * Mã nhân viên sinh ra phải duy nhất kể cả khi hai người TRÙNG TÊN trong cùng file.
   */
  async validateImport(companyId: string, rows: ImportRowDto[]): Promise<{
    totalRows: number;
    validRows: number;
    invalidRows: number;
    rows: ImportRowResult[];
  }> {
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { code: true },
    });

    const [existingEmployees, departments] = await Promise.all([
      this.prisma.employee.findMany({
        where: { companyId, deletedAt: null },
        select: { employeeCode: true, phone: true },
      }),
      this.prisma.department.findMany({
        where: { companyId, deletedAt: null },
        select: { id: true, name: true },
      }),
    ]);

    const takenCodes = new Set(existingEmployees.map((row) => row.employeeCode));
    const existingPhones = new Set(existingEmployees.map((row) => row.phone));
    const departmentNames = new Set(departments.map((row) => row.name.toLowerCase()));
    const phonesInFile = new Set<string>();

    const results: ImportRowResult[] = rows.map((row, index) => {
      const errors: ImportRowResult['errors'] = [];
      // +2 vì dòng 1 là tiêu đề trong file Excel.
      const rowNumber = index + 2;
      const phone = normalizePhone(row.phone ?? '');

      if (!row.fullName?.trim()) {
        errors.push({ field: 'fullName', code: 'REQUIRED', message: 'Thiếu họ và tên' });
      }
      if (!phone) {
        errors.push({ field: 'phone', code: 'REQUIRED', message: 'Thiếu số điện thoại' });
      } else if (!isValidVietnamesePhone(phone)) {
        errors.push({
          field: 'phone',
          code: 'INVALID_PHONE',
          message: 'Số điện thoại không đúng định dạng',
        });
      } else if (existingPhones.has(phone)) {
        errors.push({
          field: 'phone',
          code: 'DUPLICATE_IN_COMPANY',
          message: 'Số điện thoại đã tồn tại trong công ty',
        });
      } else if (phonesInFile.has(phone)) {
        errors.push({
          field: 'phone',
          code: 'DUPLICATE_IN_FILE',
          message: 'Số điện thoại bị trùng trong file',
        });
      }

      if (row.departmentName && !departmentNames.has(row.departmentName.trim().toLowerCase())) {
        errors.push({
          field: 'departmentName',
          code: 'DEPARTMENT_NOT_FOUND',
          message: `Phòng ban "${row.departmentName}" không tồn tại`,
        });
      }

      const valid = errors.length === 0;
      let generatedCode: string | null = null;

      if (valid) {
        phonesInFile.add(phone);
        // Đưa mã vừa sinh vào tập đã dùng để dòng sau trùng tên nhận mã khác.
        generatedCode = buildUniqueEmployeeCode(row.fullName, company.code, takenCodes);
        takenCodes.add(generatedCode);
      }

      return {
        row: rowNumber,
        fullName: row.fullName ?? '',
        phone: row.phone ?? '',
        generatedCode,
        valid,
        errors,
      };
    });

    return {
      totalRows: results.length,
      validRows: results.filter((row) => row.valid).length,
      invalidRows: results.filter((row) => !row.valid).length,
      rows: results,
    };
  }

  async executeImport(ctx: TenantContext, rows: ImportRowDto[], sendInvite = true) {
    const validation = await this.validateImport(ctx.companyId, rows);
    const validRowNumbers = new Set(
      validation.rows.filter((row) => row.valid).map((row) => row.row),
    );

    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: ctx.companyId },
      select: { code: true, name: true },
    });
    const departments = await this.prisma.department.findMany({
      where: { companyId: ctx.companyId, deletedAt: null },
      select: { id: true, name: true },
    });
    const departmentByName = new Map(
      departments.map((department) => [department.name.toLowerCase(), department.id]),
    );

    const created: Array<{ row: number; employeeId: string; employeeCode: string }> = [];
    const failed: Array<{ row: number; code: string; message: string }> = [];

    for (const [index, row] of rows.entries()) {
      const rowNumber = index + 2;
      const validationRow = validation.rows[index];

      if (!validRowNumbers.has(rowNumber) || !validationRow.generatedCode) {
        failed.push({
          row: rowNumber,
          code: validationRow.errors[0]?.code ?? 'INVALID',
          message: validationRow.errors[0]?.message ?? 'Dòng không hợp lệ',
        });
        continue;
      }

      try {
        await this.assertEmployeeQuota(ctx.companyId);

        const phone = normalizePhone(row.phone);
        const account = await this.provisionAccount(ctx.companyId, {
          email: row.email,
          fullName: row.fullName.trim(),
          phone,
        });

        const employee = await this.prisma.employee.create({
          data: {
            companyId: ctx.companyId,
            userId: account.userId,
            employeeCode: validationRow.generatedCode,
            fullName: row.fullName.trim(),
            phone,
            departmentId: row.departmentName
              ? (departmentByName.get(row.departmentName.trim().toLowerCase()) ?? null)
              : null,
            position: row.position,
            contractType: row.contractType,
            joinedAt: row.joinedAt ? new Date(row.joinedAt) : new Date(),
            status: EmployeeStatus.PENDING_ACTIVATION,
            roles: [SystemRole.EMPLOYEE],
          },
        });

        created.push({
          row: rowNumber,
          employeeId: employee.id,
          employeeCode: employee.employeeCode,
        });

        if (sendInvite) {
          await this.sendInviteSms(phone, company.name, employee.employeeCode);
        }
      } catch (error) {
        failed.push({
          row: rowNumber,
          code: error instanceof AppException ? error.code : 'SYS_INTERNAL_ERROR',
          message:
            error instanceof AppException
              ? error.definition.message
              : (error as Error).message,
        });
      }
    }

    await this.audit.record(ctx, {
      action: 'EMPLOYEE_IMPORT',
      targetType: 'COMPANY',
      targetId: ctx.companyId,
      after: { createdCount: created.length, failedCount: failed.length },
    });

    return { created, failed, createdCount: created.length, failedCount: failed.length };
  }

  // ===========================================================================
  //  Helper
  // ===========================================================================

  private async assertEmployeeQuota(companyId: string): Promise<void> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: { plan: true },
    });
    const maxEmployees = company?.plan?.maxEmployees;
    if (!maxEmployees) return;

    const current = await this.prisma.employee.count({ where: { companyId, deletedAt: null } });
    if (current >= maxEmployees) {
      throw new AppException('PLAN_EMPLOYEE_LIMIT_REACHED', { current, maxEmployees });
    }
  }

  private async sendInviteSms(
    phone: string,
    companyName: string,
    employeeCode: string,
  ): Promise<void> {
    await this.notifications.queueSms(JOBS.SEND_INVITE_SMS, {
      phone,
      companyName,
      employeeCode,
    });
  }

  private async requireEmployee(companyId: string, employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId, deletedAt: null },
    });
    if (!employee) {
      throw new AppException('EMP_NOT_FOUND');
    }
    return employee;
  }
}
