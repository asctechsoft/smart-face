import { Injectable } from '@nestjs/common';
import {
  Company,
  DeviceBinding,
  Employee,
  Prisma,
  RefreshToken,
  UserAccount,
} from '@prisma/client';
import { BaseRepository } from 'src/infra/prisma/base.repository';
import { PrismaService } from 'src/infra/prisma/prisma.service';

export interface CreateRefreshTokenData {
  userId: string;
  tokenHash: string;
  deviceId: string;
  expiresAt: Date;
}

export interface DeviceProfileData {
  deviceModel?: string | null;
  osName?: string | null;
  osVersion?: string | null;
  appVersion?: string | null;
  isRooted?: boolean;
  pushToken?: string | null;
  companyId?: string | null;
}

export type DeviceBindingListItem = Pick<
  DeviceBinding,
  | 'id'
  | 'deviceId'
  | 'deviceModel'
  | 'osName'
  | 'osVersion'
  | 'appVersion'
  | 'isRooted'
  | 'isActive'
  | 'lastSeenAt'
  | 'createdAt'
  | 'revokedAt'
  | 'revokedReason'
>;

/**
 * Truy cập dữ liệu cho toàn bộ module xác thực: `user_account`, `refresh_token`,
 * `device_binding`, cộng vài truy vấn tra cứu sang `company` / `employee`.
 *
 * ## Vì sao đây là chỗ DUY NHẤT không nhận `companyId`
 *
 * Quy ước chung bắt Repository luôn nhận `companyId` (BR-09). Module này là ngoại
 * lệ có chủ đích: nó chạy TRƯỚC khi biết người gọi thuộc công ty nào — chính nó
 * là nơi trả lời câu hỏi đó. Ràng buộc tenant ở đây là `firebaseUid` và `domain`,
 * và việc đối chiếu hai thứ đó (`AuthService.createSession`) là chốt ranh giới
 * công ty duy nhất trong hệ thống.
 *
 * Vì vậy KHÔNG thêm phương thức nghiệp vụ nào vào đây. Cần đọc dữ liệu nhân sự
 * thì gọi repository của module tương ứng, nơi `companyId` là bắt buộc.
 */
