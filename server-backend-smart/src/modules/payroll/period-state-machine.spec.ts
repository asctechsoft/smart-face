import { PayrollPeriodStatus } from '@prisma/client';
import { AppException } from 'src/common/errors';
import { PayrollService } from './payroll.service';
import type { TenantContext } from 'src/common/types/request-context';

/**
 * State machine kỳ công (docs/05 §13.1 · docs/13 §5.4).
 *
 * ```
 *   OPEN ──submitLock──► PENDING_APPROVAL ──approveLock──► LOCKED
 *     ▲                        │                              │
 *     └──────rejectLock────────┘                              │
 *     ▲                                                       │
 *     └── REOPENED ◄──────────approveReopen───────────────────┘
 * ```
 *
 * Ba thứ được canh ở đây, và cả ba đều là lỗi ĐÃ TỪNG tồn tại trong bản cũ:
 *
 * 1. **Không ai được vừa gửi vừa duyệt.** Bản cũ chỉ có một hàm `closePeriod`
 *    do Kế toán gọi, khoá kỳ ngay. Không có bước nào để Giám đốc đối chiếu.
 * 2. **Chốt lại không được xoá số cũ.** Bản cũ gọi `replaceSummaries()` — mở lại
 *    rồi chốt lần hai là bộ số lần một biến mất, không giải trình được nữa.
 * 3. **Mọi lần chuyển trạng thái phải để lại vết.** Cột `reopenReason` chỉ giữ
 *    lần cuối; kỳ mở lại hai lần là mất lý do lần đầu.
 */
