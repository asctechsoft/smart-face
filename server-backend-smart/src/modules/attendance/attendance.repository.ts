import { Injectable } from '@nestjs/common';
import {
  AttendanceAdjustment,
  AttendanceDaily,
  AttendanceDecision,
  AttendanceLog,
  AttendanceType,
  Branch,
  DailyStatus,
  Employee,
  ExportJob,
  FaceProfileStatus,
  PayrollPeriodStatus,
  Prisma,
} from '@prisma/client';
import { periodLockedFilter } from 'src/common/constants/payroll-period.constants';
import { BaseRepository } from 'src/infra/prisma/base.repository';
import { PrismaService } from 'src/infra/prisma/prisma.service';

/**
 * Dữ liệu ghi bản ghi thô.
 *
 * Dùng thẳng kiểu `…UncheckedCreateInput` của Prisma (trừ `companyId` do
 * repository tự chèn) thay vì chép tay ~35 field: đây là HÌNH DẠNG DỮ LIỆU, không
 * phải câu truy vấn, và một bản sao chép tay sẽ lệch khỏi schema ngay lần thêm
 * cột tiếp theo mà không ai nhận ra.
 */
export type CreateAttendanceLogData = Omit<Prisma.AttendanceLogUncheckedCreateInput, 'companyId'>;

export type AttendanceLogDetail = Prisma.AttendanceLogGetPayload<{
  include: { fraudFlags: true; adjustments: true };
}>;

export type TodayPunch = Pick<
  AttendanceLog,
  'id' | 'type' | 'recordedAt' | 'authMethod' | 'decision' | 'insideGeofence' | 'distanceToBranchM'
>;

export type EmployeeSummary = Pick<
  Employee,
  'id' | 'fullName' | 'employeeCode' | 'departmentId' | 'branchId'
>;

export interface DailySearchFilter {
  employeeIds?: string[];
  employeeId?: string;
  from?: Date;
  to?: Date;
  status?: DailyStatus;
  hasFraudFlag?: boolean;
  skip: number;
  take: number;
}

export interface EmployeeScopeFilter {
  departmentId?: string;
  branchId?: string;
  employeeId?: string;
  /** Phạm vi phòng ban của MANAGER — do ScopeGuard áp, không lấy từ query. */
  departmentScope: string[] | null;
  q?: string;
}

export interface CreateAdjustmentData {
  employeeId: string;
  workDate: Date;
  attendanceLogId: string | null;
  adjustType: string;
  beforeValue?: Prisma.InputJsonValue;
  afterValue: Prisma.InputJsonValue;
  reason: string;
  requestId?: string | null;
  createdByUserId: string;
}

/**
 * Truy cập dữ liệu chấm công — `attendance_log`, `attendance_daily`,
 * `attendance_adjustment`, cùng các tra cứu phụ trợ cho luồng chấm công.
 *
 * ## Hai điều repository này cố tình KHÔNG có
 *
 * **Không có `updateLog` / `deleteLog`.** `attendance_log` là bản ghi THÔ và BẤT
 * BIẾN (BR-06): rule ở tầng DB biến mọi UPDATE/DELETE thành no-op im lặng
 * (`prisma/sql/01_immutability_and_rls.sql`). Có phương thức sửa ở tầng code thì
 * lời gọi "thành công" mà dữ liệu không đổi — kiểu lỗi tệ nhất. Hiệu chỉnh đi qua
 * `createAdjustment`, và với `ADD` thì thêm một bản ghi mới `authMethod = MANUAL`.
 *
 * **Không có phương thức nào nhận `recordedAt` từ bên ngoài cho luồng chấm công
 * thường.** Giờ chính thức là giờ SERVER (BR-01); service tự đóng dấu.
 */
