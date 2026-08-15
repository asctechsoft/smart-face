import { Injectable, Logger } from '@nestjs/common';
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
  private readonly logger = new Logger(MakeupService.name);

  constructor(
    private readonly records: MakeupRepository,
    private readonly transactions: TransactionManager,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  // ---------------------------------------------------------------------------
  // Engine tính công gọi vào
  // ---------------------------------------------------------------------------

  /**
   * Đồng bộ khoản nợ ENGINE của một ngày công với số giờ thực sự thiếu.
   *
   * ## Vì sao hàm này tồn tại
   *
   * docs/04 mục 5.1: nợ công phát sinh từ việc đi muộn / về sớm tích luỹ, tức là
   * từ engine tính công. Trước đây `MakeupWorkRecord` chỉ được tạo bằng tay qua
   * màn "Ghi nhận nợ công", nên sổ làm bù gần như luôn trống và mọi thứ dựa trên
   * nó — kể cả đơn xin làm bù — không có gì để trừ vào.
   *
   * ## Vì sao nó phải phức tạp hơn một lệnh `create`
   *
   * `calculateAndPersist` là hàm IDEMPOTENT (NFR-REL-06) và bị gọi lại rất nhiều
   * lần cho cùng một ngày: mỗi lần hiệu chỉnh công, mỗi lần duyệt đơn ngược quá
   * khứ, và mỗi đêm khi cron quét. Một lệnh `create` trần ở đây sẽ nhân bản nợ
   * sau mỗi lần chạy — và đây là con số đi thẳng vào bảng lương.
   *
   * Nên hàm này ĐỐI CHIẾU thay vì ghi thêm: giữ cho tổng nợ ENGINE của ngày đó
   * luôn bằng `shortfallMinutes`, dù chạy một lần hay một trăm lần.
   *
   * ## Ba ranh giới không được vượt
   *
   * 1. **Chỉ đụng dòng `source = ENGINE`.** Khoản nợ HR nhập tay theo thoả thuận
   *    riêng phải sống sót qua mọi lần tính lại.
   * 2. **Không bao giờ sửa dòng đã có giờ bù.** Nhân viên đã làm bù thật; xoá
   *    dòng đó là xoá công đã làm của người ta.
   * 3. **Không tạo nợ cho ngày nghỉ, ngày lễ, hay ngày vắng mặt** — việc lọc đó
   *    nằm ở phía engine, hàm này chỉ nhận `shortfallMinutes` đã tính sẵn.
   */
  async reconcileEngineDebt(
    companyId: string,
    employeeId: string,
    debtWorkDate: Date,
    shortfallMinutes: number,
  ): Promise<void> {
    const existing = await this.records.findEngineDebts(companyId, employeeId, debtWorkDate);
    const recorded = existing.reduce((sum, row) => sum + row.debtMinutes, 0);

    // Đường thoát nhanh và cũng là bảo chứng idempotent: chạy lại khi không có
    // gì đổi thì không phát sinh một lệnh ghi nào.
    if (recorded === shortfallMinutes) return;

    if (shortfallMinutes > recorded) {
      await this.growEngineDebt(
        companyId,
        employeeId,
        debtWorkDate,
        existing,
        shortfallMinutes - recorded,
      );
      return;
    }

    await this.shrinkEngineDebt(companyId, existing, recorded - shortfallMinutes);
  }

  /** Nợ tăng: dồn vào dòng chưa bù nếu có, không thì mở dòng mới. */
  private async growEngineDebt(
    companyId: string,
    employeeId: string,
    debtWorkDate: Date,
    existing: MakeupWorkRecord[],
    delta: number,
  ): Promise<void> {
    const untouched = existing.find((row) => row.makeupMinutes === 0 && row.status !== 'COMPLETED');

    if (untouched) {
      await this.records.update(companyId, untouched.id, {
        debtMinutes: untouched.debtMinutes + delta,
        remainingMinutes: untouched.remainingMinutes + delta,
      });
      return;
    }

    const conversion = await this.getConversion(companyId);
    await this.records.create(companyId, {
      employeeId,
      debtWorkDate,
      debtMinutes: delta,
      remainingMinutes: delta,
      // Hạn đếm từ NGÀY PHÁT SINH NỢ, không phải hôm nay: tính lại một ngày của
      // tháng trước mà lấy hạn từ hôm nay là tự kéo dài hạn thêm một tháng.
      dueDate: this.addDays(debtWorkDate, conversion.dueDays),
      status: 'OPEN',
      source: 'ENGINE',
    });
  }

  /**
   * Nợ giảm (ngày được hiệu chỉnh, hoặc đơn nghỉ được duyệt ngược quá khứ).
   *
   * Cắt từ dòng MỚI NHẤT ngược lên và chỉ cắt vào phần CHƯA BÙ. Phần đã bù thì
   * giữ nguyên: đó là giờ nhân viên đã làm thật, và nó vẫn đang được cộng vào
   * công của ngày làm bù.
   */
  private async shrinkEngineDebt(
    companyId: string,
    existing: MakeupWorkRecord[],
    excess: number,
  ): Promise<void> {
    let left = excess;

    for (const row of existing) {
      if (left <= 0) break;
      if (row.makeupMinutes > 0) continue;

      if (row.debtMinutes <= left) {
        left -= row.debtMinutes;
        await this.records.delete(companyId, row.id);
        continue;
      }

      await this.records.update(companyId, row.id, {
        debtMinutes: row.debtMinutes - left,
        remainingMinutes: Math.max(0, row.remainingMinutes - left),
      });
      left = 0;
    }

    // Còn dư nghĩa là phần vượt nằm ở các dòng ĐÃ BÙ. Không đụng vào, nhưng cũng
    // không im lặng: nhân viên đã làm bù cho một khoản nợ mà nay không còn nữa,
    // và số giờ đó cần được xử lý như tăng ca chứ không phải bù công.
    if (left > 0) {
      this.logger.warn(
        `Nợ công giảm ${excess} phút nhưng chỉ cắt được ${excess - left}: phần còn lại đã được làm bù. ` +
          `Kiểm tra lại ngày ${formatWorkDate(existing[0]?.debtWorkDate ?? new Date())} của nhân viên ${existing[0]?.employeeId}.`,
      );
    }
  }

  /**
   * Áp giờ làm bù từ một ĐƠN vừa được duyệt vào các khoản còn nợ.
   *
   * ## Vì sao cần
   *
   * Duyệt đơn làm bù trước đây không chạm gì vào sổ: `commitLeaveDeduction` chỉ
   * xử lý `deductFrom = ANNUAL_LEAVE`, còn `MAKEUP_CREDIT` rơi thẳng ra ngoài,
   * im lặng. Người duyệt bấm đồng ý và không có gì xảy ra.
   *
   * ## Trả nợ CŨ NHẤT TRƯỚC
   *
   * Khoản cũ nhất cũng là khoản sắp hết hạn nhất. Trả khoản mới trước sẽ để
   * khoản cũ rơi vào quá hạn trong khi nhân viên đã làm bù đủ giờ — rồi họ phải
   * đi xin gia hạn cho một khoản mình đã trả.
   *
   * ## Vượt quá số nợ thì TỪ CHỐI, không cắt bớt
   *
   * Phần dôi ra không phải công làm bù mà là tăng ca, và tăng ca có luồng duyệt
   * cùng hệ số lương riêng (150% / 200% / 300%). Lặng lẽ nuốt phần dôi là trả
   * thiếu lương; lặng lẽ cộng vào là trả sai hệ số. Cả hai đều sai theo hướng
   * không ai phát hiện ra, nên đơn bị chặn ngay lúc duyệt kèm số nợ thực tế.
   */
  async applyFromApprovedRequest(
    ctx: TenantContext,
    input: { employeeId: string; minutes: number; makeupWorkDate: Date; requestId: string },
  ): Promise<{ appliedMinutes: number; touchedRecordIds: string[] }> {
    if (input.minutes <= 0) return { appliedMinutes: 0, touchedRecordIds: [] };

    const debts = await this.records.findOutstandingDebts(ctx.companyId, input.employeeId);
    const outstanding = debts.reduce((sum, row) => sum + row.remainingMinutes, 0);

    if (input.minutes > outstanding) {
      throw new AppException('MKUP_EXCEEDS_DEBT', {
        remainingMinutes: outstanding,
        provided: input.minutes,
        hint:
          outstanding === 0
            ? 'Nhân viên không còn khoản công nào cần bù. Giờ làm thêm ngoài giờ thuộc đơn đăng ký OT.'
            : `Nhân viên chỉ còn nợ ${this.formatMinutes(outstanding)}. Sửa lại số giờ trên đơn, phần dôi ra dùng đơn đăng ký OT.`,
      });
    }

    const touched: string[] = [];
    let left = input.minutes;

    for (const debt of debts) {
      if (left <= 0) break;

      const take = Math.min(left, debt.remainingMinutes);
      // Dùng lại đúng `record()` của đường nhập tay: nó đã xử lý việc TÁCH DÒNG
      // khi bù dở dang (FR-WEB-MKUP-02) và khôi phục trạng thái. Viết một nhánh
      // ghi riêng ở đây là nhân đôi quy tắc khó nhất của module này.
      await this.record(ctx, debt.id, {
        makeupWorkDate: formatWorkDate(input.makeupWorkDate),
        minutes: take,
        requestId: input.requestId,
      });

      touched.push(debt.id);
      left -= take;
    }

    return { appliedMinutes: input.minutes - left, touchedRecordIds: touched };
  }

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
