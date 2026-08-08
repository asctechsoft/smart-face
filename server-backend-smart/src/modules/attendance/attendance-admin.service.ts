import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { AttendanceType, AuthMethod, PayrollPeriodStatus, Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { PaginatedResult } from 'src/common/dto';
import { AppException } from 'src/common/errors';
import { buildMeta, formatWorkDate, parseWorkDate } from 'src/common/utils';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { StorageService } from 'src/infra/storage/storage.service';
import { JOBS, QUEUES } from 'src/infra/queue/queue.constants';
import { AuditService } from '../audit/audit.service';
import { NotificationService } from '../notification/notification.service';
import { AttendanceService } from './attendance.service';
import type {
  AdjustAttendanceDto,
  AdminAttendanceQueryDto,
  ExportAttendanceDto,
} from './dto/attendance.dto';
import type { TenantContext } from 'src/common/types/request-context';

/**
 * Quản lý chấm công cho Web Quản lý (FR-WEB-ATT).
 *
 * Nguyên tắc xuyên suốt: bản ghi thô BẤT BIẾN (BR-06). Mọi hiệu chỉnh tạo
 * `AttendanceAdjustment` riêng, ghi audit, rồi kích hoạt tính lại (BR-ADJ-01..04).
 */
@Injectable()
export class AttendanceAdminService {
  private readonly logger = new Logger(AttendanceAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    private readonly attendance: AttendanceService,
    @InjectQueue(QUEUES.EXPORT) private readonly exportQueue: Queue,
  ) {}

  // ===========================================================================
  //  Danh sách (FR-WEB-ATT-01)
  // ===========================================================================

  /**
   * Bảng công theo ngày.
   *
   * Query trên `AttendanceDaily` (đã tính sẵn), KHÔNG trên `AttendanceLog`
   * (bảng lớn nhất hệ thống) — docs/04 mục 9.1, NFR-PERF-06.
   *
   * @param departmentScope null = không giới hạn; mảng = chỉ các phòng ban này (ScopeGuard).
   */
  async listDaily(
    companyId: string,
    query: AdminAttendanceQueryDto,
    departmentScope: string[] | null,
  ) {
    const employeeWhere: Prisma.EmployeeWhereInput = { companyId, deletedAt: null };
    if (query.departmentId) employeeWhere.departmentId = query.departmentId;
    if (query.branchId) employeeWhere.branchId = query.branchId;
    if (query.employeeId) employeeWhere.id = query.employeeId;
    if (departmentScope) employeeWhere.departmentId = { in: departmentScope };
    if (query.q) {
      employeeWhere.OR = [
        { fullName: { contains: query.q, mode: 'insensitive' } },
        { employeeCode: { contains: query.q, mode: 'insensitive' } },
        { phone: { contains: query.q } },
      ];
    }

    const employees = await this.prisma.employee.findMany({
      where: employeeWhere,
      select: {
        id: true,
        fullName: true,
        employeeCode: true,
        departmentId: true,
        branchId: true,
      },
    });
    const employeeIds = employees.map((employee) => employee.id);

    if (employeeIds.length === 0) {
      return new PaginatedResult([], buildMeta(query.page, query.pageSize, 0));
    }

    const where: Prisma.AttendanceDailyWhereInput = {
      companyId,
      employeeId: { in: employeeIds },
    };
    if (query.from || query.to) {
      where.workDate = {
        ...(query.from ? { gte: parseWorkDate(query.from) } : {}),
        ...(query.to ? { lte: parseWorkDate(query.to) } : {}),
      };
    }
    if (query.status) where.status = query.status;
    if (query.hasFraudFlag) where.hasFraudFlag = true;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.attendanceDaily.findMany({
        where,
        orderBy: [{ workDate: 'desc' }, { employeeId: 'asc' }],
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.attendanceDaily.count({ where }),
    ]);

    const employeeMap = new Map(employees.map((employee) => [employee.id, employee]));
    const items = rows.map((row) => ({
      ...row,
      workDate: formatWorkDate(row.workDate),
      employee: employeeMap.get(row.employeeId) ?? null,
    }));

    return new PaginatedResult(items, buildMeta(query.page, query.pageSize, total));
  }

  /** Các lượt chấm công thô của một nhân viên trong một ngày (màn hình chi tiết). */
  async listLogsForDay(companyId: string, employeeId: string, workDate: string) {
    const logs = await this.prisma.attendanceLog.findMany({
      where: { companyId, employeeId, workDate: parseWorkDate(workDate) },
      orderBy: { recordedAt: 'asc' },
      include: { fraudFlags: true, adjustments: true },
    });

    return Promise.all(
      logs.map(async (log) => ({
        ...log,
        // Đi qua AttendanceService để chốt thời hạn lưu áp dụng đồng nhất
        // (NFR-LEGAL-04). Gọi thẳng storage sẽ phục vụ cả ảnh đã hết hạn.
        photoUrl: await this.attendance.getAttendancePhotoUrl(
          log.companyId,
          log.recordedAt,
          log.photoKey,
        ),
      })),
    );
  }

  // ===========================================================================
  //  Hiệu chỉnh công (FR-WEB-ATT-04, BR-ADJ-01..05)
  // ===========================================================================

  async adjust(ctx: TenantContext, dto: AdjustAttendanceDto) {
    const companyId = ctx.companyId;
    const workDate = parseWorkDate(dto.workDate);

    const employee = await this.prisma.employee.findFirst({
      where: { id: dto.employeeId, companyId, deletedAt: null },
    });
    if (!employee) {
      throw new AppException('EMP_NOT_FOUND');
    }

    // BR-ADJ-05: không hiệu chỉnh dữ liệu thuộc kỳ lương đã chốt.
    const closedPeriod = await this.prisma.payrollPeriod.findFirst({
      where: {
        companyId,
        status: PayrollPeriodStatus.CLOSED,
        startDate: { lte: workDate },
        endDate: { gte: workDate },
      },
      select: { name: true },
    });
    if (closedPeriod) {
      throw new AppException('ATT_PERIOD_LOCKED', { period: closedPeriod.name });
    }

    let beforeValue: Prisma.InputJsonValue | undefined;
    let targetLogId: string | null = dto.attendanceLogId ?? null;

    if (dto.adjustType !== 'ADD') {
      if (!dto.attendanceLogId) {
        throw new AppException('SYS_VALIDATION_ERROR', {
          reason: 'MODIFY_TIME và VOID bắt buộc có attendanceLogId.',
        });
      }
      const log = await this.prisma.attendanceLog.findFirst({
        where: { id: dto.attendanceLogId, companyId, employeeId: dto.employeeId },
      });
      if (!log) {
        throw new AppException('ATT_NOT_FOUND');
      }
      beforeValue = {
        recordedAt: log.recordedAt.toISOString(),
        type: log.type,
        decision: log.decision,
      };
    }

    // BR-ADJ-01: KHÔNG sửa đè bản ghi thô. Với ADD, tạo một AttendanceLog mới có
    // authMethod = MANUAL để bảng công tính được, và luôn kèm bản ghi điều chỉnh.
    if (dto.adjustType === 'ADD') {
      const recordedAtRaw = dto.afterValue?.recordedAt;
      const typeRaw = dto.afterValue?.type;
      if (typeof recordedAtRaw !== 'string' || typeof typeRaw !== 'string') {
        throw new AppException('SYS_VALIDATION_ERROR', {
          reason: 'ADD bắt buộc có afterValue.recordedAt và afterValue.type.',
        });
      }

      const created = await this.prisma.attendanceLog.create({
        data: {
          companyId,
          employeeId: dto.employeeId,
          branchId: employee.branchId,
          type: typeRaw as AttendanceType,
          authMethod: AuthMethod.MANUAL,
          recordedAt: new Date(recordedAtRaw),
          workDate,
          createdByUserId: ctx.userId,
        },
      });
      targetLogId = created.id;
    }

    const adjustment = await this.prisma.attendanceAdjustment.create({
      data: {
        companyId,
        employeeId: dto.employeeId,
        workDate,
        attendanceLogId: targetLogId,
        adjustType: dto.adjustType,
        beforeValue,
        afterValue: (dto.afterValue ?? {}) as Prisma.InputJsonValue,
        reason: dto.reason,
        requestId: dto.requestId,
        createdByUserId: ctx.userId,
      },
    });

    // BR-ADJ-03: audit log đầy đủ giá trị cũ → mới.
    await this.audit.record(ctx, {
      action: 'ATTENDANCE_ADJUST',
      targetType: 'ATTENDANCE_LOG',
      targetId: targetLogId ?? dto.employeeId,
      reason: dto.reason,
      before: beforeValue,
      after: (dto.afterValue ?? {}) as Prisma.InputJsonValue,
    });

    // BR-ADJ-04: tự động kích hoạt tính lại bảng công của ngày đó.
    await this.attendance.enqueueRecalculate(companyId, dto.employeeId, workDate);

    // BR-ADJ-06 + minh bạch với người lao động: báo cho nhân viên biết.
    await this.notifications.notify({
      companyId,
      employeeId: dto.employeeId,
      type: 'ATTENDANCE_ADJUSTED',
      title: 'Công của bạn vừa được hiệu chỉnh',
      body: `Ngày ${dto.workDate} — ${this.describeAdjustType(dto.adjustType)}. Lý do: ${dto.reason}`,
      data: { workDate: dto.workDate, adjustmentId: adjustment.id },
    });

    return adjustment;
  }

  /** BR-ADJ-06 — nhân viên xem được lịch sử hiệu chỉnh liên quan tới mình. */
  async listAdjustments(companyId: string, employeeId: string, from?: string, to?: string) {
    const where: Prisma.AttendanceAdjustmentWhereInput = { companyId, employeeId };
    if (from || to) {
      where.workDate = {
        ...(from ? { gte: parseWorkDate(from) } : {}),
        ...(to ? { lte: parseWorkDate(to) } : {}),
      };
    }
    return this.prisma.attendanceAdjustment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  // ===========================================================================
  //  Xuất Excel (FR-WEB-ATT-05)
  // ===========================================================================

  /**
   * Xuất bất đồng bộ qua queue — trả 202 kèm jobId.
   * docs/04 mục 3.4: "Xuất Excel 5000 dòng không làm treo trình duyệt".
   */
  async requestExport(ctx: TenantContext, dto: ExportAttendanceDto) {
    const job = await this.prisma.exportJob.create({
      data: {
        companyId: ctx.companyId,
        createdBy: ctx.userId,
        kind: 'ATTENDANCE',
        status: 'QUEUED',
        params: dto as unknown as Prisma.InputJsonValue,
      },
    });

    await this.exportQueue.add(JOBS.EXPORT_ATTENDANCE, { exportJobId: job.id }).catch(
      async (error: Error) => {
        this.logger.error(`Không đẩy được job export: ${error.message}`);
        await this.prisma.exportJob.update({
          where: { id: job.id },
          data: { status: 'FAILED', errorMessage: error.message },
        });
      },
    );

    return { jobId: job.id, statusUrl: `/v1/jobs/${job.id}` };
  }

  async getJob(companyId: string, jobId: string) {
    const job = await this.prisma.exportJob.findFirst({ where: { id: jobId, companyId } });
    if (!job) {
      throw new AppException('SYS_NOT_FOUND');
    }
    return {
      ...job,
      downloadUrl: job.fileKey ? await this.storage.getPresignedUrl(job.fileKey) : null,
    };
  }

  private describeAdjustType(type: string): string {
    switch (type) {
      case 'ADD':
        return 'bổ sung bản ghi chấm công';
      case 'MODIFY_TIME':
        return 'điều chỉnh giờ chấm công';
      case 'VOID':
        return 'huỷ một lượt chấm công';
      default:
        return type;
    }
  }
}
