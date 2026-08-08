import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { FaceProfileStatus } from '@prisma/client';
import { Job } from 'bullmq';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { StorageService } from 'src/infra/storage/storage.service';
import { AuditService } from 'src/modules/audit/audit.service';
import { PolicyKeys } from 'src/modules/policy/policy.constants';
import { PolicyService } from 'src/modules/policy/policy.service';
import { JOBS, QUEUES } from '../queue.constants';

/** Số bản ghi lấy mỗi lượt. Đủ lớn để chạy nhanh, đủ nhỏ để không ngốn RAM. */
const BATCH_SIZE = 500;

/**
 * Thực thi tự động chính sách lưu trữ (`NFR-LEGAL-04`, `NFR-SCALE-07`).
 *
 * ## Vì sao phải có job này
 *
 * Nghị định 13/2023 yêu cầu chính sách xoá dữ liệu cá nhân được **thực thi tự
 * động**, không phải làm tay khi ai đó nhớ ra. `docs/09` cũng ghi
 * `NFR-SCALE-07` "ảnh có lifecycle tự xoá" ở mức Must, và ước tính nếu không
 * xoá thì riêng ảnh chấm công đã ~540 GB.
 *
 * ## Nguyên tắc: giữ BẢN GHI, chỉ xoá ẢNH
 *
 * `NFR-LEGAL-08` yêu cầu lưu chứng từ chấm công phục vụ thanh tra lao động;
 * `NFR-LEGAL-04` yêu cầu xoá dữ liệu sinh trắc học đúng hạn. Hai điều này chỉ
 * mâu thuẫn nếu coi ảnh và bản ghi là một.
 *
 *   Bản ghi `AttendanceLog` (giờ, vị trí, quyết định, điểm gian lận)
 *     → giữ VĨNH VIỄN, đó là chứng từ
 *   Ảnh khuôn mặt
 *     → dữ liệu sinh trắc học, xoá sau thời hạn lưu
 *
 * ## Vì sao KHÔNG null hoá `photoKey` sau khi xoá
 *
 * `attendance_log` có rule `DO INSTEAD NOTHING` cho mọi UPDATE (`BR-06`), nên
 * về mặt kỹ thuật là không sửa được. Nhưng kể cả sửa được cũng không nên:
 * `photoHash` vẫn cần cho việc đối chiếu tranh chấp, và `photoKey` là dấu vết
 * lịch sử cho biết từng có ảnh.
 *
 * Việc chặn phục vụ ảnh quá hạn nằm ở tầng đọc — `AttendanceService` so tuổi
 * bản ghi trước khi sinh presigned URL. Xem `isPhotoWithinRetention`.
 *
 * ## Đây là lớp thứ nhất trong hai lớp
 *
 * Job này xoá **chính xác theo chính sách từng công ty**. Lớp thứ hai là
 * lifecycle rule đặt thẳng trên bucket với trần cứng dài hơn — để job hỏng vài
 * tháng mà không ai biết thì vẫn có thứ dọn. Xem `docs/r2-lifecycle.md`.
 */