@Injectable()
export class AttendanceRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  // ===========================================================================
  //  Nhân viên & thiết bị
  // ===========================================================================

  async findEmployee(companyId: string, employeeId: string): Promise<Employee | null> {
    return this.db().employee.findFirst({
      where: { id: employeeId, companyId, deletedAt: null },
    });
  }

  async findEmployeeSummary(
    companyId: string,
    employeeId: string,
  ): Promise<EmployeeSummary | null> {
    return this.db().employee.findFirst({
      where: { id: employeeId, companyId },
      select: { id: true, fullName: true, employeeCode: true, departmentId: true, branchId: true },
    });
  }

  /** Nhân viên trong phạm vi được phép xem — dùng để lọc bảng công (BR-09 + ScopeGuard). */
  async findEmployeesInScope(
    companyId: string,
    filter: EmployeeScopeFilter,
  ): Promise<EmployeeSummary[]> {
    const where: Prisma.EmployeeWhereInput = { companyId, deletedAt: null };
    if (filter.departmentId) where.departmentId = filter.departmentId;
    if (filter.branchId) where.branchId = filter.branchId;
    if (filter.employeeId) where.id = filter.employeeId;
    if (filter.departmentScope) where.departmentId = { in: filter.departmentScope };
    if (filter.q) {
      where.OR = [
        { fullName: { contains: filter.q, mode: 'insensitive' } },
        { employeeCode: { contains: filter.q, mode: 'insensitive' } },
        { phone: { contains: filter.q } },
      ];
    }

    return this.db().employee.findMany({
      where,
      select: { id: true, fullName: true, employeeCode: true, departmentId: true, branchId: true },
    });
  }

  /** BR-04 — mã nhân viên bất biến sau lần chấm công đầu tiên. */
  async lockEmployeeCode(
    companyId: string,
    employeeId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await this.db(tx).employee.updateMany({
      where: { id: employeeId, companyId },
      data: { codeLocked: true, status: 'ACTIVE' },
    });
  }

  async isDeviceActive(userId: string, deviceId: string): Promise<boolean> {
    const device = await this.db().deviceBinding.findUnique({
      where: { userId_deviceId: { userId, deviceId } },
      select: { isActive: true, revokedAt: true },
    });
    return Boolean(device?.isActive && !device.revokedAt);
  }

  // ===========================================================================
  //  Dữ liệu sinh trắc học dùng để đối chiếu
  // ===========================================================================

  /** Embedding của các hồ sơ ĐANG HOẠT ĐỘNG — đầu vào so khớp 1:1 với AI Server. */
  async findActiveFaceEmbeddings(companyId: string, employeeId: string): Promise<Buffer[]> {
    const profiles = await this.db().faceProfile.findMany({
      where: { companyId, employeeId, status: FaceProfileStatus.ACTIVE },
      select: { embeddingRaw: true },
    });
    return profiles
      .map((profile) => profile.embeddingRaw)
      .filter((raw): raw is Buffer => raw !== null);
  }

  async findFingerprintKey(companyId: string, employeeId: string, deviceId: string) {
    return this.db().biometricKey.findFirst({
      where: { companyId, employeeId, deviceId, revokedAt: null },
    });
  }

  // ===========================================================================
  //  Ràng buộc trước khi ghi
  // ===========================================================================

  /** BR-07 / BR-ATT-05 — kỳ lương đã chốt thì khoá hoàn toàn. */
  async findClosedPeriodCovering(
    companyId: string,
    workDate: Date,
  ): Promise<{ id: string; name: string } | null> {
    return this.db().payrollPeriod.findFirst({
      where: {
        companyId,
        status: periodLockedFilter(),
        startDate: { lte: workDate },
        endDate: { gte: workDate },
      },
      select: { id: true, name: true },
    });
  }

  /** Lượt IN/OUT gần nhất trong ngày — nền tảng của BR-ATT-01/02/03. */
  async findLastPunch(
    companyId: string,
    employeeId: string,
    workDate: Date,
  ): Promise<Pick<AttendanceLog, 'type' | 'recordedAt'> | null> {
    return this.db().attendanceLog.findFirst({
      where: {
        companyId,
        employeeId,
        workDate,
        type: { in: [AttendanceType.CHECK_IN, AttendanceType.CHECK_OUT] },
        decision: { not: AttendanceDecision.REJECTED },
      },
      orderBy: { recordedAt: 'desc' },
      select: { type: true, recordedAt: true },
    });
  }

  /** Chi nhánh có toạ độ — đầu vào tính geofence. */
  async findGeofenceBranches(companyId: string, branchId?: string): Promise<Branch[]> {
    return this.db().branch.findMany({
      where: {
        companyId,
        deletedAt: null,
        latitude: { not: null },
        longitude: { not: null },
        ...(branchId ? { id: branchId } : {}),
      },
    });
  }

  /** BR-ATT-06 — đơn công tác đã duyệt còn hiệu lực thì miễn kiểm geofence. */
  async hasApprovedBusinessTrip(companyId: string, employeeId: string, at: Date): Promise<boolean> {
    const trip = await this.db().leaveRequest.findFirst({
      where: {
        companyId,
        employeeId,
        status: 'APPROVED',
        startAt: { lte: at },
        endAt: { gte: at },
        requestType: { code: { in: ['BUSINESS_TRIP', 'CONG_TAC'] } },
      },
      select: { id: true },
    });
    return trip !== null;
  }

  // ===========================================================================
  //  Ghi bản ghi thô (BR-06 — chỉ INSERT)
  // ===========================================================================

  async createLog(
    companyId: string,
    data: CreateAttendanceLogData,
    tx?: Prisma.TransactionClient,
  ): Promise<AttendanceLog> {
    return this.db(tx).attendanceLog.create({ data: { companyId, ...data } });
  }

  /**
   * Chốt kết quả soát một lượt chấm công đang chờ duyệt.
   *
   * `decision: PENDING_REVIEW` trong `where` là điều kiện, không phải bộ lọc cho
   * đẹp: hai người quản lý cùng mở một lượt và cùng bấm duyệt thì chỉ lượt đầu
   * ghi được, lượt sau nhận `count: 0` và biết là đã có người xử lý trước.
   */
  async resolvePendingReview(
    companyId: string,
    logId: string,
    decision: AttendanceDecision,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const updated = await this.db(tx).attendanceLog.updateMany({
      where: { id: logId, companyId, decision: AttendanceDecision.PENDING_REVIEW },
      data: { decision },
    });
    return updated.count;
  }

  /**
   * Bản ghi offline đã đồng bộ trước đó.
   *
   * Không có cột `localId` để làm khoá idempotent, nên dùng khoá tự nhiên
   * (nhân viên, loại, thời điểm chấm). App gửi lại đúng gói cũ thì `capturedAt`
   * giống hệt tới từng mili giây — đủ chặt để không nhân đôi công, và không
   * chặt tới mức chặn nhầm hai lượt chấm thật cách nhau vài giây.
   */
  async findOfflineDuplicate(
    companyId: string,
    employeeId: string,
    type: AttendanceType,
    recordedAt: Date,
  ): Promise<Pick<AttendanceLog, 'id'> | null> {
    return this.db().attendanceLog.findFirst({
      where: { companyId, employeeId, type, recordedAt, isOffline: true },
      select: { id: true },
    });
  }

  /** Các lượt đang chờ soát — hàng đợi công việc của Quản lý/HR. */
  async listPendingReview(
    companyId: string,
    filter: { employeeIds?: string[] | null; from?: Date; to?: Date; skip: number; take: number },
  ) {
    const where: Prisma.AttendanceLogWhereInput = {
      companyId,
      decision: AttendanceDecision.PENDING_REVIEW,
      ...(filter.employeeIds ? { employeeId: { in: filter.employeeIds } } : {}),
      ...(filter.from || filter.to
        ? {
            workDate: {
              ...(filter.from ? { gte: filter.from } : {}),
              ...(filter.to ? { lte: filter.to } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.db().attendanceLog.findMany({
        where,
        orderBy: { recordedAt: 'desc' },
        skip: filter.skip,
        take: filter.take,
        include: {
          fraudFlags: {
            select: { id: true, code: true, severity: true, score: true, reviewedAt: true },
          },
        },
      }),
      this.db().attendanceLog.count({ where }),
    ]);

    return { items, total };
  }

  // ===========================================================================
  //  Đọc cho App
  // ===========================================================================

  async listPunchesForDay(
    companyId: string,
    employeeId: string,
    workDate: Date,
  ): Promise<TodayPunch[]> {
    return this.db().attendanceLog.findMany({
      where: { companyId, employeeId, workDate },
      orderBy: { recordedAt: 'asc' },
      select: {
        id: true,
        type: true,
        recordedAt: true,
        authMethod: true,
        decision: true,
        insideGeofence: true,
        distanceToBranchM: true,
      },
    });
  }

  async findDaily(
    companyId: string,
    employeeId: string,
    workDate: Date,
  ): Promise<AttendanceDaily | null> {
    return this.db().attendanceDaily.findFirst({ where: { companyId, employeeId, workDate } });
  }

  /** Chi nhánh của nhân viên; chưa gán thì lấy chi nhánh đầu tiên có toạ độ. */
  async findBranchForEmployee(companyId: string, branchId: string | null): Promise<Branch | null> {
    if (branchId) {
      return this.db().branch.findFirst({ where: { id: branchId, companyId } });
    }
    return this.db().branch.findFirst({
      where: { companyId, deletedAt: null, latitude: { not: null } },
    });
  }

  async findLogDetail(
    companyId: string,
    logId: string,
    restrictToEmployeeId?: string,
  ): Promise<AttendanceLogDetail | null> {
    return this.db().attendanceLog.findFirst({
      where: {
        id: logId,
        companyId,
        ...(restrictToEmployeeId ? { employeeId: restrictToEmployeeId } : {}),
      },
      include: { fraudFlags: true, adjustments: true },
    });
  }

  async listLogsWithDetailsForDay(
    companyId: string,
    employeeId: string,
    workDate: Date,
  ): Promise<AttendanceLogDetail[]> {
    return this.db().attendanceLog.findMany({
      where: { companyId, employeeId, workDate },
      orderBy: { recordedAt: 'asc' },
      include: { fraudFlags: true, adjustments: true },
    });
  }

  // ===========================================================================
  //  Bảng công theo ngày
  // ===========================================================================

  /**
   * Truy vấn trên `attendance_daily` (đã tính sẵn), KHÔNG quét `attendance_log`
   * — bảng lớn nhất hệ thống (docs/04 mục 9.1, NFR-PERF-06).
   */
  async searchDaily(
    companyId: string,
    filter: DailySearchFilter,
  ): Promise<{ items: AttendanceDaily[]; total: number }> {
    const where: Prisma.AttendanceDailyWhereInput = { companyId };
    if (filter.employeeIds) where.employeeId = { in: filter.employeeIds };
    if (filter.employeeId) where.employeeId = filter.employeeId;
    if (filter.from || filter.to) {
      where.workDate = {
        ...(filter.from ? { gte: filter.from } : {}),
        ...(filter.to ? { lte: filter.to } : {}),
      };
    }
    if (filter.status) where.status = filter.status;
    if (filter.hasFraudFlag) where.hasFraudFlag = true;

    // findMany + count trong một transaction để hai truy vấn nhìn cùng một ảnh
    // chụp dữ liệu; chạy rời nhau thì tổng số lệch với số phần tử và trang cuối nhảy.
    const [items, total] = await this.prisma.$transaction([
      this.prisma.attendanceDaily.findMany({
        where,
        orderBy: filter.employeeIds
          ? [{ workDate: 'desc' }, { employeeId: 'asc' }]
          : [{ workDate: 'desc' }],
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.attendanceDaily.count({ where }),
    ]);

    return { items, total };
  }

  // ===========================================================================
  //  Hiệu chỉnh (BR-ADJ-01..06)
  // ===========================================================================

  async findLog(
    companyId: string,
    employeeId: string,
    logId: string,
  ): Promise<AttendanceLog | null> {
    return this.db().attendanceLog.findFirst({ where: { id: logId, companyId, employeeId } });
  }

  async createAdjustment(
    companyId: string,
    data: CreateAdjustmentData,
    tx?: Prisma.TransactionClient,
  ): Promise<AttendanceAdjustment> {
    return this.db(tx).attendanceAdjustment.create({ data: { companyId, ...data } });
  }

  async listAdjustments(
    companyId: string,
    employeeId: string,
    range: { from?: Date; to?: Date } = {},
  ): Promise<AttendanceAdjustment[]> {
    const where: Prisma.AttendanceAdjustmentWhereInput = { companyId, employeeId };
    if (range.from || range.to) {
      where.workDate = {
        ...(range.from ? { gte: range.from } : {}),
        ...(range.to ? { lte: range.to } : {}),
      };
    }
    return this.db().attendanceAdjustment.findMany({ where, orderBy: { createdAt: 'desc' } });
  }

  /**
   * Tên hiển thị của các tài khoản đã thao tác — dùng cho lịch sử điều chỉnh.
   *
   * Lọc theo `companyId` chứ không tra id trần: id lấy từ dữ liệu của công ty
   * này, nhưng một truy vấn không khoanh vùng vẫn là một truy vấn có thể trả về
   * tên người của công ty khác nếu dữ liệu lỡ lẫn.
   */
  async findUserNames(
    companyId: string,
    userIds: string[],
  ): Promise<Array<{ id: string; fullName: string }>> {
    if (userIds.length === 0) return [];
    return this.db().userAccount.findMany({
      where: { companyId, id: { in: userIds } },
      select: { id: true, fullName: true },
    });
  }

  // ===========================================================================
  //  Job xuất Excel
  // ===========================================================================

  async createExportJob(
    companyId: string,
    data: { createdBy: string; kind: string; params: Prisma.InputJsonValue },
  ): Promise<ExportJob> {
    return this.db().exportJob.create({
      data: { companyId, status: 'QUEUED', ...data },
    });
  }

  async markExportJobFailed(companyId: string, jobId: string, errorMessage: string): Promise<void> {
    await this.db().exportJob.updateMany({
      where: { id: jobId, companyId },
      data: { status: 'FAILED', errorMessage },
    });
  }

  async findExportJob(companyId: string, jobId: string): Promise<ExportJob | null> {
    return this.db().exportJob.findFirst({ where: { id: jobId, companyId } });
  }
}
