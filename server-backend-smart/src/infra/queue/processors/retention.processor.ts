import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { StorageService } from 'src/infra/storage/storage.service';
import { JobsRepository } from '../jobs.repository';
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
    private readonly jobs: JobsRepository,
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

    for (const companyId of companies) {
      const retentionDays = await this.policy.getNumber(
        companyId,
        PolicyKeys.BIOMETRIC_PHOTO_RETENTION_DAYS,
      );

      // Chính sách <= 0 nghĩa là "giữ vĩnh viễn". Không tự suy diễn thành
      // "xoá tất cả" — hiểu nhầm ở đây là mất sạch bằng chứng của cả công ty.
      if (retentionDays <= 0) {
        this.logger.log(`Công ty ${companyId}: giữ ảnh vĩnh viễn, bỏ qua`);
        continue;
      }

      const cutoff = daysAgo(retentionDays);
      let deletedForCompany = 0;
      let cursor: string | undefined;

      // Duyệt theo lô bằng con trỏ id. Không dùng `skip` vì mỗi lô xoá xong sẽ
      // làm lệch offset của lô sau.
      for (;;) {
        const rows = await this.jobs.findExpiredAttendancePhotos(
          companyId,
          cutoff,
          BATCH_SIZE,
          cursor,
        );
        if (rows.length === 0) break;

        // `deleteMany` đã tự chia lô 1000 khoá theo giới hạn của giao thức S3.
        await this.storage.deleteMany(rows.map((row) => row.key));

        deletedForCompany += rows.length;
        cursor = rows[rows.length - 1].id;

        if (rows.length < BATCH_SIZE) break;
      }

      if (deletedForCompany > 0) {
        totalDeleted += deletedForCompany;
        await this.recordPurge(companyId, 'ATTENDANCE_PHOTO', deletedForCompany, {
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

    for (const companyId of companies) {
      const delayDays = await this.policy.getNumber(
        companyId,
        PolicyKeys.BIOMETRIC_DELETE_DELAY_DAYS,
      );
      if (delayDays < 0) continue;

      const cutoff = daysAgo(delayDays);

      const profiles = await this.jobs.findPurgeableFaceProfiles(companyId, cutoff, BATCH_SIZE * 4);
      if (profiles.length === 0) continue;

      // Xoá kho TRƯỚC, cập nhật DB SAU. Ngược lại thì mất khoá là mất luôn khả
      // năng dọn, để lại tệp mồ côi vĩnh viễn không ai tìm ra.
      await this.storage.deleteMany(profiles.map((profile) => profile.key));

      // Xoá khoá ảnh để lần chạy sau không quét lại cùng những hàng này.
      await this.jobs.clearFaceProfilePhotoKeys(profiles.map((profile) => profile.id));

      totalDeleted += profiles.length;
      await this.recordPurge(companyId, 'FACE_PROFILE_PHOTO', profiles.length, {
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

    for (const companyId of companies) {
      const retentionDays = await this.policy.getNumber(
        companyId,
        PolicyKeys.EXPORT_FILE_RETENTION_DAYS,
      );
      if (retentionDays <= 0) continue;

      const cutoff = daysAgo(retentionDays);

      const files = await this.jobs.findExpiredExportFiles(companyId, cutoff, BATCH_SIZE * 4);
      if (files.length === 0) continue;

      await this.storage.deleteMany(files.map((file) => file.key));
      await this.jobs.clearExportFileKeys(files.map((file) => file.id));

      totalDeleted += files.length;
      await this.recordPurge(companyId, 'EXPORT_FILE', files.length, { retentionDays });
    }

    this.logger.log(`Xoá ${totalDeleted} file xuất quá hạn`);
    return { deleted: totalDeleted };
  }

  // ===========================================================================
  //  Tiện ích
  // ===========================================================================

  /**
   * Mọi công ty chưa xoá — kể cả đã ngừng dịch vụ.
   *
   * Nghĩa vụ xoá dữ liệu cá nhân đúng hạn không mất đi khi công ty ngừng thanh
   * toán (NFR-LEGAL-04).
   */
  private activeCompanies() {
    return this.jobs.acrossTenantsFindAllCompanyIds();
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
