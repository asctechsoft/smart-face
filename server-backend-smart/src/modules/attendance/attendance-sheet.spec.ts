import { AppException } from 'src/common/errors';
import { AttendanceSheetService } from './attendance-sheet.service';
import type { AttendanceSheetRow } from './attendance-sheet.repository';

/**
 * Bảng chấm công — FR-WEB-ATT-08.
 *
 * Bốn luật được kiểm ở đây là bốn thứ mà sai một cái là bảng công sai tiền:
 *
 *  1. Thành viên phải lấy từ BẢNG PHÂN CA của cùng tháng — thiếu người có ca thì
 *     cuối tháng không ai rà công cho họ.
 *  2. Chỉ rơi về danh sách phòng ban khi tháng đó chưa có bảng phân ca nào.
 *  3. Lưới không được kéo ra ngoài kỳ của bảng.
 *  4. Bảng đã chốt không sửa được thành viên.
 */
describe('Bảng chấm công', () => {
  const sheet = (patch: Partial<AttendanceSheetRow> = {}): AttendanceSheetRow =>
    ({
      id: 'sheet_1',
      companyId: 'cmp_1',
      name: 'Bảng chấm công Tháng 08/2026',
      // Tháng 8/2026 — ngày 01 đúng như service chuẩn hoá.
      periodMonth: new Date(Date.UTC(2026, 7, 1)),
      departmentIds: ['dept_kho'],
      shiftScheduleIds: ['sch_1'],
      status: 'DRAFT',
      closedAt: null,
      closedBy: null,
      createdBy: 'usr_1',
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      _count: { members: 2 },
      ...patch,
    }) as AttendanceSheetRow;

  /** Kho mock, đặt lại trước mỗi test để một test không nhìn thấy lời gọi của test khác. */
  let sheets: Record<string, jest.Mock>;
  let policies: Record<string, jest.Mock>;
  let payroll: Record<string, jest.Mock>;
  let queue: Record<string, jest.Mock>;
  let service: AttendanceSheetService;

  beforeEach(() => {
    sheets = {
      findSheet: jest.fn().mockResolvedValue(sheet()),
      findShiftSchedulesForPeriod: jest.fn().mockResolvedValue([]),
      findScheduleMemberIds: jest.fn().mockResolvedValue([]),
      filterEmployeeIds: jest.fn().mockResolvedValue([]),
      findMembersTakenInMonth: jest.fn().mockResolvedValue([]),
      createSheet: jest.fn().mockResolvedValue({ id: 'sheet_1' }),
      addMembers: jest.fn().mockResolvedValue(0),
      findMemberIds: jest.fn().mockResolvedValue([]),
      createRecalculateJob: jest.fn().mockResolvedValue({ id: 'job_1' }),
      markRecalculateJobDone: jest.fn().mockResolvedValue(undefined),
    };
    payroll = { runTrackedRecalculate: jest.fn().mockResolvedValue(undefined) };
    queue = { add: jest.fn().mockResolvedValue(undefined) };
    policies = {
      expandDepartmentIds: jest.fn().mockResolvedValue(['dept_kho', 'dept_kho_a']),
      findAssignableEmployeeIdsInDepartments: jest.fn().mockResolvedValue([]),
      findDepartmentNames: jest.fn().mockResolvedValue(['Kho']),
    };

    service = new AttendanceSheetService(
      sheets as never,
      policies as never,
      {} as never,
      payroll as never,
      // `TransactionManager.run` chỉ cần chạy callback: các test ở đây kiểm luật
      // nghiệp vụ, không kiểm ranh giới transaction.
      { run: (fn: (tx: unknown) => unknown) => fn({}) } as never,
      queue as never,
    );
  });

  const create = () =>
    service.create(
      'cmp_1',
      { departmentIds: ['dept_kho'], periodMonth: '2026-08-15' },
      'usr_1',
      null,
    );

  describe('nguồn thành viên khi lập bảng', () => {
    it('lấy CBNV từ bảng phân ca của cùng tháng', async () => {
      sheets.findShiftSchedulesForPeriod?.mockResolvedValue([
        {
          id: 'sch_1',
          name: 'Bảng phân ca Tháng 08/2026',
          departmentIds: ['dept_kho'],
          shiftIds: [],
        },
      ]);
      sheets.findScheduleMemberIds?.mockResolvedValue(['emp_1', 'emp_2']);
      sheets.filterEmployeeIds?.mockResolvedValue(['emp_1', 'emp_2']);

      await create();

      expect(sheets.addMembers).toHaveBeenCalledWith(
        'sheet_1',
        new Date(Date.UTC(2026, 7, 1)),
        ['emp_1', 'emp_2'],
        expect.anything(),
      );
      // Có phân ca thì KHÔNG được đụng tới danh sách phòng ban: hai nguồn cho ra
      // hai tập người khác nhau ngay khi có người chuyển phòng giữa tháng.
      expect(policies.findAssignableEmployeeIdsInDepartments).not.toHaveBeenCalled();
    });

    it('ghi lại bảng phân ca nguồn để truy được xuất xứ', async () => {
      sheets.findShiftSchedulesForPeriod?.mockResolvedValue([
        { id: 'sch_1', name: 'A', departmentIds: ['dept_kho'], shiftIds: [] },
        { id: 'sch_2', name: 'B', departmentIds: ['dept_kho_a'], shiftIds: [] },
      ]);
      sheets.findScheduleMemberIds?.mockResolvedValue(['emp_1']);
      sheets.filterEmployeeIds?.mockResolvedValue(['emp_1']);

      await create();

      expect(sheets.createSheet).toHaveBeenCalledWith(
        'cmp_1',
        expect.objectContaining({ shiftScheduleIds: ['sch_1', 'sch_2'] }),
        expect.anything(),
      );
    });

    it('chuẩn hoá kỳ về ngày 01 dù client gửi ngày giữa tháng', async () => {
      sheets.filterEmployeeIds?.mockResolvedValue(['emp_1']);

      await create();

      expect(sheets.createSheet).toHaveBeenCalledWith(
        'cmp_1',
        expect.objectContaining({ periodMonth: new Date(Date.UTC(2026, 7, 1)) }),
        expect.anything(),
      );
    });

    it('rơi về danh sách phòng ban khi tháng đó chưa có bảng phân ca nào', async () => {
      policies.findAssignableEmployeeIdsInDepartments?.mockResolvedValue(['emp_9']);

      await create();

      expect(sheets.addMembers).toHaveBeenCalledWith(
        'sheet_1',
        expect.anything(),
        ['emp_9'],
        expect.anything(),
      );
      // Không được nhận vơ là lấy từ phân ca — đó là nói dối về xuất xứ dữ liệu,
      // và danh sách bảng dùng đúng trường này để cảnh báo mức tin cậy.
      expect(sheets.createSheet).toHaveBeenCalledWith(
        'cmp_1',
        expect.objectContaining({ shiftScheduleIds: [] }),
        expect.anything(),
      );
    });

    it('từ chối lập bảng rỗng', async () => {
      await expect(create()).rejects.toMatchObject({ code: 'ATT_SHEET_NO_MEMBERS' });
      expect(sheets.createSheet).not.toHaveBeenCalled();
    });

    it('báo tên người đã thuộc bảng khác của cùng tháng', async () => {
      sheets.filterEmployeeIds?.mockResolvedValue(['emp_1']);
      sheets.findMembersTakenInMonth?.mockResolvedValue([
        { employeeId: 'emp_1', fullName: 'Nguyễn Văn A', sheetName: 'Bảng chấm công Kho' },
      ]);

      await expect(create()).rejects.toBeInstanceOf(AppException);
      await expect(create()).rejects.toMatchObject({ code: 'ATT_SHEET_EMPLOYEE_TAKEN' });
      expect(sheets.createSheet).not.toHaveBeenCalled();
    });
  });

  describe('lưới phải nằm trong kỳ của bảng', () => {
    const board = (from: string, to: string) =>
      service.getBoard('cmp_1', 'sheet_1', { from, to, page: 1, pageSize: 25 }, null);

    // Ngày ngoài kỳ là lỗi âm thầm nhất: lưới vẫn dựng ra được, nhưng nó hiển
    // thị công của một tháng khác dưới cái tên của tháng này.
    it('từ chối ngày trước kỳ', async () => {
      await expect(board('2026-07-25', '2026-08-10')).rejects.toMatchObject({
        code: 'ATT_SHEET_OUT_OF_PERIOD',
      });
    });

    it('từ chối ngày sau kỳ', async () => {
      await expect(board('2026-08-20', '2026-09-02')).rejects.toMatchObject({
        code: 'ATT_SHEET_OUT_OF_PERIOD',
      });
    });

    it('từ chối khoảng ngày đảo ngược', async () => {
      await expect(board('2026-08-20', '2026-08-10')).rejects.toMatchObject({
        code: 'SYS_VALIDATION_ERROR',
      });
    });
  });

  describe('bảng đã chốt', () => {
    beforeEach(() => {
      sheets.findSheet?.mockResolvedValue(sheet({ status: 'CLOSED' }));
    });

    it('không thêm được CBNV', async () => {
      await expect(
        service.addMembers('cmp_1', 'sheet_1', { employeeIds: ['emp_3'] }, null),
      ).rejects.toMatchObject({ code: 'ATT_SHEET_CLOSED' });
      expect(sheets.addMembers).not.toHaveBeenCalled();
    });

    it('không bỏ được CBNV', async () => {
      await expect(
        service.removeMembers('cmp_1', 'sheet_1', { employeeIds: ['emp_1'] }),
      ).rejects.toMatchObject({ code: 'ATT_SHEET_CLOSED' });
    });

    // Đọc thì vẫn phải được: chốt bảng là khoá việc SỬA, không phải khoá việc xem.
    it('vẫn xem được chi tiết', async () => {
      await expect(service.get('cmp_1', 'sheet_1')).resolves.toMatchObject({ status: 'CLOSED' });
    });
  });

  describe('cập nhật bảng công', () => {
    const ctx = { companyId: 'cmp_1', userId: 'usr_1' } as never;

    // Không có Redis thì nhánh nội tuyến phải chạy — nếu để nó ném lỗi như xuất
    // Excel thì nút bấm vô dụng ở mọi môi trường chưa bật dịch vụ nền.
    it('tính lại ĐÚNG thành viên của bảng và ĐÚNG kỳ của bảng', async () => {
      sheets.findMemberIds?.mockResolvedValue(['emp_1', 'emp_2']);

      const result = await service.recalculate(ctx, 'sheet_1');

      expect(payroll.runTrackedRecalculate).toHaveBeenCalledWith(
        'cmp_1',
        'job_1',
        new Date(Date.UTC(2026, 7, 1)),
        new Date(Date.UTC(2026, 7, 31)),
        ['emp_1', 'emp_2'],
      );
      expect(result).toMatchObject({ jobId: 'job_1', employeeCount: 2 });
    });

    // Client đang chờ một `jobId` để hỏi tiến độ. Trả lỗi, hoặc để job nằm mãi ở
    // `QUEUED`, đều là kiểu hỏng người dùng không hiểu chuyện gì đang xảy ra.
    it('bảng rỗng vẫn trả về một job đã kết thúc, không phải lỗi', async () => {
      const result = await service.recalculate(ctx, 'sheet_1');

      expect(sheets.markRecalculateJobDone).toHaveBeenCalledWith('job_1');
      expect(payroll.runTrackedRecalculate).not.toHaveBeenCalled();
      expect(result).toMatchObject({ jobId: 'job_1', employeeCount: 0 });
    });

    // Chốt bảng khoá việc sửa THÀNH VIÊN, không khoá số liệu — kỳ lương mới làm
    // việc đó (BR-07), và `runRecalculateRange` tự bỏ qua ngày đã chốt.
    it('bảng đã chốt vẫn cập nhật được số liệu', async () => {
      sheets.findSheet?.mockResolvedValue(sheet({ status: 'CLOSED' }));
      sheets.findMemberIds?.mockResolvedValue(['emp_1']);

      await expect(service.recalculate(ctx, 'sheet_1')).resolves.toMatchObject({ jobId: 'job_1' });
    });

    it('báo không tìm thấy khi bảng không tồn tại', async () => {
      sheets.findSheet?.mockResolvedValue(null);
      await expect(service.recalculate(ctx, 'sheet_x')).rejects.toMatchObject({
        code: 'ATT_SHEET_NOT_FOUND',
      });
      expect(sheets.createRecalculateJob).not.toHaveBeenCalled();
    });
  });

  it('báo không tìm thấy khi bảng không tồn tại', async () => {
    sheets.findSheet?.mockResolvedValue(null);
    await expect(service.get('cmp_1', 'sheet_x')).rejects.toMatchObject({
      code: 'ATT_SHEET_NOT_FOUND',
    });
  });
});
