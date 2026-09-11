// `firebase-admin` kéo theo `jose` (chỉ phát hành ESM) — Jest ở đây chạy
// CommonJS nên nạp thẳng sẽ chết lúc parse. Service dưới đây nhận FirebaseService
// dạng mock, nên chặn cả cây phụ thuộc là đủ. Cùng cách với auth.service.spec.ts.
jest.mock('firebase-admin/app', () => ({
  initializeApp: jest.fn(),
  cert: jest.fn(),
  deleteApp: jest.fn(),
}));
jest.mock('firebase-admin/auth', () => ({ getAuth: jest.fn() }));

import { ProvisioningService } from './provisioning.service';

/**
 * Khởi tạo quản trị viên nền tảng đầu tiên (`POST /v1/platform/bootstrap`).
 *
 * Đây là đường DUY NHẤT để có tài khoản đăng nhập đầu tiên trên production —
 * seed thì cấm chạy ở đó. Bản trước tạo tài khoản thiếu `isSystemAdmin`, và
 * `AuthService.resolveCompanyForLogin` từ chối mọi tài khoản `companyId = null`
 * không mang cờ này: tạo xong trơn tru, rồi không bao giờ đăng nhập được.
 */
describe('ProvisioningService.bootstrapPlatform', () => {
  const input = {
    fullName: 'Nguyễn Văn An',
    email: '  Admin@SmartFace.vn ',
    phone: '0901234567',
    password: 'Str0ng!Passw0rd',
  };

  let prisma: { userAccount: { count: jest.Mock; create: jest.Mock } };
  let firebase: { createUser: jest.Mock; deleteUser: jest.Mock };
  let passwords: { assertStrong: jest.Mock };
  let audit: { recordSystem: jest.Mock };
  let service: ProvisioningService;

  beforeEach(() => {
    prisma = {
      userAccount: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({
          id: 'usr_1',
          email: 'admin@smartface.vn',
          fullName: input.fullName,
        }),
      },
    };
    firebase = {
      createUser: jest.fn().mockResolvedValue('fb_uid_1'),
      deleteUser: jest.fn().mockResolvedValue(undefined),
    };
    passwords = { assertStrong: jest.fn() };
    audit = { recordSystem: jest.fn().mockResolvedValue(undefined) };
    const config = { get: jest.fn((_key: string, fallback: unknown) => fallback) };

    service = new ProvisioningService(
      prisma as never,
      {} as never,
      firebase as never,
      passwords as never,
      {} as never,
      {} as never,
      audit as never,
      config as never,
    );
  });

  it('tạo tài khoản mang cờ isSystemAdmin — thiếu cờ này là không đăng nhập được', async () => {
    await service.bootstrapPlatform(input);

    expect(prisma.userAccount.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: null,
          email: 'admin@smartface.vn',
          firebaseUid: 'fb_uid_1',
          isSystemAdmin: true,
        }),
      }),
    );
  });

  it('từ chối khi đã có quản trị viên nền tảng, không đụng tới Firebase', async () => {
    prisma.userAccount.count.mockResolvedValue(1);

    await expect(service.bootstrapPlatform(input)).rejects.toMatchObject({
      code: 'PLATFORM_ALREADY_BOOTSTRAPPED',
    });
    expect(firebase.createUser).not.toHaveBeenCalled();
  });

  it('ghi DB lỗi thì xoá tài khoản Firebase vừa tạo, không để lại danh tính mồ côi', async () => {
    prisma.userAccount.create.mockRejectedValue(new Error('db down'));

    await expect(service.bootstrapPlatform(input)).rejects.toThrow('db down');
    expect(firebase.deleteUser).toHaveBeenCalledWith('fb_uid_1');
  });
});
