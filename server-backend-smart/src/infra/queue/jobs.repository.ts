import { Injectable } from '@nestjs/common';
import {
  AttendanceDecision,
  AttendanceType,
  DailyStatus,
  ExportJob,
  FaceProfileStatus,
  Prisma,
  RequestStatus,
} from '@prisma/client';
import { BaseRepository } from 'src/infra/prisma/base.repository';
import { PrismaService } from 'src/infra/prisma/prisma.service';

export interface LocatedPunch {
  id: string;
  companyId: string;
  employeeId: string;
  latitude: number | null;
  longitude: number | null;
  gpsAccuracy: number | null;
  recordedAt: Date;
}

export interface DailyForShortScan {
  companyId: string;
  employeeId: string;
  workedMinutes: number;
  workDate: Date;
  shiftId: string | null;
}

export interface DailyForCheckoutScan {
  companyId: string;
  employeeId: string;
  workDate: Date;
  firstCheckInAt: Date | null;
}

export interface AuditCandidate {
  id: string;
  employeeId: string;
  matchScore: number | null;
  recordedAt: Date;
}

export interface MatchScoreHistory {
  average: number | null;
  sampleCount: number;
}

export interface ExportEmployeeRow {
  id: string;
  fullName: string;
  employeeCode: string;
  department: { name: string } | null;
}

export interface KeyedRow {
  id: string;
  key: string;
}

/**
 * Truy cập dữ liệu cho các job chạy nền (BullMQ processor).
 *
 * ## Vì sao job không dùng repository của module
 *
 * Repository của module nghiệp vụ bắt buộc nhận `companyId` (BR-09) vì chúng
 * phục vụ request của một người dùng thuộc một công ty. Job nền thì ngược lại:
 * quét gian lận, dọn dữ liệu quá hạn và tính công hằng đêm chạy cho TOÀN BỘ
 * tenant, không có ngữ cảnh người gọi.
 *
 * Gộp hai loại truy vấn đó vào cùng một repository là mở sẵn cửa hậu — sớm muộn
 * sẽ có người gọi một phương thức "không cần companyId" từ đường request. Tách ra
 * đây thì ranh giới nằm ở tầng module: `JobsRepository` chỉ được khai trong
 * `WorkerModule`, không controller nào với tới.
 *
 * Quy ước đặt tên: phương thức quét xuyên tenant mang tiền tố `acrossTenants…` để
 * chỗ gọi phải cố ý gõ ra. Các phương thức còn lại vẫn nhận `companyId`.
 */
