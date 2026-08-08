import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DateTime } from 'luxon';
import { AppException } from 'src/common/errors';
import { sha256Buffer } from 'src/common/utils';

export interface UploadResult {
  key: string;
  hash: string;
  sizeBytes: number;
}

/**
 * Object storage — ảnh chấm công, ảnh hồ sơ, file đính kèm, file export.
 *
 * NFR-SEC-01: mã hoá at-rest (SSE).
 * NFR-SEC-12: ảnh KHÔNG có URL công khai, chỉ truy cập qua presigned URL TTL ≤ 5 phút.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly presignTtl: number;

  constructor(private readonly config: ConfigService) {
    const endpoint = this.config.get<string>('storage.endpoint');
    this.bucket = this.config.get<string>('storage.bucket', 'smartface');
    this.presignTtl = this.config.get<number>('storage.presignTtlSeconds', 300);

    this.client = new S3Client({
      region: this.config.get<string>('storage.region', 'ap-southeast-1'),
      endpoint: endpoint || undefined,
      forcePathStyle: this.config.get<boolean>('storage.forcePathStyle', true),
      credentials: {
        accessKeyId: this.config.get<string>('storage.accessKey', ''),
        secretAccessKey: this.config.get<string>('storage.secretKey', ''),
      },
    });
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
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          // NFR-SEC-01: mã hoá at-rest. Đổi sang 'aws:kms' + SSEKMSKeyId khi dùng KMS.
          ServerSideEncryption: 'AES256',
          Metadata: metadata,
        }),
      );
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
  async getPresignedUrl(key: string | null | undefined, ttlSeconds?: number): Promise<string | null> {
    if (!key) return null;
    try {
      return await getSignedUrl(
        this.client,
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
        { expiresIn: Math.min(ttlSeconds ?? this.presignTtl, 300) },
      );
    } catch (error) {
      this.logger.warn(`Không tạo được presigned URL (${key}): ${(error as Error).message}`);
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client
      .send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
      .catch((error: Error) => this.logger.warn(`Xoá thất bại (${key}): ${error.message}`));
  }

  /** Xoá hàng loạt — dùng khi thực thi "quyền được quên" (NFR-LEGAL-03). */
  async deleteMany(keys: string[]): Promise<void> {
    if (keys.length === 0) return;

    for (let index = 0; index < keys.length; index += 1000) {
      const chunk = keys.slice(index, index + 1000);
      await this.client
        .send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: chunk.map((Key) => ({ Key })) },
          }),
        )
        .catch((error: Error) => this.logger.warn(`Xoá lô thất bại: ${error.message}`));
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch {
      return false;
    }
  }
}
