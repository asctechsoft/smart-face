import { Injectable, Logger } from '@nestjs/common';
import { AppException } from 'src/common/errors';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { AuthService } from './auth.service';

/** Thử thách sống bao lâu kể từ lúc xác thực xong. */
const STEP_UP_TTL_SECONDS = 300;

/** Số lần gửi sai token cho một thử thách trước khi nó bị vô hiệu. */
const MAX_ATTEMPTS = 5;

/**
 * Step-up authentication cho thao tác nhạy cảm (`BR-18` · docs/13 §5.6).
 *
 * ## Khác gì `reauthToken` đã có
 *
 * `AuthService.verifyReauth()` cấp một token dùng một lần, sống trong Redis, và
 * **không gắn với hành động nào**. Nó đủ cho mục đích ban đầu (đổi sinh trắc
 * học) nhưng không đủ cho v2.1 vì ba lý do:
 *
 * 1. **Không gắn hành động.** Người dùng xác thực lại để đổi khuôn mặt, rồi
 *    token đó dùng luôn được để gán Owner. Thử thách phải gắn với ĐÚNG một
 *    hành động.
 * 2. **Không lưu vết.** Chỉ có Redis, hết TTL là biến mất. `NFR-AUD-02` đòi
 *    audit log trỏ được tới thử thách nào đã cho phép thao tác đó.
 * 3. **Không có dấu vết thất bại.** Ai đó dò token thì không ai biết.
 *
 * Nên `StepUpChallenge` sống trong DB. Việc xác thực danh tính vẫn đi qua
 * `verifyReauth()` — không dựng lại phần đối chiếu Firebase và 2FA lần nữa.
 */
@Injectable()
export class StepUpService {
  private readonly logger = new Logger(StepUpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  /**
   * Mở một thử thách cho hành động cụ thể.
   *
   * Chưa xác thực gì ở bước này — chỉ ghi nhận ý định, để `verify()` có chỗ gắn
   * kết quả vào và để lần dò tìm nào cũng có dấu vết.
   */
  async challenge(
    userId: string,
    companyId: string | null,
    action: string,
    method: 'BIOMETRIC' | 'OTP' | 'MFA' = 'MFA',
  ) {
    const challenge = await this.prisma.stepUpChallenge.create({
      data: {
        userId,
        companyId,
        action,
        method,
        expiresAt: new Date(Date.now() + STEP_UP_TTL_SECONDS * 1000),
      },
    });

    return {
      challengeId: challenge.id,
      action,
      method,
      expiresAt: challenge.expiresAt,
      expiresIn: STEP_UP_TTL_SECONDS,
    };
  }

  /**
   * Xác thực lại danh tính rồi đánh dấu thử thách hợp lệ.
   *
   * Thời hạn được đặt LẠI kể từ lúc xác thực xong: người dùng có thể mở thử
   * thách, đi lấy điện thoại, rồi mới nhập mã — tính giờ từ lúc mở thì thời gian
   * đọc tin nhắn ăn hết vào thời gian thao tác.
   */
  async verify(
    userId: string,
    challengeId: string,
    firebaseIdToken: string,
    twoFactorCode?: string,
  ) {
    const challenge = await this.prisma.stepUpChallenge.findUnique({ where: { id: challengeId } });

    if (!challenge || challenge.userId !== userId) {
      throw new AppException('STEPUP_REQUIRED', {
        reason: 'Không tìm thấy thử thách xác thực này.',
      });
    }
    if (challenge.consumedAt) {
      throw new AppException('STEPUP_EXPIRED', { reason: 'Thử thách này đã được dùng.' });
    }
    if (challenge.expiresAt < new Date()) {
      throw new AppException('STEPUP_EXPIRED');
    }

    // `verifyReauth` tự ném lỗi nếu Firebase token sai hoặc mã 2 lớp sai.
    await this.auth.verifyReauth(userId, firebaseIdToken, twoFactorCode);

    const verified = await this.prisma.stepUpChallenge.update({
      where: { id: challengeId },
      data: {
        verifiedAt: new Date(),
        expiresAt: new Date(Date.now() + STEP_UP_TTL_SECONDS * 1000),
      },
    });

    return {
      stepUpToken: verified.id,
      action: verified.action,
      expiresAt: verified.expiresAt,
      expiresIn: STEP_UP_TTL_SECONDS,
    };
  }

  /**
   * Tiêu thụ thử thách cho đúng hành động đang chạy. `StepUpGuard` gọi hàm này.
   *
   * Trả về id để `AuditInterceptor` gắn vào `AuditLog.stepUpChallengeId` — đó là
   * mắt xích cho phép sau này trả lời "ai đã xác thực gì trước khi mở lại kỳ công".
   */
  async consume(userId: string, token: string, action: string): Promise<string> {
    const challenge = await this.prisma.stepUpChallenge.findUnique({ where: { id: token } });

    if (!challenge || challenge.userId !== userId) {
      throw new AppException('STEPUP_REQUIRED');
    }
    if (challenge.attempts >= MAX_ATTEMPTS) {
      throw new AppException('STEPUP_EXPIRED', {
        reason: 'Thử thách đã bị khoá do thử quá nhiều lần.',
      });
    }
    if (challenge.action !== action) {
      await this.prisma.stepUpChallenge.update({
        where: { id: token },
        data: { attempts: { increment: 1 } },
      });
      this.logger.warn(
        `Step-up dùng sai hành động: cấp cho "${challenge.action}" nhưng dùng cho "${action}" (user ${userId}).`,
      );
      throw new AppException('STEPUP_ACTION_MISMATCH', {
        issuedFor: challenge.action,
        usedFor: action,
      });
    }
    if (!challenge.verifiedAt) {
      throw new AppException('STEPUP_REQUIRED', { reason: 'Thử thách chưa được xác thực.' });
    }
    if (challenge.consumedAt) {
      throw new AppException('STEPUP_EXPIRED', { reason: 'Thử thách này đã được dùng.' });
    }
    if (challenge.expiresAt < new Date()) {
      throw new AppException('STEPUP_EXPIRED');
    }

    // Dùng MỘT LẦN: đánh dấu ngay, và chỉ đánh dấu được nếu chưa ai đánh dấu
    // trước — hai request song song cùng cầm một token thì chỉ một cái qua.
    const claimed = await this.prisma.stepUpChallenge.updateMany({
      where: { id: token, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new AppException('STEPUP_EXPIRED', { reason: 'Thử thách này đã được dùng.' });
    }

    return challenge.id;
  }
}
