import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CompanyStatus, Employee, EmployeeStatus, UserAccount } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { AppException } from 'src/common/errors';
import {
  isValidVietnamesePhone,
  maskPhone,
  normalizePhone,
  randomToken,
  sha256,
} from 'src/common/utils';
import { FirebaseService } from 'src/infra/firebase/firebase.service';
import { RedisService } from 'src/infra/redis/redis.service';
import { RedisKeys } from 'src/infra/redis/redis.keys';
import { SmsService } from '../notification/sms.service';
import { AuthRepository } from './auth.repository';
import { DeviceService } from './device.service';
import { OtpService } from './otp.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import type { AuthTokenResponseDto, DeviceInfoDto, LoginResultDto, NextStep } from './dto/auth.dto';

const REAUTH_TOKEN_TTL_SECONDS = 300;
const TWO_FACTOR_TOKEN_TTL_SECONDS = 300;
const TWO_FACTOR_SETUP_TTL_SECONDS = 600;

/**
 * Đăng nhập bằng **Firebase Authentication**, xác thực 2 lớp bằng **OTP SMS**.
 *
 * ## Ai làm việc gì
 *
 * ```
 * Client                     Firebase                  Backend
 *   │  email + mật khẩu  ──────▶ │
 *   │  ◀────── Firebase ID token │
 *   │
 *   │  POST /auth/session { domain, firebaseIdToken, deviceId }
 *   │                                                    │ verifyIdToken
 *   │                                                    │ tra UserAccount theo uid
 *   │                                                    │
 *   │  ◀── đã bật 2 lớp?  → gửi OTP, trả twoFactorToken ─┤
 *   │  POST /auth/2fa/verify { twoFactorToken, code }     │
 *   │                                                    │
 *   │  ◀── accessToken + refreshToken của Backend ───────┘
 * ```
 *
 * ## Vì sao Backend vẫn cấp token riêng thay vì dùng thẳng Firebase ID token
 *
 * Đây là câu hỏi đúng nhất cần đặt ra khi đọc file này, nên trả lời ngay:
 *
 * 1. **Ràng buộc thiết bị (AF-16).** `JwtAuthGuard` bắt `X-Device-Id` phải khớp
 *    `deviceId` nằm trong token. Firebase ID token cấp theo NGƯỜI DÙNG, không
 *    theo phiên, nên không có chỗ nào đặt được `deviceId` cho từng máy.
 * 2. **Thu hồi theo từng thiết bị.** `TokenService.revokeAllForDevice` đóng phiên
 *    của đúng một máy. Firebase chỉ có `revokeRefreshTokens(uid)` — hoặc thu hồi
 *    tất cả, hoặc không thu hồi gì.
 * 3. **Phát hiện dùng lại refresh token (AF-16).** Firebase không có khái niệm
 *    này; mất dấu hiệu sớm nhất của việc token bị đánh cắp.
 * 4. **Vai trò và phạm vi.** `roles`, `companyId`, `scopeDepartmentIds` nằm sẵn
 *    trong JWT nên guard quyết định được mà không chạm database. Đẩy chúng sang
 *    Firebase custom claims thì bị giới hạn 1000 byte, và thu hồi quyền phải chờ
 *    tới một giờ cho tới khi client tự làm mới token — thay vì 15 phút như hiện
 *    tại.
 *
 * Nên ranh giới là: **Firebase trả lời "anh là ai", Backend quyết định "anh được
 * làm gì và trong bao lâu"**.
 *
 * ## Vì sao 2 lớp không dùng cơ chế của Firebase
 *
 * MFA qua SMS của Firebase đòi nâng cấp Identity Platform (tính tiền theo MAU),
 * và từ 09/2024 mọi tin nhắn của Phone Auth đòi gói Blaze có gắn thanh toán. Dự
 * án đang ở gói Spark nên cả hai đường đều đóng. Thử thách lớp hai vì vậy do
 * Backend tự điều phối: `OtpService` sinh và kiểm mã, `SmsService` gửi.
 *
 * Đổi lại còn được lợi: toàn bộ ngưỡng chống lạm dụng (giãn cách gửi lại, số lần
 * gửi mỗi giờ, số lần nhập sai, thời gian khoá) nằm trong tay mình.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly accounts: AuthRepository,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly firebase: FirebaseService,
    private readonly passwords: PasswordService,
    private readonly otp: OtpService,
    private readonly sms: SmsService,
    private readonly tokens: TokenService,
    private readonly devices: DeviceService,
  ) {}

  // ===========================================================================
  //  Đăng nhập — đổi Firebase ID token lấy phiên của Backend
  // ===========================================================================

  async createSession(input: {
    domain: string;
    firebaseIdToken: string;
    deviceId?: string;
    deviceInfo?: DeviceInfoDto;
  }): Promise<LoginResultDto> {
    const decoded = await this.firebase.verifyIdToken(input.firebaseIdToken);

    const account = await this.accounts.findAccountByFirebaseUid(decoded.uid);

    // Có tài khoản Firebase hợp lệ nhưng chưa được cấp hồ sơ trong hệ thống —
    // ví dụ ai đó tự đăng ký thẳng qua SDK ở phía client. Không phải lỗi xác
    // thực, mà là chưa được cấp quyền vào.
    if (!account) {
      this.logger.warn(`Firebase uid ${decoded.uid} chưa gắn với tài khoản nào`);
      throw new AppException('AUTH_ACCOUNT_NOT_PROVISIONED');
    }

    const company = await this.resolveCompanyForDomain(input.domain);

    // Tên miền phải khớp công ty của tài khoản.
    //
    // Không phải chuyện thẩm mỹ: bỏ chốt này thì nhân viên công ty A gõ tên miền
    // của công ty B vẫn vào được — Firebase chỉ xác nhận danh tính, nó không biết
    // gì về ranh giới công ty. Đây là nơi duy nhất kiểm điều đó.
    if ((account.companyId ?? null) !== (company?.id ?? null)) {
      throw new AppException('AUTH_DOMAIN_MISMATCH');
    }

    // Tên miền quy ước dành RIÊNG cho quản trị viên nền tảng.
    //
    // Chỉ so `companyId` là chưa đủ: một tài khoản `companyId = null` mà không
    // phải quản trị viên vẫn lọt qua chốt trên. Trường hợp đó không nên tồn tại,
    // nhưng "không nên tồn tại" không phải là một chốt an ninh.
    if (company === null && !account.isSystemAdmin) {
      throw new AppException('AUTH_DOMAIN_MISMATCH');
    }

    await this.assertAccountUsable(account, company);

    if (account.twoFactorEnabled && account.twoFactorPhone) {
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
    const pending = await this.redis.getJson<PendingTwoFactor>(key);

    if (!pending) {
      throw new AppException('AUTH_2FA_INVALID', { reason: 'Phiên xác thực đã hết hạn.' });
    }

    const account = await this.accounts.findAccountById(pending.userId);
    if (!account?.twoFactorEnabled) {
      throw new AppException('AUTH_2FA_NOT_ENABLED');
    }

    // Thử mã dự phòng TRƯỚC khi tính là nhập sai OTP.
    //
    // Ngược lại thì mỗi lần dùng mã dự phòng đều bị `OtpService` đếm là một lần
    // sai, và người mất điện thoại — đúng đối tượng mà mã dự phòng sinh ra để
    // cứu — sẽ tự khoá mình sau vài lần thử.
    if (!(await this.consumeRecoveryCode(account, input.code))) {
      await this.otp.verify(RedisKeys.twoFactorOtp(account.id), input.code);
    }

    // Tiêu thụ ngay khi dùng — không cho thử lại nhiều mã trên cùng một phiên.
    await this.redis.del(key);

    return this.completeLogin(account, pending.deviceId, pending.deviceInfo);
  }

  /** Gửi lại OTP cho một thử thách đang mở. */
  async resendTwoFactorCode(twoFactorToken: string): Promise<TwoFactorDelivery> {
    const key = RedisKeys.twoFactorChallenge(sha256(twoFactorToken));
    const pending = await this.redis.getJson<PendingTwoFactor>(key);

    if (!pending) {
      throw new AppException('AUTH_2FA_INVALID', { reason: 'Phiên xác thực đã hết hạn.' });
    }

    const account = await this.accounts.findAccountById(pending.userId);
    if (!account?.twoFactorEnabled || !account.twoFactorPhone) {
      throw new AppException('AUTH_2FA_NOT_ENABLED');
    }

    return this.sendTwoFactorCode(account.id, account.twoFactorPhone);
  }

  // ===========================================================================
  //  Mật khẩu
  // ===========================================================================

  /**
   * Đổi mật khẩu. Đây cũng là bước bắt buộc sau khi đăng nhập lần đầu.
   *
   * ## Vì sao nhận `firebaseIdToken` thay vì `currentPassword`
   *
   * Backend không giữ mật khẩu nữa nên không tự đối chiếu được mật khẩu hiện tại.
   * Client phải gọi `reauthenticateWithCredential` của Firebase (tức là người
   * dùng gõ lại mật khẩu cũ), rồi gửi lên ID token vừa làm mới. `auth_time` trong
   * token đó chứng minh việc gõ lại vừa xảy ra.
   *
   * Thu hồi TOÀN BỘ phiên khác sau khi đổi — cả phía Backend lẫn phía Firebase.
   * Nếu mật khẩu bị lộ và kẻ tấn công đang có phiên mở, đổi mật khẩu mà không thu
   * hồi thì phiên của hắn vẫn sống.
   */
  async changePassword(userId: string, firebaseIdToken: string, newPassword: string) {
    const account = await this.accounts.findAccountByIdOrThrow(userId);

    const decoded = await this.firebase.verifyFreshIdToken(firebaseIdToken);
    if (decoded.uid !== account.firebaseUid) {
      throw new AppException('AUTH_FIREBASE_TOKEN_INVALID', {
        reason: 'Token thuộc về tài khoản khác.',
      });
    }

    this.passwords.assertStrong(newPassword, {
      email: account.email,
      fullName: account.fullName,
    });

    await this.firebase.setPassword(account.firebaseUid, newPassword);

    await this.accounts.markPasswordChanged(userId, new Date());

    // Hai kho phiên độc lập: bỏ sót bên nào thì bên đó vẫn cho vào bằng mật khẩu cũ.
    await this.firebase.revokeTokens(account.firebaseUid);
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
  //  Xác thực 2 lớp (OTP qua SMS)
  // ===========================================================================

  /**
   * Bước 1 — nhận số điện thoại và gửi mã xác minh tới đó.
   *
   * Chưa ghi gì vào `UserAccount`: số chỉ được lưu khi đã chứng minh người dùng
   * nhận được tin nhắn tới đúng số đó (bước `enable`). Ghi trước rồi mới xác minh
   * nghĩa là gõ nhầm một chữ số cũng đủ khiến mọi mã OTP về sau bay tới máy người
   * lạ — và người dùng thì tự khoá mình ra ngoài.
   */
  async setupTwoFactor(userId: string, phone: string) {
    const account = await this.accounts.findAccountByIdOrThrow(userId);
    if (account.twoFactorEnabled) {
      throw new AppException('AUTH_2FA_ALREADY_ENABLED');
    }

    const normalized = normalizePhone(phone);
    if (!isValidVietnamesePhone(normalized)) {
      throw new AppException('AUTH_PHONE_INVALID', { phone: maskPhone(normalized) });
    }

    await this.redis.setJson(
      RedisKeys.twoFactorPendingPhone(userId),
      { phone: normalized },
      TWO_FACTOR_SETUP_TTL_SECONDS,
    );

    return {
      ...(await this.sendTwoFactorCode(userId, normalized)),
      setupExpiresIn: TWO_FACTOR_SETUP_TTL_SECONDS,
    };
  }

  /** Bước 2 — xác nhận bằng mã vừa nhận rồi mới bật. */
  async enableTwoFactor(userId: string, code: string) {
    const account = await this.accounts.findAccountByIdOrThrow(userId);
    if (account.twoFactorEnabled) {
      throw new AppException('AUTH_2FA_ALREADY_ENABLED');
    }

    const pending = await this.redis.getJson<{ phone: string }>(
      RedisKeys.twoFactorPendingPhone(userId),
    );
    if (!pending) {
      throw new AppException('AUTH_2FA_INVALID', {
        reason: 'Chưa thiết lập hoặc đã quá hạn. Gọi POST /auth/2fa/setup trước.',
      });
    }

    await this.otp.verify(RedisKeys.twoFactorOtp(userId), code);

    const recoveryCodes = generateRecoveryCodes();

    await this.accounts.enableTwoFactor(userId, {
      phone: pending.phone,
      confirmedAt: new Date(),
      recoveryCodeHashes: recoveryCodes.map((value) => sha256(value)),
    });

    await this.redis.del(RedisKeys.twoFactorPendingPhone(userId));

    return {
      enabled: true,
      maskedPhone: maskPhone(pending.phone),
      // Hiển thị MỘT LẦN. Server không giữ bản gốc nên không cấp lại được.
      recoveryCodes,
    };
  }

  /**
   * Tắt 2FA — bắt buộc xác thực lại.
   *
   * Trước đây chốt này là mật khẩu; giờ là một Firebase ID token vừa làm mới, vì
   * cùng một lý do như `changePassword`: Backend không còn mật khẩu để đối chiếu.
   */
  async disableTwoFactor(userId: string, firebaseIdToken: string) {
    const account = await this.accounts.findAccountByIdOrThrow(userId);
    if (!account.twoFactorEnabled) {
      throw new AppException('AUTH_2FA_NOT_ENABLED');
    }

    const decoded = await this.firebase.verifyFreshIdToken(firebaseIdToken);
    if (decoded.uid !== account.firebaseUid) {
      throw new AppException('AUTH_FIREBASE_TOKEN_INVALID', {
        reason: 'Token thuộc về tài khoản khác.',
      });
    }

    await this.accounts.disableTwoFactor(userId);

    return { enabled: false };
  }

  // ===========================================================================
  //  Phiên đăng nhập
  // ===========================================================================

  async refresh(refreshToken: string) {
    return this.tokens.rotate(refreshToken, async (userId) => {
      const account = await this.accounts.findAccountById(userId);
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
   * Xác thực lại bằng MẬT KHẨU (qua Firebase, kèm mã 2 lớp nếu đã bật), không
   * dùng OTP một mình. Kẻ cầm được điện thoại đang đăng nhập cũng nhận được SMS
   * gửi tới chính máy đó, nên OTP không phải là rào cản trong đúng kịch bản mà
   * chốt này sinh ra để chặn — mật khẩu thì hắn không có.
   */
  async verifyReauth(userId: string, firebaseIdToken: string, twoFactorCode?: string) {
    const account = await this.accounts.findAccountByIdOrThrow(userId);

    const decoded = await this.firebase.verifyFreshIdToken(firebaseIdToken);
    if (decoded.uid !== account.firebaseUid) {
      throw new AppException('AUTH_FIREBASE_TOKEN_INVALID', {
        reason: 'Token thuộc về tài khoản khác.',
      });
    }

    if (account.twoFactorEnabled) {
      if (!twoFactorCode) {
        throw new AppException('AUTH_2FA_REQUIRED');
      }
      if (!(await this.consumeRecoveryCode(account, twoFactorCode))) {
        await this.otp.verify(RedisKeys.twoFactorOtp(account.id), twoFactorCode);
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

  /**
   * Gửi OTP để phục vụ `verifyReauth` khi tài khoản đã bật 2 lớp.
   *
   * Tách riêng khỏi `verifyReauth` vì thứ tự bắt buộc là: gửi mã → người dùng
   * đọc tin nhắn → gọi `verifyReauth` kèm mã. Gộp vào một lượt gọi thì không có
   * chỗ nào để chờ người dùng.
   */
  async requestReauthCode(userId: string): Promise<TwoFactorDelivery> {
    const account = await this.accounts.findAccountByIdOrThrow(userId);
    if (!account.twoFactorEnabled || !account.twoFactorPhone) {
      throw new AppException('AUTH_2FA_NOT_ENABLED');
    }
    return this.sendTwoFactorCode(account.id, account.twoFactorPhone);
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
   * Quản trị viên nền tảng không thuộc công ty nào nên không có tên miền để gõ.
   * Dành riêng một tên miền quy ước cho họ, cấu hình được để không đụng tên miền
   * của một khách hàng thật.
   */
  private async resolveCompanyForDomain(rawDomain: string) {
    const domain = normalizeDomain(rawDomain);
    const systemDomain = this.config.get<string>('app.systemAdminDomain', 'system');

    if (domain === systemDomain) return null;

    const company = await this.accounts.findCompanyByDomain(domain);
    if (!company) {
      throw new AppException('AUTH_DOMAIN_MISMATCH');
    }
    return company;
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
    const delivery = await this.sendTwoFactorCode(account.id, account.twoFactorPhone!);
    const twoFactorToken = randomToken(24);

    await this.redis.setJson(
      RedisKeys.twoFactorChallenge(sha256(twoFactorToken)),
      { userId: account.id, deviceId, deviceInfo } satisfies PendingTwoFactor,
      TWO_FACTOR_TOKEN_TTL_SECONDS,
    );

    return {
      nextStep: 'TWO_FACTOR',
      twoFactorToken,
      expiresIn: TWO_FACTOR_TOKEN_TTL_SECONDS,
      ...delivery,
    };
  }

  /**
   * Sinh OTP rồi gửi qua SMS.
   *
   * Chỉ trả về số đã CHE. Trả số đầy đủ ở bước này là biến màn hình đăng nhập
   * thành công cụ tra số điện thoại nhân viên cho bất kỳ ai đoán đúng mật khẩu
   * một lần.
   */
  private async sendTwoFactorCode(userId: string, phone: string): Promise<TwoFactorDelivery> {
    const { code, result } = await this.otp.issue(RedisKeys.twoFactorOtp(userId));
    await this.sms.sendOtp(phone, code, result.expiresIn);

    return {
      maskedPhone: maskPhone(phone),
      codeExpiresIn: result.expiresIn,
      resendAfter: result.resendAfter,
      ...(result.debugCode ? { debugCode: result.debugCode } : {}),
    };
  }

  private async completeLogin(
    account: UserAccount,
    deviceId?: string,
    deviceInfo?: DeviceInfoDto,
  ): Promise<AuthTokenResponseDto> {
    const employee = await this.findEmployee(account.id);

    await this.accounts.markLoggedIn(account.id, new Date());

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
    return this.accounts.findEmployeeByUserId(userId);
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

    const { faces, fingerprints } = await this.accounts.countActiveBiometrics(employee.id);

    // BR-03: chưa có phương thức xác thực nào thì KHÔNG được vào Home.
    return faces + fingerprints > 0 ? 'HOME' : 'SETUP_BIOMETRIC';
  }

  /** Mã dự phòng dùng một lần rồi xoá khỏi danh sách. */
  private async consumeRecoveryCode(account: UserAccount, code: string): Promise<boolean> {
    const hashed = sha256(code.trim().toLowerCase());
    if (!account.twoFactorRecoveryCodes.includes(hashed)) return false;

    await this.accounts.replaceRecoveryCodes(
      account.id,
      account.twoFactorRecoveryCodes.filter((stored) => stored !== hashed),
    );

    this.logger.warn(`Tài khoản ${account.id} đăng nhập bằng mã dự phòng 2FA`);
    return true;
  }
}

// ---------------------------------------------------------------------------

interface PendingTwoFactor {
  userId: string;
  deviceId?: string;
  deviceInfo?: DeviceInfoDto;
}

/** Thông tin về mã vừa gửi — đủ để App vẽ màn hình chờ, không lộ số đầy đủ. */
export interface TwoFactorDelivery {
  maskedPhone: string;
  codeExpiresIn: number;
  resendAfter: number;
  /** CHỈ khi OTP_DEBUG_RETURN=true (môi trường dev). */
  debugCode?: string;
}

function normalizeDomain(raw: string): string {
  // Người dùng hay gõ kèm giao thức hoặc dấu / ở cuối khi chép từ trình duyệt.
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
}

/**
 * Mã dự phòng dùng khi mất điện thoại.
 *
 * Bảng chữ cái bỏ ký tự dễ đọc nhầm vì người dùng được khuyên chép ra giấy.
 * Trả về dạng gốc để hiển thị MỘT LẦN; chỉ bản băm được ghi xuống database.
 */
function generateRecoveryCodes(count = 8): string[] {
  const alphabet = '23456789abcdefghjkmnpqrstuvwxyz';
  const part = () => Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join('');

  return Array.from({ length: count }, () => `${part()}-${part()}`);
}
