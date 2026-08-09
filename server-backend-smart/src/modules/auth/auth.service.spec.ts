import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { FirebaseService } from 'src/infra/firebase/firebase.service';

// `firebase-admin` kéo theo `jose`, gói chỉ phát hành ESM — Jest ở đây chạy
// CommonJS nên nạp thẳng sẽ chết ngay lúc parse.
//
// Spec này chỉ cần lớp `FirebaseService` làm TOKEN cho DI (bản cài thật đã được
// thay bằng mock trong `providers`), nên chặn cả cây phụ thuộc đó lại là đủ.
jest.mock('firebase-admin/app', () => ({
  initializeApp: jest.fn(),
  cert: jest.fn(),
  deleteApp: jest.fn(),
}));
jest.mock('firebase-admin/auth', () => ({ getAuth: jest.fn() }));

import { RedisService } from 'src/infra/redis/redis.service';
import { RedisKeys } from 'src/infra/redis/redis.keys';
import { SmsService } from '../notification/sms.service';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { DeviceService } from './device.service';
import { OtpService } from './otp.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

/**
 * Đăng nhập qua Firebase + xác thực 2 lớp bằng OTP SMS.
 *
 * Trọng tâm là những tính chất dễ mất khi refactor:
 *   1. Tên miền phải khớp công ty của tài khoản — Firebase không biết gì về
 *      ranh giới công ty, đây là nơi DUY NHẤT kiểm điều đó.
 *   2. Cờ bắt đổi mật khẩu đi vào token, không chỉ nằm trong response.
 *   3. Bật 2 lớp không được ghi số điện thoại trước khi xác minh.
 *   4. Mã dự phòng không bị tính là một lần nhập sai OTP.
 */
