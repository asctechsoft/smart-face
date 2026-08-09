import { Test } from '@nestjs/testing';
import { Job } from 'bullmq';
import { StorageService } from 'src/infra/storage/storage.service';
import { AuditService } from 'src/modules/audit/audit.service';
import { PolicyKeys } from 'src/modules/policy/policy.constants';
import { PolicyService } from 'src/modules/policy/policy.service';
import { JobsRepository } from '../jobs.repository';
import { JOBS } from '../queue.constants';
import { RetentionProcessor } from './retention.processor';

/**
 * Thực thi chính sách lưu trữ (NFR-LEGAL-04, NFR-SCALE-07).
 *
 * Job này XOÁ DỮ LIỆU THẬT và không hoàn tác được. Hai hướng sai đều nghiêm
 * trọng theo cách khác nhau:
 *
 *   Xoá thiếu → vi phạm Nghị định 13/2023, và dung lượng phình vô hạn.
 *   Xoá thừa → mất bằng chứng cho tranh chấp lao động, hoặc tệ hơn: xoá hồ sơ
 *              khuôn mặt đang dùng khiến nhân viên không chấm công được.
 *
 * Sau khi tách tầng Repository, các ràng buộc "chỉ lấy hồ sơ REVOKED/REPLACED",
 * "lọc theo `revokedAt` chứ không theo tuổi hồ sơ" nằm trong `JobsRepository`.
 * Bộ test này canh giữ phần thuộc về processor: mốc thời gian dựng từ chính sách
 * của TỪNG công ty, thứ tự xoá kho trước — DB sau, và dấu vết audit.
 */
