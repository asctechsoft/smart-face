import { Injectable } from '@nestjs/common';
import { FraudFlag, Prisma } from '@prisma/client';
import { BaseRepository } from 'src/infra/prisma/base.repository';
import { PrismaService } from 'src/infra/prisma/prisma.service';

export type FraudFlagWithLog = Prisma.FraudFlagGetPayload<{
  include: {
    attendanceLog: {
      select: {
        id: true;
        type: true;
        recordedAt: true;
        workDate: true;
        fraudScore: true;
        decision: true;
        latitude: true;
        longitude: true;
        distanceToBranchM: true;
      };
    };
  };
}>;

export interface EmployeeLabel {
  id: string;
  fullName: string;
  employeeCode: string;
  departmentId: string | null;
}

export interface FraudFlagFilter {
  severity?: string;
  code?: string;
  employeeId?: string;
  /** 'true' = đã xử lý, 'false' = chưa xử lý, bỏ trống = cả hai. */
  reviewed?: string;
  from?: Date;
  to?: Date;
  /** Danh sách nhân viên được phép xem — null nghĩa là không giới hạn. */
  employeeIdScope: string[] | null;
  skip: number;
  take: number;
}

export interface FraudFlagRow {
  employeeId: string;
  attendanceLogId: string | null;
  code: string;
  severity: string;
  score: number;
  details: Prisma.InputJsonValue;
}

export interface ReviewDecisionData {
  reviewedBy: string;
  reviewedAt: Date;
  reviewDecision: string;
  reviewReason: string;
}

export interface FraudStatsCounters {
  total: number;
  high: number;
  pending: number;
  reviewed: number;
  byCode: Array<{ code: string; count: number }>;
}

/**
 * Truy cập dữ liệu chống gian lận: `fraud_flag`, cùng các truy vấn đọc ngược
 * `attendance_log` / `leave_request` phục vụ chấm điểm rủi ro.
 *
 * Các phương thức chấm điểm chạy TRONG mỗi lượt chấm công nên đều là truy vấn
 * một dòng có index đỡ (`companyId + employeeId + recordedAt`). Thêm truy vấn
 * nặng vào nhóm này là làm chậm đúng endpoint bận nhất hệ thống — phân tích tốn
 * kém thuộc về `fraud-scan.processor.ts`.
 */
