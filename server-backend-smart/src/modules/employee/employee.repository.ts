import { Injectable } from '@nestjs/common';
import { Employee, EmployeeStatus, Prisma, SystemRole } from '@prisma/client';
import { withDescendantDepartments } from 'src/common/utils';
import { BaseRepository } from 'src/infra/prisma/base.repository';
import { PrismaService } from 'src/infra/prisma/prisma.service';

export type EmployeeListItem = Prisma.EmployeeGetPayload<{
  include: {
    department: { select: { id: true; name: true } };
    branch: { select: { id: true; name: true } };
    _count: { select: { faceProfiles: true; biometricKeys: true } };
  };
}>;

export type EmployeeDetail = Prisma.EmployeeGetPayload<{
  include: {
    department: { select: { id: true; name: true } };
    branch: { select: { id: true; name: true } };
    user: { select: { id: true; phone: true; lastLoginAt: true; isBlocked: true } };
    faceProfiles: {
      select: {
        id: true;
        angle: true;
        modelVersion: true;
        enrolledAt: true;
        qualityScore: true;
      };
    };
    biometricKeys: { select: { id: true; deviceId: true; algorithm: true; createdAt: true } };
  };
}>;

/**
 * Thiết bị hiển thị cho HR — đã lược bỏ `deviceSecretHash` và `pushToken`.
 * Hai trường đó không phục vụ việc quản lý, mà lộ ra thì đủ để giả mạo request.
 */
export interface DeviceBindingView {
  id: string;
  deviceId: string;
  deviceModel: string | null;
  osName: string | null;
  osVersion: string | null;
  appVersion: string | null;
  isRooted: boolean;
  isActive: boolean;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
  revokedReason: string | null;
  createdAt: Date;
}

export interface EmployeeSearchFilter {
  /** Một hoặc nhiều trạng thái. Bỏ trống = mọi trạng thái chưa xoá mềm. */
  status?: EmployeeStatus[];
  /** Phòng ban đã chọn kèm cấp dưới — service gọi `expandDepartmentIds` trước. */
  departmentIds?: string[];
  branchId?: string;
  /** Phạm vi phòng ban của MANAGER — do guard áp, không lấy từ query. */
  departmentScope: string[] | null;
  q?: string;
  skip: number;
  take: number;
}

export interface CreateEmployeeData {
  userId: string;
  employeeCode: string;
  fullName: string;
  phone: string;
  email?: string | null;
  departmentId?: string | null;
  branchId?: string | null;
  position?: string | null;
  contractType?: string | null;
  joinedAt: Date;
  status: EmployeeStatus;
  roles: SystemRole[];
  managedDepartmentIds?: string[];
}

export interface UpdateEmployeeData {
  fullName?: string;
  employeeCode?: string;
  email?: string;
  departmentId?: string;
  branchId?: string;
  position?: string;
  contractType?: string;
  joinedAt?: Date;
  roles?: SystemRole[];
  managedDepartmentIds?: string[];
}

export interface CreateUserAccountData {
  email: string;
  phone: string;
  fullName: string;
  firebaseUid: string;
}

/**
 * Truy cập dữ liệu nhân sự: `employee`, `user_account` (phần cấp tài khoản),
 * `department`, cùng các thao tác vô hiệu sinh trắc học khi chấm dứt hợp đồng.
 *
 * Mọi phương thức nhận `companyId` đầu tiên. Riêng `update`/`softDelete` dùng
 * `updateMany` thay vì `update({ where: { id } })`: `where` của `update` chỉ nhận
 * khoá duy nhất nên không nhét được `companyId` vào, và một `employeeId` đoán
 * đúng sẽ sửa được hồ sơ của công ty khác (BR-09).
 */
