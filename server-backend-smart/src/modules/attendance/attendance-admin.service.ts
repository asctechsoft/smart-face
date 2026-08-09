import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { AttendanceType, AuthMethod, Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { PaginatedResult } from 'src/common/dto';
import { AppException } from 'src/common/errors';
import { buildMeta, formatWorkDate, parseWorkDate } from 'src/common/utils';
import { StorageService } from 'src/infra/storage/storage.service';
import { JOBS, QUEUES } from 'src/infra/queue/queue.constants';
import { AuditService } from '../audit/audit.service';
import { NotificationService } from '../notification/notification.service';
import { AttendanceRepository } from './attendance.repository';
import { AttendanceService } from './attendance.service';
import type {
  AdjustAttendanceDto,
  AdminAttendanceQueryDto,
  ExportAttendanceDto,
} from './dto/attendance.dto';
import type { TenantContext } from 'src/common/types/request-context';

/**
 * Tham số job xuất bảng công, đã chốt tại thời điểm gửi yêu cầu.
 *
 * Khác `ExportAttendanceDto` ở đúng một điểm quan trọng: `departmentIds` ở đây
 * là phạm vi ĐÃ ÁP QUYỀN, không phải bộ lọc client gửi lên.
 */
export interface AttendanceExportParams {
  from?: string;
  to?: string;
  /** `null` = toàn công ty. Mảng rỗng = không phòng ban nào (fail-closed, có chủ đích). */
  departmentIds: string[] | null;
}

/**
 * Giao phạm vi phòng ban của người yêu cầu với bộ lọc họ gửi lên.
 *
 * `scope === null` là HR/Admin xem toàn công ty — khi đó bộ lọc client gửi được
 * dùng nguyên. Với `MANAGER`, kết quả LUÔN nằm trong `scope` kể cả khi client
 * gửi phòng ban ngoài phạm vi: `ScopeGuard` đã chặn trường hợp đó ở tầng trên,
 * đây là lớp thứ hai vì phép giao rẻ hơn nhiều so với một vụ rò rỉ.
 */
export function resolveExportDepartmentFilter(
  requested: string[] | undefined,
  scope: string[] | null,
): string[] | null {
  if (scope === null) {
    return requested?.length ? [...requested] : null;
  }
  if (!requested?.length) return [...scope];
  return requested.filter((id) => scope.includes(id));
}

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
    private readonly attendances: AttendanceRepository,
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
    const employees = await this.attendances.findEmployeesInScope(companyId, {
      departmentId: query.departmentId,
      branchId: query.branchId,
      employeeId: query.employeeId,
      departmentScope,
      q: query.q,
    });
    const employeeIds = employees.map((employee) => employee.id);

    if (employeeIds.length === 0) {
      return new PaginatedResult([], buildMeta(query.page, query.pageSize, 0));
    }

    const { items: rows, total } = await this.attendances.searchDaily(companyId, {
      employeeIds,
      from: query.from ? parseWorkDate(query.from) : undefined,
      to: query.to ? parseWorkDate(query.to) : undefined,
      status: query.status,
      hasFraudFlag: query.hasFraudFlag,
      skip: query.skip,
      take: query.take,
    });

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
    const logs = await this.attendances.listLogsWithDetailsForDay(
      companyId,
      employeeId,
      parseWorkDate(workDate),
    );

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

    const employee = await this.attendances.findEmployee(companyId, dto.employeeId);
    if (!employee) {
      throw new AppException('EMP_NOT_FOUND');
    }

    // BR-ADJ-05: không hiệu chỉnh dữ liệu thuộc kỳ lương đã chốt.
    const closedPeriod = await this.attendances.findClosedPeriodCovering(companyId, workDate);
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
      const log = await this.attendances.findLog(companyId, dto.employeeId, dto.attendanceLogId);
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

      const created = await this.attendances.createLog(companyId, {
        employeeId: dto.employeeId,
        branchId: employee.branchId,
        type: typeRaw as AttendanceType,
        authMethod: AuthMethod.MANUAL,
        recordedAt: new Date(recordedAtRaw),
        workDate,
        createdByUserId: ctx.userId,
      });
      targetLogId = created.id;
    }

    const adjustment = await this.attendances.createAdjustment(companyId, {
      employeeId: dto.employeeId,
      workDate,
      attendanceLogId: targetLogId,
      adjustType: dto.adjustType,
      beforeValue,
      afterValue: (dto.afterValue ?? {}) as Prisma.InputJsonValue,
      reason: dto.reason,
      requestId: dto.requestId,
      createdByUserId: ctx.userId,
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
    return this.attendances.listAdjustments(companyId, employeeId, {
      from: from ? parseWorkDate(from) : undefined,
      to: to ? parseWorkDate(to) : undefined,
    });
  }

  // ===========================================================================
  //  Xuất Excel (FR-WEB-ATT-05)
  // ===========================================================================

  /**
   * Xuất bất đồng bộ qua queue — trả 202 kèm jobId.
   * docs/04 mục 3.4: "Xuất Excel 5000 dòng không làm treo trình duyệt".
   *
   * ⚠ Phạm vi phòng ban phải được CHỐT ở đây rồi ghi vào `params`. Worker chạy
   * sau, ở pod khác, không còn request context — nó không có cách nào suy lại
   * `MANAGER` này được xem phòng ban nào. Lưu `dto` nguyên xi như trước là để
   * lọt: một `MANAGER` xuất được bảng công toàn công ty (`BR-09`).
   *
   * @param departmentScope kết quả `resolveDepartmentScope(ctx)` — null = toàn công ty.
   */
  async requestExport(
    ctx: TenantContext,
    dto: ExportAttendanceDto,
    departmentScope: string[] | null,
  ) {
    const params: AttendanceExportParams = {
      from: dto.from,
      to: dto.to,
      departmentIds: resolveExportDepartmentFilter(dto.departmentIds, departmentScope),
    };

    const job = await this.attendances.createExportJob(ctx.companyId, {
      createdBy: ctx.userId,
      kind: 'ATTENDANCE',
      params: params as unknown as Prisma.InputJsonValue,
    });

    await this.exportQueue
      .add(JOBS.EXPORT_ATTENDANCE, { exportJobId: job.id })
      .catch(async (error: Error) => {
        this.logger.error(`Không đẩy được job export: ${error.message}`);
        await this.attendances.markExportJobFailed(ctx.companyId, job.id, error.message);
      });

    return { jobId: job.id, statusUrl: `/v1/jobs/${job.id}` };
  }

  async getJob(companyId: string, jobId: string) {
    const job = await this.attendances.findExportJob(companyId, jobId);
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
