import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException } from 'src/common/errors';
import { randomNumericCode, sha256 } from 'src/common/utils';
import { RedisService } from 'src/infra/redis/redis.service';
import { RedisKeys } from 'src/infra/redis/redis.keys';

interface OtpRecord {
  codeHash: string;
  attempts: number;
  createdAt: number;
}

export interface OtpIssueResult {
  expiresIn: number;
  resendAfter: number;
  /** CHỈ trả về khi OTP_DEBUG_RETURN=true (môi trường dev). */
  debugCode?: string;
}

/**
 * OTP — FR-APP-AUTH-02..05, docs/05 mục 5.1.
 *
 * - Lưu HASH của mã, không lưu mã gốc.
 * - Chống spam: khoảng cách gửi lại + giới hạn số lần gửi mỗi giờ.
 * - Nhập sai quá số lần cho phép → khoá, không cho gọi verify nữa.
 * - Toàn bộ ngưỡng cấu hình được qua env (FR-ADM-CFG-02).
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Sinh và lưu OTP mới.
   * @returns mã gốc để caller gửi SMS — KHÔNG log giá trị này (NFR-OBS-08).
   */
  async issue(phone: string): Promise<{ code: string; result: OtpIssueResult }> {
    await this.assertNotLocked(phone);

    // Chống gửi lại quá nhanh (chặn cả ở client lẫn server).
    const resendAfter = this.config.get<number>('otp.resendAfterSeconds', 60);
    const canSend = await this.redis.consumeOnce(RedisKeys.otpResendLock(phone), resendAfter);
    if (!canSend) {
      const remaining = await this.redis.ttl(RedisKeys.otpResendLock(phone));
      throw new AppException('AUTH_OTP_RESEND_TOO_SOON', {
        retryAfterSeconds: Math.max(remaining, 1),
      });
    }

    // Giới hạn số lần gửi trong một giờ.
    const maxPerHour = this.config.get<number>('otp.maxSendPerHour', 5);
    const sendCount = await this.redis.incrementWithTtl(RedisKeys.otpSendCount(phone), 3600);
    if (sendCount > maxPerHour) {
      throw new AppException('AUTH_OTP_SEND_LIMIT', { maxPerHour });
    }

    const length = this.config.get<number>('otp.length', 6);
    const ttl = this.config.get<number>('otp.ttlSeconds', 300);
    const code = randomNumericCode(length);

    const record: OtpRecord = { codeHash: sha256(code), attempts: 0, createdAt: Date.now() };
    await this.redis.setJson(RedisKeys.otp(phone), record, ttl);

    const debugReturn = this.config.get<boolean>('otp.debugReturn', false);
    return {
      code,
      result: {
        expiresIn: ttl,
        resendAfter,
        ...(debugReturn ? { debugCode: code } : {}),
      },
    };
  }

  /** Đối chiếu OTP. Đúng → xoá mã (dùng một lần). */
  async verify(phone: string, code: string): Promise<void> {
    await this.assertNotLocked(phone);

    const record = await this.redis.getJson<OtpRecord>(RedisKeys.otp(phone));
    if (!record) {
      throw new AppException('AUTH_OTP_EXPIRED');
    }

    const maxAttempts = this.config.get<number>('otp.maxAttempts', 5);

    if (record.codeHash !== sha256(code)) {
      const attempts = record.attempts + 1;
      const remainingTtl = await this.redis.ttl(RedisKeys.otp(phone));

      if (attempts >= maxAttempts) {
        const lockSeconds = this.config.get<number>('otp.lockSeconds', 900);
        await this.redis.del(RedisKeys.otp(phone));
        await this.redis.setJson(RedisKeys.otpLock(phone), { lockedAt: Date.now() }, lockSeconds);
        throw new AppException('AUTH_OTP_MAX_ATTEMPTS', {
          lockedUntil: new Date(Date.now() + lockSeconds * 1000).toISOString(),
          lockSeconds,
        });
      }

      await this.redis.setJson(
        RedisKeys.otp(phone),
        { ...record, attempts },
        Math.max(remainingTtl, 1),
      );
      throw new AppException('AUTH_OTP_INVALID', { remainingAttempts: maxAttempts - attempts });
    }

    await this.redis.del(RedisKeys.otp(phone));
  }

  private async assertNotLocked(phone: string): Promise<void> {
    const locked = await this.redis.getJson<{ lockedAt: number }>(RedisKeys.otpLock(phone));
    if (locked) {
      const remaining = await this.redis.ttl(RedisKeys.otpLock(phone));
      throw new AppException('AUTH_OTP_MAX_ATTEMPTS', {
        lockedUntil: new Date(Date.now() + Math.max(remaining, 0) * 1000).toISOString(),
        retryAfterSeconds: Math.max(remaining, 1),
      });
    }
  }
}
