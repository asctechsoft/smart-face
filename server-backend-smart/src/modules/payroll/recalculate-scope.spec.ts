import { PayrollService } from './payroll.service';

/**
 * Phạm vi của một lượt tính lại công.
 *
 * Bài học đắt giá đã trả một lần: bộ lọc trạng thái nhân viên loại hết mọi người
 * ra khỏi danh sách, vòng lặp không chạy lần nào, và job vẫn báo hoàn tất 100%.
 * Người dùng bấm nút "Cập nhật bảng công", nhận thông báo thành công, rồi ngồi
 * nhìn một bảng không đổi mà không có gì trên màn hình giải thích vì sao.
 *
 * Hai chốt dưới đây tồn tại để kiểu hỏng ĐÓ không quay lại: mọi người mà
 * repository trả về đều phải được tính, và số người trong phạm vi phải được báo
 * ra ngoài chứ không nuốt vào trong.
 */
describe('Phạm vi tính lại công', () => {
  const COMPANY = 'cmp_1';
  const from = new Date(Date.UTC(2026, 7, 1));
  const to = new Date(Date.UTC(2026, 7, 3)); // 3 ngày cho gọn

  let payrolls: Record<string, jest.Mock>;
  let engine: { calculateAndPersist: jest.Mock };
  let service: PayrollService;

  beforeEach(() => {
    payrolls = {
      findCalculableEmployeeIds: jest.fn().mockResolvedValue([]),
      findClosedPeriodsInRange: jest.fn().mockResolvedValue([]),
    };
    engine = { calculateAndPersist: jest.fn().mockResolvedValue(undefined) };

    service = new PayrollService(
      payrolls as never,
      {} as never,
      engine as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  const run = (employeeIds?: string[]) =>
    service.runRecalculateRange(COMPANY, from, to, employeeIds);

  it('tính cho MỌI nhân viên repository trả về, mỗi người mỗi ngày', async () => {
    payrolls.findCalculableEmployeeIds?.mockResolvedValue(['emp_1', 'emp_2']);

    const result = await run(['emp_1', 'emp_2']);

    // 2 người × 3 ngày.
    expect(engine.calculateAndPersist).toHaveBeenCalledTimes(6);
    expect(result).toMatchObject({ calculated: 6, employeeCount: 2 });
  });

  // Đây chính là hình dạng của lỗi cũ: `calculated = 0` mà không ai biết.
  // `employeeCount` là thứ phân biệt "không có ai trong phạm vi" với "đã tính xong".
  it('báo ra employeeCount = 0 khi phạm vi rỗng, không im lặng báo thành công', async () => {
    const result = await run(['emp_khong_ton_tai']);

    expect(engine.calculateAndPersist).not.toHaveBeenCalled();
    expect(result).toMatchObject({ calculated: 0, employeeCount: 0 });
  });

  // BR-07: ngày thuộc kỳ lương đã chốt là dữ liệu đã dùng để trả tiền.
  it('bỏ qua ngày thuộc kỳ đã chốt thay vì ghi đè', async () => {
    payrolls.findCalculableEmployeeIds?.mockResolvedValue(['emp_1']);
    payrolls.findClosedPeriodsInRange?.mockResolvedValue([
      { startDate: new Date(Date.UTC(2026, 7, 2)), endDate: new Date(Date.UTC(2026, 7, 2)) },
    ]);

    const result = await run();

    expect(engine.calculateAndPersist).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ calculated: 2, skippedLockedDays: 1, employeeCount: 1 });
  });
});
