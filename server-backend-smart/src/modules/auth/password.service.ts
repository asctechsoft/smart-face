import { Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { AppException } from 'src/common/errors';

/**
 * Chính sách mật khẩu.
 *
 * ## Vì sao service này không còn băm mật khẩu
 *
 * Từ khi chuyển sang Firebase Authentication, Backend không giữ mật khẩu nữa —
 * `hash`, `verify` và `needsRehash` (scrypt) đã bị bỏ cùng với cột `passwordHash`.
 * Firebase là nơi lưu và đối chiếu.
 *
 * Nhưng CHÍNH SÁCH thì vẫn ở lại đây, vì Firebase bản không nâng cấp Identity
 * Platform chỉ ép được độ dài tối thiểu 6 ký tự. Bỏ tầng này đi là hạ chuẩn mật
 * khẩu của toàn hệ thống từ 12 ký tự xuống 6.
 *
 * ## Chỗ chính sách này KHÔNG với tới được
 *
 * Chỉ những đường đi QUA Backend mới bị kiểm: cấp tài khoản, và `POST
 * /auth/password/change`. Nếu sau này bật màn hình "quên mật khẩu" mặc định của
 * Firebase, người dùng đặt mật khẩu thẳng trên trang của Firebase và chỉ bị kiểm
 * theo chuẩn của Firebase. Muốn giữ nguyên chuẩn 12 ký tự thì luồng đặt lại mật
 * khẩu cũng phải đi qua Backend.
 */
@Injectable()
export class PasswordService {
  /** Độ dài tối thiểu. Đây là yếu tố có tác dụng thật, không phải quy tắc thành phần. */
  static readonly MIN_LENGTH = 12;

  /** Mật khẩu chỉ gồm chữ số cần dài hơn — 10^15 vẫn dò offline được. */
  static readonly MIN_LENGTH_DIGITS_ONLY = 16;

  static readonly MAX_LENGTH = 128;

  /**
   * Chính sách độ mạnh mật khẩu.
   *
   * ## Vì sao KHÔNG có quy tắc "phải có chữ hoa, số và ký tự đặc biệt"
   *
   * Quy tắc kiểu đó đẩy người dùng tới đúng một khuôn: `Matkhau@123`. Thoả mọi
   * điều kiện mà nằm đầu mọi danh sách dò, vì ai cũng bị ép theo cùng một cách.
   * NIST SP 800-63B đã bỏ khuyến nghị này từ lâu.
   *
   * Thứ thật sự làm mật khẩu khó dò là **độ dài** và **không nằm trong danh
   * sách đã lộ**. Nên ở đây chỉ có: đủ dài, không phải lựa chọn hiển nhiên,
   * không suy ra được từ thông tin cá nhân.
   *
   * `caidenhoihaidongsau` (19 ký tự, toàn chữ thường) mạnh hơn hẳn `Abc@1234`
   * và dễ nhớ hơn nhiều — chính sách này cho phép nó.
   */
  assertStrong(plain: string, context: { email?: string; fullName?: string } = {}): void {
    const reasons: string[] = [];

    if (plain.length < PasswordService.MIN_LENGTH) {
      reasons.push(`Mật khẩu phải dài ít nhất ${PasswordService.MIN_LENGTH} ký tự.`);
    }
    if (plain.length > PasswordService.MAX_LENGTH) {
      reasons.push(`Mật khẩu không được dài quá ${PasswordService.MAX_LENGTH} ký tự.`);
    }
    if (/^\d+$/.test(plain) && plain.length < PasswordService.MIN_LENGTH_DIGITS_ONLY) {
      reasons.push(
        `Mật khẩu chỉ gồm chữ số phải dài ít nhất ${PasswordService.MIN_LENGTH_DIGITS_ONLY} ký tự.`,
      );
    }
    if (/^(.)\1+$/.test(plain)) {
      reasons.push('Mật khẩu không được chỉ gồm một ký tự lặp lại.');
    }

    const lowered = plain.toLowerCase();
    if (COMMON_PASSWORDS.has(lowered)) {
      reasons.push('Mật khẩu này nằm trong danh sách mật khẩu phổ biến.');
    }

    // Kẻ tấn công thử email và tên trước tiên.
    const localPart = context.email?.split('@')[0]?.toLowerCase();
    if (localPart && localPart.length >= 3 && lowered.includes(localPart)) {
      reasons.push('Mật khẩu không được chứa phần đầu địa chỉ email.');
    }

    if (reasons.length > 0) {
      throw new AppException('AUTH_PASSWORD_TOO_WEAK', { reasons });
    }
  }

  /**
   * Sinh mật khẩu tạm cho HR đọc cho nhân viên.
   *
   * Bảng chữ cái bỏ hết ký tự dễ đọc nhầm — `0`/`O`, `1`/`l`/`I` — vì mật khẩu
   * này được đọc qua điện thoại hoặc chép tay từ giấy. Một ký tự chép nhầm là
   * một cuộc gọi nữa cho HR.
   */
  generateTemporary(length = 14): string {
    const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const size = Math.max(length, PasswordService.MIN_LENGTH);

    let result = '';
    for (let index = 0; index < size; index += 1) {
      result += alphabet[randomInt(alphabet.length)];
    }
    return result;
  }
}

/**
 * Danh sách rút gọn — đủ chặn những lựa chọn tệ nhất mà không cần tệp từ điển.
 *
 * Chỉ liệt kê chuỗi từ 12 ký tự trở lên, vì ngắn hơn đã bị chặn bởi độ dài.
 */
const COMMON_PASSWORDS = new Set([
  'password1234',
  'password123456',
  'matkhau123456',
  'qwerty123456',
  'admin1234567',
  'abcd12345678',
  'iloveyou1234',
  '123456789012',
  'smartface123',
  'smartface1234',
  'chamcong1234',
  'congty123456',
]);
