import { Test } from '@nestjs/testing';
import { AppException } from 'src/common/errors';
import { TransactionManager } from 'src/infra/prisma/transaction.manager';
import { RedisService } from 'src/infra/redis/redis.service';
import { StorageService } from 'src/infra/storage/storage.service';
import { AiGatewayService } from '../ai-gateway/ai-gateway.service';
import { AuditService } from '../audit/audit.service';
import { NotificationService } from '../notification/notification.service';
import { PolicyKeys } from '../policy/policy.constants';
import { PolicyService } from '../policy/policy.service';
import { BiometricRepository } from './biometric.repository';
import { BiometricService } from './biometric.service';
import type { TenantContext } from 'src/common/types/request-context';

/**
 * Đăng ký khuôn mặt — trọng tâm là ranh giới giữa ĐĂNG KÝ LẦN ĐẦU và ĐĂNG KÝ ĐÈ.
 *
 * Kịch bản tấn công mà bộ test này canh giữ:
 *
 *   Kẻ tấn công cầm được điện thoại đang đăng nhập của nạn nhân (hoặc lấy được
 *   token còn hạn). Hắn KHÔNG cần gọi `DELETE /biometric/face` — nơi đã có chốt
 *   xác thực lại. Hắn chỉ cần gọi `face/enroll/start` rồi chụp 4 tấm ảnh của
 *   chính mình. Hồ sơ cũ bị đánh dấu REPLACED, hồ sơ của hắn thành ACTIVE, và
 *   từ đó hắn chấm công thay nạn nhân vĩnh viễn.
 *
 * Chốt chặn nằm ở `startFaceEnrollment`, không phải ở bước submit: chặn sớm thì
 * người dùng không mất công chụp xong 4 ảnh mới bị từ chối.
 */