describe('AuthService — Firebase + OTP 2 lớp', () => {
  let service: AuthService;

  const accounts = {
    findCompanyByDomain: jest.fn(),
    findAccountByFirebaseUid: jest.fn(),
    findAccountById: jest.fn(),
    findAccountByIdOrThrow: jest.fn(),
    findEmployeeByUserId: jest.fn(),
    countActiveBiometrics: jest.fn(),
    markLoggedIn: jest.fn(),
    markPasswordChanged: jest.fn(),
    enableTwoFactor: jest.fn(),
    disableTwoFactor: jest.fn(),
    replaceRecoveryCodes: jest.fn(),
  };
  const tokens = { issue: jest.fn(), revokeAllForUser: jest.fn() };
  const redis = { setJson: jest.fn(), getJson: jest.fn(), del: jest.fn(), consumeOnce: jest.fn() };
  const devices = { link: jest.fn() };
  const firebase = {
    verifyIdToken: jest.fn(),
    verifyFreshIdToken: jest.fn(),
    setPassword: jest.fn(),
    revokeTokens: jest.fn(),
  };
  const otp = { issue: jest.fn(), verify: jest.fn() };
  const sms = { sendOtp: jest.fn() };

  const COMPANY = { id: 'cmp_1', domain: 'amobi.vn', status: 'ACTIVE' };
  const FIREBASE_UID = 'fb_uid_1';
  const ID_TOKEN = 'firebase-id-token';

  function accountFixture(overrides: Record<string, unknown> = {}) {
    return {
      id: 'usr_1',
      companyId: 'cmp_1',
      email: 'duc@amobi.vn',
      phone: '0901234567',
      fullName: 'Nguyễn Văn Đức',
      firebaseUid: FIREBASE_UID,
      mustChangePassword: false,
      twoFactorEnabled: false,
      twoFactorPhone: null,
      twoFactorRecoveryCodes: [],
      isSystemAdmin: false,
      isBlocked: false,
      blockedReason: null,
      deletedAt: null,
      avatarUrl: null,
      ...overrides,
    };
  }

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        PasswordService,
        { provide: AuthRepository, useValue: accounts },
        { provide: RedisService, useValue: redis },
        { provide: ConfigService, useValue: { get: (_k: string, d: unknown) => d } },
        { provide: FirebaseService, useValue: firebase },
        { provide: OtpService, useValue: otp },
        { provide: SmsService, useValue: sms },
        { provide: TokenService, useValue: tokens },
        { provide: DeviceService, useValue: devices },
      ],
    }).compile();

    service = moduleRef.get(AuthService);

    firebase.verifyIdToken.mockResolvedValue({ uid: FIREBASE_UID, email: 'duc@amobi.vn' });
    firebase.verifyFreshIdToken.mockResolvedValue({ uid: FIREBASE_UID });
    accounts.findCompanyByDomain.mockResolvedValue(COMPANY);
    accounts.findAccountByFirebaseUid.mockResolvedValue(accountFixture());
    accounts.findAccountById.mockResolvedValue(accountFixture());
    accounts.findAccountByIdOrThrow.mockResolvedValue(accountFixture());
    accounts.findEmployeeByUserId.mockResolvedValue(null);
    accounts.countActiveBiometrics.mockResolvedValue({ faces: 0, fingerprints: 0 });
    otp.issue.mockResolvedValue({ code: '123456', result: { expiresIn: 300, resendAfter: 60 } });
    tokens.issue.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', expiresIn: 900 });
  });

  const createSession = (overrides: Record<string, unknown> = {}) =>
    service.createSession({ domain: 'amobi.vn', firebaseIdToken: ID_TOKEN, ...overrides });

  // ===========================================================================
  //  Đường hợp lệ
  // ===========================================================================

  it('ID token hợp lệ thì cấp phiên của Backend', async () => {
    const result = await createSession();
    expect(result).toMatchObject({ accessToken: 'at', nextStep: 'HOME' });
  });

  it('tra tài khoản theo firebaseUid, KHÔNG theo email trong token', async () => {
    // Email trong Firebase đổi được (`updateUser`), uid thì không. Neo vào email
    // nghĩa là đổi email bên Firebase là mất luôn hồ sơ nghiệp vụ.
    await createSession();

    expect(accounts.findAccountByFirebaseUid).toHaveBeenCalledWith(FIREBASE_UID);
  });

  it('chuẩn hoá tên miền — chấp nhận cả https:// và dấu / cuối', async () => {
    await createSession({ domain: 'HTTPS://Amobi.VN/' });

    expect(accounts.findCompanyByDomain).toHaveBeenCalledWith('amobi.vn');
  });

  // ===========================================================================
  //  Ranh giới công ty — thứ Firebase không biết
  // ===========================================================================

  describe('ràng buộc tên miền', () => {
    it('chặn khi tài khoản thuộc công ty khác với tên miền đã gõ', async () => {
      accounts.findAccountByFirebaseUid.mockResolvedValue(
        accountFixture({ companyId: 'cmp_khac' }),
      );

      await expect(createSession()).rejects.toMatchObject({ code: 'AUTH_DOMAIN_MISMATCH' });
    });

    it('tên miền không tồn tại trả CÙNG mã lỗi với tên miền sai công ty', async () => {
      // Phân biệt ra thì gõ bừa tên miền sẽ dò được tên miền nào có thật.
      accounts.findCompanyByDomain.mockResolvedValue(null);

      await expect(createSession()).rejects.toMatchObject({ code: 'AUTH_DOMAIN_MISMATCH' });
    });

    it('quản trị viên nền tảng vào bằng tên miền quy ước, không cần công ty', async () => {
      accounts.findAccountByFirebaseUid.mockResolvedValue(
        accountFixture({ companyId: null, isSystemAdmin: true }),
      );

      const result = await createSession({ domain: 'system' });

      expect(result).toMatchObject({ accessToken: 'at' });
      expect(accounts.findCompanyByDomain).not.toHaveBeenCalled();
    });

    it('tài khoản KHÔNG phải quản trị viên không vào được bằng tên miền quy ước', async () => {
      // Chỉ so companyId là chưa đủ: một tài khoản `companyId = null` mà không
      // phải quản trị viên vẫn khớp `null === null` ở chốt trên.
      accounts.findAccountByFirebaseUid.mockResolvedValue(
        accountFixture({ companyId: null, isSystemAdmin: false }),
      );

      await expect(createSession({ domain: 'system' })).rejects.toMatchObject({
        code: 'AUTH_DOMAIN_MISMATCH',
      });
    });
  });

  it('từ chối uid chưa được cấp hồ sơ trong hệ thống', async () => {
    // Ai đó tự đăng ký thẳng qua Firebase SDK ở client. Xác thực thì hợp lệ,
    // nhưng tài khoản trong hệ thống chỉ do HR cấp.
    accounts.findAccountByFirebaseUid.mockResolvedValue(null);

    await expect(createSession()).rejects.toMatchObject({
      code: 'AUTH_ACCOUNT_NOT_PROVISIONED',
    });
  });

  // ===========================================================================
  //  Bắt đổi mật khẩu
  // ===========================================================================

  describe('mật khẩu tạm', () => {
    beforeEach(() => {
      accounts.findAccountByFirebaseUid.mockResolvedValue(
        accountFixture({ mustChangePassword: true }),
      );
    });

    it('trả nextStep = CHANGE_PASSWORD', async () => {
      expect(await createSession()).toMatchObject({ nextStep: 'CHANGE_PASSWORD' });
    });

    it('đưa cờ vào TOKEN, không chỉ vào response', async () => {
      // Chỉ trả trong response thì việc bắt đổi mật khẩu phụ thuộc App có chịu
      // điều hướng hay không. PasswordChangeGuard đọc cờ trong token.
      await createSession();

      expect(tokens.issue).toHaveBeenCalledWith(
        expect.objectContaining({ mustChangePassword: true }),
      );
    });

    it('đứng TRƯỚC bước đăng ký sinh trắc học', async () => {
      // Cho đăng ký khuôn mặt khi vẫn đang dùng mật khẩu tạm nghĩa là ai cầm tờ
      // giấy ghi mật khẩu đó đều đăng ký được khuôn mặt của mình.
      accounts.findEmployeeByUserId.mockResolvedValue({ id: 'emp_1', companyId: 'cmp_1' });

      expect(await createSession()).toMatchObject({ nextStep: 'CHANGE_PASSWORD' });
    });
  });

  // ===========================================================================
  //  Trạng thái tài khoản và công ty
  // ===========================================================================

  it('chặn tài khoản bị khoá', async () => {
    accounts.findAccountByFirebaseUid.mockResolvedValue(accountFixture({ isBlocked: true }));

    await expect(createSession()).rejects.toMatchObject({ code: 'AUTH_ACCOUNT_SUSPENDED' });
  });

  it('chặn khi công ty tạm ngưng dịch vụ', async () => {
    accounts.findCompanyByDomain.mockResolvedValue({ ...COMPANY, status: 'SUSPENDED' });

    await expect(createSession()).rejects.toMatchObject({ code: 'AUTH_COMPANY_INACTIVE' });
  });

  it('chặn nhân viên đã nghỉ việc dù tài khoản còn', async () => {
    accounts.findEmployeeByUserId.mockResolvedValue({
      id: 'emp_1',
      companyId: 'cmp_1',
      status: 'TERMINATED',
    });

    await expect(createSession()).rejects.toMatchObject({ code: 'AUTH_ACCOUNT_SUSPENDED' });
  });

  // ===========================================================================
  //  Xác thực 2 lớp — đăng nhập
  // ===========================================================================

  describe('thử thách 2 lớp', () => {
    beforeEach(() => {
      const account = accountFixture({ twoFactorEnabled: true, twoFactorPhone: '0901234567' });
      accounts.findAccountByFirebaseUid.mockResolvedValue(account);
      accounts.findAccountById.mockResolvedValue(account);
    });

    it('KHÔNG cấp token ngay, chỉ trả twoFactorToken', async () => {
      const result = await createSession();

      expect(result).toMatchObject({ nextStep: 'TWO_FACTOR' });
      expect(result).not.toHaveProperty('accessToken');
      expect(tokens.issue).not.toHaveBeenCalled();
    });

    it('gửi OTP tới số đã đăng ký ngay khi tạo thử thách', async () => {
      await createSession();

      expect(sms.sendOtp).toHaveBeenCalledWith('0901234567', '123456', 300);
    });

    it('chỉ trả về số đã CHE, không trả số đầy đủ', async () => {
      // Trả số đầy đủ ở bước này là biến màn hình đăng nhập thành công cụ tra số
      // điện thoại nhân viên cho bất kỳ ai đoán đúng mật khẩu một lần.
      const result = await createSession();

      expect(result).toMatchObject({ maskedPhone: '090****567' });
      expect(JSON.stringify(result)).not.toContain('0901234567');
    });

    it('đánh phạm vi OTP theo userId, không theo số điện thoại', async () => {
      // Hai người khai chung một số mà đánh theo số thì người này nhập sai năm
      // lần là người kia bị khoá.
      await createSession();

      expect(otp.issue).toHaveBeenCalledWith(RedisKeys.twoFactorOtp('usr_1'));
    });

    it('lưu phiên chờ vào Redis với TTL 5 phút', async () => {
      await createSession();

      const call = redis.setJson.mock.calls.find(([key]) => String(key).startsWith('auth:2fa:'));
      expect(call?.[1]).toMatchObject({ userId: 'usr_1' });
      expect(call?.[2]).toBe(300);
    });

    it('mã đúng thì cấp token', async () => {
      redis.getJson.mockResolvedValue({ userId: 'usr_1' });
      otp.verify.mockResolvedValue(undefined);

      const result = await service.verifyTwoFactor({ twoFactorToken: 'tk', code: '123456' });

      expect(result).toMatchObject({ accessToken: 'at' });
    });

    it('mã sai thì từ chối', async () => {
      redis.getJson.mockResolvedValue({ userId: 'usr_1' });
      otp.verify.mockRejectedValue(Object.assign(new Error('sai'), { code: 'AUTH_OTP_INVALID' }));

      await expect(
        service.verifyTwoFactor({ twoFactorToken: 'tk', code: '000000' }),
      ).rejects.toMatchObject({ code: 'AUTH_OTP_INVALID' });
    });

    it('phiên chờ hết hạn thì từ chối', async () => {
      redis.getJson.mockResolvedValue(null);

      await expect(
        service.verifyTwoFactor({ twoFactorToken: 'tk', code: '123456' }),
      ).rejects.toMatchObject({ code: 'AUTH_2FA_INVALID' });
    });

    it('tiêu thụ phiên chờ ngay khi dùng — không thử được nhiều mã', async () => {
      redis.getJson.mockResolvedValue({ userId: 'usr_1' });
      otp.verify.mockResolvedValue(undefined);

      await service.verifyTwoFactor({ twoFactorToken: 'tk', code: '123456' });

      expect(redis.del).toHaveBeenCalled();
    });

    it('mã dự phòng KHÔNG bị tính là một lần nhập sai OTP', async () => {
      // Ngược lại thì người mất điện thoại — đúng đối tượng mà mã dự phòng sinh
      // ra để cứu — sẽ tự khoá mình sau vài lần thử.
      const { sha256 } = await import('src/common/utils');
      const recovery = 'abcd-efgh';
      accounts.findAccountById.mockResolvedValue(
        accountFixture({
          twoFactorEnabled: true,
          twoFactorPhone: '0901234567',
          twoFactorRecoveryCodes: [sha256(recovery)],
        }),
      );
      redis.getJson.mockResolvedValue({ userId: 'usr_1' });

      const result = await service.verifyTwoFactor({ twoFactorToken: 'tk', code: recovery });

      expect(result).toMatchObject({ accessToken: 'at' });
      expect(otp.verify).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  //  Xác thực 2 lớp — bật
  // ===========================================================================

  describe('bật 2 lớp', () => {
    it('KHÔNG ghi số điện thoại vào tài khoản ở bước setup', async () => {
      // Ghi trước rồi mới xác minh nghĩa là gõ nhầm một chữ số cũng đủ khiến mọi
      // mã OTP về sau bay tới máy người lạ.
      await service.setupTwoFactor('usr_1', '0912345678');

      expect(accounts.enableTwoFactor).not.toHaveBeenCalled();
      expect(redis.setJson).toHaveBeenCalledWith(
        RedisKeys.twoFactorPendingPhone('usr_1'),
        { phone: '0912345678' },
        expect.any(Number),
      );
    });

    it('chuẩn hoá số +84 về dạng 0…', async () => {
      await service.setupTwoFactor('usr_1', '+84912345678');

      expect(sms.sendOtp).toHaveBeenCalledWith(
        '0912345678',
        expect.any(String),
        expect.any(Number),
      );
    });

    it('từ chối số không hợp lệ trước khi gửi tin nhắn', async () => {
      await expect(service.setupTwoFactor('usr_1', '12345')).rejects.toMatchObject({
        code: 'AUTH_PHONE_INVALID',
      });
      expect(sms.sendOtp).not.toHaveBeenCalled();
    });

    it('chỉ ghi số vào tài khoản sau khi nhập đúng mã', async () => {
      redis.getJson.mockResolvedValue({ phone: '0912345678' });
      otp.verify.mockResolvedValue(undefined);

      const result = await service.enableTwoFactor('usr_1', '123456');

      expect(accounts.enableTwoFactor).toHaveBeenCalledWith(
        'usr_1',
        expect.objectContaining({ phone: '0912345678' }),
      );
      expect(result.recoveryCodes).toHaveLength(8);
    });

    it('chỉ lưu bản BĂM của mã dự phòng', async () => {
      // Mất điện thoại mà đọc được mã dự phòng từ DB thì lớp thứ hai vô nghĩa.
      redis.getJson.mockResolvedValue({ phone: '0912345678' });
      otp.verify.mockResolvedValue(undefined);

      const result = await service.enableTwoFactor('usr_1', '123456');
      const stored = accounts.enableTwoFactor.mock.calls[0][1].recoveryCodeHashes;

      for (const code of result.recoveryCodes) {
        expect(stored).not.toContain(code);
      }
      expect(stored).toHaveLength(8);
    });

    it('từ chối enable khi chưa qua bước setup', async () => {
      redis.getJson.mockResolvedValue(null);

      await expect(service.enableTwoFactor('usr_1', '123456')).rejects.toMatchObject({
        code: 'AUTH_2FA_INVALID',
      });
    });
  });

  // ===========================================================================
  //  Đổi mật khẩu
  // ===========================================================================

  describe('đổi mật khẩu', () => {
    it('đòi ID token vừa làm mới, thuộc đúng tài khoản', async () => {
      firebase.verifyFreshIdToken.mockResolvedValue({ uid: 'uid_nguoi_khac' });

      await expect(
        service.changePassword('usr_1', ID_TOKEN, 'MatKhauMoiRatDai2026'),
      ).rejects.toMatchObject({ code: 'AUTH_FIREBASE_TOKEN_INVALID' });
      expect(firebase.setPassword).not.toHaveBeenCalled();
    });

    it('kiểm chính sách mật khẩu TRƯỚC khi ghi sang Firebase', async () => {
      // Firebase bản không nâng cấp chỉ ép tối thiểu 6 ký tự; bỏ tầng này là hạ
      // chuẩn của cả hệ thống.
      await expect(service.changePassword('usr_1', ID_TOKEN, 'abc123')).rejects.toMatchObject({
        code: 'AUTH_PASSWORD_TOO_WEAK',
      });
      expect(firebase.setPassword).not.toHaveBeenCalled();
    });

    it('thu hồi phiên ở CẢ HAI phía sau khi đổi', async () => {
      // Bỏ sót bên nào thì bên đó vẫn cho vào bằng mật khẩu cũ.
      tokens.revokeAllForUser.mockResolvedValue(2);

      await service.changePassword('usr_1', ID_TOKEN, 'MatKhauMoiRatDai2026');

      expect(firebase.revokeTokens).toHaveBeenCalledWith(FIREBASE_UID);
      expect(tokens.revokeAllForUser).toHaveBeenCalledWith('usr_1', 'PASSWORD_CHANGED');
    });

    it('xoá cờ bắt đổi mật khẩu', async () => {
      tokens.revokeAllForUser.mockResolvedValue(0);

      await service.changePassword('usr_1', ID_TOKEN, 'MatKhauMoiRatDai2026');

      expect(accounts.markPasswordChanged).toHaveBeenCalledWith('usr_1', expect.any(Date));
    });
  });
});
