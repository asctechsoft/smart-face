import type { Bucket } from '@google-cloud/storage';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DateTime } from 'luxon';
import { AppException } from 'src/common/errors';
import { sha256Buffer } from 'src/common/utils';
import { STORAGE_BUCKET_PROVIDER, StorageBucketProvider } from './storage-bucket.provider';

export interface UploadResult {
  key: string;
  hash: string;
  sizeBytes: number;
}

/**
 * Object storage — ảnh chấm công, ảnh hồ sơ khuôn mặt, file đính kèm, file export.
 *
 * Nơi lưu là **Cloud Storage for Firebase** (bản chất là bucket Google Cloud
 * Storage), dùng chung service account với Firebase Authentication — bucket lấy
 * qua `StorageBucketProvider`, hiện thực bởi `FirebaseService`.
 *
 * NFR-SEC-01: mã hoá at-rest — GCS mã hoá mặc định mọi đối tượng, không cần
 * khai gì thêm (trước đây dùng S3 phải tự đặt `ServerSideEncryption`).
 * NFR-SEC-12: ảnh KHÔNG có URL công khai. Bucket phải để chế độ riêng tư và mọi
 * truy cập đi qua signed URL V4 với TTL ≤ 5 phút.
 *
 * ⚠ Signed URL được ký **tại chỗ** bằng khoá riêng trong service account
 * (`FIREBASE_PRIVATE_KEY`). Nếu triển khai bằng Application Default Credentials
 * thay vì khoá riêng, service account phải có quyền
 * `iam.serviceAccounts.signBlob` thì `getSignedUrl` mới chạy được.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly presignTtl: number;
  private bucketRef: Bucket | null = null;

  constructor(
    private readonly config: ConfigService,
    @Inject(STORAGE_BUCKET_PROVIDER) private readonly buckets: StorageBucketProvider,
  ) {
    this.presignTtl = this.config.get<number>('storage.presignTtlSeconds', 300);
  }

  /**
   * Lấy bucket theo kiểu lười.
   *
   * Không dựng trong constructor được: bên hiện thực (`FirebaseService`) chỉ
   * khởi tạo Firebase App ở `onModuleInit`, tức là SAU khi Nest dựng xong mọi
   * provider. Đụng vào bucket ngay trong constructor sẽ chạm phải App chưa tồn tại.
   */
  private get bucket(): Bucket {
    if (!this.bucketRef) {
      this.bucketRef = this.buckets.getStorageBucket();
    }
    return this.bucketRef;
  }

  // ---------------------------------------------------------------------------
  // Quy ước đặt key — phân vùng theo công ty + ngày để lifecycle policy dễ áp
  // ---------------------------------------------------------------------------

  /** `attendance/{companyId}/{yyyy}/{MM}/{dd}/{employeeId}/{uuid}.jpg` */
  buildAttendancePhotoKey(companyId: string, employeeId: string, recordedAt: Date): string {
    const date = DateTime.fromJSDate(recordedAt, { zone: 'utc' });
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    return `attendance/${companyId}/${date.toFormat('yyyy/MM/dd')}/${employeeId}/${suffix}.jpg`;
  }

  /** `face-profile/{companyId}/{employeeId}/{angle}-{ts}.jpg` — ảnh hồ sơ gốc */
  buildFaceProfileKey(companyId: string, employeeId: string, angle: string): string {
    return `face-profile/${companyId}/${employeeId}/${angle.toLowerCase()}-${Date.now()}.jpg`;
  }

  buildRequestAttachmentKey(companyId: string, requestId: string, fileName: string): string {
    const safeName = fileName.replace(/[^\w.\-]/g, '_').slice(-120);
    return `requests/${companyId}/${requestId}/${Date.now()}-${safeName}`;
  }

  buildExportKey(companyId: string, jobId: string, fileName: string): string {
    return `exports/${companyId}/${jobId}/${fileName}`;
  }

  // ---------------------------------------------------------------------------
  // Thao tác
  // ---------------------------------------------------------------------------

  async upload(
    key: string,
    body: Buffer,
    contentType: string,
    metadata?: Record<string, string>,
  ): Promise<UploadResult> {
    try {
      await this.bucket.file(key).save(body, {
        contentType,
        // Ảnh chấm công chỉ vài trăm KB, file export vài MB. Upload resumable
        // tốn thêm một lượt khứ hồi để mở session mà không đổi lại được gì.
        resumable: false,
        metadata: metadata ? { metadata } : undefined,
      });
    } catch (error) {
      this.logger.error(`Upload thất bại (${key}): ${(error as Error).message}`);
      throw new AppException('SYS_STORAGE_UNAVAILABLE');
    }

    return { key, hash: sha256Buffer(body), sizeBytes: body.length };
  }

  /**
   * URL tải có thời hạn. TTL bị chặn cứng ≤ 5 phút ở tầng config (NFR-SEC-12).
   * Trả `null` nếu key rỗng để controller không phải kiểm tra thủ công.
   */
  async getPresignedUrl(
    key: string | null | undefined,
    ttlSeconds?: number,
  ): Promise<string | null> {
    if (!key) return null;

    const ttl = Math.min(ttlSeconds ?? this.presignTtl, 300);

    // Storage Emulator không có khoá để ký, nên signed URL không tồn tại ở đó.
    // Trả thẳng đường tải của emulator để luồng dev vẫn xem được ảnh.
    const emulatorHost = this.buckets.getStorageEmulatorHost();
    if (emulatorHost) {
      return `${emulatorHost}/v0/b/${this.bucket.name}/o/${encodeURIComponent(key)}?alt=media`;
    }

    try {
      const [url] = await this.bucket.file(key).getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + ttl * 1000,
      });
      return url;
    } catch (error) {
      this.logger.warn(`Không tạo được signed URL (${key}): ${(error as Error).message}`);
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await this.bucket
      .file(key)
      .delete({ ignoreNotFound: true })
      .catch((error: Error) => this.logger.warn(`Xoá thất bại (${key}): ${error.message}`));
  }

  /**
   * Xoá hàng loạt — dùng khi thực thi "quyền được quên" (NFR-LEGAL-03).
   *
   * GCS không có API xoá theo lô như `DeleteObjects` của S3, nên phải gọi từng
   * đối tượng. Chạy theo cụm 50 để không bắn hàng nghìn request cùng lúc.
   */
  async deleteMany(keys: string[]): Promise<void> {
    if (keys.length === 0) return;

    const CONCURRENCY = 50;
    for (let index = 0; index < keys.length; index += CONCURRENCY) {
      const chunk = keys.slice(index, index + CONCURRENCY);
      await Promise.all(chunk.map((key) => this.delete(key)));
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const [exists] = await this.bucket.exists();
      return exists;
    } catch {
      return false;
    }
  }
}
