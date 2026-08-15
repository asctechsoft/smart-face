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
