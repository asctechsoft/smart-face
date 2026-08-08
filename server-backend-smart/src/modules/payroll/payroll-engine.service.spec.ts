import { Test } from '@nestjs/testing';
import { AttendanceType, DailyStatus, ShiftType } from '@prisma/client';
import { parseWorkDate } from 'src/common/utils';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { PolicyService } from '../policy/policy.service';
import { PolicyKeys, POLICY_DEFAULTS } from '../policy/policy.constants';
import { PayrollEngineService } from './payroll-engine.service';

const VN = 'Asia/Ho_Chi_Minh';
const COMPANY = 'cmp_1';
const EMPLOYEE = 'emp_1';

type PunchLog = { id: string; type: AttendanceType; recordedAt: Date };

/**
 * NFR-MAINT-01: module payroll cần độ phủ ≥ 90% vì "sai một dòng = sai lương
 * hàng trăm người". Danh mục case bắt buộc nằm ở docs/09 mục 7.1.
 */
describe('PayrollEngineService', () => {
  let engine: PayrollEngineService;
  let prisma: {
    attendanceLog: { findMany: jest.Mock };
    attendanceAdjustment: { findMany: jest.Mock };
    fraudFlag: { count: jest.Mock };
    makeupWorkRecord: { aggregate: jest.Mock };
    leaveRequest: { findMany: jest.Mock };
    attendanceDaily: { upsert: jest.Mock };
  };
  let policy: {
    getTimezone: jest.Mock;
    resolveShiftForDate: jest.Mock;
    findHoliday: jest.Mock;
    getNumber: jest.Mock;
    getBoolean: jest.Mock;
  };

  const officeShift = {
    id: 'shift_office',
    name: 'Hành chính',
    type: ShiftType.FIXED,
    startTime: '08:00',
    endTime: '17:30',
    crossesMidnight: false,
    breakMinutes: 60,
    requiredMinutes: null,
    lateToleranceMinutes: 5,
    earlyLeaveToleranceMinutes: 0,
    segments: [],
  };

  const nightShift = {
    ...officeShift,
    id: 'shift_night',
    name: 'Ca đêm',
    type: ShiftType.ROTATING,
    startTime: '22:00',
    endTime: '06:00',
    crossesMidnight: true,
    breakMinutes: 30,
    lateToleranceMinutes: 10,
  };

  beforeEach(async () => {
    prisma = {
      attendanceLog: { findMany: jest.fn().mockResolvedValue([]) },
      attendanceAdjustment: { findMany: jest.fn().mockResolvedValue([]) },
      fraudFlag: { count: jest.fn().mockResolvedValue(0) },
      makeupWorkRecord: { aggregate: jest.fn().mockResolvedValue({ _sum: { makeupMinutes: 0 } }) },
      leaveRequest: { findMany: jest.fn().mockResolvedValue([]) },
      attendanceDaily: { upsert: jest.fn().mockResolvedValue({}) },
    };

    policy = {
      getTimezone: jest.fn().mockResolvedValue(VN),
      resolveShiftForDate: jest.fn().mockResolvedValue(officeShift),
      findHoliday: jest.fn().mockResolvedValue(null),
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
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PayrollEngineService,
        { provide: PrismaService, useValue: prisma },
        { provide: PolicyService, useValue: policy },
      ],
    }).compile();

    engine = moduleRef.get(PayrollEngineService);
  });

  /** Helper: dựng danh sách lượt chấm công theo GIỜ VN. */
  function punches(...entries: Array<[AttendanceType, string]>): PunchLog[] {
    return entries.map(([type, iso], index) => ({
      id: `log_${index}`,
      type,
      recordedAt: new Date(iso),
    }));
  }

  const calc = (workDate = '2026-08-03') => engine.calculate(COMPANY, EMPLOYEE, parseWorkDate(workDate));

  // =========================================================================
  //  Ca hành chính bình thường
  // =========================================================================

  it('ca hành chính đúng giờ: 08:00–17:30 → 8h công, trạng thái ON_TIME', async () => {
    prisma.attendanceLog.findMany.mockResolvedValue(
      punches(
        [AttendanceType.CHECK_IN, '2026-08-03T01:00:00Z'], // 08:00 VN
        [AttendanceType.CHECK_OUT, '2026-08-03T10:30:00Z'], // 17:30 VN
      ),
    );

    const result = await calc();

    // 9h30 tổng − 60 phút nghỉ trưa = 8h30 = 510 phút
    expect(result.workedMinutes).toBe(510);
    expect(result.breakMinutes).toBe(60);
    expect(result.lateMinutes).toBe(0);
    expect(result.earlyLeaveMinutes).toBe(0);
    expect(result.status).toBe(DailyStatus.ON_TIME);
  });

  it('đi muộn TRONG dung sai 5 phút thì không tính lỗi', async () => {
    prisma.attendanceLog.findMany.mockResolvedValue(
      punches(
        [AttendanceType.CHECK_IN, '2026-08-03T01:04:00Z'], // 08:04 VN
        [AttendanceType.CHECK_OUT, '2026-08-03T10:30:00Z'],
      ),
    );

    const result = await calc();
    expect(result.lateMinutes).toBe(0);
    expect(result.status).not.toBe(DailyStatus.LATE);
  });

  it('đi muộn NGOÀI dung sai: 08:47 → trừ 5 phút dung sai = 42 phút muộn', async () => {
    prisma.attendanceLog.findMany.mockResolvedValue(
      punches(
        [AttendanceType.CHECK_IN, '2026-08-03T01:47:00Z'], // 08:47 VN
        [AttendanceType.CHECK_OUT, '2026-08-03T10:30:00Z'],
      ),
    );

    const result = await calc();
    expect(result.lateMinutes).toBe(42);
    expect(result.status).toBe(DailyStatus.LATE);
  });

  it('về sớm: chấm ra 16:30 thay vì 17:30 → 60 phút về sớm', async () => {
    prisma.attendanceLog.findMany.mockResolvedValue(
      punches(
        [AttendanceType.CHECK_IN, '2026-08-03T01:00:00Z'],
        [AttendanceType.CHECK_OUT, '2026-08-03T09:30:00Z'], // 16:30 VN
      ),
    );

    const result = await calc();
    expect(result.earlyLeaveMinutes).toBe(60);
    expect(result.status).toBe(DailyStatus.EARLY_LEAVE);
  });

  it('vừa đi muộn vừa về sớm → LATE_AND_EARLY', async () => {
    prisma.attendanceLog.findMany.mockResolvedValue(
      punches(
        [AttendanceType.CHECK_IN, '2026-08-03T01:30:00Z'], // 08:30 VN
        [AttendanceType.CHECK_OUT, '2026-08-03T09:30:00Z'], // 16:30 VN
      ),
    );

    const result = await calc();
    expect(result.lateMinutes).toBe(25);
    expect(result.earlyLeaveMinutes).toBe(60);
    expect(result.status).toBe(DailyStatus.LATE_AND_EARLY);
  });

  // =========================================================================
  //  Ca đêm vắt qua nửa đêm — bẫy lớn nhất (docs/04 mục 6.4)
  // =========================================================================

  it('ca đêm 22:00 → 06:00 hôm sau: KHÔNG tách thành hai ngày công', async () => {
    policy.resolveShiftForDate.mockResolvedValue(nightShift);
    prisma.attendanceLog.findMany.mockResolvedValue(
      punches(
        [AttendanceType.CHECK_IN, '2026-08-03T15:00:00Z'], // 22:00 VN ngày 03
        [AttendanceType.CHECK_OUT, '2026-08-03T23:00:00Z'], // 06:00 VN ngày 04
      ),
    );

    const result = await calc('2026-08-03');

    // 8h tổng − 30 phút nghỉ = 450 phút, gắn với ngày BẮT ĐẦU CA (03/08).
    expect(result.workedMinutes).toBe(450);
    expect(result.lateMinutes).toBe(0);
    expect(result.earlyLeaveMinutes).toBe(0);
    expect(result.workDate).toEqual(parseWorkDate('2026-08-03'));
  });

  it('ca đêm về sớm: chấm ra 05:00 thay vì 06:00 → 60 phút về sớm', async () => {
    policy.resolveShiftForDate.mockResolvedValue(nightShift);
    prisma.attendanceLog.findMany.mockResolvedValue(
      punches(
        [AttendanceType.CHECK_IN, '2026-08-03T15:00:00Z'],
        [AttendanceType.CHECK_OUT, '2026-08-03T22:00:00Z'], // 05:00 VN ngày 04
      ),
    );

    const result = await calc('2026-08-03');
    expect(result.earlyLeaveMinutes).toBe(60);
  });

  // =========================================================================
  //  Nhiều cặp vào/ra & quên chấm ra
  // =========================================================================

  it('nhiều cặp vào/ra trong ngày (ra ngoài giữa giờ) đều được cộng dồn', async () => {
    prisma.attendanceLog.findMany.mockResolvedValue(
      punches(
        [AttendanceType.CHECK_IN, '2026-08-03T01:00:00Z'], // 08:00
        [AttendanceType.CHECK_OUT, '2026-08-03T05:00:00Z'], // 12:00 → 240 phút
        [AttendanceType.CHECK_IN, '2026-08-03T06:00:00Z'], // 13:00
        [AttendanceType.CHECK_OUT, '2026-08-03T10:30:00Z'], // 17:30 → 270 phút
      ),
    );

    const result = await calc();
    // 510 phút tổng − 60 phút nghỉ trưa = 450
    expect(result.workedMinutes).toBe(450);
  });

  it('quên chấm ra → MISSING_RECORD, không cộng giờ cho cặp dở dang', async () => {
    prisma.attendanceLog.findMany.mockResolvedValue(
      punches([AttendanceType.CHECK_IN, '2026-08-03T01:00:00Z']),
    );

    const result = await calc();
    expect(result.workedMinutes).toBe(0);
    expect(result.status).toBe(DailyStatus.MISSING_RECORD);
    expect(result.firstCheckInAt).not.toBeNull();
    expect(result.lastCheckOutAt).toBeNull();
  });

  it('chấm ra mà chưa chấm vào (BR-ATT-03) → bỏ qua, không sinh giờ âm', async () => {
    prisma.attendanceLog.findMany.mockResolvedValue(
      punches([AttendanceType.CHECK_OUT, '2026-08-03T10:30:00Z']),
    );

    const result = await calc();
    expect(result.workedMinutes).toBe(0);
    expect(result.workedMinutes).toBeGreaterThanOrEqual(0);
  });

  it('không có bản ghi nào → ABSENT', async () => {
    const result = await calc();
    expect(result.status).toBe(DailyStatus.ABSENT);
    expect(result.workedMinutes).toBe(0);
  });

  // =========================================================================
  //  Hiệu chỉnh công (BR-ADJ-01)
  // =========================================================================

  it('bản ghi bị VOID không được tính vào bảng công', async () => {
    prisma.attendanceLog.findMany.mockResolvedValue(
      punches(
        [AttendanceType.CHECK_IN, '2026-08-03T01:00:00Z'],
        [AttendanceType.CHECK_OUT, '2026-08-03T10:30:00Z'],
      ),
    );
    prisma.attendanceAdjustment.findMany.mockImplementation(({ where }: { where: { adjustType: string } }) =>
      Promise.resolve(
        where.adjustType === 'VOID' ? [{ attendanceLogId: 'log_1' }] : [],
      ),
    );

    const result = await calc();
    // Mất lượt chấm ra → cặp dở dang.
    expect(result.status).toBe(DailyStatus.MISSING_RECORD);
    expect(result.workedMinutes).toBe(0);
  });

  it('MODIFY_TIME áp giờ mới nhưng KHÔNG sửa bản ghi gốc', async () => {
    prisma.attendanceLog.findMany.mockResolvedValue(
      punches(
        [AttendanceType.CHECK_IN, '2026-08-03T01:47:00Z'], // 08:47 — đi muộn
        [AttendanceType.CHECK_OUT, '2026-08-03T10:30:00Z'],
      ),
    );
    prisma.attendanceAdjustment.findMany.mockImplementation(({ where }: { where: { adjustType: string } }) =>
      Promise.resolve(
        where.adjustType === 'MODIFY_TIME'
          ? [{ attendanceLogId: 'log_0', afterValue: { recordedAt: '2026-08-03T01:00:00Z' } }]
          : [],
      ),
    );

    const result = await calc();
    expect(result.lateMinutes).toBe(0);
    // Bản ghi gốc vẫn nằm trong breakdown để đối soát.
    expect(result.breakdown.timeOverrides).toHaveLength(1);
  });

  // =========================================================================
  //  Nghỉ phép & ngày lễ
  // =========================================================================

  it('đơn nghỉ phép nguyên ngày đã duyệt → ON_LEAVE và vẫn tính đủ công', async () => {
    prisma.leaveRequest.findMany.mockResolvedValue([
      {
        id: 'req_1',
        quantity: 1,
        isHalfDay: false,
        requestType: { code: 'ANNUAL_LEAVE', deductFrom: 'ANNUAL_LEAVE', unit: 'DAY' },
      },
    ]);

    const result = await calc();
    expect(result.status).toBe(DailyStatus.ON_LEAVE);
    expect(result.standardDays).toBe(1);
    expect(result.appliedRequestIds).toContain('req_1');
  });

  it('nghỉ nửa ngày → tính nửa công', async () => {
    prisma.leaveRequest.findMany.mockResolvedValue([
      {
        id: 'req_2',
        quantity: 0.5,
        isHalfDay: true,
        requestType: { code: 'ANNUAL_LEAVE', deductFrom: 'ANNUAL_LEAVE', unit: 'DAY' },
      },
    ]);

    const result = await calc();
    expect(result.standardDays).toBe(0.5);
  });

  it('nghỉ KHÔNG lương không được tính công', async () => {
    prisma.leaveRequest.findMany.mockResolvedValue([
      {
        id: 'req_3',
        quantity: 1,
        isHalfDay: false,
        requestType: { code: 'UNPAID_LEAVE', deductFrom: 'UNPAID', unit: 'DAY' },
      },
    ]);

    const result = await calc();
    expect(result.standardDays).toBe(0);
  });

  it('ngày lễ không có chấm công → HOLIDAY', async () => {
    policy.findHoliday.mockResolvedValue({ name: 'Quốc khánh', otMultiplier: 3.0 });

    const result = await calc('2026-09-02');
    expect(result.status).toBe(DailyStatus.HOLIDAY);
  });

  // =========================================================================
  //  OT (docs/04 mục 7.3, NFR-LEGAL-05/06)
  // =========================================================================

  it('làm ngoài ca nhưng KHÔNG có đơn OT duyệt trước → không tính OT', async () => {
    prisma.attendanceLog.findMany.mockResolvedValue(
      punches(
        [AttendanceType.CHECK_IN, '2026-08-03T01:00:00Z'],
        [AttendanceType.CHECK_OUT, '2026-08-03T13:30:00Z'], // 20:30 VN — muộn 3h
      ),
    );

    const result = await calc();
    expect(result.otMinutes).toBe(0);
    expect(result.breakdown.overtime).toMatchObject({
      reason: 'Không có đơn OT đã duyệt trước',
    });
  });

  it('có đơn OT duyệt trước → tính OT với hệ số ngày thường 1.5', async () => {
    prisma.attendanceLog.findMany.mockResolvedValue(
      punches(
        [AttendanceType.CHECK_IN, '2026-08-03T01:00:00Z'],
        [AttendanceType.CHECK_OUT, '2026-08-03T13:30:00Z'], // 20:30 VN
      ),
    );
    prisma.leaveRequest.findMany.mockResolvedValue([
      {
        id: 'req_ot',
        quantity: 3,
        isHalfDay: false,
        requestType: { code: 'OT_REGISTER', deductFrom: 'OT_CREDIT', unit: 'HOUR' },
      },
    ]);

    const result = await calc();
    expect(result.otMinutes).toBe(180); // 17:30 → 20:30
    expect(result.otMultiplier).toBe(1.5);
  });

  it('OT ngày lễ dùng hệ số 3.0 (NFR-LEGAL-05)', async () => {
    policy.findHoliday.mockResolvedValue({ name: 'Quốc khánh', otMultiplier: 3.0 });
    prisma.attendanceLog.findMany.mockResolvedValue(
      punches(
        [AttendanceType.CHECK_IN, '2026-09-02T01:00:00Z'],
        [AttendanceType.CHECK_OUT, '2026-09-02T12:30:00Z'], // 19:30 VN
      ),
    );
    prisma.leaveRequest.findMany.mockResolvedValue([
      {
        id: 'req_ot',
        quantity: 2,
        isHalfDay: false,
        requestType: { code: 'OT_REGISTER', deductFrom: 'OT_CREDIT', unit: 'HOUR' },
      },
    ]);

    const result = await calc('2026-09-02');
    expect(result.otMultiplier).toBe(3.0);
  });

  it('OT vượt trần theo ngày bị cắt về mức tối đa (NFR-LEGAL-06)', async () => {
    prisma.attendanceLog.findMany.mockResolvedValue(
      punches(
        [AttendanceType.CHECK_IN, '2026-08-03T01:00:00Z'],
        [AttendanceType.CHECK_OUT, '2026-08-03T17:00:00Z'], // 24:00 VN → OT 6h30
      ),
    );
    prisma.leaveRequest.findMany.mockResolvedValue([
      {
        id: 'req_ot',
        quantity: 7,
        isHalfDay: false,
        requestType: { code: 'OT_REGISTER', deductFrom: 'OT_CREDIT', unit: 'HOUR' },
      },
    ]);

    const result = await calc();
    // Trần mặc định 240 phút/ngày.
    expect(result.otMinutes).toBe(240);
    expect(String(result.breakdown.overtime)).toBeDefined();
  });

  // =========================================================================
  //  Làm bù & idempotency
  // =========================================================================

  it('phút làm bù được cộng vào công chuẩn', async () => {
    prisma.makeupWorkRecord.aggregate.mockResolvedValue({ _sum: { makeupMinutes: 120 } });
    prisma.attendanceLog.findMany.mockResolvedValue(
      punches(
        [AttendanceType.CHECK_IN, '2026-08-03T01:00:00Z'],
        [AttendanceType.CHECK_OUT, '2026-08-03T07:00:00Z'], // 14:00 VN → 360 phút
      ),
    );

    const result = await calc();
    // 360 − 60 nghỉ = 300, + 120 làm bù = 420
    expect(result.makeupMinutes).toBe(120);
    expect(result.workedMinutes).toBe(420);
  });

  it('IDEMPOTENT — chạy hai lần cho cùng dữ liệu ra kết quả GIỐNG HỆT (NFR-REL-06)', async () => {
    prisma.attendanceLog.findMany.mockResolvedValue(
      punches(
        [AttendanceType.CHECK_IN, '2026-08-03T01:15:00Z'],
        [AttendanceType.CHECK_OUT, '2026-08-03T10:45:00Z'],
      ),
    );

    const first = await calc();
    const second = await calc();

    expect(second.workedMinutes).toBe(first.workedMinutes);
    expect(second.lateMinutes).toBe(first.lateMinutes);
    expect(second.earlyLeaveMinutes).toBe(first.earlyLeaveMinutes);
    expect(second.otMinutes).toBe(first.otMinutes);
    expect(second.standardDays).toBe(first.standardDays);
    expect(second.status).toBe(first.status);
  });

  // =========================================================================
  //  Ca linh hoạt
  // =========================================================================

  it('ca linh hoạt KHÔNG tính đi muộn, chỉ tính đủ/thiếu giờ', async () => {
    policy.resolveShiftForDate.mockResolvedValue({
      ...officeShift,
      type: ShiftType.FLEXIBLE,
      requiredMinutes: 480,
    });
    prisma.attendanceLog.findMany.mockResolvedValue(
      punches(
        [AttendanceType.CHECK_IN, '2026-08-03T03:00:00Z'], // 10:00 VN — muộn nếu là ca cố định
        [AttendanceType.CHECK_OUT, '2026-08-03T12:00:00Z'], // 19:00 VN
      ),
    );

    const result = await calc();
    expect(result.lateMinutes).toBe(0);
    expect(result.earlyLeaveMinutes).toBe(0);
  });

  it('về sớm được ưu tiên hơn thiếu công vì nói rõ nguyên nhân hơn', async () => {
    prisma.attendanceLog.findMany.mockResolvedValue(
      punches(
        [AttendanceType.CHECK_IN, '2026-08-03T01:00:00Z'],
        [AttendanceType.CHECK_OUT, '2026-08-03T06:00:00Z'], // 13:00 VN → 300 phút
      ),
    );

    const result = await calc();
    // 300 − 60 = 240 phút, dưới 480 phút chuẩn NHƯNG nguyên nhân là về sớm.
    expect(result.workedMinutes).toBe(240);
    expect(result.earlyLeaveMinutes).toBe(270);
    expect(result.status).toBe(DailyStatus.EARLY_LEAVE);
  });

  it('vào đúng giờ, ra đúng giờ nhưng nghỉ dài giữa ca → INSUFFICIENT', async () => {
    prisma.attendanceLog.findMany.mockResolvedValue(
      punches(
        [AttendanceType.CHECK_IN, '2026-08-03T01:00:00Z'], // 08:00
        [AttendanceType.CHECK_OUT, '2026-08-03T05:00:00Z'], // 12:00 → 240 phút
        [AttendanceType.CHECK_IN, '2026-08-03T10:00:00Z'], // 17:00
        [AttendanceType.CHECK_OUT, '2026-08-03T10:30:00Z'], // 17:30 → 30 phút
      ),
    );

    const result = await calc();
    // 270 − 60 nghỉ trưa = 210 phút, dưới 480 phút chuẩn.
    expect(result.workedMinutes).toBe(210);
    expect(result.lateMinutes).toBe(0);
    expect(result.earlyLeaveMinutes).toBe(0);
    expect(result.status).toBe(DailyStatus.INSUFFICIENT);
  });

  // =========================================================================
  //  Breakdown phục vụ giải trình
  // =========================================================================

  it('breakdown ghi đủ thông tin để giải trình "con số này ra từ đâu"', async () => {
    prisma.attendanceLog.findMany.mockResolvedValue(
      punches(
        [AttendanceType.CHECK_IN, '2026-08-03T01:00:00Z'],
        [AttendanceType.CHECK_OUT, '2026-08-03T10:30:00Z'],
      ),
    );

    const result = await calc();
    expect(result.breakdown).toMatchObject({
      timezone: VN,
      workDate: '2026-08-03',
      rawWorkedMinutes: 570,
      breakMinutes: 60,
      minutesPerStandardDay: 480,
    });
    expect(result.breakdown.shift).toMatchObject({ name: 'Hành chính', startTime: '08:00' });
    expect(Array.isArray(result.breakdown.pairs)).toBe(true);
  });
});