@Injectable()
export class JobsRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  // ===========================================================================
  //  Danh sách công ty cần quét
  // ===========================================================================

  /** Công ty còn dùng dịch vụ — job nghiệp vụ chỉ chạy cho nhóm này. */
  async acrossTenantsFindOperatingCompanyIds(): Promise<string[]> {
    const rows = await this.db().company.findMany({
      where: { status: { in: ['TRIAL', 'ACTIVE'] }, deletedAt: null },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /**
   * Mọi công ty chưa xoá — kể cả SUSPENDED/TERMINATED.
   *
   * Job dọn dữ liệu phải chạy cho cả nhóm này: nghĩa vụ xoá dữ liệu cá nhân đúng
   * hạn không mất đi khi công ty ngừng thanh toán (NFR-LEGAL-04).
   */
  async acrossTenantsFindAllCompanyIds(): Promise<string[]> {
    const rows = await this.db().company.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  // ===========================================================================
  //  Quét gian lận nền (AF-03, AF-19)
  // ===========================================================================

  /**
   * Lượt chấm công CÓ toạ độ trong khoảng gần đây, xuyên tenant.
   *
   * Sắp xếp theo `(employeeId, recordedAt)` để chỗ gọi gom theo nhân viên và so
   * từng cặp liên tiếp mà không phải sắp lại trong bộ nhớ.
   */
  async acrossTenantsFindLocatedPunchesSince(since: Date): Promise<LocatedPunch[]> {
    return this.db().attendanceLog.findMany({
      where: {
        recordedAt: { gte: since },
        latitude: { not: null },
        longitude: { not: null },
        decision: { not: AttendanceDecision.REJECTED },
      },
      orderBy: [{ employeeId: 'asc' }, { recordedAt: 'asc' }],
      select: {
        id: true,
        companyId: true,
        employeeId: true,
        latitude: true,
        longitude: true,
        gpsAccuracy: true,
        recordedAt: true,
      },
    });
  }

  /** AF-19 — ngày có làm việc thật, để so thời lượng với ca chuẩn. */
  async acrossTenantsFindWorkedDailies(workDate: Date): Promise<DailyForShortScan[]> {
    return this.db().attendanceDaily.findMany({
      where: {
        workDate,
        workedMinutes: { gt: 0 },
        status: { notIn: [DailyStatus.ON_LEAVE, DailyStatus.HOLIDAY] },
      },
      select: {
        companyId: true,
        employeeId: true,
        workedMinutes: true,
        workDate: true,
        shiftId: true,
      },
    });
  }

  async acrossTenantsFindMissingRecordDailies(workDate: Date): Promise<DailyForCheckoutScan[]> {
    return this.db().attendanceDaily.findMany({
      where: { workDate, status: DailyStatus.MISSING_RECORD },
      select: { companyId: true, employeeId: true, workDate: true, firstCheckInAt: true },
    });
  }

  async findLastCheckInId(
    companyId: string,
    employeeId: string,
    workDate: Date,
  ): Promise<string | null> {
    const log = await this.db().attendanceLog.findFirst({
      where: { companyId, employeeId, workDate, type: AttendanceType.CHECK_IN },
      orderBy: { recordedAt: 'desc' },
      select: { id: true },
    });
    return log?.id ?? null;
  }

  /** Job chạy mỗi 15 phút — không gắn cờ trùng cho cùng một bản ghi. */
  async hasFlagForLog(attendanceLogId: string, code: string): Promise<boolean> {
    const existing = await this.db().fraudFlag.findFirst({
      where: { attendanceLogId, code },
      select: { id: true },
    });
    return existing !== null;
  }

  async hasApprovedBusinessTrip(companyId: string, employeeId: string, at: Date): Promise<boolean> {
    const trip = await this.db().leaveRequest.findFirst({
      where: {
        companyId,
        employeeId,
        status: RequestStatus.APPROVED,
        startAt: { lte: at },
        endAt: { gte: at },
        requestType: { code: { in: ['BUSINESS_TRIP', 'CONG_TAC'] } },
      },
      select: { id: true },
    });
    return trip !== null;
  }

  /** Bất kỳ đơn đã duyệt nào phủ lên ngày — đơn về sớm, ra ngoài, nghỉ nửa ngày. */
  async hasApprovedRequestOnDate(
    companyId: string,
    employeeId: string,
    workDate: Date,
  ): Promise<boolean> {
    const dayEnd = new Date(workDate.getTime() + 24 * 60 * 60 * 1000);
    const request = await this.db().leaveRequest.findFirst({
      where: {
        companyId,
        employeeId,
        status: RequestStatus.APPROVED,
        startAt: { lt: dayEnd },
        endAt: { gte: workDate },
      },
      select: { id: true },
    });
    return request !== null;
  }

  // ===========================================================================
  //  Random audit (AF-08)
  // ===========================================================================

  async findAuditCandidates(companyId: string, since: Date): Promise<AuditCandidate[]> {
    return this.db().attendanceLog.findMany({
      where: {
        companyId,
        recordedAt: { gte: since },
        matchScore: { not: null },
        decision: { not: AttendanceDecision.REJECTED },
      },
      select: { id: true, employeeId: true, matchScore: true, recordedAt: true },
    });
  }

  /**
   * Điểm tương đồng trung bình của CHÍNH nhân viên đó trong quá khứ.
   *
   * So với chính mình chứ không với ngưỡng chung: mỗi người có mức nền khác nhau
   * (đeo kính, có râu, da sẫm trong điều kiện thiếu sáng) nên ngưỡng chung sẽ
   * liên tục báo nhầm đúng những người đó.
   */
  async averageMatchScore(
    companyId: string,
    employeeId: string,
    from: Date,
    to: Date,
  ): Promise<MatchScoreHistory> {
    const history = await this.db().attendanceLog.aggregate({
      where: {
        companyId,
        employeeId,
        matchScore: { not: null },
        recordedAt: { gte: from, lt: to },
      },
      _avg: { matchScore: true },
      _count: { _all: true },
    });

    return { average: history._avg.matchScore, sampleCount: history._count._all };
  }

  async countActiveFaceProfiles(companyId: string, employeeId: string): Promise<number> {
    return this.db().faceProfile.count({
      where: { companyId, employeeId, status: FaceProfileStatus.ACTIVE },
    });
  }

  // ===========================================================================
  //  Tính công nền
  // ===========================================================================

  /** BR-07 — kỳ đã chốt thì job BỎ QUA, không ghi đè số liệu đã chốt. */
  async findClosedPeriodCovering(
    companyId: string,
    workDate: Date,
  ): Promise<{ name: string } | null> {
    return this.db().payrollPeriod.findFirst({
      where: {
        companyId,
        status: 'CLOSED',
        startDate: { lte: workDate },
        endDate: { gte: workDate },
      },
      select: { name: true },
    });
  }

  // ===========================================================================
  //  Job xuất Excel
  // ===========================================================================

  /**
   * Trạng thái job nằm ở BẢNG `export_job`, không chỉ trong BullMQ: client hỏi
   * tiến độ qua `GET /v1/jobs/:id`, và trạng thái phải sống sót qua lần Redis
   * restart.
   */
  async findExportJob(exportJobId: string): Promise<ExportJob> {
    return this.db().exportJob.findUniqueOrThrow({ where: { id: exportJobId } });
  }

  async markExportProcessing(exportJobId: string, progress = 10): Promise<void> {
    await this.db().exportJob.update({
      where: { id: exportJobId },
      data: { status: 'PROCESSING', progress },
    });
  }

  async markExportDone(
    exportJobId: string,
    data: { fileKey: string; fileName: string },
  ): Promise<void> {
    await this.db().exportJob.update({
      where: { id: exportJobId },
      data: { status: 'DONE', progress: 100, ...data, completedAt: new Date() },
    });
  }

  async markExportFailed(exportJobId: string, errorMessage: string): Promise<void> {
    await this.db().exportJob.update({
      where: { id: exportJobId },
      data: {
        status: 'FAILED',
        errorCode: 'EXPORT_FAILED',
        errorMessage,
        completedAt: new Date(),
      },
    });
  }

  /**
   * @param employeeIds bỏ trống = toàn công ty. Mảng rỗng = không ai — Prisma
   *        dịch `in: []` thành 0 dòng, đúng ý đồ fail-closed.
   */
  async findDailiesForExport(companyId: string, from: Date, to: Date, employeeIds?: string[]) {
    const where: Prisma.AttendanceDailyWhereInput = {
      companyId,
      workDate: { gte: from, lte: to },
    };
    if (employeeIds) where.employeeId = { in: employeeIds };

    return this.db().attendanceDaily.findMany({
      where,
      orderBy: [{ workDate: 'asc' }, { employeeId: 'asc' }],
    });
  }

  /**
   * @param departmentIds phạm vi phòng ban đã áp quyền. `null`/bỏ trống = toàn
   *        công ty (HR/Admin). Không bao giờ nhận thẳng từ client — xem
   *        `resolveExportDepartmentFilter()`.
   */
  async findEmployeesForExport(
    companyId: string,
    departmentIds?: string[] | null,
  ): Promise<ExportEmployeeRow[]> {
    const where: Prisma.EmployeeWhereInput = { companyId, deletedAt: null };
    if (departmentIds) where.departmentId = { in: departmentIds };

    return this.db().employee.findMany({
      where,
      select: {
        id: true,
        fullName: true,
        employeeCode: true,
        department: { select: { name: true } },
      },
    });
  }

  // ===========================================================================
  //  Dọn dữ liệu quá hạn (NFR-LEGAL-04, NFR-SCALE-07)
  // ===========================================================================

  /**
   * Ảnh chấm công quá hạn, duyệt theo con trỏ id.
   *
   * Không dùng `skip`: mỗi lô xử lý xong không làm bản ghi biến mất khỏi bảng
   * (chỉ ảnh bị xoá khỏi kho), nhưng con trỏ vẫn là cách duy nhất chạy ổn định
   * khi dữ liệu mới được chèn vào giữa các lô.
   */
  async findExpiredAttendancePhotos(
    companyId: string,
    cutoff: Date,
    take: number,
    cursor?: string,
  ): Promise<KeyedRow[]> {
    const rows = await this.db().attendanceLog.findMany({
      where: {
        companyId,
        recordedAt: { lt: cutoff },
        photoKey: { not: null },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: { id: true, photoKey: true },
      orderBy: { id: 'asc' },
      take,
    });
    return rows.map((row) => ({ id: row.id, key: row.photoKey as string }));
  }

  /**
   * Ảnh hồ sơ khuôn mặt đã THU HỒI/THAY THẾ quá thời gian chờ.
   *
   * ⚠ Không lọc theo tuổi hồ sơ. Hồ sơ `ACTIVE` là thứ dùng để so khớp mỗi ngày —
   * xoá nó đi thì nhân viên không chấm công được nữa, bất kể đăng ký từ bao lâu.
   */
  async findPurgeableFaceProfiles(
    companyId: string,
    cutoff: Date,
    take: number,
  ): Promise<KeyedRow[]> {
    const rows = await this.db().faceProfile.findMany({
      where: {
        companyId,
        status: { in: [FaceProfileStatus.REVOKED, FaceProfileStatus.REPLACED] },
        revokedAt: { lt: cutoff },
        photoKey: { not: null },
      },
      select: { id: true, photoKey: true },
      take,
    });
    return rows.map((row) => ({ id: row.id, key: row.photoKey as string }));
  }

  /** `face_profile` không bị rule bất biến chặn nên xoá được khoá ảnh. */
  async clearFaceProfilePhotoKeys(ids: string[]): Promise<number> {
    const result = await this.db().faceProfile.updateMany({
      where: { id: { in: ids } },
      data: { photoKey: null },
    });
    return result.count;
  }

  async findExpiredExportFiles(companyId: string, cutoff: Date, take: number): Promise<KeyedRow[]> {
    const rows = await this.db().exportJob.findMany({
      where: { companyId, createdAt: { lt: cutoff }, fileKey: { not: null } },
      select: { id: true, fileKey: true },
      take,
    });
    return rows.map((row) => ({ id: row.id, key: row.fileKey as string }));
  }

  async clearExportFileKeys(ids: string[]): Promise<number> {
    const result = await this.db().exportJob.updateMany({
      where: { id: { in: ids } },
      data: { fileKey: null },
    });
    return result.count;
  }
}

export type { Prisma };