@Injectable()
export class AuthRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  // ===========================================================================
  //  UserAccount
  // ===========================================================================

  async findAccountByFirebaseUid(firebaseUid: string): Promise<UserAccount | null> {
    return this.db().userAccount.findFirst({ where: { firebaseUid, deletedAt: null } });
  }

  async findAccountById(userId: string): Promise<UserAccount | null> {
    return this.db().userAccount.findUnique({ where: { id: userId } });
  }

  async findAccountByIdOrThrow(userId: string): Promise<UserAccount> {
    return this.db().userAccount.findUniqueOrThrow({ where: { id: userId } });
  }

  async markLoggedIn(userId: string, at: Date, tx?: Prisma.TransactionClient): Promise<void> {
    await this.db(tx).userAccount.update({ where: { id: userId }, data: { lastLoginAt: at } });
  }

  async markPasswordChanged(
    userId: string,
    at: Date,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await this.db(tx).userAccount.update({
      where: { id: userId },
      data: { mustChangePassword: false, passwordChangedAt: at },
    });
  }

  async enableTwoFactor(
    userId: string,
    data: { phone: string; confirmedAt: Date; recoveryCodeHashes: string[] },
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await this.db(tx).userAccount.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: true,
        twoFactorPhone: data.phone,
        twoFactorConfirmedAt: data.confirmedAt,
        // Chỉ lưu bản băm. Mất điện thoại mà đọc được mã dự phòng từ DB thì lớp
        // xác thực thứ hai không còn ý nghĩa gì.
        twoFactorRecoveryCodes: data.recoveryCodeHashes,
      },
    });
  }

  async disableTwoFactor(userId: string, tx?: Prisma.TransactionClient): Promise<void> {
    await this.db(tx).userAccount.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: false,
        twoFactorPhone: null,
        twoFactorConfirmedAt: null,
        twoFactorRecoveryCodes: [],
      },
    });
  }

  async replaceRecoveryCodes(
    userId: string,
    hashes: string[],
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await this.db(tx).userAccount.update({
      where: { id: userId },
      data: { twoFactorRecoveryCodes: hashes },
    });
  }

  // ===========================================================================
  //  Tra cứu phục vụ đăng nhập
  // ===========================================================================

  async findCompanyByDomain(domain: string): Promise<Company | null> {
    return this.db().company.findUnique({ where: { domain } });
  }

  /**
   * Công ty của một tài khoản, tra thẳng theo id.
   *
   * Dùng khi client KHÔNG gửi `domain` lúc đăng nhập: quan hệ tài khoản–công ty
   * là 1–1 (`UserAccount.companyId`), nên bản thân tài khoản đã đủ để xác định
   * công ty, không cần người dùng gõ lại.
   */
  async findCompanyById(companyId: string): Promise<Company | null> {
    return this.db().company.findUnique({ where: { id: companyId } });
  }

  /** Quan hệ 1–1: tài khoản gắn với đúng một công ty nên đúng một hồ sơ. */
  async findEmployeeByUserId(userId: string): Promise<Employee | null> {
    return this.db().employee.findFirst({ where: { userId, deletedAt: null } });
  }

  /** BR-03 — đã có phương thức xác thực sinh trắc học nào chưa. */
  async countActiveBiometrics(
    employeeId: string,
  ): Promise<{ faces: number; fingerprints: number }> {
    const [faces, fingerprints] = await Promise.all([
      this.db().faceProfile.count({ where: { employeeId, status: 'ACTIVE' } }),
      this.db().biometricKey.count({ where: { employeeId, revokedAt: null } }),
    ]);
    return { faces, fingerprints };
  }

  // ===========================================================================
  //  RefreshToken (AF-16)
  // ===========================================================================

  async createRefreshToken(
    data: CreateRefreshTokenData,
    tx?: Prisma.TransactionClient,
  ): Promise<RefreshToken> {
    return this.db(tx).refreshToken.create({ data });
  }

  async findRefreshTokenByHash(tokenHash: string): Promise<RefreshToken | null> {
    return this.db().refreshToken.findUnique({ where: { tokenHash } });
  }

  async findRefreshTokenIdByHash(tokenHash: string): Promise<{ id: string } | null> {
    return this.db().refreshToken.findUnique({ where: { tokenHash }, select: { id: true } });
  }

  async markRefreshTokenReplaced(
    id: string,
    replacedById: string | undefined,
    revokedAt: Date,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await this.db(tx).refreshToken.update({
      where: { id },
      data: { revokedAt, replacedById },
    });
  }

  async revokeRefreshTokenByHash(
    tokenHash: string,
    reason: string,
    revokedAt: Date,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await this.db(tx).refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt, revokedReason: reason },
    });
    return result.count;
  }

  async revokeRefreshTokensForUser(
    userId: string,
    reason: string,
    revokedAt: Date,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await this.db(tx).refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt, revokedReason: reason },
    });
    return result.count;
  }

  async revokeRefreshTokensForDevice(
    userId: string,
    deviceId: string,
    reason: string,
    revokedAt: Date,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await this.db(tx).refreshToken.updateMany({
      where: { userId, deviceId, revokedAt: null },
      data: { revokedAt, revokedReason: reason },
    });
    return result.count;
  }

  // ===========================================================================
  //  DeviceBinding (BR-11, AF-07)
  // ===========================================================================

  async findDeviceBinding(userId: string, deviceId: string): Promise<DeviceBinding | null> {
    return this.db().deviceBinding.findUnique({ where: { userId_deviceId: { userId, deviceId } } });
  }

  /**
   * Khoá ký HMAC của một thiết bị (AF-12) — dùng bởi `SignatureGuard`.
   *
   * Chỉ trả đúng ba cột cần thiết. Guard chạy trên MỌI request có chữ ký, nên
   * kéo cả hàng về là trả giá bandwidth cho dữ liệu không ai đọc.
   */
  async findDeviceSignatureKey(
    userId: string,
    deviceId: string,
  ): Promise<Pick<DeviceBinding, 'deviceSecretHash' | 'isActive' | 'revokedAt'> | null> {
    return this.db().deviceBinding.findUnique({
      where: { userId_deviceId: { userId, deviceId } },
      select: { deviceSecretHash: true, isActive: true, revokedAt: true },
    });
  }

  async refreshDeviceProfile(
    id: string,
    data: DeviceProfileData & { lastSeenAt: Date },
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await this.db(tx).deviceBinding.update({ where: { id }, data });
  }

  /** BR-11 — chỉ một thiết bị hoạt động tại một thời điểm. */
  async revokeOtherDevices(
    userId: string,
    keepDeviceId: string,
    reason: string,
    revokedAt: Date,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await this.db(tx).deviceBinding.updateMany({
      where: { userId, isActive: true, deviceId: { not: keepDeviceId } },
      data: { isActive: false, revokedAt, revokedReason: reason },
    });
    return result.count;
  }

  async upsertDeviceBinding(
    userId: string,
    deviceId: string,
    data: DeviceProfileData & { deviceSecretHash: string; lastSeenAt: Date },
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const { companyId, ...profile } = data;
    await this.db(tx).deviceBinding.upsert({
      where: { userId_deviceId: { userId, deviceId } },
      create: {
        userId,
        companyId,
        deviceId,
        ...profile,
        isRooted: profile.isRooted ?? false,
        isActive: true,
      },
      update: {
        companyId,
        ...profile,
        isRooted: profile.isRooted ?? false,
        isActive: true,
        revokedAt: null,
        revokedReason: null,
      },
    });
  }

  async touchDeviceBinding(userId: string, deviceId: string, at: Date): Promise<void> {
    await this.db()
      .deviceBinding.updateMany({ where: { userId, deviceId }, data: { lastSeenAt: at } })
      .catch(() => undefined);
  }

  async listDeviceBindings(userId: string): Promise<DeviceBindingListItem[]> {
    return this.db().deviceBinding.findMany({
      where: { userId },
      orderBy: [{ isActive: 'desc' }, { lastSeenAt: 'desc' }],
      select: {
        id: true,
        deviceId: true,
        deviceModel: true,
        osName: true,
        osVersion: true,
        appVersion: true,
        isRooted: true,
        isActive: true,
        lastSeenAt: true,
        createdAt: true,
        revokedAt: true,
        revokedReason: true,
      },
    });
  }

  async revokeDeviceBinding(
    userId: string,
    deviceId: string,
    revokedBy: string,
    reason: string,
    revokedAt: Date,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await this.db(tx).deviceBinding.updateMany({
      where: { userId, deviceId },
      data: { isActive: false, revokedAt, revokedBy, revokedReason: reason },
    });
    return result.count;
  }

  /** Khoá vân tay gắn với thiết bị bị thu hồi cũng phải vô hiệu (BR-11). */
  async revokeBiometricKeysForDevice(
    userId: string,
    deviceId: string,
    reason: string,
    revokedAt: Date,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await this.db(tx).biometricKey.updateMany({
      where: { deviceId, revokedAt: null, employee: { userId } },
      data: { revokedAt, revokedReason: reason },
    });
    return result.count;
  }
}
