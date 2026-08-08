import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Xác thực 2 lớp bằng TOTP — RFC 6238 (dựa trên HOTP, RFC 4226).
 *
 * Tương thích Google Authenticator, Microsoft Authenticator, Authy, 1Password.
 *
 * ## Vì sao tự cài thay vì dùng thư viện
 *
 * Thuật toán chỉ là `HMAC-SHA1(secret, counter)` rồi cắt lấy 6 chữ số — khoảng
 * 30 dòng. Đổi lại là thêm một phụ thuộc vào đúng đường xác thực. Cách duy nhất
 * để yên tâm với bản tự cài là kiểm chứng bằng **vector thử chuẩn trong RFC**,
 * và đó chính là việc `totp.service.spec.ts` làm.
 *
 * ## SHA-1 ở đây không phải lỗi
 *
 * RFC 6238 mặc định HMAC-SHA1 và mọi ứng dụng xác thực phổ biến đều mặc định
 * như vậy. Điểm yếu va chạm của SHA-1 không ảnh hưởng tới HMAC. Đổi sang SHA-256
 * sẽ làm phần lớn ứng dụng quét mã QR xong sinh sai mã.
 */
@Injectable()
export class TotpService {
  private readonly digits = 6;
  private readonly periodSeconds = 30;

  /**
   * Số bước thời gian chấp nhận lệch về hai phía.
   *
   * 1 nghĩa là chấp nhận mã của bước trước, hiện tại và sau — tổng 90 giây.
   * Cần khoảng này vì đồng hồ điện thoại hay lệch vài giây, và người dùng mất
   * thời gian gõ. Nới rộng hơn thì cửa sổ đoán mò của kẻ tấn công cũng rộng ra.
   */
  private readonly window = 1;

  /** Secret base32 32 ký tự = 160 bit, đúng khuyến nghị RFC 4226. */
  generateSecret(): string {
    return base32Encode(randomBytes(20));
  }

  /**
   * URI để dựng mã QR (định dạng `otpauth://` của Key Uri Format).
   *
   * `issuer` xuất hiện cả ở tiền tố nhãn lẫn tham số truy vấn — vài ứng dụng
   * chỉ đọc một trong hai chỗ.
   */
  buildOtpAuthUri(secret: string, accountName: string, issuer: string): string {
    const label = encodeURIComponent(`${issuer}:${accountName}`);
    const params = new URLSearchParams({
      secret,
      issuer,
      algorithm: 'SHA1',
      digits: String(this.digits),
      period: String(this.periodSeconds),
    });
    return `otpauth://totp/${label}?${params.toString()}`;
  }

  /** Mã tại một thời điểm. `atMs` để test; production luôn dùng giờ hiện tại. */
  generate(secret: string, atMs: number = Date.now()): string {
    return this.hotp(secret, Math.floor(atMs / 1000 / this.periodSeconds));
  }

  /**
   * Kiểm mã người dùng nhập.
   *
   * Trả về chỉ số bước đã khớp (`-1`, `0`, `1`) hoặc `null` nếu không khớp.
   * Trả chỉ số thay vì boolean là có chủ đích: tầng gọi cần lưu lại bước đã
   * dùng để chặn dùng lại cùng một mã trong 90 giây — không có chốt đó thì kẻ
   * nhìn trộm màn hình gõ lại được ngay mã vừa thấy.
   */
  verify(secret: string, code: string, atMs: number = Date.now()): number | null {
    const cleaned = code.replace(/\s/g, '');
    if (!new RegExp(`^\\d{${this.digits}}$`).test(cleaned)) return null;

    const counter = Math.floor(atMs / 1000 / this.periodSeconds);

    for (let offset = -this.window; offset <= this.window; offset += 1) {
      const expected = this.hotp(secret, counter + offset);
      // So sánh chống timing attack — mã chỉ có một triệu khả năng, rò rỉ thời
      // gian từng chữ số sẽ thu hẹp không gian tìm kiếm đáng kể.
      if (safeEqual(expected, cleaned)) return offset;
    }
    return null;
  }

  /**
   * Mã dự phòng dùng khi mất thiết bị.
   *
   * Trả về mã dạng gốc để hiển thị MỘT LẦN cho người dùng lưu lại; chỉ bản băm
   * mới được ghi xuống cơ sở dữ liệu.
   */
  generateRecoveryCodes(count = 8): string[] {
    const codes: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const part = () =>
        Array.from({ length: 4 }, () => '23456789abcdefghjkmnpqrstuvwxyz'[randomInt(31)]).join('');
      codes.push(`${part()}-${part()}`);
    }
    return codes;
  }

  // ---------------------------------------------------------------------------

  /** HOTP — RFC 4226 mục 5.3. */
  private hotp(secret: string, counter: number): string {
    const key = base32Decode(secret);

    // Bộ đếm là số nguyên 8 byte big-endian.
    const buffer = Buffer.alloc(8);
    buffer.writeBigUInt64BE(BigInt(Math.max(counter, 0)));

    const digest = createHmac('sha1', key).update(buffer).digest();

    // Cắt động: 4 bit cuối cho biết bắt đầu đọc từ đâu.
    const offset = digest[digest.length - 1] & 0x0f;
    const binary =
      ((digest[offset] & 0x7f) << 24) |
      ((digest[offset + 1] & 0xff) << 16) |
      ((digest[offset + 2] & 0xff) << 8) |
      (digest[offset + 3] & 0xff);

    return (binary % 10 ** this.digits).toString().padStart(this.digits, '0');
  }
}

// ---------------------------------------------------------------------------
//  Base32 (RFC 4648) — định dạng mà ứng dụng xác thực dùng cho secret
// ---------------------------------------------------------------------------

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(encoded: string): Buffer {
  // Bỏ padding và khoảng trắng: người dùng hay chép secret kèm dấu cách.
  const cleaned = encoded.toUpperCase().replace(/[=\s-]/g, '');

  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (const character of cleaned) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index === -1) {
      throw new Error(`Ký tự base32 không hợp lệ: ${character}`);
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
