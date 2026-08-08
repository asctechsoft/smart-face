import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import ExcelJS from 'exceljs';
import { formatWorkDate, parseWorkDate } from 'src/common/utils';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { StorageService } from 'src/infra/storage/storage.service';
import { PayrollService } from 'src/modules/payroll/payroll.service';
import { JOBS, QUEUES } from '../queue.constants';

/**
 * Queue `export` — xuất Excel ở BACKEND, không ở client (docs/04 mục 7.4).
 *
 * NFR-PERF-08: 500 nhân viên × 31 ngày phải xong dưới 60 giây.
 * Kết quả lưu S3, người dùng tải qua presigned URL có thời hạn.
 */
// `concurrency: 2` — cố ý thấp. Dựng file Excel giữ TOÀN BỘ bảng tính trong RAM;
// chạy 10 job cùng lúc, mỗi job vài chục nghìn dòng, là pod worker bị OOM kill.
// Người dùng chờ thêm vài giây trong hàng đợi vẫn tốt hơn worker chết giữa chừng.
@Processor(QUEUES.EXPORT, { concurrency: 2 })
export class ExportProcessor extends WorkerHost {
  private readonly logger = new Logger(ExportProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly payroll: PayrollService,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    const { exportJobId } = job.data as { exportJobId: string };

    // Trạng thái theo dõi được lưu trong bảng `ExportJob` của database, KHÔNG chỉ
    // trong BullMQ. Client hỏi tiến độ qua `GET /v1/jobs/:id` — endpoint đó không
    // nên phụ thuộc vào Redis, và trạng thái phải sống sót qua lần Redis restart.
    await this.prisma.exportJob.update({
      where: { id: exportJobId },
      data: { status: 'PROCESSING', progress: 10 },
    });

    try {
      const exportJob = await this.prisma.exportJob.findUniqueOrThrow({
        where: { id: exportJobId },
      });

      const result =
        job.name === JOBS.EXPORT_PAYROLL
          ? await this.exportPayroll(exportJob.companyId, exportJob.params as Record<string, string>)
          : await this.exportAttendance(
              exportJob.companyId,
              exportJob.params as Record<string, string>,
            );

      const key = this.storage.buildExportKey(exportJob.companyId, exportJobId, result.fileName);
      await this.storage.upload(
        key,
        result.buffer,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );

      await this.prisma.exportJob.update({
        where: { id: exportJobId },
        data: {
          status: 'DONE',
          progress: 100,
          fileKey: key,
          fileName: result.fileName,
          completedAt: new Date(),
        },
      });

      return { key, rowCount: result.rowCount };
    } catch (error) {
      this.logger.error(`Export ${exportJobId} thất bại: ${(error as Error).message}`);
      await this.prisma.exportJob.update({
        where: { id: exportJobId },
        data: {
          status: 'FAILED',
          errorCode: 'EXPORT_FAILED',
          errorMessage: (error as Error).message,
          completedAt: new Date(),
        },
      });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------

  private async exportAttendance(companyId: string, params: Record<string, string>) {
    const from = params.from ? parseWorkDate(params.from) : new Date(0);
    const to = params.to ? parseWorkDate(params.to) : new Date();

    const dailies = await this.prisma.attendanceDaily.findMany({
      where: { companyId, workDate: { gte: from, lte: to } },
      orderBy: [{ workDate: 'asc' }, { employeeId: 'asc' }],
    });

    const employees = await this.prisma.employee.findMany({
      where: { companyId, deletedAt: null },
      select: {
        id: true,
        fullName: true,
        employeeCode: true,
        department: { select: { name: true } },
      },
    });
    const employeeMap = new Map(employees.map((employee) => [employee.id, employee]));

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SmartFace';
    const sheet = workbook.addWorksheet('Bảng công');

    sheet.columns = [
      { header: 'Ngày', key: 'workDate', width: 12 },
      { header: 'Mã NV', key: 'employeeCode', width: 18 },
      { header: 'Họ và tên', key: 'fullName', width: 25 },
      { header: 'Phòng ban', key: 'department', width: 20 },
      { header: 'Giờ vào', key: 'checkIn', width: 10 },
      { header: 'Giờ ra', key: 'checkOut', width: 10 },
      { header: 'Số phút làm', key: 'workedMinutes', width: 12 },
      { header: 'Đi muộn (phút)', key: 'lateMinutes', width: 14 },
      { header: 'Về sớm (phút)', key: 'earlyLeaveMinutes', width: 14 },
      { header: 'OT (phút)', key: 'otMinutes', width: 10 },
      { header: 'Công chuẩn', key: 'standardDays', width: 12 },
      { header: 'Trạng thái', key: 'status', width: 16 },
      { header: 'Cờ nghi vấn', key: 'hasFraudFlag', width: 12 },
    ];
    sheet.getRow(1).font = { bold: true };

    for (const daily of dailies) {
      const employee = employeeMap.get(daily.employeeId);
      sheet.addRow({
        workDate: formatWorkDate(daily.workDate),
        employeeCode: employee?.employeeCode ?? daily.employeeId,
        fullName: employee?.fullName ?? '',
        department: employee?.department?.name ?? '',
        checkIn: daily.firstCheckInAt?.toISOString().slice(11, 16) ?? '',
        checkOut: daily.lastCheckOutAt?.toISOString().slice(11, 16) ?? '',
        workedMinutes: daily.workedMinutes,
        lateMinutes: daily.lateMinutes,
        earlyLeaveMinutes: daily.earlyLeaveMinutes,
        otMinutes: daily.otMinutes,
        standardDays: Number(daily.standardDays),
        status: daily.status,
        hasFraudFlag: daily.hasFraudFlag ? 'Có' : '',
      });
    }

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return {
      buffer,
      fileName: `bang-cong-${params.from ?? 'all'}-${params.to ?? 'all'}.xlsx`,
      rowCount: dailies.length,
    };
  }

  private async exportPayroll(companyId: string, params: Record<string, string>) {
    const summary = await this.payroll.getPeriodSummary(companyId, params.periodId);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SmartFace';
    const sheet = workbook.addWorksheet('Bảng lương');

    sheet.columns = [
      { header: 'Mã NV', key: 'employeeCode', width: 18 },
      { header: 'Họ và tên', key: 'fullName', width: 25 },
      { header: 'Tổng công chuẩn', key: 'standardDays', width: 16 },
      { header: 'Số phút làm', key: 'workedMinutes', width: 14 },
      { header: 'OT ngày thường', key: 'otNormal', width: 16 },
      { header: 'OT cuối tuần', key: 'otWeekend', width: 14 },
      { header: 'OT ngày lễ', key: 'otHoliday', width: 14 },
      { header: 'Số lần đi muộn', key: 'lateCount', width: 14 },
      { header: 'Tổng phút muộn', key: 'lateMinutesTotal', width: 16 },
      { header: 'Số lần về sớm', key: 'earlyLeaveCount', width: 14 },
      { header: 'Ngày nghỉ phép', key: 'leaveDays', width: 14 },
      { header: 'Phút làm bù', key: 'makeupMinutes', width: 14 },
      { header: 'Tiền phạt', key: 'penaltyAmount', width: 14 },
    ];
    sheet.getRow(1).font = { bold: true };

    for (const row of summary.items) {
      const employee = 'employee' in row ? row.employee : null;
      sheet.addRow({
        employeeCode: employee?.employeeCode ?? row.employeeId,
        fullName: employee?.fullName ?? '',
        standardDays: Number(row.standardDays),
        workedMinutes: row.workedMinutes,
        otNormal: row.otMinutesNormal,
        otWeekend: row.otMinutesWeekend,
        otHoliday: row.otMinutesHoliday,
        lateCount: row.lateCount,
        lateMinutesTotal: row.lateMinutesTotal,
        earlyLeaveCount: row.earlyLeaveCount,
        leaveDays: Number(row.leaveDays),
        makeupMinutes: row.makeupMinutes,
        penaltyAmount: row.penaltyAmount ? Number(row.penaltyAmount) : '',
      });
    }

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return {
      buffer,
      fileName: `bang-luong-${summary.period.name.replace(/[^\w]/g, '-')}.xlsx`,
      rowCount: summary.items.length,
    };
  }
}
