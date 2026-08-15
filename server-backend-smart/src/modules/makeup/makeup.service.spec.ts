import { Test } from '@nestjs/testing';
import { parseWorkDate } from 'src/common/utils';
import { AppException } from 'src/common/errors';
import { TransactionManager } from 'src/infra/prisma/transaction.manager';
import { AuditService } from '../audit/audit.service';
import { NotificationService } from '../notification/notification.service';
import { PolicyService } from '../policy/policy.service';
import { POLICY_DEFAULTS } from '../policy/policy.constants';
import { MakeupRepository } from './makeup.repository';
import { MakeupService } from './makeup.service';
import type { TenantContext } from 'src/common/types/request-context';

const VN = 'Asia/Ho_Chi_Minh';
const COMPANY = 'cmp_1';
const EMPLOYEE = 'emp_1';

const ctx = {
  companyId: COMPANY,
  userId: 'usr_hr',
  employeeId: 'emp_hr',
  roles: [],
  deviceId: null,
  isSystemAdmin: false,
  scopeDepartmentIds: [],
  mustChangePassword: false,
  jti: 'jti_1',
  traceId: 'trace_1',
} as unknown as TenantContext;

/**
 * docs/04 mục 5: "Đây là chỗ dễ gây sai lệch lương nhất — cần unit test phủ kỹ
 * các trường hợp biên."
 *
 * Hai nhóm hành vi được kiểm ở đây:
 *
 *   1. QUY ĐỔI phút → công chuẩn theo chính sách công ty (FR-WEB-MKUP-01), gồm
 *      cả ba kiểu làm tròn. Sai ở đây là sai số công trên bảng lương.
 *
 *   2. TÁCH DÒNG khi bù dở dang (FR-WEB-MKUP-02): tổng nợ trước và sau phải
 *      bằng nhau, và mỗi lần bù phải nằm đúng ngày làm bù của nó — vì engine
 *      tính công cộng giờ bù theo `makeupWorkDate`.
 */
