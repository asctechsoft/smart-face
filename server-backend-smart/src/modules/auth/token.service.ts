import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Employee, SystemRole } from '@prisma/client';
import { ulid } from 'ulid';
import { AppException } from 'src/common/errors';
import { randomToken, sha256 } from 'src/common/utils';
import { AuthRepository } from './auth.repository';
import type { JwtPayload } from 'src/common/types/request-context';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * Cấp và xoay vòng token (docs/02 mục 8.1, AF-16).
 *
 * - Access token TTL ngắn (15 phút), gắn `deviceId`.
 * - Refresh token XOAY VÒNG: mỗi lần dùng cấp token mới, token cũ vô hiệu.
 * - Phát hiện dùng lại refresh token đã bị thay thế → THU HỒI TOÀN BỘ phiên
 *   của tài khoản, vì đó là dấu hiệu token bị đánh cắp.
 * - Refresh token lưu dạng HASH, không lưu giá trị gốc.
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly accounts: AuthRepository,
  ) {}

  async issue(params: {
    userId: string;
    employee: Employee | null;
    isSystemAdmin: boolean;
    deviceId: string | null;
    mustChangePassword?: boolean;
  }): Promise<IssuedTokens> {
    const accessTtl = this.config.get<number>('jwt.accessTtl', 900);
    const refreshTtl = this.config.get<number>('jwt.refreshTtl', 2_592_000);

    const roles: SystemRole[] = params.isSystemAdmin
      ? [SystemRole.SYSTEM_ADMIN]
      : (params.employee?.roles ?? []);

    const payload: JwtPayload = {
      sub: params.userId,
      employeeId: params.employee?.id ?? null,
      companyId: params.employee?.companyId ?? null,
      roles,
      deviceId: params.deviceId,
      isSystemAdmin: params.isSystemAdmin,
      scopeDepartmentIds: params.employee?.managedDepartmentIds ?? [],
      mustChangePassword: params.mustChangePassword ?? false,
      jti: ulid(),
    };

    const accessToken = await this.jwt.signAsync(payload, { expiresIn: accessTtl });

    // Web không có deviceId → dùng một mã ổn định để vẫn ràng buộc được phiên.
    const deviceId = params.deviceId ?? 'web';
    const refreshToken = randomToken();
    await this.accounts.createRefreshToken({
      userId: params.userId,
      tokenHash: sha256(refreshToken),
      deviceId,
      expiresAt: new Date(Date.now() + refreshTtl * 1000),
    });

    return { accessToken, refreshToken, expiresIn: accessTtl };
  }

  /**
   * Xoay vòng refresh token.
   *
   * @param resolveEmployee callback lấy Employee đang hoạt động — cho phép
   *        đổi công ty giữa các lần refresh mà không phải đăng nhập lại.
   */
  async rotate(
    refreshToken: string,
    resolveEmployee: (userId: string) => Promise<{
      employee: Employee | null;
      isSystemAdmin: boolean;
      mustChangePassword?: boolean;
    }>,
  ): Promise<IssuedTokens> {
    const tokenHash = sha256(refreshToken);
    const stored = await this.accounts.findRefreshTokenByHash(tokenHash);

    if (!stored) {
      throw new AppException('AUTH_REFRESH_INVALID');
    }

    // AF-16: token đã bị thay thế mà vẫn được dùng lại → nghi bị đánh cắp.
    if (stored.replacedById || stored.revokedAt) {
      this.logger.warn(
        `Phát hiện dùng lại refresh token của user ${stored.userId} — thu hồi toàn bộ phiên`,
      );
      await this.revokeAllForUser(stored.userId, 'REFRESH_TOKEN_REUSE_DETECTED');
      throw new AppException('AUTH_REFRESH_REUSE_DETECTED');
    }

    if (stored.expiresAt < new Date()) {
      throw new AppException('AUTH_REFRESH_INVALID', { reason: 'Refresh token đã hết hạn' });
    }

    const { employee, isSystemAdmin, mustChangePassword } = await resolveEmployee(stored.userId);
    const issued = await this.issue({
      userId: stored.userId,
      employee,
      isSystemAdmin,
      deviceId: stored.deviceId === 'web' ? null : stored.deviceId,
      // Làm mới token KHÔNG được xoá cờ bắt đổi mật khẩu — nếu không thì chỉ cần
      // gọi refresh một lần là thoát khỏi màn hình đổi mật khẩu.
      mustChangePassword,
    });

    const replacement = await this.accounts.findRefreshTokenIdByHash(sha256(issued.refreshToken));

    await this.accounts.markRefreshTokenReplaced(stored.id, replacement?.id, new Date());

    return issued;
  }

  async revoke(refreshToken: string): Promise<void> {
    await this.accounts.revokeRefreshTokenByHash(sha256(refreshToken), 'LOGOUT', new Date());
  }

  /**
   * Thu hồi mọi phiên của tài khoản.
   *
   * Bắt buộc khi: đổi thiết bị, chấm dứt hợp đồng, Admin khoá tài khoản,
   * reset sinh trắc học (docs/02 mục 8.1).
   */
  async revokeAllForUser(userId: string, reason: string): Promise<number> {
    return this.accounts.revokeRefreshTokensForUser(userId, reason, new Date());
  }

  async revokeAllForDevice(userId: string, deviceId: string, reason: string): Promise<number> {
    return this.accounts.revokeRefreshTokensForDevice(userId, deviceId, reason, new Date());
  }
}
