import { PaginatedResult } from 'src/common/dto/api-response.dto';
import { AppException } from 'src/common/errors';
import { PolicyAdminService } from './policy-admin.service';
import type { ShiftScheduleRow } from './policy.repository';

/**
 * Bảng phân ca — FR-WEB-HR-13.
 *
 * Tập trung vào các luật giữ cho hai bảng không tranh nhau ghi vào cùng một ô
 * lịch, và giữ mọi thao tác nằm trong phạm vi đã chốt lúc lập bảng.
 */
describe('Bảng phân ca', () => {
  const schedule = (patch: Partial<ShiftScheduleRow> = {}): ShiftScheduleRow =>
    ({
      id: 'sch_1',
      companyId: 'cmp_1',
      name: 'Bảng phân ca Tháng 08/2026',
      // Tháng 8/2026 — ngày 01 đúng như service chuẩn hoá.
      periodMonth: new Date(Date.UTC(2026, 7, 1)),
      departmentIds: ['dept_kho'],
      shiftIds: ['shift_hc'],
      createdBy: 'usr_1',
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      _count: { members: 5, assignments: 0 },
      ...patch,
    }) as ShiftScheduleRow;

  let service: PolicyAdminService;

  const assertRange = (from: string, to: string, row = schedule()) =>
    (
      service as unknown as {
        assertRangeInPeriod: (s: ShiftScheduleRow, f: Date, t: Date) => void;
      }
    ).assertRangeInPeriod(row, new Date(`${from}T00:00:00Z`), new Date(`${to}T00:00:00Z`));

  const assertShift = (shiftId: string, row = schedule()) =>
    (
      service as unknown as { assertShiftInScope: (s: ShiftScheduleRow, id: string) => void }
    ).assertShiftInScope(row, shiftId);

  beforeEach(() => {
    service = new PolicyAdminService({} as never, {} as never, {} as never);
  });

  describe('khoảng ngày phải nằm trong kỳ', () => {
    it('chấp nhận trọn tháng của kỳ', () => {
      expect(() => assertRange('2026-08-01', '2026-08-31')).not.toThrow();
    });

    it('chấp nhận một tuần bên trong kỳ', () => {
      expect(() => assertRange('2026-08-10', '2026-08-16')).not.toThrow();
    });

    // Đây là lỗi âm thầm nhất: xếp ca ngày 31/07 trong bảng tháng 8 thì lượt đó
    // vẫn ghi được vào database, nhưng màn chi tiết của bảng không bao giờ hiện
    // ra nó — người dùng xếp lại lần nữa và tưởng lần đầu bị mất.
    it('từ chối ngày trước kỳ', () => {
      expect(() => assertRange('2026-07-31', '2026-08-15')).toThrow(AppException);
    });

    it('từ chối ngày sau kỳ', () => {
      expect(() => assertRange('2026-08-20', '2026-09-01')).toThrow(AppException);
    });

    it('nêu đúng mã lỗi', () => {
      try {
        assertRange('2026-09-01', '2026-09-30');
        throw new Error('đáng lẽ phải ném');
      } catch (error) {
        expect((error as AppException).code).toBe('POL_SCHEDULE_OUT_OF_PERIOD');
      }
    });

    /** Tháng 2 nhuận: 2028 có 29 ngày. Sai biên ở đây làm mất một ngày công. */
    it('tính đúng ngày cuối của tháng nhuận', () => {
      const feb = schedule({ periodMonth: new Date(Date.UTC(2028, 1, 1)) });
      expect(() => assertRange('2028-02-01', '2028-02-29', feb)).not.toThrow();
      expect(() => assertRange('2028-02-01', '2028-03-01', feb)).toThrow(AppException);
    });
  });

  describe('ca phải nằm trong phạm vi bảng', () => {
    it('chấp nhận ca đã chọn lúc lập bảng', () => {
      expect(() => assertShift('shift_hc')).not.toThrow();
    });

    it('từ chối ca ngoài phạm vi', () => {
      expect(() => assertShift('shift_dem')).toThrow(AppException);
      try {
        assertShift('shift_dem');
      } catch (error) {
        expect((error as AppException).code).toBe('POL_SCHEDULE_OUT_OF_SCOPE');
      }
    });
  });

  /**
   * docs/04 mục 8.5 — "không tạo bảng rỗng vô nghĩa".
   *
   * Bảng rỗng không báo lỗi gì mà vẫn GIỮ CHỖ: tháng đó phòng ban đó coi như đã
   * có bảng, người lập mở lưới chi tiết ra thấy trống trơn và không có gì trên
   * màn hình giải thích. Đây là đúng tình huống đã xảy ra với phòng "Kinh doanh"
   * (0 nhân viên) trên dữ liệu thật.
   */
  describe('không lập bảng rỗng', () => {
    const repositoryWith = (employeeIds: string[]) => ({
      findShift: jest.fn().mockResolvedValue({ id: 'shift_hc' }),
      expandDepartmentIds: jest.fn().mockResolvedValue(['dept_kd']),
      findAssignableEmployeeIdsInDepartments: jest.fn().mockResolvedValue(employeeIds),
      findDepartmentNames: jest.fn().mockResolvedValue(['Kinh doanh']),
      findMembersTakenInMonth: jest.fn().mockResolvedValue([]),
    });

    const create = (repository: object) =>
      new PolicyAdminService(repository as never, {} as never, {} as never).createShiftSchedule(
        'cmp_1',
        { departmentIds: ['dept_kd'], shiftIds: ['shift_hc'], periodMonth: '2026-08-01' } as never,
        'usr_1',
        null,
      );

    it('từ chối khi phòng ban không có ai đang làm việc', async () => {
      await expect(create(repositoryWith([]))).rejects.toMatchObject({
        code: 'POL_SCHEDULE_NO_MEMBERS',
      });
    });

    /** Id trần không nói được gì với người đang đứng trước màn hình. */
    it('nêu tên phòng ban trong lỗi', async () => {
      await expect(create(repositoryWith([]))).rejects.toMatchObject({
        details: { departments: ['Kinh doanh'] },
      });
    });

    /**
     * Khối cha có 0 người đứng TRỰC TIẾP nhưng có người ở phòng con vẫn phải lập
     * được — chặn nhầm ở đây thì không ai lập nổi bảng cho cả công ty.
     */
    it('không chặn nhầm khi người nằm ở phòng ban cấp dưới', async () => {
      const repository = repositoryWith(['emp_1']);
      // Đi tiếp tới bước ghi rồi ngã ở đó vì transaction không được mock — điều
      // cần khẳng định là luật "bảng rỗng" KHÔNG chặn, nên soi đúng dấu vết của
      // nhánh đó thay vì so kiểu lỗi cuối cùng.
      await create(repository).catch(() => undefined);
      expect(repository.findDepartmentNames).not.toHaveBeenCalled();
    });
  });

  /**
   * Lưới của một bảng CHỈ hiện lịch do chính bảng đó xếp.
   *
   * Một tháng có thể đã có lịch ca dựng từ trước khi có phân hệ bảng phân ca
   * (dữ liệu thật: 88 lượt `scheduleId = null`). Lấy theo khoảng ngày mà không
   * lọc theo bảng thì một bảng vừa lập xong, chưa ai xếp gì, mở ra đã kín ca —
   * đọc thành "hệ thống tự ý phân ca".
   */
  describe('lưới chỉ hiện lịch của chính bảng', () => {
    const repositoryFor = (query: { scheduleId?: string }) => {
      const repository = {
        findShiftSchedule: jest.fn().mockResolvedValue(schedule()),
        findScheduleMemberIds: jest.fn().mockResolvedValue(['emp_1']),
        searchAssignableEmployees: jest
          .fn()
          .mockResolvedValue({ items: [{ id: 'emp_1' }], total: 1 }),
        findShiftAssignments: jest.fn().mockResolvedValue([]),
        listHolidays: jest.fn().mockResolvedValue([]),
        expandDepartmentIds: jest.fn().mockResolvedValue([]),
      };
      const board = new PolicyAdminService(
        repository as never,
        {} as never,
        {} as never,
      ).getShiftBoard(
        'cmp_1',
        { from: '2026-08-01', to: '2026-08-31', page: 1, pageSize: 25, ...query } as never,
        null,
      );
      return { repository, board };
    };

    it('lọc lịch theo đúng bảng đang mở', async () => {
      const { repository, board } = repositoryFor({ scheduleId: 'sch_1' });
      await board;
      // Tham số cuối là `scheduleId` — đây chính là chốt giữ cho lưới trắng.
      expect(repository.findShiftAssignments).toHaveBeenCalledWith(
        'cmp_1',
        ['emp_1'],
        expect.any(Date),
        expect.any(Date),
        'sch_1',
      );
    });

    /** Màn xem lịch chung không gắn bảng nào thì vẫn phải thấy toàn bộ lịch. */
    it('không lọc khi xem ngoài phạm vi một bảng', async () => {
      const { repository, board } = repositoryFor({});
      await board;
      expect(repository.findShiftAssignments).toHaveBeenCalledWith(
        'cmp_1',
        ['emp_1'],
        expect.any(Date),
        expect.any(Date),
        undefined,
      );
    });
  });

  /**
   * `TransformInterceptor` nhận diện phản hồi phân trang bằng `instanceof`, nên
   * trả về một object CÙNG HÌNH DẠNG `{ items, meta }` là không đủ — cả cụm sẽ
   * chui vào `data` và phía Web nhận một object ở chỗ nó chờ một mảng, làm
   * trắng cả trang.
   *
   * Kiểm tra bằng `instanceof` chứ không so hình dạng: so hình dạng thì chính
   * cái bug này vẫn lọt qua.
   */
  it('danh sách trả về PaginatedResult, không phải object cùng hình dạng', async () => {
    const repository = {
      listShiftSchedules: jest.fn().mockResolvedValue({ items: [schedule()], total: 1 }),
    };
    const withRepo = new PolicyAdminService(repository as never, {} as never, {} as never);

    const result = await withRepo.listShiftSchedules(
      'cmp_1',
      { page: 1, pageSize: 20 } as never,
      null,
    );

    expect(result).toBeInstanceOf(PaginatedResult);
    expect(Array.isArray(result.items)).toBe(true);
    expect(result.meta.total).toBe(1);
  });
});
