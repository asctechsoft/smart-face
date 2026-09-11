import { AttendanceDecision } from '@prisma/client';
import { AppException } from 'src/common/errors';
import { AttendanceAdminService } from './attendance-admin.service';
import type { TenantContext } from 'src/common/types/request-context';

/**
 * Đường thoát của `PENDING_REVIEW`.
 *
 * Đây là một lỗ có thật trước v2.1: hai chỗ gán `PENDING_REVIEW` (chính sách
 * chấm ngoài vùng và điểm rủi ro vượt ngưỡng) nhưng KHÔNG có chỗ nào gỡ ra, còn
 * engine tính công chỉ đếm `ACCEPTED` và `FLAGGED`. Hệ quả: nhân viên có chấm
 * công, hệ thống có bản ghi, bảng công trống, và không ai nhìn thấy những lượt
 * đó ở đâu để xử lý.
 */
describe('Soát lượt chấm công chờ duyệt', () => {
  const WORK_DATE = new Date('2026-09-03T00:00:00.000Z');

  const ctx = {
    companyId: 'cmp_1',
    userId: 'usr_hr',
    employeeId: 'emp_hr',
    roles: [],
    isSystemAdmin: false,
    scopeDepartmentIds: [],
    deviceId: null,
    mustChangePassword: false,
    jti: 'jti',
    traceId: 'trace',
    correlationId: 'corr',
  } as unknown as TenantContext;

  const buildLog = (over: Partial<Record<string, unknown>> = {}) => ({
    id: 'log_1',
    employeeId: 'emp_9',
    workDate: WORK_DATE,
    decision: AttendanceDecision.PENDING_REVIEW,
    ...over,
  });

  const build = (
    over: {
      log?: unknown;
      closedPeriod?: unknown;
      resolveCount?: number;
    } = {},
  ) => {
    const attendances = {
      // `??` không dùng được ở đây: `log: null` là một tình huống cần kiểm tra,
      // còn `??` sẽ coi nó như "không truyền" và thay bằng bản ghi mặc định.
      findLogDetail: jest.fn().mockResolvedValue('log' in over ? over.log : buildLog()),
      findClosedPeriodCovering: jest.fn().mockResolvedValue(over.closedPeriod ?? null),
      resolvePendingReview: jest.fn().mockResolvedValue(over.resolveCount ?? 1),
      findEmployeesInScope: jest.fn().mockResolvedValue([{ id: 'emp_9' }]),
      listPendingReview: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
    const attendance = { enqueueRecalculate: jest.fn().mockResolvedValue(undefined) };

    const service = new AttendanceAdminService(
      attendances as never,
      {} as never, // StorageService — không dùng trên đường này
      audit as never,
      notifications as never,
      attendance as never,
      {} as never, // hàng đợi export
    );

    return { service, attendances, audit, notifications, attendance };
  };

  it('chấp nhận thì chuyển ACCEPTED và tính lại công ngày đó', async () => {
    const { service, attendances, attendance } = build();

    const result = await service.reviewPendingLog(
      ctx,
      'log_1',
      'ACCEPT',
      'Đã xác minh đi công trường',
    );

    expect(result.decision).toBe(AttendanceDecision.ACCEPTED);
    expect(attendances.resolvePendingReview).toHaveBeenCalledWith(
      'cmp_1',
      'log_1',
      AttendanceDecision.ACCEPTED,
    );
    // Không tính lại thì lượt đã duyệt vẫn không lên bảng công, và người duyệt
    // tưởng mình đã xong việc.
    expect(attendance.enqueueRecalculate).toHaveBeenCalledWith('cmp_1', 'emp_9', WORK_DATE);
  });

  it('bác thì chuyển REJECTED', async () => {
    const { service, attendances } = build();

    await service.reviewPendingLog(ctx, 'log_1', 'REJECT', 'Ảnh không khớp người trong hồ sơ');

    expect(attendances.resolvePendingReview).toHaveBeenCalledWith(
      'cmp_1',
      'log_1',
      AttendanceDecision.REJECTED,
    );
  });

  it('ghi audit kèm lý do ở CẢ HAI chiều', async () => {
    for (const decision of ['ACCEPT', 'REJECT'] as const) {
      const { service, audit } = build();
      await service.reviewPendingLog(ctx, 'log_1', decision, 'Lý do đầy đủ mười ký tự');
      expect(audit.record).toHaveBeenCalledWith(
        ctx,
        expect.objectContaining({ action: 'ATTENDANCE_REVIEW', reason: 'Lý do đầy đủ mười ký tự' }),
      );
    }
  });

  it('báo cho nhân viên biết — không quyết định âm thầm về công của họ', async () => {
    const { service, notifications } = build();

    await service.reviewPendingLog(ctx, 'log_1', 'REJECT', 'Không xác minh được vị trí');

    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ employeeId: 'emp_9', type: 'ATTENDANCE_VOIDED' }),
    );
  });

  it('kỳ đã chốt thì không soát được nữa (BR-07)', async () => {
    const { service, attendances } = build({ closedPeriod: { name: 'Tháng 08/2026' } });

    await expect(
      service.reviewPendingLog(ctx, 'log_1', 'ACCEPT', 'Lý do đầy đủ mười ký tự'),
    ).rejects.toMatchObject({ code: 'ATT_PERIOD_LOCKED' });
    expect(attendances.resolvePendingReview).not.toHaveBeenCalled();
  });

  it('lượt không ở trạng thái chờ soát thì từ chối', async () => {
    const { service } = build({ log: buildLog({ decision: AttendanceDecision.ACCEPTED }) });

    await expect(
      service.reviewPendingLog(ctx, 'log_1', 'ACCEPT', 'Lý do đầy đủ mười ký tự'),
    ).rejects.toBeInstanceOf(AppException);
  });

  it('hai người cùng bấm duyệt — người sau bị chặn thay vì ghi đè', async () => {
    // `resolvePendingReview` trả 0 nghĩa là điều kiện `PENDING_REVIEW` trong
    // WHERE đã không còn đúng: có người xử lý trước rồi.
    const { service, attendance } = build({ resolveCount: 0 });

    await expect(
      service.reviewPendingLog(ctx, 'log_1', 'ACCEPT', 'Lý do đầy đủ mười ký tự'),
    ).rejects.toBeInstanceOf(AppException);
    expect(attendance.enqueueRecalculate).not.toHaveBeenCalled();
  });

  it('không tìm thấy lượt → ATT_NOT_FOUND', async () => {
    const { service } = build({ log: null });

    await expect(
      service.reviewPendingLog(ctx, 'log_1', 'ACCEPT', 'Lý do đầy đủ mười ký tự'),
    ).rejects.toMatchObject({ code: 'ATT_NOT_FOUND' });
  });

  it('MANAGER chỉ thấy hàng đợi của phòng ban mình quản lý', async () => {
    const { service, attendances } = build();

    await service.listPendingReview('cmp_1', {}, ['dept_ky_thuat']);

    expect(attendances.findEmployeesInScope).toHaveBeenCalledWith('cmp_1', {
      departmentScope: ['dept_ky_thuat'],
    });
    expect(attendances.listPendingReview).toHaveBeenCalledWith(
      'cmp_1',
      expect.objectContaining({ employeeIds: ['emp_9'] }),
    );
  });

  it('không có giới hạn phòng ban thì không lọc theo nhân viên', async () => {
    const { service, attendances } = build();

    await service.listPendingReview('cmp_1', {}, null);

    expect(attendances.findEmployeesInScope).not.toHaveBeenCalled();
    expect(attendances.listPendingReview).toHaveBeenCalledWith(
      'cmp_1',
      expect.objectContaining({ employeeIds: null }),
    );
  });
});
