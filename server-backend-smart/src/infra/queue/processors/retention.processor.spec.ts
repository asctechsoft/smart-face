import { Test } from '@nestjs/testing';
import { FaceProfileStatus } from '@prisma/client';
import { Job } from 'bullmq';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { StorageService } from 'src/infra/storage/storage.service';
import { AuditService } from 'src/modules/audit/audit.service';
import { PolicyKeys } from 'src/modules/policy/policy.constants';
import { PolicyService } from 'src/modules/policy/policy.service';
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
 */
describe('RetentionProcessor', () => {
  let processor: RetentionProcessor;

  const prisma = {
    company: { findMany: jest.fn() },
    attendanceLog: { findMany: jest.fn() },
    faceProfile: { findMany: jest.fn(), updateMany: jest.fn() },
    exportJob: { findMany: jest.fn(), updateMany: jest.fn() },
  };
  const storage = { deleteMany: jest.fn() };
  const audit = { recordSystem: jest.fn() };
  const policy = { getNumber: jest.fn() };

  const runJob = (name: string) => processor.process({ name } as Job);

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        RetentionProcessor,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
        { provide: AuditService, useValue: audit },
        { provide: PolicyService, useValue: policy },
      ],
    }).compile();

    processor = moduleRef.get(RetentionProcessor);

    prisma.company.findMany.mockResolvedValue([{ id: 'cmp_1' }]);
    prisma.attendanceLog.findMany.mockResolvedValue([]);
    prisma.faceProfile.findMany.mockResolvedValue([]);
    prisma.exportJob.findMany.mockResolvedValue([]);
    prisma.faceProfile.updateMany.mockResolvedValue({ count: 0 });
    prisma.exportJob.updateMany.mockResolvedValue({ count: 0 });
    policy.getNumber.mockResolvedValue(90);
  });

  // ===========================================================================
  //  Ảnh chấm công
  // ===========================================================================

  describe('xoá ảnh chấm công quá hạn', () => {
    it('xoá đúng những khoá lấy được', async () => {
      prisma.attendanceLog.findMany.mockResolvedValueOnce([
        { id: 'log_1', photoKey: 'attendance/cmp_1/a.jpg' },
        { id: 'log_2', photoKey: 'attendance/cmp_1/b.jpg' },
      ]);

      const result = await runJob(JOBS.PURGE_ATTENDANCE_PHOTOS);

      expect(storage.deleteMany).toHaveBeenCalledWith([
        'attendance/cmp_1/a.jpg',
        'attendance/cmp_1/b.jpg',
      ]);
      expect(result).toMatchObject({ deleted: 2 });
    });

    it('KHÔNG đụng tới bảng attendance_log', async () => {
      // BR-06: bảng này bất biến, có rule DO INSTEAD NOTHING ở tầng DB. Cố sửa
      // thì không lỗi mà cũng không có tác dụng — im lặng sai còn tệ hơn lỗi.
      prisma.attendanceLog.findMany.mockResolvedValueOnce([
        { id: 'log_1', photoKey: 'attendance/cmp_1/a.jpg' },
      ]);

      await runJob(JOBS.PURGE_ATTENDANCE_PHOTOS);

      expect(prisma.attendanceLog).not.toHaveProperty('updateMany.mock.calls.length', 1);
      expect(Object.keys(prisma.attendanceLog)).toEqual(['findMany']);
    });

    it('lọc theo mốc thời gian dựng từ chính sách của công ty', async () => {
      policy.getNumber.mockResolvedValue(30);
      prisma.attendanceLog.findMany.mockResolvedValueOnce([]);

      await runJob(JOBS.PURGE_ATTENDANCE_PHOTOS);

      const where = prisma.attendanceLog.findMany.mock.calls[0][0].where;
      const cutoff = where.recordedAt.lt as Date;
      const ageDays = (Date.now() - cutoff.getTime()) / 86_400_000;

      expect(ageDays).toBeCloseTo(30, 1);
      expect(where.photoKey).toEqual({ not: null });
      expect(where.companyId).toBe('cmp_1');
    });

    it('chính sách <= 0 nghĩa là GIỮ VĨNH VIỄN, không phải xoá tất cả', async () => {
      // Hiểu nhầm ở đây là mất sạch ảnh bằng chứng của cả công ty.
      policy.getNumber.mockResolvedValue(0);

      await runJob(JOBS.PURGE_ATTENDANCE_PHOTOS);

      expect(prisma.attendanceLog.findMany).not.toHaveBeenCalled();
      expect(storage.deleteMany).not.toHaveBeenCalled();
    });

    it('mỗi công ty áp chính sách riêng', async () => {
      prisma.company.findMany.mockResolvedValue([{ id: 'cmp_1' }, { id: 'cmp_2' }]);
      policy.getNumber.mockImplementation((companyId: string) =>
        Promise.resolve(companyId === 'cmp_1' ? 30 : 365),
      );
      prisma.attendanceLog.findMany.mockResolvedValue([]);

      await runJob(JOBS.PURGE_ATTENDANCE_PHOTOS);

      const cutoffs = prisma.attendanceLog.findMany.mock.calls.map(
        (call) => (Date.now() - (call[0].where.recordedAt.lt as Date).getTime()) / 86_400_000,
      );
      expect(cutoffs[0]).toBeCloseTo(30, 1);
      expect(cutoffs[1]).toBeCloseTo(365, 1);
    });

    it('duyệt theo con trỏ id, không dùng skip', async () => {
      // Mỗi lô xoá xong sẽ làm lệch offset của lô sau, nên `skip` sẽ bỏ sót.
      const batch = Array.from({ length: 500 }, (_, index) => ({
        id: `log_${index}`,
        photoKey: `attendance/cmp_1/${index}.jpg`,
      }));
      prisma.attendanceLog.findMany
        .mockResolvedValueOnce(batch)
        .mockResolvedValueOnce([{ id: 'log_500', photoKey: 'attendance/cmp_1/500.jpg' }]);

      const result = await runJob(JOBS.PURGE_ATTENDANCE_PHOTOS);

      const secondCall = prisma.attendanceLog.findMany.mock.calls[1][0];
      expect(secondCall.where.id).toEqual({ gt: 'log_499' });
      expect(secondCall.orderBy).toEqual({ id: 'asc' });
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
      prisma.attendanceLog.findMany.mockResolvedValueOnce([
        { id: 'log_1', photoKey: 'attendance/cmp_1/a.jpg' },
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
    it('CHỈ lấy hồ sơ REVOKED hoặc REPLACED', async () => {
      // Hồ sơ ACTIVE là thứ dùng để so khớp mỗi ngày. Xoá nhầm thì nhân viên
      // không chấm công được nữa, bất kể đăng ký từ bao lâu.
      await runJob(JOBS.PURGE_REVOKED_FACE_PROFILES);

      const where = prisma.faceProfile.findMany.mock.calls[0][0].where;
      expect(where.status).toEqual({
        in: [FaceProfileStatus.REVOKED, FaceProfileStatus.REPLACED],
      });
      expect(where.status.in).not.toContain(FaceProfileStatus.ACTIVE);
    });

    it('lọc theo thời gian CHỜ sau khi thu hồi, không theo tuổi hồ sơ', async () => {
      // Thời gian chờ để còn kịp điều tra nếu việc thu hồi là do bị chiếm thiết bị.
      policy.getNumber.mockResolvedValue(90);

      await runJob(JOBS.PURGE_REVOKED_FACE_PROFILES);

      const where = prisma.faceProfile.findMany.mock.calls[0][0].where;
      expect(where.revokedAt).toBeDefined();
      expect(where).not.toHaveProperty('enrolledAt');
      expect(policy.getNumber).toHaveBeenCalledWith(
        'cmp_1',
        PolicyKeys.BIOMETRIC_DELETE_DELAY_DAYS,
      );
    });

    it('xoá kho TRƯỚC rồi mới cập nhật DB', async () => {
      // Ngược lại thì mất khoá là mất luôn khả năng dọn, để lại tệp mồ côi
      // vĩnh viễn không ai tìm ra.
      const order: string[] = [];
      storage.deleteMany.mockImplementation(() => {
        order.push('storage');
        return Promise.resolve();
      });
      prisma.faceProfile.updateMany.mockImplementation(() => {
        order.push('db');
        return Promise.resolve({ count: 1 });
      });
      prisma.faceProfile.findMany.mockResolvedValueOnce([
        { id: 'fp_1', photoKey: 'face-profile/cmp_1/front.jpg' },
      ]);

      await runJob(JOBS.PURGE_REVOKED_FACE_PROFILES);

      expect(order).toEqual(['storage', 'db']);
    });

    it('null hoá photoKey để lần sau không quét lại', async () => {
      prisma.faceProfile.findMany.mockResolvedValueOnce([
        { id: 'fp_1', photoKey: 'face-profile/cmp_1/front.jpg' },
      ]);

      await runJob(JOBS.PURGE_REVOKED_FACE_PROFILES);

      expect(prisma.faceProfile.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['fp_1'] } },
        data: { photoKey: null },
      });
    });
  });

  // ===========================================================================
  //  File xuất báo cáo
  // ===========================================================================

  describe('xoá file xuất quá hạn', () => {
    it('dùng chính sách riêng cho file xuất, không dùng chính sách ảnh', async () => {
      await runJob(JOBS.PURGE_EXPIRED_EXPORTS);

      expect(policy.getNumber).toHaveBeenCalledWith(
        'cmp_1',
        PolicyKeys.EXPORT_FILE_RETENTION_DAYS,
      );
    });

    it('xoá và null hoá fileKey', async () => {
      policy.getNumber.mockResolvedValue(7);
      prisma.exportJob.findMany.mockResolvedValueOnce([
        { id: 'exp_1', fileKey: 'exports/cmp_1/exp_1/bao-cao.xlsx' },
      ]);

      const result = await runJob(JOBS.PURGE_EXPIRED_EXPORTS);

      expect(storage.deleteMany).toHaveBeenCalledWith([
        'exports/cmp_1/exp_1/bao-cao.xlsx',
      ]);
      expect(prisma.exportJob.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['exp_1'] } },
        data: { fileKey: null },
      });
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

  it('chỉ duyệt công ty chưa bị xoá mềm', async () => {
    await runJob(JOBS.PURGE_ATTENDANCE_PHOTOS);

    expect(prisma.company.findMany).toHaveBeenCalledWith({
      where: { deletedAt: null },
      select: { id: true },
    });
  });
});