@Processor(QUEUES.RETENTION)
export class RetentionProcessor extends WorkerHost {
  private readonly logger = new Logger(RetentionProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case JOBS.PURGE_ATTENDANCE_PHOTOS:
        return this.purgeAttendancePhotos();
      case JOBS.PURGE_REVOKED_FACE_PROFILES:
        return this.purgeRevokedFaceProfiles();
      case JOBS.PURGE_EXPIRED_EXPORTS:
        return this.purgeExpiredExports();
      default:
        this.logger.warn(`Job không nhận ra: ${job.name}`);
        return { skipped: true };
    }
  }

  // ===========================================================================
  //  Ảnh chấm công
  // ===========================================================================

  /**
   * Xoá ảnh bằng chứng quá hạn lưu.
   *
   * KHÔNG đụng tới bảng `attendance_log` — chỉ xoá đối tượng khỏi kho lưu trữ.
   */
  private async purgeAttendancePhotos() {
    const companies = await this.activeCompanies();
    let totalDeleted = 0;

    for (const company of companies) {
      const retentionDays = await this.policy.getNumber(
        company.id,
        PolicyKeys.BIOMETRIC_PHOTO_RETENTION_DAYS,
      );

      // Chính sách <= 0 nghĩa là "giữ vĩnh viễn". Không tự suy diễn thành
      // "xoá tất cả" — hiểu nhầm ở đây là mất sạch bằng chứng của cả công ty.
      if (retentionDays <= 0) {
        this.logger.log(`Công ty ${company.id}: giữ ảnh vĩnh viễn, bỏ qua`);
        continue;
      }

      const cutoff = daysAgo(retentionDays);
      let deletedForCompany = 0;
      let cursor: string | undefined;

      // Duyệt theo lô bằng con trỏ id. Không dùng `skip` vì mỗi lô xoá xong sẽ
      // làm lệch offset của lô sau.
      for (;;) {
        const logs = await this.prisma.attendanceLog.findMany({
          where: {
            companyId: company.id,
            recordedAt: { lt: cutoff },
            photoKey: { not: null },
            ...(cursor ? { id: { gt: cursor } } : {}),
          },
          select: { id: true, photoKey: true },
          orderBy: { id: 'asc' },
          take: BATCH_SIZE,
        });

        if (logs.length === 0) break;

        const keys = logs
          .map((log) => log.photoKey)
          .filter((key): key is string => key !== null);

        // `deleteMany` đã tự chia lô 1000 khoá theo giới hạn của giao thức S3.
        await this.storage.deleteMany(keys);

        deletedForCompany += keys.length;
        cursor = logs[logs.length - 1].id;

        if (logs.length < BATCH_SIZE) break;
      }

      if (deletedForCompany > 0) {
        totalDeleted += deletedForCompany;
        await this.recordPurge(company.id, 'ATTENDANCE_PHOTO', deletedForCompany, {
          retentionDays,
          cutoff: cutoff.toISOString(),
        });
      }
    }

    this.logger.log(`Xoá ${totalDeleted} ảnh chấm công quá hạn`);
    return { deleted: totalDeleted, companyCount: companies.length };
  }

  // ===========================================================================
  //  Ảnh hồ sơ khuôn mặt
  // ===========================================================================

  /**
   * Xoá ảnh hồ sơ khuôn mặt đã bị thu hồi hoặc thay thế quá lâu.
   *
   * ⚠ KHÔNG xoá theo tuổi như ảnh chấm công. Hồ sơ `ACTIVE` là thứ dùng để so
   * khớp mỗi ngày — xoá nó đi thì nhân viên không chấm công được nữa, bất kể
   * đăng ký từ bao lâu.
   *
   * Chỉ những hồ sơ đã ở trạng thái `REVOKED`/`REPLACED` mới bị dọn, và còn
   * phải qua thời gian chờ (`BIOMETRIC_DELETE_DELAY_DAYS`) để còn kịp điều tra
   * nếu việc thu hồi là do bị chiếm thiết bị.
   */
  private async purgeRevokedFaceProfiles() {
    const companies = await this.activeCompanies();
    let totalDeleted = 0;

    for (const company of companies) {
      const delayDays = await this.policy.getNumber(
        company.id,
        PolicyKeys.BIOMETRIC_DELETE_DELAY_DAYS,
      );
      if (delayDays < 0) continue;

      const cutoff = daysAgo(delayDays);

      const profiles = await this.prisma.faceProfile.findMany({
        where: {
          companyId: company.id,
          // Chỉ hồ sơ KHÔNG còn hoạt động.
          status: { in: [FaceProfileStatus.REVOKED, FaceProfileStatus.REPLACED] },
          revokedAt: { lt: cutoff },
          photoKey: { not: null },
        },
        select: { id: true, photoKey: true },
        take: BATCH_SIZE * 4,
      });

      if (profiles.length === 0) continue;

      const keys = profiles
        .map((profile) => profile.photoKey)
        .filter((key): key is string => key !== null);

      // Xoá kho TRƯỚC, cập nhật DB SAU. Ngược lại thì mất khoá là mất luôn khả
      // năng dọn, để lại tệp mồ côi vĩnh viễn không ai tìm ra.
      await this.storage.deleteMany(keys);

      // `face_profile` không bị rule bất biến chặn nên xoá được khoá. Làm vậy
      // để lần chạy sau không quét lại cùng những hàng này.
      await this.prisma.faceProfile.updateMany({
        where: { id: { in: profiles.map((profile) => profile.id) } },
        data: { photoKey: null },
      });

      totalDeleted += keys.length;
      await this.recordPurge(company.id, 'FACE_PROFILE_PHOTO', keys.length, {
        delayDays,
        cutoff: cutoff.toISOString(),
      });
    }

    this.logger.log(`Xoá ${totalDeleted} ảnh hồ sơ khuôn mặt đã thu hồi`);
    return { deleted: totalDeleted };
  }

  // ===========================================================================
  //  File xuất báo cáo
  // ===========================================================================

  /** File Excel là tệp TẠM — kế toán tải về rồi lưu chỗ khác. */
  private async purgeExpiredExports() {
    const companies = await this.activeCompanies();
    let totalDeleted = 0;

    for (const company of companies) {
      const retentionDays = await this.policy.getNumber(
        company.id,
        PolicyKeys.EXPORT_FILE_RETENTION_DAYS,
      );
      if (retentionDays <= 0) continue;

      const cutoff = daysAgo(retentionDays);

      const jobs = await this.prisma.exportJob.findMany({
        where: {
          companyId: company.id,
          createdAt: { lt: cutoff },
          fileKey: { not: null },
        },
        select: { id: true, fileKey: true },
        take: BATCH_SIZE * 4,
      });

      if (jobs.length === 0) continue;

      const keys = jobs
        .map((exportJob) => exportJob.fileKey)
        .filter((key): key is string => key !== null);

      await this.storage.deleteMany(keys);
      await this.prisma.exportJob.updateMany({
        where: { id: { in: jobs.map((exportJob) => exportJob.id) } },
        data: { fileKey: null },
      });

      totalDeleted += keys.length;
      await this.recordPurge(company.id, 'EXPORT_FILE', keys.length, { retentionDays });
    }

    this.logger.log(`Xoá ${totalDeleted} file xuất quá hạn`);
    return { deleted: totalDeleted };
  }

  // ===========================================================================
  //  Tiện ích
  // ===========================================================================

  private activeCompanies() {
    return this.prisma.company.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });
  }

  /**
   * Ghi audit mỗi lần xoá.
   *
   * Không có dấu vết thì không giải trình được với thanh tra rằng việc xoá dữ
   * liệu là tự động và đúng hạn — mà đó chính là thứ `NFR-LEGAL-04` yêu cầu.
   */
  private async recordPurge(
    companyId: string,
    targetType: string,
    count: number,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.recordSystem({
      companyId,
      action: 'RETENTION_PURGE',
      targetType,
      targetId: companyId,
      actorName: 'retention-job',
      after: { deletedCount: count, ...details },
    });
  }
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}
