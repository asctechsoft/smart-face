import type { Bucket } from '@google-cloud/storage';

/**
 * Cổng lấy bucket — `StorageService` chỉ biết tới interface này, KHÔNG import
 * thẳng `FirebaseService`.
 *
 * Không phải để "cho dễ thay nhà cung cấp": bucket vẫn là Firebase, và
 * `FirebaseModule` là nơi duy nhất hiện thực cổng này. Lý do thật là ranh giới
 * đồ thị module — `FirebaseService` kéo theo `firebase-admin/auth`, vốn kéo tiếp
 * `jwks-rsa` → `jose` (gói ESM thuần mà Jest không nạp được). Import thẳng thì
 * MỌI file test chạm tới `StorageService` (retention, biometric, export…) đều
 * chết ngay lúc nạp module, dù chúng đã mock sạch StorageService.
 */
export interface StorageBucketProvider {
  /** Bucket dùng chung cho toàn hệ thống. */
  getStorageBucket(): Bucket;
  /** Rỗng khi đang chạy với Firebase thật. */
  getStorageEmulatorHost(): string;
}

export const STORAGE_BUCKET_PROVIDER = Symbol('STORAGE_BUCKET_PROVIDER');