@Injectable()
export class FraudRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  // ===========================================================================
  //  Đầu vào chấm điểm realtime
  // ===========================================================================

  /** Toạ độ của lượt chấm công gần nhất — nền của tín hiệu trùng toạ độ tuyệt đối. */
  async findLastCoordinate(
    companyId: string,
    employeeId: string,
  ): Promise<{ latitude: number | null; longitude: number | null } | null> {
    return this.db().attendanceLog.findFirst({
      where: { companyId, employeeId },
      orderBy: { recordedAt: 'desc' },
      select: { latitude: true, longitude: true },
    });
  }

  /** Lượt gần nhất CÓ toạ độ — nền của tín hiệu di chuyển bất khả thi (AF-03). */
  async findLastLocatedPunch(
    companyId: string,
    employeeId: string,
  ): Promise<{
    latitude: number | null;
    longitude: number | null;
    recordedAt: Date;
    gpsAccuracy: number | null;
  } | null> {
    return this.db().attendanceLog.findFirst({
      where: {
        companyId,
        employeeId,
        latitude: { not: null },
        longitude: { not: null },
      },
      orderBy: { recordedAt: 'desc' },
      select: { latitude: true, longitude: true, recordedAt: true, gpsAccuracy: true },
    });
  }

  /** Ngoại lệ của AF-03: nhân viên có đơn công tác đã duyệt (đi máy bay). */
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

  /** AF-07 — cùng tài khoản vừa chấm công từ một thiết bị khác. */
  async findRecentPunchFromOtherDevice(
    companyId: string,
    employeeId: string,
    currentDeviceId: string,
    since: Date,
  ): Promise<{ deviceId: string | null; recordedAt: Date } | null> {
    return this.db().attendanceLog.findFirst({
      where: {
        companyId,
        employeeId,
        recordedAt: { gte: since },
        deviceId: { not: null, notIn: [currentDeviceId] },
      },
      select: { deviceId: true, recordedAt: true },
    });
  }

  // ===========================================================================
  //  Ghi cờ
  // ===========================================================================

  async createFlags(
    companyId: string,
    rows: FraudFlagRow[],
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await this.db(tx).fraudFlag.createMany({
      data: rows.map((row) => ({ companyId, ...row })),
    });
    return result.count;
  }

  // ===========================================================================
  //  Dashboard cảnh báo (AF-21) & xử lý cờ (AF-23)
  // ===========================================================================

  /** Nhân viên thuộc phạm vi được phép xem — giao của bộ lọc client và ScopeGuard. */
  async findEmployeeIdsInScope(
    companyId: string,
    departmentId: string | undefined,
    departmentScope: string[] | null,
  ): Promise<string[]> {
    const rows = await this.db().employee.findMany({
      where: {
        companyId,
        ...(departmentId ? { departmentId } : {}),
        ...(departmentScope ? { departmentId: { in: departmentScope } } : {}),
      },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  async findEmployeeLabels(companyId: string, employeeIds: string[]): Promise<EmployeeLabel[]> {
    return this.db().employee.findMany({
      where: { id: { in: employeeIds }, companyId },
      select: { id: true, fullName: true, employeeCode: true, departmentId: true },
    });
  }

  async findEmployeeLabel(companyId: string, employeeId: string): Promise<EmployeeLabel | null> {
    return this.db().employee.findFirst({
      where: { id: employeeId, companyId },
      select: { id: true, fullName: true, employeeCode: true, departmentId: true },
    });
  }

  async searchFlags(
    companyId: string,
    filter: FraudFlagFilter,
  ): Promise<{ items: FraudFlagWithLog[]; total: number }> {
    const where = this.buildWhere(companyId, filter);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.fraudFlag.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filter.skip,
        take: filter.take,
        include: {
          attendanceLog: {
            select: {
              id: true,
              type: true,
              recordedAt: true,
              workDate: true,
              fraudScore: true,
              decision: true,
              latitude: true,
              longitude: true,
              distanceToBranchM: true,
            },
          },
        },
      }),
      this.prisma.fraudFlag.count({ where }),
    ]);

    return { items, total };
  }

  async findFlagWithLog(companyId: string, flagId: string) {
    return this.db().fraudFlag.findFirst({
      where: { id: flagId, companyId },
      include: { attendanceLog: true },
    });
  }

  async findFlag(companyId: string, flagId: string): Promise<FraudFlag | null> {
    return this.db().fraudFlag.findFirst({ where: { id: flagId, companyId } });
  }

  async recordReview(
    companyId: string,
    flagId: string,
    data: ReviewDecisionData,
    tx?: Prisma.TransactionClient,
  ): Promise<FraudFlag | null> {
    const updated = await this.db(tx).fraudFlag.updateMany({
      where: { id: flagId, companyId },
      data,
    });
    if (updated.count === 0) return null;
    return this.findFlag(companyId, flagId);
  }

  /** Thống kê cho dashboard (AF-21). */
  async countStats(companyId: string, from?: Date, to?: Date): Promise<FraudStatsCounters> {
    const where: Prisma.FraudFlagWhereInput = { companyId };
    if (from || to) {
      where.createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
    }

    const [total, high, pending, reviewed] = await this.prisma.$transaction([
      this.prisma.fraudFlag.count({ where }),
      this.prisma.fraudFlag.count({ where: { ...where, severity: 'HIGH' } }),
      this.prisma.fraudFlag.count({ where: { ...where, reviewedAt: null } }),
      this.prisma.fraudFlag.count({ where: { ...where, reviewedAt: { not: null } } }),
    ]);

    // groupBy tách khỏi $transaction([...]) vì gộp vào mảng làm mất kiểu narrow
    // của `_count`.
    const byCode = await this.db().fraudFlag.groupBy({
      by: ['code'],
      where,
      _count: { code: true },
      orderBy: { _count: { code: 'desc' } },
    });

    return {
      total,
      high,
      pending,
      reviewed,
      byCode: byCode.map((row) => ({ code: row.code, count: row._count.code })),
    };
  }

  /** Cờ chưa xử lý trong khoảng — chặn chốt kỳ lương (docs/04 mục 7.2). */
  async countUnreviewedInRange(companyId: string, from: Date, to: Date): Promise<number> {
    return this.db().fraudFlag.count({
      where: { companyId, reviewedAt: null, createdAt: { gte: from, lte: to } },
    });
  }

  private buildWhere(companyId: string, filter: FraudFlagFilter): Prisma.FraudFlagWhereInput {
    const where: Prisma.FraudFlagWhereInput = { companyId };

    if (filter.severity) where.severity = filter.severity;
    if (filter.code) where.code = filter.code;
    if (filter.employeeId) where.employeeId = filter.employeeId;
    if (filter.reviewed === 'true') where.reviewedAt = { not: null };
    if (filter.reviewed === 'false') where.reviewedAt = null;
    if (filter.from || filter.to) {
      where.createdAt = {
        ...(filter.from ? { gte: filter.from } : {}),
        ...(filter.to ? { lte: filter.to } : {}),
      };
    }
    // Phạm vi của ScopeGuard ghi đè `employeeId` do client gửi — thu hẹp, không mở rộng.
    if (filter.employeeIdScope) where.employeeId = { in: filter.employeeIdScope };

    return where;
  }
}
