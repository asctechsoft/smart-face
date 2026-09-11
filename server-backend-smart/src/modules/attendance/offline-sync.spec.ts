import { AttendanceDecision, AttendanceType, AuthMethod } from '@prisma/client';
import { PolicyKeys } from '../policy/policy.constants';
import { AttendanceService } from './attendance.service';
import type { RequestContext } from 'src/common/types/request-context';
import type { SyncOfflineDto } from './dto/attendance.dto';

/**
 * Đồng bộ chấm công offline (`FR-APP-STAT-06`).
 *
 * Trọng tâm của bộ test này KHÔNG phải "đường thành công chạy được", mà là các
 * chốt mà chế độ offline dễ bị dùng để lách:
 *
 *  - Tắt mặc định — bật rồi mới nhận.
 *  - Không tự lên bảng công, dù mọi thứ khác đều hợp lệ.
 *  - Vẫn phải đúng người: sai mặt là loại tại chỗ.
 *  - Giờ tương lai và bản ghi quá cũ đều bị chặn.
 *  - Kỳ đã chốt thì không nhét thêm được (BR-07).
 */
describe('Đồng bộ chấm công offline', () => {
  const NOW = new Date('2026-09-07T09:00:00.000Z');
  const WORK_DATE = new Date('2026-09-07T00:00:00.000Z');

  const ctx = { userId: 'usr_1', companyId: 'cmp_1', employeeId: 'emp_1' } as RequestContext;

  const employee = {
    id: 'emp_1',
    companyId: 'cmp_1',
    branchId: 'br_1',
    codeLocked: true,
  };

  const record = (over: Partial<Record<string, unknown>> = {}) => ({
    localId: 'local_1',
    type: AttendanceType.CHECK_IN,
    capturedAt: '2026-09-07T01:00:00.000Z',
    authMethod: AuthMethod.FACE,
    location: { latitude: 10.77, longitude: 106.7, accuracy: 12 },
    deviceContext: { deviceId: 'dev_1', model: 'Pixel', osVersion: '14', appVersion: '1.0.0' },
    imageBase64: Buffer.from('anh-gia-lap').toString('base64'),
    ...over,
  });

  const build = (
    over: {
      enabled?: boolean;
      maxAgeHours?: number;
      matchScore?: number;
      duplicate?: { id: string } | null;
      closedPeriod?: { name: string } | null;
      embeddings?: unknown[];
    } = {},
  ) => {
    const attendances = {
      findOfflineDuplicate: jest.fn().mockResolvedValue(over.duplicate ?? null),
      findClosedPeriodCovering: jest.fn().mockResolvedValue(over.closedPeriod ?? null),
      findActiveFaceEmbeddings: jest
        .fn()
        .mockResolvedValue(over.embeddings ?? [Buffer.alloc(2048)]),
      createLog: jest.fn().mockResolvedValue({ id: 'log_new' }),
      lockEmployeeCode: jest.fn().mockResolvedValue(undefined),
      findEmployeeForContext: jest.fn().mockResolvedValue(employee),
    };

    const policy = {
      getBoolean: jest.fn().mockImplementation(async (_company: string, key: string) => {
        if (key === PolicyKeys.OFFLINE_ENABLED) return over.enabled ?? true;
        return false;
      }),
      getNumber: jest.fn().mockImplementation(async (_company: string, key: string) => {
        if (key === PolicyKeys.OFFLINE_MAX_AGE_HOURS) return over.maxAgeHours ?? 48;
        if (key === PolicyKeys.FACE_MATCH_THRESHOLD) return 0.6;
        return 0;
      }),
      getTimezone: jest.fn().mockResolvedValue('Asia/Ho_Chi_Minh'),
      resolveShiftForDate: jest.fn().mockResolvedValue(null),
    };

    const ai = {
      verify: jest.fn().mockResolvedValue({
        face_found: true,
        match: { best_score: over.matchScore ?? 0.91, scores: [over.matchScore ?? 0.91] },
        liveness: { score: 0.7, action_verified: null },
        processing_ms: 40,
      }),
      toAppException: jest.fn(),
    };

    const fraud = { persistFlags: jest.fn().mockResolvedValue(undefined) };
    const storage = {
      buildAttendancePhotoKey: jest.fn().mockReturnValue('k'),
      upload: jest.fn().mockResolvedValue({ key: 'k', hash: 'h' }),
    };

    const service = new AttendanceService(
      attendances as never,
      {} as never, // Redis — không dùng trên đường này (không có nonce)
      {} as never, // ConfigService
      policy as never,
      ai as never,
      fraud as never,
      storage as never,
      {} as never, // RealtimeGateway
      {} as never, // hàng đợi payroll
    );

    // `requireActiveEmployee` và `resolveWorkDate` đọc nhiều thứ ngoài phạm vi
    // bài test này; thay bằng bản tối giản để bài test nói về đúng chế độ offline.
    jest.spyOn(service as never, 'requireActiveEmployee').mockResolvedValue(employee as never);
    jest.spyOn(service as never, 'resolveWorkDate').mockResolvedValue(WORK_DATE as never);

    jest.useFakeTimers().setSystemTime(NOW);

    return { service, attendances, policy, ai, fraud };
  };

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const sync = (service: AttendanceService, records: unknown[]) =>
    service.syncOffline(ctx, { records } as SyncOfflineDto);

  it('công ty chưa bật thì từ chối cả gói', async () => {
    const { service, attendances } = build({ enabled: false });

    await expect(sync(service, [record()])).rejects.toMatchObject({
      code: 'ATT_OFFLINE_DISABLED',
    });
    expect(attendances.createLog).not.toHaveBeenCalled();
  });

  it('bản ghi hợp lệ vẫn KHÔNG tự lên bảng công', async () => {
    const { service, attendances } = build();

    const result = await sync(service, [record()]);

    expect(result.accepted).toBe(1);
    const written = attendances.createLog.mock.calls[0][1];
    expect(written.isOffline).toBe(true);
    // Điểm mấu chốt: engine tính công chỉ đếm ACCEPTED và FLAGGED.
    expect(written.decision).toBe(AttendanceDecision.PENDING_REVIEW);
    // Giờ ghi nhận là giờ MÁY khai, không phải giờ đồng bộ.
    expect(written.recordedAt.toISOString()).toBe('2026-09-07T01:00:00.000Z');
  });

  it('để lại dấu vết nói rõ cái gì không kiểm được', async () => {
    const { service, fraud } = build();

    await sync(service, [record()]);

    const signals = fraud.persistFlags.mock.calls[0][0].signals;
    expect(signals[0].code).toBe('OFFLINE_RECORD');
    // Điểm 0: đây là ghi chú cho người duyệt, không phải cáo buộc gian lận.
    expect(signals[0].score).toBe(0);
  });

  it('sai người thì loại ngay, không đẩy rác sang người duyệt', async () => {
    const { service, attendances } = build({ matchScore: 0.2 });

    const result = await sync(service, [record()]);

    expect(result.rejected).toBe(1);
    expect(result.results[0].code).toBe('FACE_NOT_MATCHED');
    expect(attendances.createLog).not.toHaveBeenCalled();
  });

  it('KHÔNG kiểm hành động sống — không giả vờ đã kiểm thứ chưa kiểm', async () => {
    // `action_verified: null` sẽ chặn ở đường trực tuyến (AF-05). Ở đây thì
    // không, vì lúc mất mạng không có server nào bốc hành động để mà kiểm.
    const { service, ai } = build();

    const result = await sync(service, [record()]);

    expect(result.accepted).toBe(1);
    expect(ai.verify).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      requireLiveness: false,
    });
  });

  it('giờ ở tương lai là vặn đồng hồ, không phải mất mạng', async () => {
    const { service } = build();

    const result = await sync(service, [record({ capturedAt: '2026-09-07T23:00:00.000Z' })]);

    expect(result.results[0].code).toBe('FRAUD_CLOCK_SKEW');
  });

  it('bản ghi quá hạn đồng bộ bị từ chối', async () => {
    const { service } = build({ maxAgeHours: 6 });

    const result = await sync(service, [record({ capturedAt: '2026-09-05T01:00:00.000Z' })]);

    expect(result.results[0].code).toBe('ATT_OFFLINE_TOO_OLD');
  });

  it('kỳ đã chốt thì không nhét thêm được, kể cả dữ liệu thật (BR-07)', async () => {
    const { service } = build({ closedPeriod: { name: 'Tháng 09/2026' } });

    const result = await sync(service, [record()]);

    expect(result.results[0].code).toBe('ATT_PERIOD_LOCKED');
  });

  it('gửi lại cùng gói không nhân đôi công', async () => {
    const { service, attendances } = build({ duplicate: { id: 'log_cu' } });

    const result = await sync(service, [record()]);

    expect(result.duplicates).toBe(1);
    expect(result.results[0].attendanceLogId).toBe('log_cu');
    expect(attendances.createLog).not.toHaveBeenCalled();
  });

  it('một bản ghi hỏng không làm hỏng cả gói', async () => {
    // App xoá dữ liệu cục bộ theo từng `localId`, nên fail cả lô đồng nghĩa với
    // việc người dùng phải gửi lại mãi vì một bản ghi duy nhất bị lỗi.
    const { service } = build();

    const result = await sync(service, [
      record({ localId: 'ok_1' }),
      record({ localId: 'xau', capturedAt: 'khong-phai-ngay' }),
      record({ localId: 'ok_2', capturedAt: '2026-09-07T02:00:00.000Z' }),
    ]);

    expect(result.accepted).toBe(2);
    expect(result.rejected).toBe(1);
    expect(result.results.map((row) => row.localId)).toEqual(['ok_1', 'xau', 'ok_2']);
  });

  it('chấm bằng mặt mà không có ảnh thì không đối chiếu được → loại', async () => {
    const { service } = build();

    const result = await sync(service, [record({ imageBase64: undefined })]);

    expect(result.results[0].code).toBe('FACE_NOT_FOUND');
  });
});
