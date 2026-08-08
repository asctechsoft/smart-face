import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { RedisService } from 'src/infra/redis/redis.service';
import { AuthService } from './auth.service';
import { DeviceService } from './device.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { TotpService } from './totp.service';

/**
 * Luồng đăng nhập bằng tên miền + email + mật khẩu.
 *
 * Trọng tâm là hai tính chất dễ mất khi refactor:
 *   1. Không phân biệt được sai tên miền / sai email / sai mật khẩu — cả về mã
 *      lỗi lẫn thời gian phản hồi.
 *   2. Cờ bắt đổi mật khẩu đi vào token, không chỉ nằm trong response.
 */
describe('AuthService — đăng nhập', () => {
  jest.setTimeout(30_000);

  let service: AuthService;
  const passwords = new PasswordService();

  const prisma = {
    company: { findUnique: jest.fn() },
    userAccount: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    employee: { findFirst: jest.fn() },
    faceProfile: { count: jest.fn() },
    biometricKey: { count: jest.fn() },
  };
  const tokens = { issue: jest.fn(), revokeAllForUser: jest.fn() };
  const redis = { setJson: jest.fn(), getJson: jest.fn(), del: jest.fn(), consumeOnce: jest.fn() };
  const devices = { link: jest.fn() };

  const COMPANY = { id: 'cmp_1', domain: 'amobi.vn', status: 'ACTIVE' };
  const PASSWORD = 'MatKhauCuaToi2026';
  let passwordHash: string;

  function accountFixture(overrides: Record<string, unknown> = {}) {
    return {
      id: 'usr_1',
      companyId: 'cmp_1',
      email: 'duc@amobi.vn',
      phone: '0901234567',
      fullName: 'Nguyễn Văn Đức',
      passwordHash,
      mustChangePassword: false,
      failedLoginCount: 0,
      lockedUntil: null,
      twoFactorEnabled: false,
      twoFactorSecret: null,
      twoFactorRecoveryCodes: [],
      isSystemAdmin: false,
      isBlocked: false,
      blockedReason: null,
      deletedAt: null,
      avatarUrl: null,
      ...overrides,
    };
  }

  beforeAll(async () => {
    passwordHash = await passwords.hash(PASSWORD);
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        PasswordService,
        TotpService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        { provide: ConfigService, useValue: { get: (_k: string, d: unknown) => d } },
        { provide: TokenService, useValue: tokens },
        { provide: DeviceService, useValue: devices },
      ],
    }).compile();

    service = moduleRef.get(AuthService);

    prisma.company.findUnique.mockResolvedValue(COMPANY);
    prisma.userAccount.findUnique.mockResolvedValue(accountFixture());
    prisma.userAccount.update.mockResolvedValue({});
    prisma.employee.findFirst.mockResolvedValue(null);
    prisma.faceProfile.count.mockResolvedValue(0);
    prisma.biometricKey.count.mockResolvedValue(0);
    tokens.issue.mockResolvedValue({
      accessToken: 'at',
      refreshToken: 'rt',
      expiresIn: 900,
    });
  });

  const login = (overrides: Record<string, unknown> = {}) =>
    service.login({
      domain: 'amobi.vn',
      email: 'duc@amobi.vn',
      password: PASSWORD,
      ...overrides,
    });

  // ===========================================================================
  //  Đường hợp lệ
  // ===========================================================================

  it('đăng nhập đúng thì cấp token', async () => {
    const result = await login();
    expect(result).toMatchObject({ accessToken: 'at', nextStep: 'HOME' });
  });

  it('chuẩn hoá tên miền — chấp nhận cả https:// và dấu / cuối', async () => {
    // Người dùng hay chép từ thanh địa chỉ trình duyệt.
    await login({ domain: 'HTTPS://Amobi.VN/' });

    expect(prisma.company.findUnique).toHaveBeenCalledWith({ where: { domain: 'amobi.vn' } });
  });

  it('chuẩn hoá email về chữ thường', async () => {
    await login({ email: '  DUC@Amobi.VN ' });

    expect(prisma.userAccount.findUnique).toHaveBeenCalledWith({
      where: { companyId_email: { companyId: 'cmp_1', email: 'duc@amobi.vn' } },
    });
  });

  // ===========================================================================
  //  Không để màn hình đăng nhập thành công cụ dò tài khoản
  // ===========================================================================

  describe('chống dò tài khoản', () => {
    it('sai tên miền, sai email và sai mật khẩu đều trả CÙNG một mã lỗi', async () => {
      // Phân biệt ra thì kẻ tấn công gõ bừa email, thấy "email không tồn tại"
      // là loại, thấy "mật khẩu sai" là biết email có thật. Danh sách email
      // nhân viên của một công ty có giá trị với cả tuyển dụng lẫn lừa đảo.
      prisma.company.findUnique.mockResolvedValueOnce(null);
      const wrongDomain = await login().catch((error) => error);

      prisma.userAccount.findUnique.mockResolvedValueOnce(null);
      const wrongEmail = await login().catch((error) => error);

      const wrongPassword = await login({ password: 'SaiBetMatKhau2026' }).catch((e) => e);

      expect(wrongDomain.code).toBe('AUTH_INVALID_CREDENTIALS');
      expect(wrongEmail.code).toBe('AUTH_INVALID_CREDENTIALS');
      expect(wrongPassword.code).toBe('AUTH_INVALID_CREDENTIALS');
    });

    it('VẪN băm mật khẩu khi không tìm thấy tài khoản', async () => {
      // scrypt cố tình chậm. Thoát sớm khi không có tài khoản sẽ làm phản hồi
      // về nhanh hơn hẳn, và chênh lệch đó đủ để dò ra email nào có thật mà
      // không cần đoán đúng mật khẩu nào.
      prisma.userAccount.findUnique.mockResolvedValueOnce(null);

      const started = Date.now();
      await login().catch(() => undefined);
      const missingAccountMs = Date.now() - started;

      const startedReal = Date.now();
      await login({ password: 'SaiBetMatKhau2026' }).catch(() => undefined);
      const wrongPasswordMs = Date.now() - startedReal;

      // Không so chính xác được vì máy chạy test có nhiễu; chỉ cần nhánh
      // "không có tài khoản" KHÔNG nhanh hơn hẳn.
      expect(missingAccountMs).toBeGreaterThan(wrongPasswordMs * 0.4);
    });
  });

  // ===========================================================================
  //  Khoá tạm sau nhiều lần sai
  // ===========================================================================

  describe('khoá tạm', () => {
    it('đếm số lần sai liên tiếp', async () => {
      await login({ password: 'SaiBetMatKhau2026' }).catch(() => undefined);

      expect(prisma.userAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ failedLoginCount: 1 }) }),
      );
    });

    it('khoá khi chạm ngưỡng', async () => {
      prisma.userAccount.findUnique.mockResolvedValue(accountFixture({ failedLoginCount: 7 }));

      const error = await login({ password: 'SaiBetMatKhau2026' }).catch((e) => e);
      expect(error.code).toBe('AUTH_ACCOUNT_LOCKED');
    });

    it('từ chối ngay khi đang trong thời gian khoá, KHÔNG kiểm mật khẩu', async () => {
      prisma.userAccount.findUnique.mockResolvedValue(
        accountFixture({ lockedUntil: new Date(Date.now() + 60_000) }),
      );

      const error = await login().catch((e) => e);
      expect(error.code).toBe('AUTH_ACCOUNT_LOCKED');
    });

    it('đăng nhập đúng thì xoá bộ đếm', async () => {
      prisma.userAccount.findUnique.mockResolvedValue(accountFixture({ failedLoginCount: 3 }));
      await login();

      expect(prisma.userAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ failedLoginCount: 0, lockedUntil: null }),
        }),
      );
    });
  });

  // ===========================================================================
  //  Bắt đổi mật khẩu
  // ===========================================================================

  describe('mật khẩu tạm', () => {
    beforeEach(() => {
      prisma.userAccount.findUnique.mockResolvedValue(
        accountFixture({ mustChangePassword: true }),
      );
    });

    it('trả nextStep = CHANGE_PASSWORD', async () => {
      expect(await login()).toMatchObject({ nextStep: 'CHANGE_PASSWORD' });
    });

    it('đưa cờ vào TOKEN, không chỉ vào response', async () => {
      // Chỉ trả trong response thì việc bắt đổi mật khẩu phụ thuộc App có chịu
      // điều hướng hay không. PasswordChangeGuard đọc cờ trong token.
      await login();

      expect(tokens.issue).toHaveBeenCalledWith(
        expect.objectContaining({ mustChangePassword: true }),
      );
    });

    it('đứng TRƯỚC bước đăng ký sinh trắc học', async () => {
      // Cho đăng ký khuôn mặt khi vẫn đang dùng mật khẩu tạm nghĩa là ai cầm tờ
      // giấy ghi mật khẩu đó đều đăng ký được khuôn mặt của mình.
      prisma.employee.findFirst.mockResolvedValue({ id: 'emp_1', companyId: 'cmp_1' });
      prisma.faceProfile.count.mockResolvedValue(0);

      expect(await login()).toMatchObject({ nextStep: 'CHANGE_PASSWORD' });
    });
  });

  // ===========================================================================
  //  Trạng thái tài khoản và công ty
  // ===========================================================================

  it('chặn tài khoản bị khoá', async () => {
    prisma.userAccount.findUnique.mockResolvedValue(accountFixture({ isBlocked: true }));

    await expect(login()).rejects.toMatchObject({ code: 'AUTH_ACCOUNT_SUSPENDED' });
  });

  it('chặn khi công ty tạm ngưng dịch vụ', async () => {
    prisma.company.findUnique.mockResolvedValue({ ...COMPANY, status: 'SUSPENDED' });

    await expect(login()).rejects.toMatchObject({ code: 'AUTH_COMPANY_INACTIVE' });
  });

  it('chặn nhân viên đã nghỉ việc dù tài khoản còn', async () => {
    prisma.employee.findFirst.mockResolvedValue({
      id: 'emp_1',
      companyId: 'cmp_1',
      status: 'TERMINATED',
    });

    await expect(login()).rejects.toMatchObject({ code: 'AUTH_ACCOUNT_SUSPENDED' });
  });

  // ===========================================================================
  //  Xác thực 2 lớp
  // ===========================================================================

  describe('xác thực 2 lớp', () => {
    const totp = new TotpService();
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

    beforeEach(() => {
      prisma.userAccount.findUnique.mockResolvedValue(
        accountFixture({ twoFactorEnabled: true, twoFactorSecret: secret }),
      );
    });

    it('KHÔNG cấp token ngay, chỉ trả twoFactorToken', async () => {
      const result = await login();

      expect(result).toMatchObject({ nextStep: 'TWO_FACTOR' });
      expect(result).not.toHaveProperty('accessToken');
      expect(tokens.issue).not.toHaveBeenCalled();
    });

    it('lưu phiên chờ vào Redis với TTL 5 phút', async () => {
      await login();

      const [, payload, ttl] = redis.setJson.mock.calls[0];
      expect(payload).toMatchObject({ userId: 'usr_1' });
      expect(ttl).toBe(300);
    });

    it('mã đúng thì cấp token', async () => {
      redis.getJson.mockResolvedValue({ userId: 'usr_1' });
      redis.consumeOnce.mockResolvedValue(true);

      const result = await service.verifyTwoFactor({
        twoFactorToken: 'tk',
        code: totp.generate(secret),
      });

      expect(result).toMatchObject({ accessToken: 'at' });
    });

    it('mã sai thì từ chối', async () => {
      redis.getJson.mockResolvedValue({ userId: 'usr_1' });

      await expect(
        service.verifyTwoFactor({ twoFactorToken: 'tk', code: '000000' }),
      ).rejects.toMatchObject({ code: 'AUTH_2FA_INVALID' });
    });

    it('CHẶN dùng lại cùng một mã trong cửa sổ 90 giây', async () => {
      // Không có chốt này thì người nhìn trộm màn hình gõ lại được ngay mã vừa thấy.
      redis.getJson.mockResolvedValue({ userId: 'usr_1' });
      redis.consumeOnce.mockResolvedValue(false);

      await expect(
        service.verifyTwoFactor({ twoFactorToken: 'tk', code: totp.generate(secret) }),
      ).rejects.toMatchObject({ code: 'AUTH_2FA_INVALID' });
    });

    it('phiên chờ hết hạn thì từ chối', async () => {
      redis.getJson.mockResolvedValue(null);

      await expect(
        service.verifyTwoFactor({ twoFactorToken: 'tk', code: '123456' }),
      ).rejects.toMatchObject({ code: 'AUTH_2FA_INVALID' });
    });

    it('tiêu thụ phiên chờ ngay khi dùng — không thử được nhiều mã', async () => {
      redis.getJson.mockResolvedValue({ userId: 'usr_1' });
      redis.consumeOnce.mockResolvedValue(true);

      await service.verifyTwoFactor({ twoFactorToken: 'tk', code: totp.generate(secret) });

      expect(redis.del).toHaveBeenCalled();
    });
  });
});
