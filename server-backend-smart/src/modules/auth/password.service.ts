import { Injectable } from '@nestjs/common';
import { randomBytes, randomInt, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { promisify } from 'node:util';
import { AppException } from 'src/common/errors';

/**
 * `promisify` chọn overload 3 tham số của `scrypt` nên mất mất tham số
 * `options` — mà đó lại là chỗ đặt `maxmem`, thứ bắt buộc phải nới rộng.
 * Khai báo lại kiểu cho đúng chữ ký thật.
 */
const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * Băm và kiểm tra mật khẩu.
 *
 * ## Vì sao scrypt chứ không phải bcrypt/argon2
 *
 * scrypt nằm sẵn trong `node:crypto`, không cần thư viện biên dịch native. Đây
 * là lựa chọn có chủ đích: `bcrypt` và `argon2` đều phải build bằng node-gyp,
 * và một phụ thuộc native hỏng build là thứ chặn đứng cả pipeline vào đúng lúc
 * cần deploy gấp. scrypt là hàm dẫn xuất khoá đúng nghĩa — tốn cả CPU lẫn bộ
 * nhớ, nên đắt với người bẻ khoá bằng GPU/ASIC.
 *
 * ## Định dạng lưu
 *
 * ```
 * scrypt$N$r$p$<salt base64url>$<hash base64url>
 * ```
 *
 * Tham số nằm ngay trong chuỗi, không hard-code ở chỗ đọc. Nhờ vậy nâng tham số
 * về sau vẫn kiểm được mật khẩu cũ, và `needsRehash()` cho biết khi nào nên băm
 * lại lúc người dùng đăng nhập thành công.
 */
@Injectable()
export class PasswordService {
  /** Chi phí CPU/bộ nhớ. N=2^16 tốn ~64MB mỗi lần băm. */
  private readonly cost = 2 ** 16;
  private readonly blockSize = 8;
  private readonly parallelization = 1;
  private readonly keyLength = 64;
  private readonly saltLength = 16;

  /**
   * `maxmem` phải nới rộng hơn nhu cầu thật.
   *
   * scrypt cần khoảng `128 * N * r` byte; mặc định của Node là 32MB nên N=2^16
   * sẽ ném lỗi "memory limit exceeded" ngay lần băm đầu tiên.
   */
  private get options() {
    return {
      N: this.cost,
      r: this.blockSize,
      p: this.parallelization,
      maxmem: 256 * this.cost * this.blockSize,
    };
  }

  async hash(plain: string): Promise<string> {
    const salt = randomBytes(this.saltLength);
    const derived = (await scryptAsync(
      plain.normalize('NFKC'),
      salt,
      this.keyLength,
      this.options,
    )) as Buffer;

    return [
      'scrypt',
      this.cost,
      this.blockSize,
      this.parallelization,
      salt.toString('base64url'),
      derived.toString('base64url'),
    ].join('$');
  }

  /**
   * Kiểm mật khẩu.
   *
   * Trả `false` thay vì ném lỗi khi chuỗi băm hỏng: bản ghi lỗi trong DB không
   * được biến thành 500, và cũng không được để lộ ra ngoài rằng tài khoản này
   * khác các tài khoản khác ở điểm nào.
   */
  async verify(plain: string, stored: string): Promise<boolean> {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

    const [, cost, blockSize, parallelization, saltEncoded, hashEncoded] = parts;
    const N = Number.parseInt(cost, 10);
    const r = Number.parseInt(blockSize, 10);
    const p = Number.parseInt(parallelization, 10);
    if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

    const expected = Buffer.from(hashEncoded, 'base64url');
    if (expected.length === 0) return false;

    try {
      const derived = (await scryptAsync(
        plain.normalize('NFKC'),
        Buffer.from(saltEncoded, 'base64url'),
        expected.length,
        { N, r, p, maxmem: 256 * N * r },
      )) as Buffer;

      return timingSafeEqual(derived, expected);
    } catch {
      return false;
    }
  }

  /** Chuỗi băm cũ dùng tham số yếu hơn cấu hình hiện tại → nên băm lại. */
  needsRehash(stored: string): boolean {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return true;
    return Number.parseInt(parts[1], 10) < this.cost;
  }

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
      // Không phải để làm khó người dùng: scrypt cố tình tốn kém, một chuỗi vài
      // MB gửi lên sẽ chiếm CPU rất lâu.
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
