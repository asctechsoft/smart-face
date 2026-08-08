import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CompanyStatus, Employee, EmployeeStatus, UserAccount } from '@prisma/client';
import { AppException } from 'src/common/errors';
import { randomToken, sha256 } from 'src/common/utils';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { RedisService } from 'src/infra/redis/redis.service';
import { RedisKeys } from 'src/infra/redis/redis.keys';
import { DeviceService } from './device.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { TotpService } from './totp.service';
import type { AuthTokenResponseDto, DeviceInfoDto, LoginResultDto, NextStep } from './dto/auth.dto';

const REAUTH_TOKEN_TTL_SECONDS = 300;
const TWO_FACTOR_TOKEN_TTL_SECONDS = 300;

/** Số lần sai liên tiếp trước khi khoá tạm. */
const MAX_FAILED_LOGINS = 8;
const LOCK_DURATION_MS = 15 * 60 * 1000;

/**
 * Đăng nhập bằng **tên miền + email + mật khẩu**.
 *
 * ## Luồng
 *
 * ```
 * HR cấp tài khoản (tên miền, email, mật khẩu tạm)
 *      ↓
 * POST /auth/login
 *      ├─ đã bật 2FA?  → trả twoFactorToken, chờ POST /auth/2fa/verify
 *      └─ chưa bật     → cấp token luôn
 *      ↓
 * mustChangePassword = true  →  nextStep: CHANGE_PASSWORD
 *      ↓  POST /auth/password/change
 * chưa có sinh trắc học      →  nextStep: SETUP_BIOMETRIC
 *      ↓
 * HOME
 * ```
 *
 * ## Tài khoản gắn với đúng một công ty
 *
 * Một người làm ở hai công ty có hai tài khoản riêng, hai mật khẩu riêng. Vì
 * vậy không còn khái niệm "chọn công ty" hay "chuyển công ty" — đăng nhập vào
 * tên miền nào là làm việc với công ty đó.
 *
 * ## OTP không còn là cách đăng nhập
 *
 * Xác thực 2 lớp dùng TOTP (ứng dụng xác thực), do người dùng tự bật.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly passwords: PasswordService,
    private readonly totp: TotpService,
    private readonly tokens: TokenService,
    private readonly devices: DeviceService,
  ) {}

  // ===========================================================================
  //  Đăng nhập
  // ===========================================================================

  async login(input: {
    domain: string;
    email: string;
    password: string;
    deviceId?: string;
    deviceInfo?: DeviceInfoDto;
  }): Promise<LoginResultDto> {
    const domain = normalizeDomain(input.domain);
    const email = normalizeEmail(input.email);

    // Quản trị viên nền tảng không thuộc công ty nào nên không có tên miền để
    // gõ. Dành riêng một tên miền quy ước cho họ. Không tách thành endpoint
    // riêng: một endpoint đăng nhập duy nhất thì chỉ có một chỗ để làm đúng
    // việc chống dò tài khoản và đếm số lần sai.
    const systemDomain = this.config.get<string>('app.systemAdminDomain', 'system');

    const company =
      domain === systemDomain
        ? null
        : await this.prisma.company.findUnique({ where: { domain } });

    let user: UserAccount | null = null;
    if (domain === systemDomain) {
      // `companyId = null` không dùng được findUnique vì Postgres coi mọi NULL
      // là khác nhau — ràng buộc duy nhất cho nhóm này là chỉ mục một phần
      // trong prisma/sql/02_auth_constraints.sql.
      user = await this.prisma.userAccount.findFirst({
        where: { companyId: null, email, isSystemAdmin: true, deletedAt: null },
      });
    } else if (company) {
      user = await this.prisma.userAccount.findUnique({
        where: { companyId_email: { companyId: company.id, email } },
      });
    }

    // ⚠ Không thoát sớm khi không tìm thấy công ty hoặc tài khoản. Xem
    // `assertPasswordMatches` để hiểu vì sao.
    await this.assertPasswordMatches(user, input.password);

    // Tới đây `user` chắc chắn khác null.
    const account = user as UserAccount;
    await this.assertAccountUsable(account, company);

    if (account.twoFactorEnabled && account.twoFactorSecret) {
      return this.beginTwoFactorChallenge(account, input.deviceId, input.deviceInfo);
    }

    return this.completeLogin(account, input.deviceId, input.deviceInfo);
  }

  /**
   * Bước hai của đăng nhập khi tài khoản đã bật xác thực 2 lớp.
   *
   * `twoFactorToken` sống 5 phút trong Redis và dùng một lần. Nó KHÔNG phải
   * access token: chưa qua bước này thì chưa gọi được API nào.
   */
  async verifyTwoFactor(input: {
    twoFactorToken: string;
    code: string;
  }): Promise<AuthTokenResponseDto> {
    const key = RedisKeys.twoFactorChallenge(sha256(input.twoFactorToken));
    const pending = await this.redis.getJson<{
      userId: string;
      deviceId?: string;
      deviceInfo?: DeviceInfoDto;
    }>(key);

    if (!pending) {
      throw new AppException('AUTH_2FA_INVALID', { reason: 'Phiên xác thực đã hết hạn.' });
    }

    const account = await this.prisma.userAccount.findUnique({ where: { id: pending.userId } });
    if (!account?.twoFactorSecret) {
      throw new AppException('AUTH_2FA_NOT_ENABLED');
    }

    const step = this.totp.verify(account.twoFactorSecret, input.code);
    if (step === null) {
      const usedRecoveryCode = await this.consumeRecoveryCode(account, input.code);
      if (!usedRecoveryCode) {
        throw new AppException('AUTH_2FA_INVALID');
      }
    } else {
      await this.assertTotpStepUnused(account.id, step);
    }

    // Tiêu thụ ngay khi dùng — không cho thử lại nhiều mã trên cùng một phiên.
    await this.redis.del(key);

    return this.completeLogin(account, pending.deviceId, pending.deviceInfo);
  }

  // ===========================================================================
  //  Mật khẩu
  // ===========================================================================

  /**
   * Đổi mật khẩu. Đây cũng là bước bắt buộc sau khi đăng nhập lần đầu.
   *
   * Thu hồi TOÀN BỘ phiên khác sau khi đổi: nếu mật khẩu bị lộ và kẻ tấn công
   * đang có phiên mở, đổi mật khẩu mà không thu hồi thì phiên của hắn vẫn sống.
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const account = await this.prisma.userAccount.findUniqueOrThrow({ where: { id: userId } });

    const matches = await this.passwords.verify(currentPassword, account.passwordHash);
    if (!matches) {
      throw new AppException('AUTH_INVALID_CREDENTIALS', {
        reason: 'Mật khẩu hiện tại không đúng.',
      });
    }

    if (await this.passwords.verify(newPassword, account.passwordHash)) {
      throw new AppException('AUTH_PASSWORD_REUSED');
    }

    this.passwords.assertStrong(newPassword, {
      email: account.email,
      fullName: account.fullName,
    });

    await this.prisma.userAccount.update({
      where: { id: userId },
      data: {
        passwordHash: await this.passwords.hash(newPassword),
        mustChangePassword: false,
        passwordChangedAt: new Date(),
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });

    const revoked = await this.tokens.revokeAllForUser(userId, 'PASSWORD_CHANGED');
    this.logger.log(`Đổi mật khẩu cho ${userId}, thu hồi ${revoked} phiên`);

    // Cấp lại phiên mới ngay để người dùng không phải đăng nhập lại — nhưng lần
    // này token KHÔNG còn cờ bắt đổi mật khẩu.
    const employee = await this.findEmployee(userId);
    const issued = await this.tokens.issue({
      userId,
      employee,
      isSystemAdmin: account.isSystemAdmin,
      deviceId: null,
      mustChangePassword: false,
    });

    return {
      ...issued,
      nextStep: await this.resolveNextStep(account.isSystemAdmin, false, employee),
      revokedSessions: revoked,
    };
  }

  // ===========================================================================
  //  Xác thực 2 lớp (TOTP)
  // ===========================================================================

  /**
   * Bước 1 — sinh secret và URI mã QR.
   *
   * Secret được lưu ngay nhưng `twoFactorEnabled` vẫn `false`. Chỉ khi người
   * dùng nhập đúng một mã sinh từ secret đó (bước `enable`) mới bật thật. Bật
   * ngay từ đây sẽ khoá chính người dùng ra ngoài nếu họ quét mã QR hỏng.
   */
  async setupTwoFactor(userId: string) {
    const account = await this.prisma.userAccount.findUniqueOrThrow({ where: { id: userId } });
    if (account.twoFactorEnabled) {
      throw new AppException('AUTH_2FA_ALREADY_ENABLED');
    }

    const secret = this.totp.generateSecret();
    await this.prisma.userAccount.update({
      where: { id: userId },
      data: { twoFactorSecret: secret, twoFactorConfirmedAt: null },
    });

    const issuer = this.config.get<string>('app.name', 'SmartFace');

    return {
      secret,
      otpauthUri: this.totp.buildOtpAuthUri(secret, account.email, issuer),
      // App hiển thị secret dạng chữ cho người không quét được mã QR.
      manualEntryKey: secret.replace(/(.{4})/g, '$1 ').trim(),
    };
  }

  /** Bước 2 — xác nhận bằng một mã thật rồi mới bật. */
  async enableTwoFactor(userId: string, code: string) {
    const account = await this.prisma.userAccount.findUniqueOrThrow({ where: { id: userId } });
    if (account.twoFactorEnabled) {
      throw new AppException('AUTH_2FA_ALREADY_ENABLED');
    }
    if (!account.twoFactorSecret) {
      throw new AppException('AUTH_2FA_INVALID', {
        reason: 'Chưa thiết lập. Gọi POST /auth/2fa/setup trước.',
      });
    }
    if (this.totp.verify(account.twoFactorSecret, code) === null) {
      throw new AppException('AUTH_2FA_INVALID');
    }

    const recoveryCodes = this.totp.generateRecoveryCodes();

    await this.prisma.userAccount.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: true,
        twoFactorConfirmedAt: new Date(),
        // Chỉ lưu bản băm. Mất thiết bị mà đọc được mã dự phòng từ DB thì lớp
        // xác thực thứ hai không còn ý nghĩa gì.
        twoFactorRecoveryCodes: recoveryCodes.map((value) => sha256(value)),
      },
    });

    return {
      enabled: true,
      // Hiển thị MỘT LẦN. Server không giữ bản gốc nên không cấp lại được.
      recoveryCodes,
    };
  }

  /** Tắt 2FA — bắt buộc xác nhận lại bằng mật khẩu. */
  async disableTwoFactor(userId: string, password: string) {
    const account = await this.prisma.userAccount.findUniqueOrThrow({ where: { id: userId } });
    if (!account.twoFactorEnabled) {
      throw new AppException('AUTH_2FA_NOT_ENABLED');
    }
    if (!(await this.passwords.verify(password, account.passwordHash))) {
      throw new AppException('AUTH_INVALID_CREDENTIALS', { reason: 'Mật khẩu không đúng.' });
    }

    await this.prisma.userAccount.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorConfirmedAt: null,
        twoFactorRecoveryCodes: [],
      },
    });

    return { enabled: false };
  }

  // ===========================================================================
  //  Phiên đăng nhập
  // ===========================================================================

  async refresh(refreshToken: string) {
    return this.tokens.rotate(refreshToken, async (userId) => {
      const account = await this.prisma.userAccount.findUnique({ where: { id: userId } });
      if (!account || account.isBlocked || account.deletedAt) {
        throw new AppException('AUTH_ACCOUNT_SUSPENDED');
      }
      return {
        employee: await this.findEmployee(userId),
        isSystemAdmin: account.isSystemAdmin,
        mustChangePassword: account.mustChangePassword,
      };
    });
  }

  async logout(userId: string, refreshToken?: string) {
    if (refreshToken) {
      await this.tokens.revoke(refreshToken);
      return { revokedSessions: 1 };
    }
    const count = await this.tokens.revokeAllForUser(userId, 'LOGOUT_ALL');
    return { revokedSessions: count };
  }

  // ===========================================================================
  //  Xác thực lại danh tính (thao tác nhạy cảm)
  // ===========================================================================

  /**
   * docs/03 mục 8.1 — đổi khuôn mặt/vân tay BẮT BUỘC xác thực lại trước.
   *
   * Xác thực lại bằng MẬT KHẨU (kèm mã 2FA nếu đã bật), không dùng OTP SMS. Kẻ
   * cầm được điện thoại đang đăng nhập cũng nhận được SMS gửi tới chính máy đó,
   * nên OTP không phải là rào cản trong đúng kịch bản mà chốt này sinh ra để
   * chặn.
   */
  async verifyReauth(userId: string, password: string, totpCode?: string) {
    const account = await this.prisma.userAccount.findUniqueOrThrow({ where: { id: userId } });

    if (!(await this.passwords.verify(password, account.passwordHash))) {
      throw new AppException('AUTH_INVALID_CREDENTIALS', { reason: 'Mật khẩu không đúng.' });
    }

    if (account.twoFactorEnabled && account.twoFactorSecret) {
      if (!totpCode || this.totp.verify(account.twoFactorSecret, totpCode) === null) {
        throw new AppException('AUTH_2FA_REQUIRED');
      }
    }

    const reauthToken = randomToken(24);
    await this.redis.setJson(
      RedisKeys.reauthToken(sha256(reauthToken)),
      { userId, issuedAt: Date.now() },
      REAUTH_TOKEN_TTL_SECONDS,
    );

    return { reauthToken, expiresIn: REAUTH_TOKEN_TTL_SECONDS };
  }

  /** Tiêu thụ reauthToken — dùng một lần. */
  async consumeReauthToken(userId: string, reauthToken: string): Promise<void> {
    const key = RedisKeys.reauthToken(sha256(reauthToken));
    const stored = await this.redis.getJson<{ userId: string }>(key);

    if (!stored || stored.userId !== userId) {
      throw new AppException('AUTH_REAUTH_REQUIRED');
    }
    await this.redis.del(key);
  }

  // ===========================================================================
  //  Helper
  // ===========================================================================

  /**
   * Kiểm mật khẩu, và tốn thời gian như nhau ở MỌI nhánh thất bại.
   *
   * Nếu thoát sớm khi không tìm thấy công ty hoặc tài khoản, phản hồi sẽ về
   * nhanh hơn hẳn so với trường hợp có tài khoản nhưng sai mật khẩu — vì scrypt
   * cố tình chậm. Chênh lệch đó đủ để kẻ tấn công dò ra email nào có thật mà
   * không cần đoán đúng một mật khẩu nào.
   *
   * Nên khi không có tài khoản, vẫn băm mật khẩu vừa nhập với một chuỗi giả rồi
   * mới báo lỗi.
   */
  private async assertPasswordMatches(user: UserAccount | null, password: string): Promise<void> {
    if (!user) {
      await this.passwords.verify(password, DUMMY_HASH);
      throw new AppException('AUTH_INVALID_CREDENTIALS');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AppException('AUTH_ACCOUNT_LOCKED', {
        lockedUntil: user.lockedUntil.toISOString(),
      });
    }

    if (await this.passwords.verify(password, user.passwordHash)) {
      if (user.failedLoginCount > 0) {
        await this.prisma.userAccount.update({
          where: { id: user.id },
          data: { failedLoginCount: 0, lockedUntil: null },
        });
      }
      return;
    }

    const failed = user.failedLoginCount + 1;
    const shouldLock = failed >= MAX_FAILED_LOGINS;

    await this.prisma.userAccount.update({
      where: { id: user.id },
      data: {
        failedLoginCount: failed,
        lockedUntil: shouldLock ? new Date(Date.now() + LOCK_DURATION_MS) : null,
      },
    });

    if (shouldLock) {
      this.logger.warn(`Khoá tạm tài khoản ${user.id} sau ${failed} lần sai mật khẩu`);
      throw new AppException('AUTH_ACCOUNT_LOCKED', {
        lockedUntil: new Date(Date.now() + LOCK_DURATION_MS).toISOString(),
      });
    }

    throw new AppException('AUTH_INVALID_CREDENTIALS');
  }

  private async assertAccountUsable(
    account: UserAccount,
    company: { status: CompanyStatus } | null,
  ): Promise<void> {
    if (account.isBlocked || account.deletedAt) {
      throw new AppException('AUTH_ACCOUNT_SUSPENDED', { reason: account.blockedReason });
    }

    if (
      company &&
      (company.status === CompanyStatus.SUSPENDED || company.status === CompanyStatus.TERMINATED)
    ) {
      throw new AppException('AUTH_COMPANY_INACTIVE');
    }

    const employee = await this.findEmployee(account.id);
    if (
      employee &&
      (employee.status === EmployeeStatus.SUSPENDED ||
        employee.status === EmployeeStatus.TERMINATED)
    ) {
      throw new AppException('AUTH_ACCOUNT_SUSPENDED');
    }
  }

  private async beginTwoFactorChallenge(
    account: UserAccount,
    deviceId?: string,
    deviceInfo?: DeviceInfoDto,
  ): Promise<LoginResultDto> {
    const twoFactorToken = randomToken(24);

    await this.redis.setJson(
      RedisKeys.twoFactorChallenge(sha256(twoFactorToken)),
      { userId: account.id, deviceId, deviceInfo },
      TWO_FACTOR_TOKEN_TTL_SECONDS,
    );

    return {
      nextStep: 'TWO_FACTOR',
      twoFactorToken,
      expiresIn: TWO_FACTOR_TOKEN_TTL_SECONDS,
    };
  }

  private async completeLogin(
    account: UserAccount,
    deviceId?: string,
    deviceInfo?: DeviceInfoDto,
  ): Promise<AuthTokenResponseDto> {
    const employee = await this.findEmployee(account.id);

    await this.prisma.userAccount.update({
      where: { id: account.id },
      data: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null },
    });

    let deviceSecret: string | undefined;
    if (deviceId) {
      const link = await this.devices.link(
        account.id,
        deviceId,
        deviceInfo,
        employee?.companyId ?? null,
      );
      deviceSecret = link.deviceSecret;

      if (link.previousDeviceRevoked) {
        // BR-11: đổi thiết bị → thu hồi phiên cũ.
        await this.tokens.revokeAllForUser(account.id, 'DEVICE_CHANGED');
      }
    }

    const issued = await this.tokens.issue({
      userId: account.id,
      employee,
      isSystemAdmin: account.isSystemAdmin,
      deviceId: deviceId ?? null,
      mustChangePassword: account.mustChangePassword,
    });

    return {
      ...issued,
      ...(deviceSecret ? { deviceSecret } : {}),
      nextStep: await this.resolveNextStep(
        account.isSystemAdmin,
        account.mustChangePassword,
        employee,
      ),
      user: {
        id: account.id,
        fullName: account.fullName,
        email: account.email,
        phone: account.phone,
        avatarUrl: account.avatarUrl,
        twoFactorEnabled: account.twoFactorEnabled,
      },
      employee: employee
        ? {
            id: employee.id,
            employeeCode: employee.employeeCode,
            companyId: employee.companyId,
            status: employee.status,
            roles: employee.roles,
          }
        : null,
    };
  }

  private findEmployee(userId: string): Promise<Employee | null> {
    // Quan hệ 1–1: tài khoản gắn với đúng một công ty nên đúng một hồ sơ.
    return this.prisma.employee.findFirst({ where: { userId, deletedAt: null } });
  }

  /**
   * Bước điều hướng tiếp theo cho App.
   *
   * Thứ tự có chủ đích: đổi mật khẩu trước, sinh trắc học sau. Cho đăng ký
   * khuôn mặt khi vẫn đang dùng mật khẩu tạm nghĩa là ai cầm tờ giấy ghi mật
   * khẩu đó đều đăng ký được khuôn mặt của mình.
   */
  private async resolveNextStep(
    isSystemAdmin: boolean,
    mustChangePassword: boolean,
    employee: Employee | null,
  ): Promise<NextStep> {
    if (mustChangePassword) return 'CHANGE_PASSWORD';
    if (isSystemAdmin) return 'HOME';
    if (!employee) return 'HOME';

    const [faceCount, fingerprintCount] = await Promise.all([
      this.prisma.faceProfile.count({ where: { employeeId: employee.id, status: 'ACTIVE' } }),
      this.prisma.biometricKey.count({ where: { employeeId: employee.id, revokedAt: null } }),
    ]);

    // BR-03: chưa có phương thức xác thực nào thì KHÔNG được vào Home.
    return faceCount + fingerprintCount > 0 ? 'HOME' : 'SETUP_BIOMETRIC';
  }

  /**
   * AF-12 tương tự cho TOTP: một mã chỉ dùng được MỘT lần.
   *
   * Cửa sổ chấp nhận là 90 giây, nên không có chốt này thì người nhìn trộm màn
   * hình gõ lại được ngay mã vừa thấy.
   */
  private async assertTotpStepUnused(userId: string, step: number): Promise<void> {
    const counter = Math.floor(Date.now() / 1000 / 30) + step;
    const fresh = await this.redis.consumeOnce(RedisKeys.totpUsedStep(userId, counter), 120);
    if (!fresh) {
      throw new AppException('AUTH_2FA_INVALID', { reason: 'Mã này đã được dùng.' });
    }
  }

  /** Mã dự phòng dùng một lần rồi xoá khỏi danh sách. */
  private async consumeRecoveryCode(account: UserAccount, code: string): Promise<boolean> {
    const hashed = sha256(code.trim().toLowerCase());
    if (!account.twoFactorRecoveryCodes.includes(hashed)) return false;

    await this.prisma.userAccount.update({
      where: { id: account.id },
      data: {
        twoFactorRecoveryCodes: account.twoFactorRecoveryCodes.filter(
          (stored) => stored !== hashed,
        ),
      },
    });

    this.logger.warn(`Tài khoản ${account.id} đăng nhập bằng mã dự phòng 2FA`);
    return true;
  }
}

/**
 * Chuỗi băm giả để nhánh "không có tài khoản" tốn thời gian ngang nhánh thật.
 *
 * Sinh sẵn một lần với đúng tham số scrypt đang dùng. Nội dung không quan trọng
 * — chỉ cần `verify` phải chạy đủ vòng lặp thay vì trả về ngay.
 */
const DUMMY_HASH =
  'scrypt$65536$8$1$AAAAAAAAAAAAAAAAAAAAAA$' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function normalizeDomain(raw: string): string {
  // Người dùng hay gõ kèm giao thức hoặc dấu / ở cuối khi chép từ trình duyệt.
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
}

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}
