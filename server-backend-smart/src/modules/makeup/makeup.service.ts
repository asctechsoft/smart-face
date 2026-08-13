import { Injectable } from '@nestjs/common';
import { MakeupWorkRecord } from '@prisma/client';
import { PaginatedResult } from 'src/common/dto';
import { AppException } from 'src/common/errors';
import { buildMeta, formatWorkDate, parseWorkDate, toWorkDate } from 'src/common/utils';
import { TransactionManager } from 'src/infra/prisma/transaction.manager';
import type { TenantContext } from 'src/common/types/request-context';
import { AuditService } from '../audit/audit.service';
import { NotificationService } from '../notification/notification.service';
import { PolicyKeys } from '../policy/policy.constants';
import { PolicyService } from '../policy/policy.service';
import {
  CreateMakeupDebtDto,
  ExtendMakeupDto,
  MakeupQueryDto,
  RecordMakeupDto,
} from './dto/makeup.dto';
import { MakeupRepository, MakeupRecordWithEmployee } from './makeup.repository';

/** Quy tắc quy đổi giờ bù sang công chuẩn — FR-WEB-MKUP-01, tất cả đều cấu hình được (BR-12). */
export interface MakeupConversion {
  minutesPerStandardDay: number;
  roundingMinutes: number;
  roundingMode: string;
  dueDays: number;
  carrySurplusToNextMonth: boolean;
}

/**
 * Công làm bù — docs/04 mục 5 (`FR-WEB-MKUP-01..04`).
 *
 * ## Mô hình dữ liệu
 *
 * Mỗi dòng `MakeupWorkRecord` là MỘT khoản nợ công gắn với TỐI ĐA MỘT lần làm
 * bù. Ràng buộc này đến từ engine tính công: nó cộng `makeupMinutes` vào đúng
 * ngày `makeupWorkDate` (`sumMakeupMinutes`), nên một dòng không biểu diễn được
 * hai ngày bù khác nhau.
 *
 * Vì vậy bù dở dang (FR-WEB-MKUP-02) được xử lý bằng cách TÁCH DÒNG: dòng hiện
 * tại đóng lại với đúng số phút đã bù, phần còn nợ chuyển sang một dòng mới giữ
 * nguyên `debtWorkDate` và `dueDate`. Tổng nợ không đổi, mà mỗi lần bù vẫn nằm
 * đúng ngày của nó.
 *
 * ```
 * Nợ 200 phút ngày 05/08, hạn 04/09
 *   bù 120 phút ngày 12/08  →  dòng A: nợ 120, bù 120 ngày 12/08, COMPLETED
 *                              dòng B: nợ  80, chưa bù,           OPEN (hạn 04/09)
 *   bù  80 phút ngày 19/08  →  dòng B: nợ  80, bù  80 ngày 19/08, COMPLETED
 * ```
 *
 * Gộp nhiều lần bù thành một công hoàn chỉnh (FR-WEB-MKUP-03) là phép cộng ở
 * tầng tổng hợp, không phải ở tầng bản ghi: `summary` cộng phút của mọi dòng rồi
 * quy đổi sang công chuẩn theo chính sách công ty.
 */
