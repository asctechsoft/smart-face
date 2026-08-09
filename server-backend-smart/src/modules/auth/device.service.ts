import { Injectable, Logger } from '@nestjs/common';
import { AppException } from 'src/common/errors';
import { randomToken, sha256 } from 'src/common/utils';
import { AuthRepository } from './auth.repository';
import { PolicyService } from '../policy/policy.service';
import { PolicyKeys } from '../policy/policy.constants';
import type { DeviceInfoDto } from './dto/auth.dto';

export interface DeviceLinkResult {
  /** Chỉ trả về khi liên kết thiết bị MỚI — App lưu vào secure enclave. */
  deviceSecret?: string;
  isNewDevice: boolean;
  previousDeviceRevoked: boolean;
}

/**
 * Device binding — BR-11, AF-07.
 *
 * "Mỗi tài khoản chỉ kích hoạt sinh trắc học trên 1 thiết bị tại 1 thời điểm."
 *
 * Khi đăng nhập trên thiết bị mới: thu hồi liên kết thiết bị cũ, cấp deviceSecret
 * mới, ghi audit. Nhân viên phải xác thực lại sinh trắc học trên máy mới.
 */
@Injectable()
export class DeviceService {
  private readonly logger = new Logger(DeviceService.name);

  constructor(
    private readonly devices: AuthRepository,
    private readonly policy: PolicyService,
  ) {}

  /**
   * Liên kết thiết bị với tài khoản.
   *
   * `deviceSecret` được cấp một lần; server chỉ lưu `sha256(deviceSecret)`.
   * App ký HMAC bằng chính hash này (xem SignatureGuard) — nhờ vậy server không
   * bao giờ giữ giá trị gốc mà vẫn xác minh được chữ ký.
   */
  async link(
    userId: string,
    deviceId: string,
    info: DeviceInfoDto | undefined,
    companyId: string | null,
  ): Promise<DeviceLinkResult> {
    const existing = await this.devices.findDeviceBinding(userId, deviceId);

    if (existing && existing.isActive && !existing.revokedAt) {
      await this.devices.refreshDeviceProfile(existing.id, {
        lastSeenAt: new Date(),
        deviceModel: info?.model ?? existing.deviceModel,
        osName: info?.os ?? existing.osName,
        osVersion: info?.osVersion ?? existing.osVersion,
        appVersion: info?.appVersion ?? existing.appVersion,
        isRooted: info?.isRooted ?? existing.isRooted,
        pushToken: info?.pushToken ?? existing.pushToken,
        companyId: companyId ?? existing.companyId,
      });
      // Thiết bị đã liên kết và còn hiệu lực → chỉ cập nhật thông tin, KHÔNG cấp
      // `deviceSecret` mới. Cấp lại mỗi lần đăng nhập sẽ làm hỏng chữ ký HMAC
      // đang lưu trong secure enclave của App.
      return { isNewDevice: false, previousDeviceRevoked: false };
    }

    // BR-11: chỉ một thiết bị hoạt động tại một thời điểm.
    //
    // Tắt được theo công ty vì không phải nơi nào cũng phù hợp — có công ty
    // dùng máy tính bảng dùng chung đặt ở cửa ra vào. Nhưng bật là mặc định, vì
    // đây chính là chốt chặn kịch bản đưa tài khoản cho người khác chấm hộ.
    const bindingEnabled = companyId
      ? await this.policy.getBoolean(companyId, PolicyKeys.DEVICE_BINDING_ENABLED)
      : true;

    let previousDeviceRevoked = false;
    if (bindingEnabled) {
      const revokedCount = await this.devices.revokeOtherDevices(
        userId,
        deviceId,
        'NEW_DEVICE_LINKED',
        new Date(),
      );
      previousDeviceRevoked = revokedCount > 0;

      if (previousDeviceRevoked) {
        this.logger.log(`Thu hồi ${revokedCount} thiết bị cũ của user ${userId} (BR-11)`);
      }
    }

    // 32 byte ngẫu nhiên — đây là bí mật DUY NHẤT phân biệt thiết bị thật với
    // kẻ đã cầm được access token. Nó không bao giờ đi kèm token, chỉ nằm trong
    // secure enclave của máy.
    const deviceSecret = randomToken(32);

    await this.devices.upsertDeviceBinding(userId, deviceId, {
      companyId,
      deviceModel: info?.model,
      osName: info?.os,
      osVersion: info?.osVersion,
      appVersion: info?.appVersion,
      isRooted: info?.isRooted ?? false,
      pushToken: info?.pushToken,
      deviceSecretHash: sha256(deviceSecret),
      lastSeenAt: new Date(),
    });

    // ⚠ CHÚ Ý KỸ CHỖ NÀY: trả về `sha256(deviceSecret)`, KHÔNG phải giá trị gốc.
    //
    // Nghĩa là App và server cùng dùng bản BĂM làm khoá ký HMAC, còn `deviceSecret`
    // gốc bị vứt bỏ ngay tại đây, không ai giữ. Đây là quy ước thống nhất với
    // `SignatureGuard`, không phải nhầm lẫn.
    //
    // Đổi dòng này thành `deviceSecret` gốc sẽ khiến MỌI chữ ký từ App không còn
    // khớp, và toàn bộ hệ thống chấm công dừng hoạt động.
    return { deviceSecret: sha256(deviceSecret), isNewDevice: true, previousDeviceRevoked };
  }

  async assertActive(userId: string, deviceId: string): Promise<void> {
    const device = await this.devices.findDeviceBinding(userId, deviceId);
    if (!device || !device.isActive || device.revokedAt) {
      throw new AppException('FRAUD_UNKNOWN_DEVICE');
    }
  }

  async touch(userId: string, deviceId: string): Promise<void> {
    await this.devices.touchDeviceBinding(userId, deviceId, new Date());
  }

  /** FR-WEB-INV-06 — danh sách thiết bị đã liên kết của một nhân viên. */
  async listForUser(userId: string) {
    return this.devices.listDeviceBindings(userId);
  }

  /** FR-ADM-USR-04 — thu hồi liên kết thiết bị (mất máy, đổi máy). */
  async revoke(userId: string, deviceId: string, revokedBy: string, reason: string) {
    const revokedAt = new Date();
    const revoked = await this.devices.revokeDeviceBinding(
      userId,
      deviceId,
      revokedBy,
      reason,
      revokedAt,
    );

    // Khoá vân tay gắn với thiết bị này cũng phải vô hiệu (BR-11).
    await this.devices.revokeBiometricKeysForDevice(userId, deviceId, reason, revokedAt);

    return { revoked };
  }
}