describe('State machine kỳ công', () => {
  const COMPANY = 'cmp_1';
  const PERIOD = 'per_1';
  const ctx = { companyId: COMPANY, userId: 'usr_ketoan' } as TenantContext;
  const dirCtx = { companyId: COMPANY, userId: 'usr_giamdoc' } as TenantContext;

  interface PeriodFixture {
    id: string;
    companyId: string;
    name: string;
    startDate: Date;
    endDate: Date;
    status: PayrollPeriodStatus;
    currentVersion: number;
    closedAt: Date | null;
  }

  const basePeriod: PeriodFixture = {
    id: PERIOD,
    companyId: COMPANY,
    name: 'Tháng 08/2026',
    startDate: new Date(Date.UTC(2026, 7, 1)),
    endDate: new Date(Date.UTC(2026, 7, 31)),
    status: PayrollPeriodStatus.OPEN,
    currentVersion: 0,
    closedAt: null,
  };

  let payrolls: Record<string, jest.Mock>;
  let audit: { record: jest.Mock };
  let notifications: { notify: jest.Mock };
  let policy: { resolveAll: jest.Mock };
  let service: PayrollService;

  /** Chạy callback ngay, không có transaction thật. */
  const transactions = { run: (fn: (tx: unknown) => unknown) => fn({}) };

  const givenPeriod = (overrides: Partial<PeriodFixture>) => {
    payrolls.findPeriod.mockResolvedValue({ ...basePeriod, ...overrides });
  };

  beforeEach(() => {
    payrolls = {
      findPeriod: jest.fn().mockResolvedValue(basePeriod),
      createPeriodVersion: jest.fn().mockResolvedValue({}),
      replaceSummaries: jest.fn().mockResolvedValue(undefined),
      updatePeriodStatus: jest.fn().mockResolvedValue(1),
      recordTransition: jest.fn().mockResolvedValue({}),
      findActiveOwnerEmployeeIds: jest.fn().mockResolvedValue(['emp_owner']),
      // preCloseReport phụ thuộc các truy vấn dưới đây; mặc định là "sạch".
      countMissingAttendance: jest.fn().mockResolvedValue(0),
      countPendingRequests: jest.fn().mockResolvedValue(0),
      findAnomalies: jest.fn().mockResolvedValue([]),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    notifications = { notify: jest.fn().mockResolvedValue(undefined) };
    policy = { resolveAll: jest.fn().mockResolvedValue({ 'payroll.rounding': 15 }) };

    service = new PayrollService(
      payrolls as never,
      transactions as never,
      {} as never,
      policy as never,
      {} as never,
      audit as never,
      notifications as never,
      {} as never,
      {} as never,
    );

    // preCloseReport và buildSummaries chạm rất nhiều repository; bài test này
    // nói về CHUYỂN TRẠNG THÁI nên hai hàm đó được thay bằng bản tối thiểu.
    jest
      .spyOn(service, 'preCloseReport')
      .mockResolvedValue({ blockers: [], anomalies: [], canClose: true } as never);
    jest
      .spyOn(service as never as { buildSummaries: () => unknown }, 'buildSummaries')
      .mockResolvedValue([
        {
          employee: { id: 'emp_1' },
          employeeId: 'emp_1',
          workedMinutes: 9600,
          otMinutesNormal: 120,
          otMinutesWeekend: 0,
          otMinutesHoliday: 0,
          leaveDays: 1,
          violationCount: 2,
        },
      ] as never);
  });

  const codeOf = async (promise: Promise<unknown>): Promise<string> => {
    try {
      await promise;
      throw new Error('Đáng lẽ phải ném lỗi nhưng lại chạy trót lọt.');
    } catch (error) {
      if (error instanceof AppException) return error.code;
      throw error;
    }
  };

  // =========================================================================
  //  Chiều thuận
  // =========================================================================

  it('OPEN → PENDING_APPROVAL: Kế toán gửi, kỳ CHƯA bị khoá hẳn', async () => {
    const result = await service.submitLock(ctx, PERIOD, 'Đã đối soát xong tháng 8');

    expect(result.status).toBe(PayrollPeriodStatus.PENDING_APPROVAL);
    expect(payrolls.updatePeriodStatus).toHaveBeenCalledWith(
      COMPANY,
      PERIOD,
      expect.objectContaining({ status: PayrollPeriodStatus.PENDING_APPROVAL }),
      expect.anything(),
    );
    // Không được nhảy thẳng sang LOCKED — đó chính là lỗi của bản cũ.
    expect(payrolls.updatePeriodStatus).not.toHaveBeenCalledWith(
      COMPANY,
      PERIOD,
      expect.objectContaining({ status: PayrollPeriodStatus.LOCKED }),
      expect.anything(),
    );
  });

  it('mỗi lần gửi sinh một version MỚI, không ghi đè version trước', async () => {
    givenPeriod({ currentVersion: 2 });

    await service.submitLock(ctx, PERIOD, 'Gửi lại sau khi sửa công');

    expect(payrolls.createPeriodVersion).toHaveBeenCalledWith(
      COMPANY,
      PERIOD,
      expect.objectContaining({ version: 3, calculatedBy: 'usr_ketoan' }),
      expect.anything(),
    );
    expect(payrolls.updatePeriodStatus).toHaveBeenCalledWith(
      COMPANY,
      PERIOD,
      expect.objectContaining({ currentVersion: 3 }),
      expect.anything(),
    );
  });

  it('version mang theo ảnh chụp chính sách tại CUỐI KỲ, không phải hôm nay (BR-12)', async () => {
    await service.submitLock(ctx, PERIOD, 'Đã đối soát xong tháng 8');

    expect(policy.resolveAll).toHaveBeenCalledWith(COMPANY, basePeriod.endDate);
    const [, , data] = payrolls.createPeriodVersion.mock.calls[0];
    expect(data.policySnapshot).toEqual({ 'payroll.rounding': 15 });
    expect(data.summary).toMatchObject({ headcount: 1, otMinutes: 120, violationCount: 2 });
  });

  it('PENDING_APPROVAL → LOCKED: Giám đốc duyệt đúng version đã gửi, KHÔNG tính lại', async () => {
    givenPeriod({ status: PayrollPeriodStatus.PENDING_APPROVAL, currentVersion: 3 });

    const result = await service.approveLock(dirCtx, PERIOD, 'Đã kiểm tra, đồng ý chốt');

    expect(result).toMatchObject({ status: PayrollPeriodStatus.LOCKED, version: 3 });
    // Duyệt mà tính lại nghĩa là Giám đốc duyệt bộ số A, hệ thống khoá bộ số B.
    expect(payrolls.createPeriodVersion).not.toHaveBeenCalled();
    expect(payrolls.replaceSummaries).not.toHaveBeenCalled();
  });

  it('PENDING_APPROVAL → OPEN khi Giám đốc từ chối', async () => {
    givenPeriod({ status: PayrollPeriodStatus.PENDING_APPROVAL });

    const result = await service.rejectLock(dirCtx, PERIOD, 'Thiếu đơn OT của phòng Kinh doanh');

    expect(result.status).toBe(PayrollPeriodStatus.OPEN);
  });

  it('LOCKED → REOPENED khi Giám đốc duyệt mở lại', async () => {
    givenPeriod({ status: PayrollPeriodStatus.LOCKED, currentVersion: 3, closedAt: new Date() });

    const result = await service.approveReopen(dirCtx, PERIOD, 'Sai giờ chấm của 3 nhân viên');

    expect(result.status).toBe(PayrollPeriodStatus.REOPENED);
  });

  it('REOPENED gửi lại được, và version tiếp tục tăng', async () => {
    givenPeriod({ status: PayrollPeriodStatus.REOPENED, currentVersion: 3 });

    const result = await service.submitLock(ctx, PERIOD, 'Đã sửa xong, gửi lại');

    expect(result.status).toBe(PayrollPeriodStatus.PENDING_APPROVAL);
    expect(result.version).toBe(4);
  });

  // =========================================================================
  //  Chuyển trạng thái không hợp lệ
  // =========================================================================

  it.each([
    [PayrollPeriodStatus.PENDING_APPROVAL, 'gửi khi đang chờ duyệt'],
    [PayrollPeriodStatus.LOCKED, 'gửi khi đã khoá'],
    [PayrollPeriodStatus.CALCULATING, 'gửi khi đang tính'],
  ])('submitLock từ %s bị chặn (%s)', async (status, _why) => {
    givenPeriod({ status });
    expect(await codeOf(service.submitLock(ctx, PERIOD, 'Lý do đủ dài'))).toBe(
      'PERIOD_INVALID_TRANSITION',
    );
  });

  it.each([PayrollPeriodStatus.OPEN, PayrollPeriodStatus.LOCKED, PayrollPeriodStatus.REOPENED])(
    'approveLock từ %s bị chặn',
    async (status) => {
      givenPeriod({ status });
      expect(await codeOf(service.approveLock(dirCtx, PERIOD, 'Lý do đủ dài'))).toBe(
        'PERIOD_INVALID_TRANSITION',
      );
    },
  );

  it('approveReopen chỉ chạy từ LOCKED — kỳ đang mở thì không có gì để mở lại', async () => {
    givenPeriod({ status: PayrollPeriodStatus.OPEN });
    expect(await codeOf(service.approveReopen(dirCtx, PERIOD, 'Lý do đủ dài'))).toBe(
      'PERIOD_INVALID_TRANSITION',
    );
  });

  // =========================================================================
  //  Vết để lại
  // =========================================================================

  it('mọi lần chuyển đều ghi PeriodTransition kèm người thực hiện và lý do', async () => {
    givenPeriod({ status: PayrollPeriodStatus.LOCKED, currentVersion: 3 });

    await service.approveReopen(dirCtx, PERIOD, 'Sai giờ chấm của 3 nhân viên');

    expect(payrolls.recordTransition).toHaveBeenCalledWith(
      COMPANY,
      PERIOD,
      expect.objectContaining({
        fromStatus: PayrollPeriodStatus.LOCKED,
        toStatus: PayrollPeriodStatus.REOPENED,
        actorId: 'usr_giamdoc',
        reason: 'Sai giờ chấm của 3 nhân viên',
      }),
      expect.anything(),
    );
  });

  it('mở lại lần hai vẫn giữ được lý do lần một trong nhật ký', async () => {
    givenPeriod({ status: PayrollPeriodStatus.LOCKED, currentVersion: 3 });
    await service.approveReopen(dirCtx, PERIOD, 'Lý do lần một: sai giờ chấm');

    givenPeriod({ status: PayrollPeriodStatus.LOCKED, currentVersion: 4 });
    await service.approveReopen(dirCtx, PERIOD, 'Lý do lần hai: thiếu đơn OT');

    const reasons = payrolls.recordTransition.mock.calls.map(([, , data]) => data.reason);
    expect(reasons).toEqual(['Lý do lần một: sai giờ chấm', 'Lý do lần hai: thiếu đơn OT']);
  });

  it('gửi đề nghị chốt thì Giám đốc được báo; đề nghị mở lại cũng vậy', async () => {
    await service.submitLock(ctx, PERIOD, 'Đã đối soát xong tháng 8');
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ employeeId: 'emp_owner', type: 'PERIOD_SUBMIT_LOCK' }),
    );

    notifications.notify.mockClear();
    givenPeriod({ status: PayrollPeriodStatus.LOCKED });
    await service.requestReopen(ctx, PERIOD, 'Phát hiện sai giờ chấm');
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'PERIOD_REOPEN_REQUEST' }),
    );
  });

  it('công ty chưa có Owner thì không nổ, chỉ cảnh báo — kỳ vẫn gửi được', async () => {
    payrolls.findActiveOwnerEmployeeIds.mockResolvedValue([]);

    const result = await service.submitLock(ctx, PERIOD, 'Đã đối soát xong tháng 8');

    expect(result.status).toBe(PayrollPeriodStatus.PENDING_APPROVAL);
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('đề nghị mở lại KHÔNG tự đổi trạng thái kỳ', async () => {
    givenPeriod({ status: PayrollPeriodStatus.LOCKED });

    const result = await service.requestReopen(ctx, PERIOD, 'Phát hiện sai giờ chấm');

    expect(result).toMatchObject({ requested: true, status: PayrollPeriodStatus.LOCKED });
    expect(payrolls.updatePeriodStatus).not.toHaveBeenCalled();
  });
});