@Injectable()
export class EmployeeRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  // ===========================================================================
  //  Đọc
  // ===========================================================================

  async search(
    companyId: string,
    filter: EmployeeSearchFilter,
  ): Promise<{ items: EmployeeListItem[]; total: number }> {
    const where: Prisma.EmployeeWhereInput = { companyId, deletedAt: null };

    // Mảng rỗng KHÔNG được rơi vào `in: []` — Prisma dịch thành 0 dòng, tức là
    // gửi `?status=` (rỗng) sẽ trả về danh sách trắng thay vì bỏ qua bộ lọc.
    if (filter.status?.length) where.status = { in: filter.status };
    if (filter.branchId) where.branchId = filter.branchId;

    // Phạm vi của MANAGER thu hẹp, không mở rộng. GIAO hai tập chứ không ghi đè:
    // ghi đè thì một MANAGER lọc theo đúng một phòng trong quyền của mình vẫn
    // nhận về cả phạm vi, tức là bộ lọc họ vừa chọn im lặng không có tác dụng.
    const picked = filter.departmentIds?.length ? filter.departmentIds : null;
    if (picked && filter.departmentScope) {
      where.departmentId = { in: picked.filter((id) => filter.departmentScope?.includes(id)) };
    } else if (picked) {
      where.departmentId = { in: picked };
    } else if (filter.departmentScope) {
      where.departmentId = { in: filter.departmentScope };
    }
    if (filter.q) {
      where.OR = [
        { fullName: { contains: filter.q, mode: 'insensitive' } },
        { employeeCode: { contains: filter.q, mode: 'insensitive' } },
        { phone: { contains: filter.q } },
        { email: { contains: filter.q, mode: 'insensitive' } },
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
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.employee.count({ where }),
    ]);

    return { items, total };
  }

  async findById(companyId: string, employeeId: string): Promise<Employee | null> {
    return this.db().employee.findFirst({
      where: { id: employeeId, companyId, deletedAt: null },
    });
  }

  async findDetail(companyId: string, employeeId: string): Promise<EmployeeDetail | null> {
    return this.db().employee.findFirst({
      where: { id: employeeId, companyId, deletedAt: null },
      include: {
        department: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        user: { select: { id: true, phone: true, lastLoginAt: true, isBlocked: true } },
        faceProfiles: {
          where: { status: 'ACTIVE' },
          select: {
            id: true,
            angle: true,
            modelVersion: true,
            enrolledAt: true,
            qualityScore: true,
          },
        },
        biometricKeys: {
          where: { revokedAt: null },
          select: { id: true, deviceId: true, algorithm: true, createdAt: true },
        },
      },
    });
  }

  async findByPhone(companyId: string, phone: string): Promise<Employee | null> {
    return this.db().employee.findFirst({ where: { companyId, phone, deletedAt: null } });
  }

  async findByCode(
    companyId: string,
    employeeCode: string,
    excludeEmployeeId?: string,
  ): Promise<Employee | null> {
    return this.db().employee.findFirst({
      where: {
        companyId,
        employeeCode,
        ...(excludeEmployeeId ? { id: { not: excludeEmployeeId } } : {}),
      },
    });
  }

  async findWithCompanyName(companyId: string, employeeId: string) {
    return this.db().employee.findFirst({
      where: { id: employeeId, companyId, deletedAt: null },
      include: { company: { select: { name: true } } },
    });
  }

  /**
   * Toàn bộ mã nhân viên của công ty — kể cả hồ sơ đã xoá mềm.
   *
   * Cố ý KHÔNG lọc `deletedAt`: mã đã cấp cho một hồ sơ xoá mềm vẫn nằm trong
   * ràng buộc UNIQUE, cấp lại là va lỗi lúc ghi.
   */
  async findAllEmployeeCodes(companyId: string): Promise<string[]> {
    const rows = await this.db().employee.findMany({
      where: { companyId },
      select: { employeeCode: true },
    });
    return rows.map((row) => row.employeeCode);
  }

  async findCodesAndPhones(
    companyId: string,
  ): Promise<Array<{ employeeCode: string; phone: string }>> {
    return this.db().employee.findMany({
      where: { companyId, deletedAt: null },
      select: { employeeCode: true, phone: true },
    });
  }

  async countActive(companyId: string): Promise<number> {
    return this.db().employee.count({ where: { companyId, deletedAt: null } });
  }

  // ===========================================================================
  //  Công ty & phòng ban (ngữ cảnh của thao tác nhân sự)
  // ===========================================================================

  async findCompanyProfile(companyId: string) {
    return this.db().company.findUniqueOrThrow({
      where: { id: companyId },
      select: { id: true, code: true, name: true, domain: true, timezone: true },
    });
  }

  /** FR-ADM-TEN-04 — giới hạn gói phải enforce ở Backend, không chỉ ẩn nút ở UI. */
  async findPlanLimits(companyId: string): Promise<{ maxEmployees: number | null } | null> {
    const company = await this.db().company.findUnique({
      where: { id: companyId },
      include: { plan: true },
    });
    if (!company?.plan) return null;
    return { maxEmployees: company.plan.maxEmployees };
  }

  async findDepartments(companyId: string): Promise<Array<{ id: string; name: string }>> {
    return this.db().department.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true, name: true },
    });
  }

  /** Phòng ban đã chọn kèm toàn bộ cấp dưới — xem `withDescendantDepartments`. */
  async expandDepartmentIds(companyId: string, departmentIds: string[]): Promise<string[]> {
    if (departmentIds.length === 0) return [];

    const all = await this.db().department.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true, parentId: true },
    });
    return withDescendantDepartments(all, departmentIds);
  }

  // ===========================================================================
  //  Ghi
  // ===========================================================================

  async create(
    companyId: string,
    data: CreateEmployeeData,
    tx?: Prisma.TransactionClient,
  ): Promise<Employee> {
    return this.db(tx).employee.create({ data: { companyId, ...data } });
  }

  async update(
    companyId: string,
    employeeId: string,
    data: UpdateEmployeeData,
    tx?: Prisma.TransactionClient,
  ): Promise<Employee | null> {
    const updated = await this.db(tx).employee.updateMany({
      where: { id: employeeId, companyId, deletedAt: null },
      data,
    });
    if (updated.count === 0) return null;
    return this.findById(companyId, employeeId);
  }

  async updateStatus(
    companyId: string,
    employeeId: string,
    data: { status: EmployeeStatus; terminatedAt?: Date },
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await this.db(tx).employee.updateMany({
      where: { id: employeeId, companyId, deletedAt: null },
      data,
    });
    return result.count;
  }

  /** D4 — soft delete, giữ dấu vết cho kiểm toán. */
  async softDelete(companyId: string, employeeId: string, deletedAt: Date): Promise<number> {
    const result = await this.db().employee.updateMany({
      where: { id: employeeId, companyId, deletedAt: null },
      data: { deletedAt },
    });
    return result.count;
  }

  // ===========================================================================
  //  Tài khoản đăng nhập
  // ===========================================================================

  async isEmailTaken(companyId: string, email: string): Promise<boolean> {
    const account = await this.db().userAccount.findUnique({
      where: { companyId_email: { companyId, email } },
      select: { id: true },
    });
    return account !== null;
  }

  async createUserAccount(
    companyId: string,
    data: CreateUserAccountData,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string }> {
    return this.db(tx).userAccount.create({
      data: { companyId, ...data, mustChangePassword: true },
      select: { id: true },
    });
  }

  async findFirebaseUid(companyId: string, userId: string): Promise<string | null> {
    const account = await this.db().userAccount.findFirst({
      where: { id: userId, companyId },
      select: { firebaseUid: true },
    });
    return account?.firebaseUid ?? null;
  }

  // ===========================================================================
  //  Thiết bị liên kết (FR-WEB-INV-06, BR-11)
  // ===========================================================================

  /**
   * Thiết bị đã liên kết với một tài khoản.
   *
   * KHÔNG lọc `isActive`: màn hình quản lý thiết bị cần thấy cả liên kết đã thu
   * hồi. "Máy cũ bị thu hồi lúc 14:03 ngày 12/08" là dữ kiện quan trọng khi điều
   * tra nghi vấn chấm công hộ — ẩn đi thì lịch sử chỉ còn một dòng và không giải
   * thích được vì sao hôm đó có hai thiết bị.
   *
   * `deviceSecretHash` và `pushToken` KHÔNG nằm trong `select`: một cái là bí mật
   * ký HMAC (AF-12), một cái gửi được thông báo tới máy nhân viên.
   */
  async listDeviceBindings(companyId: string, userId: string): Promise<DeviceBindingView[]> {
    return this.db().deviceBinding.findMany({
      where: { userId, companyId },
      select: {
        id: true,
        deviceId: true,
        deviceModel: true,
        osName: true,
        osVersion: true,
        appVersion: true,
        isRooted: true,
        isActive: true,
        lastSeenAt: true,
        revokedAt: true,
        revokedReason: true,
        createdAt: true,
      },
      orderBy: [{ isActive: 'desc' }, { lastSeenAt: 'desc' }],
    });
  }

  async revokeDeviceBinding(
    companyId: string,
    userId: string,
    bindingId: string,
    revokedBy: string,
    reason: string,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    // `userId` trong `where` chứ không chỉ `bindingId`: id đoán đúng mà thiếu chốt
    // này sẽ thu hồi được thiết bị của người khác trong cùng công ty.
    const result = await this.db(tx).deviceBinding.updateMany({
      where: { id: bindingId, userId, companyId, isActive: true },
      data: { isActive: false, revokedAt: new Date(), revokedBy, revokedReason: reason },
    });
    return result.count;
  }

  // ===========================================================================
  //  Chấm dứt hợp đồng — vô hiệu mọi phương thức truy cập
  // ===========================================================================

  async revokeFaceProfiles(
    companyId: string,
    employeeId: string,
    revokedBy: string,
    tx?: Prisma.TransactionClient,
    revokedReason = 'EMPLOYEE_TERMINATED',
  ): Promise<number> {
    const result = await this.db(tx).faceProfile.updateMany({
      where: { companyId, employeeId, status: 'ACTIVE' },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
        revokedBy,
        revokedReason,
      },
    });
    return result.count;
  }

  async revokeBiometricKeys(
    companyId: string,
    employeeId: string,
    tx?: Prisma.TransactionClient,
    revokedReason = 'EMPLOYEE_TERMINATED',
  ): Promise<number> {
    const result = await this.db(tx).biometricKey.updateMany({
      where: { companyId, employeeId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason },
    });
    return result.count;
  }

  async revokeDeviceBindings(
    companyId: string,
    userId: string,
    revokedBy: string,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await this.db(tx).deviceBinding.updateMany({
      where: { userId, companyId, isActive: true },
      data: {
        isActive: false,
        revokedAt: new Date(),
        revokedBy,
        revokedReason: 'EMPLOYEE_TERMINATED',
      },
    });
    return result.count;
  }

  /**
   * Xoá HẲN embedding khi chính sách công ty yêu cầu.
   *
   * Chỉ đụng `face_profile`. Bản ghi chấm công là chứng từ lao động, giữ vĩnh
   * viễn và bất biến (BR-06, NFR-LEGAL-08).
   */
  async deleteFaceProfiles(companyId: string, employeeId: string): Promise<number> {
    const result = await this.db().faceProfile.deleteMany({ where: { companyId, employeeId } });
    return result.count;
  }
}