describe('MakeupService', () => {
  let service: MakeupService;
  let records: {
    search: jest.Mock;
    findById: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    markExpired: jest.Mock;
    totals: jest.Mock;
    countCompletedSiblings: jest.Mock;
    findEngineDebts: jest.Mock;
    findOutstandingDebts: jest.Mock;
  };
  let policy: { getNumber: jest.Mock; getBoolean: jest.Mock; get: jest.Mock; getTimezone: jest.Mock };

  /** Khoản nợ 200 phút phát sinh 05/08, hạn 04/09 — ví dụ ở docs/04 mục 5.1. */
  const openDebt = {
    id: 'mk_1',
    companyId: COMPANY,
    employeeId: EMPLOYEE,
    debtWorkDate: parseWorkDate('2026-08-05'),
    debtMinutes: 200,
    makeupWorkDate: null,
    makeupMinutes: 0,
    remainingMinutes: 200,
    dueDate: parseWorkDate('2026-09-04'),
    requestId: null,
    status: 'OPEN',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    records = {
      search: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      findById: jest.fn().mockResolvedValue(openDebt),
      create: jest.fn().mockImplementation((_companyId, data) => ({ id: 'mk_new', ...data })),
      update: jest.fn().mockImplementation((_companyId, id, data) => ({ ...openDebt, id, ...data })),
      delete: jest.fn().mockResolvedValue(1),
      markExpired: jest.fn().mockResolvedValue(0),
      totals: jest.fn().mockResolvedValue({
        openDebtMinutes: 0,
        openRecords: 0,
        madeUpMinutes: 0,
        employeesWithDebt: 0,
      }),
      countCompletedSiblings: jest.fn().mockResolvedValue(0),
      findEngineDebts: jest.fn().mockResolvedValue([]),
      findOutstandingDebts: jest.fn().mockResolvedValue([]),
    };

    policy = {
      getTimezone: jest.fn().mockResolvedValue(VN),
      getNumber: jest
        .fn()
        .mockImplementation((_companyId: string, key: string) =>
          Promise.resolve(Number(POLICY_DEFAULTS[key] ?? 0)),
        ),
      getBoolean: jest
        .fn()
        .mockImplementation((_companyId: string, key: string) =>
          Promise.resolve(POLICY_DEFAULTS[key] === true),
        ),
      get: jest
        .fn()
        .mockImplementation((_companyId: string, key: string) =>
          Promise.resolve(POLICY_DEFAULTS[key]),
        ),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        MakeupService,
        { provide: MakeupRepository, useValue: records },
        { provide: PolicyService, useValue: policy },
        {
          // Transaction thật không cần thiết cho logic nghiệp vụ — chỉ chạy
          // callback với một client giả.
          provide: TransactionManager,
          useValue: { run: (handler: (tx: unknown) => unknown) => handler({}) },
        },
        { provide: AuditService, useValue: { record: jest.fn() } },
        { provide: NotificationService, useValue: { notify: jest.fn() } },
      ],
    }).compile();

    service = moduleRef.get(MakeupService);
  });

  // =========================================================================
  //  Quy đổi công chuẩn (FR-WEB-MKUP-01)
  // =========================================================================

  it('quy đổi mặc định: 480 phút = 1 công chuẩn', async () => {
    records.totals.mockResolvedValue({
      openDebtMinutes: 480,
      openRecords: 1,
      madeUpMinutes: 240,
      employeesWithDebt: 1,
    });

    const summary = await service.summary(COMPANY, { page: 1, pageSize: 20 } as never, null);

    expect(summary.openDebtStandardDays).toBe(1);
    expect(summary.madeUpStandardDays).toBe(0.5);
  });

  it('làm tròn XUỐNG có lợi cho công ty: 200 phút, bước 30 → 180 phút', async () => {
    policy.getNumber.mockImplementation((_companyId: string, key: string) =>
      Promise.resolve(
        key === 'payroll.roundingMinutes' ? 30 : Number(POLICY_DEFAULTS[key] ?? 0),
      ),
    );
    policy.get.mockImplementation((_companyId: string, key: string) =>
      Promise.resolve(key === 'payroll.roundingMode' ? 'DOWN' : POLICY_DEFAULTS[key]),
    );
    records.totals.mockResolvedValue({
      openDebtMinutes: 200,
      openRecords: 1,
      madeUpMinutes: 0,
      employeesWithDebt: 1,
    });

    const summary = await service.summary(COMPANY, { page: 1, pageSize: 20 } as never, null);

    // 180 / 480 = 0.375
    expect(summary.openDebtStandardDays).toBe(0.375);
  });

  it('làm tròn LÊN có lợi cho nhân viên: 200 phút, bước 30 → 210 phút', async () => {
    policy.getNumber.mockImplementation((_companyId: string, key: string) =>
      Promise.resolve(
        key === 'payroll.roundingMinutes' ? 30 : Number(POLICY_DEFAULTS[key] ?? 0),
      ),
    );
    policy.get.mockImplementation((_companyId: string, key: string) =>
      Promise.resolve(key === 'payroll.roundingMode' ? 'UP' : POLICY_DEFAULTS[key]),
    );
    records.totals.mockResolvedValue({
      openDebtMinutes: 200,
      openRecords: 1,
      madeUpMinutes: 0,
      employeesWithDebt: 1,
    });

    const summary = await service.summary(COMPANY, { page: 1, pageSize: 20 } as never, null);

    // 210 / 480 = 0.4375 → làm tròn 3 chữ số
    expect(summary.openDebtStandardDays).toBe(0.438);
  });

  // =========================================================================
  //  Ghi nhận làm bù (FR-WEB-MKUP-02, FR-WEB-MKUP-03)
  // =========================================================================

  it('bù ĐỦ: đóng khoản nợ, không tách dòng mới', async () => {
    const result = await service.record(ctx, 'mk_1', {
      makeupWorkDate: '2026-08-12',
      minutes: 200,
    });

    expect(records.update).toHaveBeenCalledWith(
      COMPANY,
      'mk_1',
      expect.objectContaining({ status: 'COMPLETED', remainingMinutes: 0, makeupMinutes: 200 }),
      expect.anything(),
    );
    expect(records.create).not.toHaveBeenCalled();
    expect(result.carried).toBeNull();
  });

  it('bù DỞ DANG: tách phần còn nợ sang dòng mới, TỔNG NỢ KHÔNG ĐỔI', async () => {
    await service.record(ctx, 'mk_1', { makeupWorkDate: '2026-08-12', minutes: 120 });

    // Dòng cũ thu về đúng phần đã bù...
    const [, , updateData] = records.update.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(updateData.debtMinutes).toBe(120);
    expect(updateData.makeupMinutes).toBe(120);
    expect(updateData.status).toBe('COMPLETED');

    // ...phần còn lại sang dòng mới, giữ nguyên ngày phát sinh và hạn.
    const [, createData] = records.create.mock.calls[0] as [string, Record<string, unknown>];
    expect(createData.debtMinutes).toBe(80);
    expect(createData.remainingMinutes).toBe(80);
    expect(createData.status).toBe('PARTIAL');
    expect(createData.debtWorkDate).toEqual(openDebt.debtWorkDate);
    expect(createData.dueDate).toEqual(openDebt.dueDate);

    // Bất biến quan trọng nhất: 120 + 80 = 200 phút nợ ban đầu.
    expect((updateData.debtMinutes as number) + (createData.debtMinutes as number)).toBe(
      openDebt.debtMinutes,
    );
  });

  it('mỗi lần bù nằm ở ĐÚNG ngày làm bù của nó — engine tính công cộng theo ngày này', async () => {
    await service.record(ctx, 'mk_1', { makeupWorkDate: '2026-08-12', minutes: 120 });

    const [, , updateData] = records.update.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(updateData.makeupWorkDate).toEqual(parseWorkDate('2026-08-12'));

    // Dòng tách ra CHƯA có ngày bù — nó là phần nợ còn lại, chưa bù lần nào.
    const [, createData] = records.create.mock.calls[0] as [string, Record<string, unknown>];
    expect(createData.makeupWorkDate).toBeUndefined();
  });

  it('bù VƯỢT số nợ bị từ chối — phần dôi ra là tăng ca, không phải công làm bù', async () => {
    await expect(
      service.record(ctx, 'mk_1', { makeupWorkDate: '2026-08-12', minutes: 240 }),
    ).rejects.toThrow(AppException);

    expect(records.update).not.toHaveBeenCalled();
    expect(records.create).not.toHaveBeenCalled();
  });

  it('khoản QUÁ HẠN không ghi nhận được cho tới khi gia hạn', async () => {
    records.findById.mockResolvedValue({
      ...openDebt,
      dueDate: parseWorkDate('2026-01-01'),
    });

    await expect(
      service.record(ctx, 'mk_1', { makeupWorkDate: '2026-08-12', minutes: 60 }),
    ).rejects.toThrow(AppException);
  });

  it('khoản ĐÃ BÙ ĐỦ không ghi nhận thêm được', async () => {
    records.findById.mockResolvedValue({ ...openDebt, status: 'COMPLETED', remainingMinutes: 0 });

    await expect(
      service.record(ctx, 'mk_1', { makeupWorkDate: '2026-08-12', minutes: 30 }),
    ).rejects.toThrow(AppException);
  });

  // =========================================================================
  //  Gia hạn & huỷ
  // =========================================================================

  it('gia hạn khoản đã bù dở dang thì mở lại thành PARTIAL, không phải OPEN', async () => {
    records.findById.mockResolvedValue({ ...openDebt, status: 'EXPIRED' });
    records.countCompletedSiblings.mockResolvedValue(1);

    await service.extend(ctx, 'mk_1', { dueDate: '2026-10-01', reason: 'Nhân viên nghỉ ốm dài ngày' });

    expect(records.update).toHaveBeenCalledWith(
      COMPANY,
      'mk_1',
      expect.objectContaining({ status: 'PARTIAL' }),
    );
  });

  it('gia hạn khoản chưa bù lần nào thì mở lại thành OPEN', async () => {
    records.findById.mockResolvedValue({ ...openDebt, status: 'EXPIRED' });
    records.countCompletedSiblings.mockResolvedValue(0);

    await service.extend(ctx, 'mk_1', { dueDate: '2026-10-01', reason: 'Gia hạn theo thoả thuận' });

    expect(records.update).toHaveBeenCalledWith(
      COMPANY,
      'mk_1',
      expect.objectContaining({ status: 'OPEN' }),
    );
  });

  it('không huỷ được khoản đã ghi nhận giờ bù — giờ đó đã vào bảng công', async () => {
    records.findById.mockResolvedValue({ ...openDebt, makeupMinutes: 120 });

    await expect(service.cancel(ctx, 'mk_1', 'Ghi nhầm khoản nợ này')).rejects.toThrow(AppException);
    expect(records.delete).not.toHaveBeenCalled();
  });

  it('huỷ được khoản chưa bù giờ nào', async () => {
    await service.cancel(ctx, 'mk_1', 'Ghi nhầm số phút, sẽ nhập lại');
    expect(records.delete).toHaveBeenCalledWith(COMPANY, 'mk_1');
  });

  // =========================================================================
  //  Hạn làm bù
  // =========================================================================

  it('hạn làm bù đếm từ NGÀY PHÁT SINH NỢ, không phải ngày nhập liệu', async () => {
    await service.createDebt(ctx, {
      employeeId: EMPLOYEE,
      debtWorkDate: '2026-08-05',
      debtMinutes: 200,
      reason: 'Thiếu giờ do đi muộn nhiều lần',
    });

    const [, createData] = records.create.mock.calls[0] as [string, Record<string, unknown>];
    // Mặc định `makeup.dueDays` = 30 → 05/08 + 30 ngày = 04/09.
    expect(createData.dueDate).toEqual(parseWorkDate('2026-09-04'));
  });

  // =========================================================================
  //  Engine tự sinh nợ — docs/04 mục 5.1
  //
  //  Nhóm test quan trọng nhất của file này. `calculateAndPersist` là hàm
  //  IDEMPOTENT bị gọi lại rất nhiều lần cho cùng một ngày (mỗi lần hiệu chỉnh
  //  công, mỗi lần duyệt đơn ngược quá khứ, và mỗi đêm khi cron quét). Một lỗi
  //  nhân bản ở đây đi thẳng vào bảng lương và không ai phát hiện cho tới lúc
  //  đối soát cuối tháng.
  // =========================================================================

  const DEBT_DAY = parseWorkDate('2026-08-05');

  /** Dòng nợ do engine sinh, chưa được bù lần nào. */
  function engineDebt(overrides: Partial<typeof openDebt> & { id: string }) {
    return { ...openDebt, source: 'ENGINE', ...overrides };
  }

  it('chạy lại khi không có gì đổi thì KHÔNG phát sinh lệnh ghi nào', async () => {
    records.findEngineDebts.mockResolvedValue([
      engineDebt({ id: 'mk_e1', debtMinutes: 120, remainingMinutes: 120 }),
    ]);

    await service.reconcileEngineDebt(COMPANY, EMPLOYEE, DEBT_DAY, 120);

    expect(records.create).not.toHaveBeenCalled();
    expect(records.update).not.toHaveBeenCalled();
    expect(records.delete).not.toHaveBeenCalled();
  });

  it('chạy 3 lần liên tiếp trên cùng dữ liệu chỉ tạo ĐÚNG MỘT dòng nợ', async () => {
    // Lần đầu chưa có gì; các lần sau thấy đúng dòng vừa tạo.
    records.findEngineDebts
      .mockResolvedValueOnce([])
      .mockResolvedValue([engineDebt({ id: 'mk_e1', debtMinutes: 90, remainingMinutes: 90 })]);

    await service.reconcileEngineDebt(COMPANY, EMPLOYEE, DEBT_DAY, 90);
    await service.reconcileEngineDebt(COMPANY, EMPLOYEE, DEBT_DAY, 90);
    await service.reconcileEngineDebt(COMPANY, EMPLOYEE, DEBT_DAY, 90);

    expect(records.create).toHaveBeenCalledTimes(1);
    const [, data] = records.create.mock.calls[0] as [string, Record<string, unknown>];
    expect(data.debtMinutes).toBe(90);
    expect(data.source).toBe('ENGINE');
    // Hạn đếm từ ngày phát sinh nợ (05/08 + 30) chứ không phải hôm nay.
    expect(data.dueDate).toEqual(parseWorkDate('2026-09-04'));
  });

  it('nợ tăng thì dồn vào dòng CHƯA BÙ thay vì mở thêm dòng mới', async () => {
    records.findEngineDebts.mockResolvedValue([
      engineDebt({ id: 'mk_e1', debtMinutes: 60, remainingMinutes: 60 }),
    ]);

    await service.reconcileEngineDebt(COMPANY, EMPLOYEE, DEBT_DAY, 100);

    expect(records.create).not.toHaveBeenCalled();
    expect(records.update).toHaveBeenCalledWith(COMPANY, 'mk_e1', {
      debtMinutes: 100,
      remainingMinutes: 100,
    });
  });

  it('ngày được hiệu chỉnh cho đủ giờ thì khoản nợ biến mất, không để lại nợ ma', async () => {
    records.findEngineDebts.mockResolvedValue([
      engineDebt({ id: 'mk_e1', debtMinutes: 120, remainingMinutes: 120 }),
    ]);

    await service.reconcileEngineDebt(COMPANY, EMPLOYEE, DEBT_DAY, 0);

    expect(records.delete).toHaveBeenCalledWith(COMPANY, 'mk_e1');
  });

  it('nợ giảm một phần thì cắt bớt dòng, không xoá cả dòng', async () => {
    records.findEngineDebts.mockResolvedValue([
      engineDebt({ id: 'mk_e1', debtMinutes: 120, remainingMinutes: 120 }),
    ]);

    await service.reconcileEngineDebt(COMPANY, EMPLOYEE, DEBT_DAY, 45);

    expect(records.delete).not.toHaveBeenCalled();
    expect(records.update).toHaveBeenCalledWith(COMPANY, 'mk_e1', {
      debtMinutes: 45,
      remainingMinutes: 45,
    });
  });

  it('KHÔNG BAO GIỜ đụng vào dòng đã có giờ làm bù — đó là công nhân viên đã làm thật', async () => {
    records.findEngineDebts.mockResolvedValue([
      // Mới nhất trước, đúng thứ tự repository trả về.
      engineDebt({ id: 'mk_unpaid', debtMinutes: 80, remainingMinutes: 80 }),
      engineDebt({
        id: 'mk_paid',
        debtMinutes: 120,
        makeupMinutes: 120,
        remainingMinutes: 0,
        status: 'COMPLETED',
      }),
    ]);

    // Nợ thật giờ chỉ còn 0 → phải cắt 200, nhưng chỉ được phép cắt 80.
    await service.reconcileEngineDebt(COMPANY, EMPLOYEE, DEBT_DAY, 0);

    expect(records.delete).toHaveBeenCalledTimes(1);
    expect(records.delete).toHaveBeenCalledWith(COMPANY, 'mk_unpaid');
    expect(records.update).not.toHaveBeenCalled();
  });

  // =========================================================================
  //  Duyệt đơn làm bù → ghi vào sổ
  // =========================================================================

  it('giờ làm bù trả khoản CŨ NHẤT trước — khoản cũ cũng là khoản sắp hết hạn', async () => {
    const older = engineDebt({
      id: 'mk_old',
      debtWorkDate: parseWorkDate('2026-08-01'),
      debtMinutes: 60,
      remainingMinutes: 60,
    });
    const newer = engineDebt({
      id: 'mk_new',
      debtWorkDate: parseWorkDate('2026-08-10'),
      debtMinutes: 60,
      remainingMinutes: 60,
    });

    records.findOutstandingDebts.mockResolvedValue([older, newer]);
    records.findById.mockImplementation((_companyId: string, id: string) =>
      Promise.resolve(id === 'mk_old' ? older : newer),
    );

    await service.applyFromApprovedRequest(ctx, {
      employeeId: EMPLOYEE,
      minutes: 60,
      makeupWorkDate: parseWorkDate('2026-08-20'),
      requestId: 'req_1',
    });

    // Đúng một khoản được ghi nhận, và đó là khoản cũ hơn.
    const touchedIds = records.update.mock.calls.map((call) => call[1] as string);
    expect(touchedIds).toContain('mk_old');
    expect(touchedIds).not.toContain('mk_new');
  });

  it('một đơn trải được qua NHIỀU khoản nợ', async () => {
    const first = engineDebt({
      id: 'mk_a',
      debtWorkDate: parseWorkDate('2026-08-01'),
      debtMinutes: 60,
      remainingMinutes: 60,
    });
    const second = engineDebt({
      id: 'mk_b',
      debtWorkDate: parseWorkDate('2026-08-02'),
      debtMinutes: 90,
      remainingMinutes: 90,
    });

    records.findOutstandingDebts.mockResolvedValue([first, second]);
    records.findById.mockImplementation((_companyId: string, id: string) =>
      Promise.resolve(id === 'mk_a' ? first : second),
    );

    const result = await service.applyFromApprovedRequest(ctx, {
      employeeId: EMPLOYEE,
      minutes: 100,
      makeupWorkDate: parseWorkDate('2026-08-20'),
      requestId: 'req_2',
    });

    expect(result.appliedMinutes).toBe(100);
    expect(result.touchedRecordIds).toEqual(['mk_a', 'mk_b']);
  });

  it('đơn khai nhiều giờ hơn số nợ thật thì BỊ TỪ CHỐI, không cắt bớt âm thầm', async () => {
    records.findOutstandingDebts.mockResolvedValue([
      engineDebt({ id: 'mk_e1', debtMinutes: 60, remainingMinutes: 60 }),
    ]);

    // Phần dôi ra là tăng ca với hệ số lương khác hẳn — nuốt hoặc cộng nhầm vào
    // đây đều là trả sai lương theo hướng không ai phát hiện ra.
    await expect(
      service.applyFromApprovedRequest(ctx, {
        employeeId: EMPLOYEE,
        minutes: 180,
        makeupWorkDate: parseWorkDate('2026-08-20'),
        requestId: 'req_3',
      }),
    ).rejects.toBeInstanceOf(AppException);

    expect(records.update).not.toHaveBeenCalled();
  });

  it('nhân viên không còn nợ thì đơn làm bù bị từ chối kèm lời giải thích', async () => {
    records.findOutstandingDebts.mockResolvedValue([]);

    await expect(
      service.applyFromApprovedRequest(ctx, {
        employeeId: EMPLOYEE,
        minutes: 60,
        makeupWorkDate: parseWorkDate('2026-08-20'),
        requestId: 'req_4',
      }),
    ).rejects.toBeInstanceOf(AppException);
  });
});
