import { DailyStatus, PayrollPeriodStatus } from '@prisma/client';
import { buildPayrollSchedule, buildProgress, classifyIssue } from './report.service';

/**
 * Dashboard doi soat ky cong (FR-WEB-DASH-07).
 *
 * Hai ham thuan tuy nay quyet dinh con so ma Ke toan nhin thay dau moi buoi
 * sang. Sai o day khong lam he thong do — no lam mot nguoi lam viec ca ngay
 * theo mot danh sach sai.
 */
describe('classifyIssue — xep mot ngay cong vao dung mot ly do', () => {
  const base = {
    status: DailyStatus.ON_TIME,
    hasFraudFlag: false,
    firstCheckInAt: new Date('2026-09-01T01:00:00Z'),
    lastCheckOutAt: new Date('2026-09-01T10:00:00Z'),
  };

  it('thieu check-out khi co gio vao ma khong co gio ra', () => {
    expect(classifyIssue({ ...base, lastCheckOutAt: null })).toBe('MISSING_CHECK_OUT');
  });

  it('thieu check-in khi co gio ra ma khong co gio vao', () => {
    expect(classifyIssue({ ...base, firstCheckInAt: null })).toBe('MISSING_CHECK_IN');
  });

  /*
   * Thu tu uu tien la phan de sai nhat cua ham nay.
   *
   * Mot ngay vua thieu check-out vua co co gian lan phai xep vao "thieu
   * check-out": do la viec Ke toan lam duoc ngay (bo sung gio). Xep vao "co
   * gian lan" thi ho mo ra, khong thay bang chung nao vi ban ghi con dang do,
   * roi dong lai — ngay do o lai hang doi mai mai.
   */
  it('thieu dau cham thang co gian lan', () => {
    expect(classifyIssue({ ...base, lastCheckOutAt: null, hasFraudFlag: true })).toBe(
      'MISSING_CHECK_OUT',
    );
  });

  it('co gian lan thang thieu gio', () => {
    expect(classifyIssue({ ...base, status: DailyStatus.INSUFFICIENT, hasFraudFlag: true })).toBe(
      'FRAUD_FLAG',
    );
  });

  it('thieu gio khi du hai dau cham va khong co co', () => {
    expect(classifyIssue({ ...base, status: DailyStatus.INSUFFICIENT })).toBe('INSUFFICIENT');
  });

  it('khong co du lieu la truong hop con lai', () => {
    expect(
      classifyIssue({
        ...base,
        status: DailyStatus.ABSENT,
        firstCheckInAt: null,
        lastCheckOutAt: null,
      }),
    ).toBe('NO_RECORD');
  });
});

describe('buildProgress — duong tien do cong don', () => {
  const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

  it('cong don theo ngay, khong phai dem rieng tung ngay', () => {
    const points = buildProgress(
      [
        { workDate: day('2026-09-01'), settled: 3 },
        { workDate: day('2026-09-02'), settled: 2 },
        { workDate: day('2026-09-03'), settled: 5 },
      ],
      day('2026-09-01'),
      day('2026-09-03'),
      10,
    );

    expect(points.map((point) => point.settled)).toEqual([3, 5, 10]);
  });

  it('muc tieu la so nhan vien nhan so ngay da qua', () => {
    const points = buildProgress([], day('2026-09-01'), day('2026-09-03'), 10);
    expect(points.map((point) => point.expected)).toEqual([10, 20, 30]);
  });

  /*
   * Ngay khong co ban ghi nao phai VAN xuat hien tren duong, voi gia tri giu
   * nguyen. Bo ngay do di thi truc ngang nhay coc va bieu do trong nhu ky cong
   * ngan hon thuc te.
   */
  it('ngay khong co du lieu van co diem, gia tri giu nguyen', () => {
    const points = buildProgress(
      [
        { workDate: day('2026-09-01'), settled: 4 },
        { workDate: day('2026-09-04'), settled: 1 },
      ],
      day('2026-09-01'),
      day('2026-09-04'),
      5,
    );

    expect(points).toHaveLength(4);
    expect(points.map((point) => point.settled)).toEqual([4, 4, 4, 5]);
    expect(points.map((point) => point.workDate)).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
    ]);
  });

  it('khoang mot ngay cho dung mot diem', () => {
    const points = buildProgress([], day('2026-09-01'), day('2026-09-01'), 7);
    expect(points).toEqual([{ workDate: '2026-09-01', settled: 0, expected: 7 }]);
  });

  /*
   * `buildProgress` sua `cursor` tai cho trong vong lap. Neu no lo dung thang
   * doi tuong `from` thi ham goi no lan thu hai voi cung tham so se cho ket qua
   * khac — mot loi chi lo ra khi cache Redis het han giua hai lan goi.
   */
  it('khong sua doi tham so `from` cua nguoi goi', () => {
    const from = day('2026-09-01');
    const to = day('2026-09-05');
    buildProgress([], from, to, 3);
    expect(from.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(to.toISOString()).toBe('2026-09-05T00:00:00.000Z');
  });
});

