import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { maskPhone } from 'src/common/utils';

/**
 * SMS Gateway — FR-ADM-CFG-01.
 *
 * `SMS_PROVIDER=console` (mặc định dev): chỉ log ra console, không gửi thật.
 * `SMS_PROVIDER=esms`: gọi eSMS.
 *
 * Thêm nhà cung cấp mới = thêm một nhánh trong `dispatch()`, không sửa chỗ gọi.
 * NFR-OBS-08: KHÔNG log nội dung OTP, chỉ log số điện thoại đã che.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(private readonly config: ConfigService) {}

  async sendOtp(phone: string, code: string, ttlSeconds: number): Promise<void> {
    const minutes = Math.ceil(ttlSeconds / 60);
    const brand = this.config.get<string>('sms.brandName', 'SmartFace');
    await this.dispatch(
      phone,
      `${brand}: Ma xac thuc cua ban la ${code}. Ma co hieu luc trong ${minutes} phut. Khong chia se ma nay cho bat ky ai.`,
      { isOtp: true },
    );
  }

  async sendInvite(phone: string, companyName: string, employeeCode: string): Promise<void> {
    const brand = this.config.get<string>('sms.brandName', 'SmartFace');
    await this.dispatch(
      phone,
      `${brand}: Ban duoc moi tham gia cham cong tai ${companyName}. Ma nhan vien: ${employeeCode}. Tai app va dang nhap bang so dien thoai nay de bat dau.`,
    );
  }

  private async dispatch(
    phone: string,
    content: string,
    options: { isOtp?: boolean } = {},
  ): Promise<void> {
    const provider = this.config.get<string>('sms.provider', 'console');

    if (provider === 'console') {
      this.logger.log(
        options.isOtp
          ? `[SMS:console] → ${maskPhone(phone)}: (nội dung OTP đã ẩn)`
          : `[SMS:console] → ${maskPhone(phone)}: ${content}`,
      );
      return;
    }

    if (provider === 'esms') {
      await this.sendViaEsms(phone, content);
      return;
    }

    this.logger.warn(`Nhà cung cấp SMS chưa hỗ trợ: ${provider}`);
  }

  private async sendViaEsms(phone: string, content: string): Promise<void> {
    const apiUrl = this.config.get<string>('sms.apiUrl');
    const apiKey = this.config.get<string>('sms.apiKey');
    const secretKey = this.config.get<string>('sms.secretKey');
    const brandName = this.config.get<string>('sms.brandName');

    if (!apiUrl || !apiKey || !secretKey) {
      this.logger.error('Thiếu cấu hình eSMS — bỏ qua việc gửi tin nhắn');
      return;
    }

    // Ném lỗi khi thất bại để BullMQ retry theo backoff mũ (docs/02 mục 10).
    await axios.post(
      apiUrl,
      {
        Phone: phone,
        Content: content,
        ApiKey: apiKey,
        SecretKey: secretKey,
        Brandname: brandName,
        SmsType: '2',
      },
      { timeout: 10_000 },
    );

    this.logger.log(`[SMS:esms] đã gửi tới ${maskPhone(phone)}`);
  }
}