@Injectable()
export class MakeupService {
  constructor(
    private readonly records: MakeupRepository,
    private readonly transactions: TransactionManager,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  // ---------------------------------------------------------------------------
  // Đọc
  // ---------------------------------------------------------------------------

  async list(companyId: string, query: MakeupQueryDto, departmentScope: string[] | null) {
    const today = await this.companyToday(companyId);
    // Đồng bộ trạng thái trước khi đọc: bộ lọc "Đã hết hạn" phải khớp với con số
    // hiển thị trên thẻ chỉ số, mà cả hai đều đọc từ cột `status`.
    await this.records.markExpired(companyId, today);

    const { items, total } = await this.records.search(companyId, {
      ...this.toFilter(query, departmentScope),
      skip: query.skip,
      take: query.take,
    });

    const conversion = await this.getConversion(companyId);

    return new PaginatedResult(
      items.map((record) => this.present(record, conversion, today)),
      buildMeta(query.page, query.pageSize, total),
    );
  }

  /**
   * Thẻ chỉ số đầu màn hình.
   *
   * Trả kèm `conversion` để giao diện hiển thị "còn nợ 3h20 ≈ 0.42 công" mà
   * không phải đoán quy tắc quy đổi — quy tắc đó do công ty cấu hình và đổi được
   * bất cứ lúc nào (BR-12).
   */
  async summary(companyId: string, query: MakeupQueryDto, departmentScope: string[] | null) {
    const today = await this.companyToday(companyId);
    await this.records.markExpired(companyId, today);

    const conversion = await this.getConversion(companyId);
    const totals = await this.records.totals(companyId, {
      ...this.toFilter(query, departmentScope),
      skip: 0,
      take: 0,
    });

    // Thẻ "quá hạn" cố ý BỎ bộ lọc trạng thái: nó là cảnh báo, và lọc đang xem
    // "Đã bù đủ" mà thẻ cảnh báo tụt về 0 sẽ đọc thành "không còn khoản nào quá hạn".
    const overdue = await this.records.totals(companyId, {
      ...this.toFilter(query, departmentScope),
      status: undefined,
      overdueBefore: today,
      skip: 0,
      take: 0,
    });

    return {
      ...totals,
      openDebtStandardDays: this.toStandardDays(totals.openDebtMinutes, conversion),
      madeUpStandardDays: this.toStandardDays(totals.madeUpMinutes, conversion),
      overdueRecords: overdue.openRecords,
      overdueMinutes: overdue.openDebtMinutes,
      conversion,
    };
  }

  // ---------------------------------------------------------------------------
  // Ghi
  // ---------------------------------------------------------------------------

  /** Tạo khoản nợ công — thường do engine sinh, đường này dành cho ghi nhận tay. */
  async createDebt(ctx: TenantContext, dto: CreateMakeupDebtDto) {
    const conversion = await this.getConversion(ctx.companyId);
    const debtWorkDate = parseWorkDate(dto.debtWorkDate);

    // Hạn làm bù đếm từ NGÀY PHÁT SINH NỢ, không phải ngày nhập liệu: HR nhập bù
    // cho tháng trước mà tính hạn từ hôm nay là tự kéo dài hạn thêm một tháng.
    const dueDate = dto.dueDate
      ? parseWorkDate(dto.dueDate)
      : this.addDays(debtWorkDate, conversion.dueDays);

    const created = await this.records.create(ctx.companyId, {
      employeeId: dto.employeeId,
      debtWorkDate,
      debtMinutes: dto.debtMinutes,
      remainingMinutes: dto.debtMinutes,
      dueDate,
      status: 'OPEN',
    });

    await this.audit.record(ctx, {
      action: 'MAKEUP_DEBT_CREATE',
      targetType: 'MAKEUP',
      targetId: created.id,
      reason: dto.reason,
      after: {
        employeeId: dto.employeeId,
        debtWorkDate: dto.debtWorkDate,
        debtMinutes: dto.debtMinutes,
        dueDate: formatWorkDate(dueDate),
      },
    });

    await this.notifications.notify({
      companyId: ctx.companyId,
      employeeId: dto.employeeId,
      type: 'MAKEUP_DEBT_CREATED',
      title: 'Bạn có giờ công cần làm bù',
      body: `Thiếu ${this.formatMinutes(dto.debtMinutes)} của ngày ${formatWorkDate(debtWorkDate)}. Hạn làm bù: ${formatWorkDate(dueDate)}.`,
    });

    return this.present(created, conversion, await this.companyToday(ctx.companyId));
  }

  /**
   * Ghi nhận một lần làm bù — FR-WEB-MKUP-02, FR-WEB-MKUP-03.
   *
   * Bù thiếu thì tách phần còn nợ sang dòng mới (xem docblock của class). Bù
   * VƯỢT số nợ bị từ chối thẳng: phần dôi ra không phải công làm bù mà là tăng
   * ca, và tăng ca có luồng duyệt cùng hệ số lương riêng — cộng nhầm vào đây là
   * trả sai lương theo hướng có lợi cho công ty.
   */
  async record(ctx: TenantContext, id: string, dto: RecordMakeupDto) {
    const existing = await this.requireRecord(ctx.companyId, id);
    const today = await this.companyToday(ctx.companyId);

    if (existing.status === 'COMPLETED') {
      throw new AppException('MKUP_ALREADY_CLOSED');
    }
    if (existing.dueDate && existing.dueDate < today) {
      throw new AppException('MKUP_OVERDUE', {
        dueDate: formatWorkDate(existing.dueDate),
        hint: 'Gia hạn khoản nợ trước khi ghi nhận giờ làm bù.',
      });
    }
    if (dto.minutes > existing.remainingMinutes) {
      throw new AppException('MKUP_EXCEEDS_DEBT', {
        remainingMinutes: existing.remainingMinutes,
        provided: dto.minutes,
      });
    }

    const makeupWorkDate = parseWorkDate(dto.makeupWorkDate);
    const leftover = existing.remainingMinutes - dto.minutes;

    const { updated, carried } = await this.transactions.run(async (tx) => {
      const updated = await this.records.update(
        ctx.companyId,
        id,
        {
          // `debtMinutes` co lại đúng bằng phần được bù ở dòng này. Phần còn nợ
          // không biến mất — nó sang dòng `carried` ngay bên dưới, nên tổng nợ
          // của nhân viên không đổi.
          debtMinutes: dto.minutes,
          makeupWorkDate,
          makeupMinutes: existing.makeupMinutes + dto.minutes,
          remainingMinutes: 0,
          requestId: dto.requestId ?? existing.requestId,
          status: 'COMPLETED',
        },
        tx,
      );

      const carried =
        leftover > 0
          ? await this.records.create(
              ctx.companyId,
              {
                employeeId: existing.employeeId,
                debtWorkDate: existing.debtWorkDate,
                debtMinutes: leftover,
                remainingMinutes: leftover,
                dueDate: existing.dueDate,
                // `PARTIAL` chứ không phải `OPEN`: khoản nợ của ngày đó ĐÃ được
                // bù một phần. Trạng thái này là thứ phân biệt "chưa bù lần nào"
                // với "bù dở dang" trên giao diện và trong báo cáo.
                status: 'PARTIAL',
              },
              tx,
            )
          : null;

      return { updated, carried };
    });

    await this.audit.record(ctx, {
      action: 'MAKEUP_RECORD',
      targetType: 'MAKEUP',
      targetId: id,
      before: {
        remainingMinutes: existing.remainingMinutes,
        status: existing.status,
      },
      after: {
        makeupWorkDate: dto.makeupWorkDate,
        minutes: dto.minutes,
        status: 'COMPLETED',
        carriedRecordId: carried?.id ?? null,
        carriedMinutes: leftover,
      },
    });

    await this.notifications.notify({
      companyId: ctx.companyId,
      employeeId: existing.employeeId,
      type: 'MAKEUP_RECORDED',
      title: 'Đã ghi nhận giờ làm bù',
      body:
        leftover > 0
          ? `Ghi nhận ${this.formatMinutes(dto.minutes)} ngày ${dto.makeupWorkDate}. Còn nợ ${this.formatMinutes(leftover)}.`
          : `Ghi nhận ${this.formatMinutes(dto.minutes)} ngày ${dto.makeupWorkDate}. Bạn đã bù đủ giờ.`,
    });

    const conversion = await this.getConversion(ctx.companyId);
    return {
      record: updated ? this.present(updated, conversion, today) : null,
      carried: carried ? this.present(carried, conversion, today) : null,
    };
  }

  /** Gia hạn — ngoại lệ có kiểm soát, luôn kèm lý do vào audit log. */
  async extend(ctx: TenantContext, id: string, dto: ExtendMakeupDto) {
    const existing = await this.requireRecord(ctx.companyId, id);
    if (existing.status === 'COMPLETED') {
      throw new AppException('MKUP_ALREADY_CLOSED');
    }

    const dueDate = parseWorkDate(dto.dueDate);

    // Gia hạn phải MỞ LẠI khoản đã hết hạn — không thì gia hạn xong vẫn không ghi
    // nhận giờ bù được, và người dùng phải đoán vì sao.
    //
    // Khôi phục đúng trạng thái cũ chứ không đổ hết về `OPEN`: một khoản đã bù
    // dở dang thì phần còn nợ nằm ở dòng `PARTIAL`, và "đã bù được một phần" là
    // thông tin người duyệt cần khi quyết định có gia hạn tiếp hay không.
    const alreadyMadeUp = await this.records.countCompletedSiblings(
      ctx.companyId,
      existing.employeeId,
      existing.debtWorkDate,
      existing.id,
    );

    const updated = await this.records.update(ctx.companyId, id, {
      dueDate,
      status: alreadyMadeUp > 0 ? 'PARTIAL' : 'OPEN',
    });

    await this.audit.record(ctx, {
      action: 'MAKEUP_EXTEND',
      targetType: 'MAKEUP',
      targetId: id,
      reason: dto.reason,
      before: {
        dueDate: existing.dueDate ? formatWorkDate(existing.dueDate) : null,
        status: existing.status,
      },
      after: { dueDate: dto.dueDate },
    });

    const conversion = await this.getConversion(ctx.companyId);
    return updated
      ? this.present(updated, conversion, await this.companyToday(ctx.companyId))
      : null;
  }

  /**
   * Huỷ khoản nợ ghi nhầm.
   *
   * Chỉ huỷ được khi CHƯA ghi nhận giờ bù nào. Khoản đã bù một phần thì số phút
   * đó đã được engine cộng vào bảng công của ngày làm bù; xoá dòng đi là làm
   * bảng công ngày đó tính lại ra số khác mà không có gì giải thích.
   */
  async cancel(ctx: TenantContext, id: string, reason: string) {
    const existing = await this.requireRecord(ctx.companyId, id);
    if (existing.makeupMinutes > 0) {
      throw new AppException('MKUP_ALREADY_CLOSED', {
        reason: 'Khoản đã ghi nhận giờ làm bù thì không huỷ được, giờ đó đã vào bảng công.',
      });
    }

    await this.records.delete(ctx.companyId, id);

    await this.audit.record(ctx, {
      action: 'MAKEUP_CANCEL',
      targetType: 'MAKEUP',
      targetId: id,
      reason,
      before: {
        employeeId: existing.employeeId,
        debtWorkDate: formatWorkDate(existing.debtWorkDate),
        debtMinutes: existing.debtMinutes,
      },
    });

    return { cancelled: true };
  }

  // ---------------------------------------------------------------------------
  // Helper
  // ---------------------------------------------------------------------------

  async getConversion(companyId: string): Promise<MakeupConversion> {
    const [minutesPerStandardDay, roundingMinutes, dueDays, roundingMode, carrySurplus] =
      await Promise.all([
        this.policy.getNumber(companyId, PolicyKeys.PAYROLL_MINUTES_PER_STANDARD_DAY),
        this.policy.getNumber(companyId, PolicyKeys.PAYROLL_ROUNDING_MINUTES),
        this.policy.getNumber(companyId, PolicyKeys.MAKEUP_DUE_DAYS),
        this.policy.get<string>(companyId, PolicyKeys.PAYROLL_ROUNDING_MODE),
        this.policy.getBoolean(companyId, PolicyKeys.MAKEUP_CARRY_SURPLUS),
      ]);

    return {
      minutesPerStandardDay,
      roundingMinutes,
      roundingMode: roundingMode ?? 'NEAREST',
      dueDays,
      carrySurplusToNextMonth: carrySurplus,
    };
  }

  private toFilter(query: MakeupQueryDto, departmentScope: string[] | null) {
    return {
      status: query.status,
      employeeId: query.employeeId,
      departmentId: query.departmentId,
      departmentScope,
      from: query.from ? parseWorkDate(query.from) : undefined,
      to: query.to ? parseWorkDate(query.to) : undefined,
      q: query.q,
    };
  }

  /**
   * Bổ sung các trường TÍNH ĐƯỢC mà giao diện cần.
   *
   * Tính ở Backend chứ không để client tự làm: quy tắc làm tròn và số phút một
   * công chuẩn là chính sách công ty, và hai nơi cùng cài đặt một công thức thì
   * sớm muộn sẽ lệch nhau — lúc đó con số trên màn hình khác con số trong bảng
   * lương mà không ai biết bên nào đúng.
   */
  private present(
    record: MakeupWorkRecord | MakeupRecordWithEmployee,
    conversion: MakeupConversion,
    today: Date,
  ) {
    const isOverdue =
      record.status !== 'COMPLETED' && record.dueDate !== null && record.dueDate < today;

    return {
      ...record,
      debtWorkDate: formatWorkDate(record.debtWorkDate),
      makeupWorkDate: record.makeupWorkDate ? formatWorkDate(record.makeupWorkDate) : null,
      dueDate: record.dueDate ? formatWorkDate(record.dueDate) : null,
      debtStandardDays: this.toStandardDays(record.debtMinutes, conversion),
      remainingStandardDays: this.toStandardDays(record.remainingMinutes, conversion),
      isOverdue,
      daysUntilDue: record.dueDate ? this.daysBetween(today, record.dueDate) : null,
    };
  }

  /** Quy đổi phút → công chuẩn theo cấu hình công ty (FR-WEB-MKUP-01). */
  private toStandardDays(minutes: number, conversion: MakeupConversion): number {
    if (conversion.minutesPerStandardDay <= 0) return 0;
    const rounded = this.applyRounding(minutes, conversion);
    return Math.round((rounded / conversion.minutesPerStandardDay) * 1000) / 1000;
  }

  private applyRounding(minutes: number, conversion: MakeupConversion): number {
    const step = conversion.roundingMinutes;
    if (!step || step <= 0) return minutes;

    const quotient = minutes / step;
    switch (conversion.roundingMode) {
      // DOWN có lợi cho công ty, UP có lợi cho nhân viên — công ty tự chọn, hệ
      // thống không mặc định giùm bên nào ngoài "gần nhất".
      case 'DOWN':
        return Math.floor(quotient) * step;
      case 'UP':
        return Math.ceil(quotient) * step;
      default:
        return Math.round(quotient) * step;
    }
  }

  private async requireRecord(companyId: string, id: string): Promise<MakeupWorkRecord> {
    const record = await this.records.findById(companyId, id);
    if (!record) {
      throw new AppException('MKUP_NOT_FOUND');
    }
    return record;
  }

  /** "Hôm nay" theo múi giờ CÔNG TY, không phải của server (docs/04 mục 6.4). */
  private async companyToday(companyId: string): Promise<Date> {
    const timezone = await this.policy.getTimezone(companyId);
    return toWorkDate(new Date(), timezone);
  }

  private addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setUTCDate(result.getUTCDate() + days);
    return result;
  }

  private daysBetween(from: Date, to: Date): number {
    return Math.round((to.getTime() - from.getTime()) / 86_400_000);
  }

  private formatMinutes(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (hours === 0) return `${rest} phút`;
    if (rest === 0) return `${hours} giờ`;
    return `${hours} giờ ${rest} phút`;
  }
}