describe('buildPayrollSchedule — bon moc chot luong suy tu ngay cuoi ky', () => {
  const endDate = new Date('2026-05-31T00:00:00Z');
  const config = { reviewDays: 2, calcDays: 2, payoutOffsetDays: 5 };

  it('trai bon moc lien tiep, khong hong ngay va khong chong nhau', () => {
    const schedule = buildPayrollSchedule(
      endDate,
      new Date('2026-05-20T00:00:00Z'),
      PayrollPeriodStatus.OPEN,
      config,
    );

    expect(schedule.map((item) => [item.key, item.fromDate, item.toDate])).toEqual([
      ['CLOSE', '2026-05-31', '2026-05-31'],
      ['REVIEW', '2026-06-01', '2026-06-02'],
      ['CALCULATE', '2026-06-03', '2026-06-04'],
      ['PAYOUT', '2026-06-05', '2026-06-05'],
    ]);
  });

  it('doi so ngay chinh sach thi moc dich theo, khong hard-code', () => {
    const schedule = buildPayrollSchedule(
      endDate,
      new Date('2026-05-20T00:00:00Z'),
      PayrollPeriodStatus.OPEN,
      { reviewDays: 3, calcDays: 1, payoutOffsetDays: 10 },
    );

    expect(schedule[1]).toMatchObject({ fromDate: '2026-06-01', toDate: '2026-06-03' });
    expect(schedule[2]).toMatchObject({ fromDate: '2026-06-04', toDate: '2026-06-04' });
    expect(schedule[3]).toMatchObject({ fromDate: '2026-06-10', toDate: '2026-06-10' });
  });

  /*
   * Cho nay la ly do bai test ton tai.
   *
   * Ngay 05/06 da qua ngay cuoi ky 31/05, nhung ky VAN dang mo — ke toan chua
   * gui duyet chot. To xanh moc "Chot cong" chi vi ngay da qua la noi voi ho
   * mot viec da xong trong khi no chua bat dau.
   */
  it('moc "Chot cong" theo trang thai ky chu khong theo ngay', () => {
    const late = new Date('2026-06-05T00:00:00Z');

    expect(buildPayrollSchedule(endDate, late, PayrollPeriodStatus.OPEN, config)[0]?.state).toBe(
      'CURRENT',
    );

    expect(buildPayrollSchedule(endDate, late, PayrollPeriodStatus.LOCKED, config)[0]?.state).toBe(
      'DONE',
    );
  });

  it('ky da chot truoc han van hien "da xong" o moc dau', () => {
    const early = new Date('2026-05-28T00:00:00Z');
    const schedule = buildPayrollSchedule(endDate, early, PayrollPeriodStatus.LOCKED, config);

    expect(schedule[0]?.state).toBe('DONE');
    expect(schedule[1]?.state).toBe('UPCOMING');
  });

  it('phan biet da qua / dang toi / sap toi theo ngay hom nay', () => {
    const schedule = buildPayrollSchedule(
      endDate,
      new Date('2026-06-02T00:00:00Z'),
      PayrollPeriodStatus.PENDING_APPROVAL,
      config,
    );

    expect(schedule.map((item) => item.state)).toEqual([
      'CURRENT',
      'CURRENT',
      'UPCOMING',
      'UPCOMING',
    ]);
  });

  /*
   * So ngay 0 la cau hinh hop le tren man hinh chinh sach (o nhap khong cho so
   * am, nhung cho 0). Khong chan thi `reviewTo` lui ve TRUOC `reviewFrom` va
   * khoi lich hien mot khoang ngay chay nguoc.
   */
  it('so ngay 0 khong lam khoang ngay chay nguoc', () => {
    const schedule = buildPayrollSchedule(endDate, endDate, PayrollPeriodStatus.OPEN, {
      reviewDays: 0,
      calcDays: 0,
      payoutOffsetDays: 0,
    });

    for (const item of schedule) {
      expect(item.fromDate <= item.toDate).toBe(true);
    }
  });
});