describe('BiometricService — đăng ký khuôn mặt', () => {
  let service: BiometricService;

  const biometrics = {
    countActiveFaceProfiles: jest.fn(),
    findOtherActiveEmbeddings: jest.fn(),
    findEmployee: jest.fn(),
    findEmployeeCode: jest.fn(),
    activateIfPending: jest.fn(),
    findFingerprintKey: jest.fn(),
    upsertFingerprintKey: jest.fn(),
  };
  // Ranh giới transaction thật do TransactionManager giữ; ở test chỉ cần chạy
  // thẳng callback để lời gọi repository bên trong vẫn được ghi nhận.
  const transactions = {
    run: jest.fn((handler: (tx: unknown) => unknown) => handler({})),
  };
  const redis = { setJson: jest.fn(), getJson: jest.fn(), del: jest.fn() };
  const ai = { randomLivenessAction: jest.fn().mockReturnValue('BLINK') };
  const policy = { getNumber: jest.fn(), getBoolean: jest.fn() };

  const ctx: TenantContext = {
    userId: 'usr_1',
    employeeId: 'emp_1',
    companyId: 'cmp_1',
    roles: ['EMPLOYEE'],
    deviceId: 'dev_1',
    isSystemAdmin: false,
    scopeDepartmentIds: [],
  } as unknown as TenantContext;

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        BiometricService,
        { provide: BiometricRepository, useValue: biometrics },
        { provide: TransactionManager, useValue: transactions },
        { provide: RedisService, useValue: redis },
        { provide: AiGatewayService, useValue: ai },
        { provide: PolicyService, useValue: policy },
        { provide: StorageService, useValue: {} },
        { provide: AuditService, useValue: { record: jest.fn() } },
        { provide: NotificationService, useValue: { notify: jest.fn(), broadcast: jest.fn() } },
      ],
    }).compile();

    service = moduleRef.get(BiometricService);

    biometrics.findEmployee.mockResolvedValue({
      id: 'emp_1',
      companyId: 'cmp_1',
      fullName: 'Nguyễn Văn Đức',
    });
    biometrics.activateIfPending.mockResolvedValue(undefined);
    biometrics.findFingerprintKey.mockResolvedValue(null);
    biometrics.upsertFingerprintKey.mockResolvedValue({ id: 'bio_1', createdAt: new Date() });
    transactions.run.mockImplementation((handler: (tx: unknown) => unknown) => handler({}));
    policy.getNumber.mockResolvedValue(112);
  });

  // ===========================================================================
  //  Đăng ký lần đầu — luồng onboarding, phải đi thẳng
  // ===========================================================================

  describe('đăng ký lần đầu (onboarding)', () => {
    beforeEach(() => {
      biometrics.countActiveFaceProfiles.mockResolvedValue(0);
    });

    it('không đòi xác thực lại', async () => {
      const result = await service.startFaceEnrollment(ctx);

      expect(result.sessionId).toMatch(/^enr_/);
      expect(result.isReEnrollment).toBe(false);
    });

    it('trả đúng 4 bước theo docs/08 mục 3', async () => {
      const { steps } = await service.startFaceEnrollment(ctx);

      expect(steps).toHaveLength(4);
      expect(steps.map((step) => step.angle)).toEqual(['FRONT', 'LEFT', 'RIGHT', 'FRONT']);
    });

    it('bước cuối kèm hành động liveness do SERVER chọn (AF-05)', async () => {
      const { steps } = await service.startFaceEnrollment(ctx);

      // App không được tự chọn: tự chọn thì kẻ gian patch app để luôn chọn
      // đúng hành động đã quay sẵn video.
      expect(ai.randomLivenessAction).toHaveBeenCalled();
      expect(steps[3].action).toBe('BLINK');
    });

    it('trả ngưỡng kích thước mặt của công ty để App hướng dẫn người dùng', async () => {
      const { guidance } = await service.startFaceEnrollment(ctx);

      expect(policy.getNumber).toHaveBeenCalledWith('cmp_1', PolicyKeys.FACE_MIN_PIXELS);
      expect(guidance.minFacePixels).toBe(112);
    });

    it('lưu phiên vào Redis với TTL 5 phút', async () => {
      await service.startFaceEnrollment(ctx);

      const [, session, ttl] = redis.setJson.mock.calls[0];
      expect(ttl).toBe(300);
      expect(session).toMatchObject({
        employeeId: 'emp_1',
        companyId: 'cmp_1',
        isReEnrollment: false,
      });
    });
  });

  // ===========================================================================
  //  Đăng ký ĐÈ — bắt buộc xác thực lại
  // ===========================================================================

  describe('đăng ký đè lên hồ sơ đang có', () => {
    beforeEach(() => {
      biometrics.countActiveFaceProfiles.mockResolvedValue(4);
    });

    it('CHẶN khi không có reauthToken', async () => {
      await expect(service.startFaceEnrollment(ctx)).rejects.toThrow(AppException);

      await expect(service.startFaceEnrollment(ctx)).rejects.toMatchObject({
        code: 'AUTH_REAUTH_REQUIRED',
      });
    });

    it('KHÔNG tạo phiên nào khi bị chặn', async () => {
      await expect(service.startFaceEnrollment(ctx)).rejects.toThrow();

      // Tạo phiên rồi mới chặn ở bước submit là sai: người dùng chụp xong 4 ảnh
      // mới biết mình bị từ chối, còn kẻ tấn công vẫn dò được là nạn nhân đã
      // đăng ký khuôn mặt hay chưa.
      expect(redis.setJson).not.toHaveBeenCalled();
    });

    it('CHO QUA khi đã xác thực lại', async () => {
      const result = await service.startFaceEnrollment(ctx, { reauthVerified: true });

      expect(result.sessionId).toMatch(/^enr_/);
      expect(result.isReEnrollment).toBe(true);
    });

    it('đánh dấu isReEnrollment vào phiên để bước hoàn tất báo HR', async () => {
      await service.startFaceEnrollment(ctx, { reauthVerified: true });

      const [, session] = redis.setJson.mock.calls[0];
      expect(session.isReEnrollment).toBe(true);
    });

    it('chỉ đếm hồ sơ ACTIVE — hồ sơ đã REVOKED không tính là đang có', async () => {
      // Nhân viên bị HR reset khuôn mặt thì phải đăng ký lại được ngay, không
      // phải xin OTP lần nữa.
      await service.startFaceEnrollment(ctx, { reauthVerified: true });

      // Bộ lọc `status = ACTIVE` nằm trong BiometricRepository — service chỉ hỏi
      // "có bao nhiêu hồ sơ đang dùng", không tự dựng điều kiện truy vấn.
      expect(biometrics.countActiveFaceProfiles).toHaveBeenCalledWith('cmp_1', 'emp_1');
    });
  });

  // ===========================================================================
  //  Ràng buộc chung
  // ===========================================================================

  it('không cho đăng ký khi chưa thuộc công ty nào', async () => {
    const noCompany = { ...ctx, employeeId: null } as unknown as TenantContext;

    await expect(service.startFaceEnrollment(noCompany)).rejects.toMatchObject({
      code: 'AUTH_COMPANY_REQUIRED',
    });
  });

  it('không cho đăng ký hộ nhân viên của công ty khác', async () => {
    biometrics.findEmployee.mockResolvedValue(null);

    await expect(service.startFaceEnrollment(ctx)).rejects.toMatchObject({
      code: 'EMP_NOT_FOUND',
    });
  });

  // ===========================================================================
  //  Đăng ký vân tay — chốt deviceId phải trùng thiết bị trong token
  // ===========================================================================

  describe('đăng ký vân tay', () => {
    const PEM = '-----BEGIN PUBLIC KEY-----\nMFkwEw...\n-----END PUBLIC KEY-----';

    /**
     * Kịch bản tấn công được canh giữ:
     *
     *   Kẻ tấn công lấy được access token của nạn nhân (từ log, bản sao lưu máy,
     *   proxy). Token gắn với thiết bị D1 của nạn nhân. Hắn gọi endpoint này với
     *   deviceId của MÁY HẮN (D2) và public key của hắn, rồi chấm công bằng vân
     *   tay từ máy mình.
     *
     *   Mã hoá payload token KHÔNG chặn được kịch bản này — hắn không cần đọc
     *   token, chỉ cần gửi lại nguyên xi.
     */
    it('CHẶN khi deviceId khác thiết bị trong token', async () => {
      await expect(
        service.registerFingerprint(ctx, 'may_cua_ke_tan_cong', PEM, 'ES256'),
      ).rejects.toMatchObject({ code: 'AUTH_REAUTH_REQUIRED' });

      expect(biometrics.upsertFingerprintKey).not.toHaveBeenCalled();
    });

    it('CHO QUA khi deviceId khác nhưng đã xác thực lại', async () => {
      await expect(
        service.registerFingerprint(ctx, 'may_khac', PEM, 'ES256', undefined, {
          reauthVerified: true,
        }),
      ).resolves.toMatchObject({ keyId: 'bio_1' });
    });

    it('CHO QUA khi đăng ký cho chính thiết bị đang đăng nhập — không phiền người dùng thật', async () => {
      // App luôn đăng ký cho máy nó đang chạy. Đổi điện thoại thì đăng nhập lại,
      // token mới mang deviceId mới, hai bên vẫn khớp. Chốt này không tạo ma sát.
      await expect(service.registerFingerprint(ctx, 'dev_1', PEM, 'ES256')).resolves.toMatchObject({
        keyId: 'bio_1',
      });
    });

    it('CHẶN khi token không gắn thiết bị (token của Web)', async () => {
      const webCtx = { ...ctx, deviceId: null } as unknown as TenantContext;

      await expect(
        service.registerFingerprint(webCtx, 'dev_1', PEM, 'ES256'),
      ).rejects.toMatchObject({ code: 'AUTH_DEVICE_MISMATCH' });
    });

    it('từ chối publicKey không phải PEM', async () => {
      await expect(
        service.registerFingerprint(ctx, 'dev_1', 'khong-phai-pem', 'ES256'),
      ).rejects.toMatchObject({ code: 'SYS_VALIDATION_ERROR' });
    });

    it('KHÔNG nhận private key — chỉ kiểm và lưu public key', async () => {
      const privateKey = '-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----';

      await expect(
        service.registerFingerprint(ctx, 'dev_1', privateKey, 'ES256'),
      ).rejects.toMatchObject({ code: 'SYS_VALIDATION_ERROR' });
    });

    it('thay khoá trên thiết bị đã có → báo HR', async () => {
      biometrics.findFingerprintKey.mockResolvedValue({
        publicKey: '-----BEGIN PUBLIC KEY-----\nKHOA_CU\n-----END PUBLIC KEY-----',
        revokedAt: null,
      });

      const notifications = { notify: jest.fn(), broadcast: jest.fn() };
      const moduleRef = await Test.createTestingModule({
        providers: [
          BiometricService,
          { provide: BiometricRepository, useValue: biometrics },
          { provide: TransactionManager, useValue: transactions },
          { provide: RedisService, useValue: redis },
          { provide: AiGatewayService, useValue: ai },
          { provide: PolicyService, useValue: policy },
          { provide: StorageService, useValue: {} },
          { provide: AuditService, useValue: { record: jest.fn() } },
          { provide: NotificationService, useValue: notifications },
        ],
      }).compile();

      await moduleRef.get(BiometricService).registerFingerprint(ctx, 'dev_1', PEM, 'ES256');

      // Không phân biệt được "người dùng đăng ký lại vân tay ở tầng OS" với
      // "ai đó cầm được máy và thêm vân tay của mình" — phải báo để có người xem.
      expect(notifications.broadcast).toHaveBeenCalled();
    });

    it('đăng ký LẦN ĐẦU trên một thiết bị thì KHÔNG báo HR', async () => {
      biometrics.findFingerprintKey.mockResolvedValue(null);

      const notifications = { notify: jest.fn(), broadcast: jest.fn() };
      const moduleRef = await Test.createTestingModule({
        providers: [
          BiometricService,
          { provide: BiometricRepository, useValue: biometrics },
          { provide: TransactionManager, useValue: transactions },
          { provide: RedisService, useValue: redis },
          { provide: AiGatewayService, useValue: ai },
          { provide: PolicyService, useValue: policy },
          { provide: StorageService, useValue: {} },
          { provide: AuditService, useValue: { record: jest.fn() } },
          { provide: NotificationService, useValue: notifications },
        ],
      }).compile();

      await moduleRef.get(BiometricService).registerFingerprint(ctx, 'dev_1', PEM, 'ES256');

      // Báo mỗi lần onboarding chỉ tạo nhiễu khiến HR bỏ qua cảnh báo thật.
      expect(notifications.broadcast).not.toHaveBeenCalled();
    });
  });
});