describe('RetentionProcessor', () => {
  let processor: RetentionProcessor;

  const jobs = {
    acrossTenantsFindAllCompanyIds: jest.fn(),
    findExpiredAttendancePhotos: jest.fn(),
    findPurgeableFaceProfiles: jest.fn(),
    clearFaceProfilePhotoKeys: jest.fn(),
    findExpiredExportFiles: jest.fn(),
    clearExportFileKeys: jest.fn(),
  };
  const storage = { deleteMany: jest.fn() };
  const audit = { recordSystem: jest.fn() };
  const policy = { getNumber: jest.fn() };

  const runJob = (name: string) => processor.process({ name } as Job);

  /** Số ngày suy ngược từ mốc cutoff mà processor truyền xuống repository. */
  const cutoffAgeDays = (cutoff: Date) => (Date.now() - cutoff.getTime()) / 86_400_000;

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        RetentionProcessor,
        { provide: JobsRepository, useValue: jobs },
        { provide: StorageService, useValue: storage },
        { provide: AuditService, useValue: audit },
        { provide: PolicyService, useValue: policy },
      ],
    }).compile();

    processor = moduleRef.get(RetentionProcessor);

    jobs.acrossTenantsFindAllCompanyIds.mockResolvedValue(['cmp_1']);
    jobs.findExpiredAttendancePhotos.mockResolvedValue([]);
    jobs.findPurgeableFaceProfiles.mockResolvedValue([]);
    jobs.findExpiredExportFiles.mockResolvedValue([]);
    jobs.clearFaceProfilePhotoKeys.mockResolvedValue(0);
    jobs.clearExportFileKeys.mockResolvedValue(0);
    storage.deleteMany.mockResolvedValue(undefined);
    policy.getNumber.mockResolvedValue(90);
  });

  // ===========================================================================
  //  Ảnh chấm công
  // ===========================================================================

  describe('xoá ảnh chấm công quá hạn', () => {
    it('xoá đúng những khoá lấy được', async () => {
      jobs.findExpiredAttendancePhotos.mockResolvedValueOnce([
        { id: 'log_1', key: 'attendance/cmp_1/a.jpg' },
        { id: 'log_2', key: 'attendance/cmp_1/b.jpg' },
      ]);

      const result = await runJob(JOBS.PURGE_ATTENDANCE_PHOTOS);

      expect(storage.deleteMany).toHaveBeenCalledWith([
        'attendance/cmp_1/a.jpg',
        'attendance/cmp_1/b.jpg',
      ]);
      expect(result).toMatchObject({ deleted: 2 });
    });

    it('KHÔNG có đường nào ghi vào attendance_log', async () => {
      // BR-06: bảng này bất biến, có rule DO INSTEAD NOTHING ở tầng DB. Cố sửa
      // thì không lỗi mà cũng không có tác dụng — im lặng sai còn tệ hơn lỗi.
      // Repository chỉ phơi ra phương thức ĐỌC, nên processor không thể ghi.
      expect(jobs).not.toHaveProperty('updateAttendanceLog');
      expect(jobs).not.toHaveProperty('clearAttendancePhotoKeys');
    });

    it('lọc theo mốc thời gian dựng từ chính sách của công ty', async () => {
      policy.getNumber.mockResolvedValue(30);

      await runJob(JOBS.PURGE_ATTENDANCE_PHOTOS);

      const [companyId, cutoff] = jobs.findExpiredAttendancePhotos.mock.calls[0];
      expect(companyId).toBe('cmp_1');
      expect(cutoffAgeDays(cutoff)).toBeCloseTo(30, 1);
    });

    it('chính sách <= 0 nghĩa là GIỮ VĨNH VIỄN, không phải xoá tất cả', async () => {
      // Hiểu nhầm ở đây là mất sạch ảnh bằng chứng của cả công ty.
      policy.getNumber.mockResolvedValue(0);

      await runJob(JOBS.PURGE_ATTENDANCE_PHOTOS);

      expect(jobs.findExpiredAttendancePhotos).not.toHaveBeenCalled();
      expect(storage.deleteMany).not.toHaveBeenCalled();
    });

    it('mỗi công ty áp chính sách riêng', async () => {
      jobs.acrossTenantsFindAllCompanyIds.mockResolvedValue(['cmp_1', 'cmp_2']);
      policy.getNumber.mockImplementation((companyId: string) =>
        Promise.resolve(companyId === 'cmp_1' ? 30 : 365),
      );

      await runJob(JOBS.PURGE_ATTENDANCE_PHOTOS);

      const cutoffs = jobs.findExpiredAttendancePhotos.mock.calls.map(([, cutoff]) =>
        cutoffAgeDays(cutoff),
      );
      expect(cutoffs[0]).toBeCloseTo(30, 1);
      expect(cutoffs[1]).toBeCloseTo(365, 1);
    });

    it('duyệt theo con trỏ id, không dùng skip', async () => {
      // Mỗi lô xoá xong sẽ làm lệch offset của lô sau, nên `skip` sẽ bỏ sót.
      const batch = Array.from({ length: 500 }, (_, index) => ({
        id: `log_${index}`,
        key: `attendance/cmp_1/${index}.jpg`,
      }));
      jobs.findExpiredAttendancePhotos
        .mockResolvedValueOnce(batch)
        .mockResolvedValueOnce([{ id: 'log_500', key: 'attendance/cmp_1/500.jpg' }]);

      const result = await runJob(JOBS.PURGE_ATTENDANCE_PHOTOS);

      const [, , take, cursor] = jobs.findExpiredAttendancePhotos.mock.calls[1];
      expect(take).toBe(500);
      expect(cursor).toBe('log_499');
      expect(result).toMatchObject({ deleted: 501 });
    });

    it('không gọi kho lưu trữ khi không có gì để xoá', async () => {
      await runJob(JOBS.PURGE_ATTENDANCE_PHOTOS);

      expect(storage.deleteMany).not.toHaveBeenCalled();
      expect(audit.recordSystem).not.toHaveBeenCalled();
    });

    it('ghi audit để giải trình việc xoá là tự động', async () => {
      // NFR-LEGAL-04 yêu cầu chính sách xoá được "thực thi tự động". Không có
      // dấu vết thì không chứng minh được điều đó với thanh tra.
      jobs.findExpiredAttendancePhotos.mockResolvedValueOnce([
        { id: 'log_1', key: 'attendance/cmp_1/a.jpg' },
      ]);

      await runJob(JOBS.PURGE_ATTENDANCE_PHOTOS);

      expect(audit.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: 'cmp_1',
          action: 'RETENTION_PURGE',
          targetType: 'ATTENDANCE_PHOTO',
          after: expect.objectContaining({ deletedCount: 1, retentionDays: 90 }),
        }),
      );
    });
  });

  // ===========================================================================
  //  Ảnh hồ sơ khuôn mặt
  // ===========================================================================

  describe('xoá ảnh hồ sơ khuôn mặt đã thu hồi', () => {
    it('dùng chính sách thời gian CHỜ sau thu hồi, không dùng chính sách ảnh chấm công', async () => {
      // Thời gian chờ để còn kịp điều tra nếu việc thu hồi là do bị chiếm thiết bị.
      policy.getNumber.mockResolvedValue(90);

      await runJob(JOBS.PURGE_REVOKED_FACE_PROFILES);

      expect(policy.getNumber).toHaveBeenCalledWith(
        'cmp_1',
        PolicyKeys.BIOMETRIC_DELETE_DELAY_DAYS,
      );
      const [companyId, cutoff] = jobs.findPurgeableFaceProfiles.mock.calls[0];
      expect(companyId).toBe('cmp_1');
      expect(cutoffAgeDays(cutoff)).toBeCloseTo(90, 1);
    });

    it('xoá kho TRƯỚC rồi mới cập nhật DB', async () => {
      // Ngược lại thì mất khoá là mất luôn khả năng dọn, để lại tệp mồ côi
      // vĩnh viễn không ai tìm ra.
      const order: string[] = [];
      storage.deleteMany.mockImplementation(() => {
        order.push('storage');
        return Promise.resolve();
      });
      jobs.clearFaceProfilePhotoKeys.mockImplementation(() => {
        order.push('db');
        return Promise.resolve(1);
      });
      jobs.findPurgeableFaceProfiles.mockResolvedValueOnce([
        { id: 'fp_1', key: 'face-profile/cmp_1/front.jpg' },
      ]);

      await runJob(JOBS.PURGE_REVOKED_FACE_PROFILES);

      expect(order).toEqual(['storage', 'db']);
    });

    it('null hoá photoKey để lần sau không quét lại', async () => {
      jobs.findPurgeableFaceProfiles.mockResolvedValueOnce([
        { id: 'fp_1', key: 'face-profile/cmp_1/front.jpg' },
      ]);

      await runJob(JOBS.PURGE_REVOKED_FACE_PROFILES);

      expect(jobs.clearFaceProfilePhotoKeys).toHaveBeenCalledWith(['fp_1']);
    });
  });

  // ===========================================================================
  //  File xuất báo cáo
  // ===========================================================================

  describe('xoá file xuất quá hạn', () => {
    it('dùng chính sách riêng cho file xuất, không dùng chính sách ảnh', async () => {
      await runJob(JOBS.PURGE_EXPIRED_EXPORTS);

      expect(policy.getNumber).toHaveBeenCalledWith('cmp_1', PolicyKeys.EXPORT_FILE_RETENTION_DAYS);
    });

    it('xoá và null hoá fileKey', async () => {
      policy.getNumber.mockResolvedValue(7);
      jobs.findExpiredExportFiles.mockResolvedValueOnce([
        { id: 'exp_1', key: 'exports/cmp_1/exp_1/bao-cao.xlsx' },
      ]);

      const result = await runJob(JOBS.PURGE_EXPIRED_EXPORTS);

      expect(storage.deleteMany).toHaveBeenCalledWith(['exports/cmp_1/exp_1/bao-cao.xlsx']);
      expect(jobs.clearExportFileKeys).toHaveBeenCalledWith(['exp_1']);
      expect(result).toMatchObject({ deleted: 1 });
    });
  });

  // ===========================================================================
  //  Chung
  // ===========================================================================

  it('job lạ thì bỏ qua, không ném lỗi', async () => {
    // BullMQ có thể còn job cũ trong hàng đợi sau khi đổi tên. Ném lỗi ở đây
    // sẽ làm job retry mãi và ngập log.
    await expect(runJob('job-khong-ton-tai')).resolves.toEqual({ skipped: true });
  });

  it('quét MỌI công ty chưa xoá, kể cả công ty đã ngừng dịch vụ', async () => {
    // Nghĩa vụ xoá dữ liệu cá nhân đúng hạn không mất đi khi công ty ngừng
    // thanh toán (NFR-LEGAL-04).
    await runJob(JOBS.PURGE_ATTENDANCE_PHOTOS);

    expect(jobs.acrossTenantsFindAllCompanyIds).toHaveBeenCalled();
  });
});
