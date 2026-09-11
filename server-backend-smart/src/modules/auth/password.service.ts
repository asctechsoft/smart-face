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
 * Platform chỉ ép được độ dài tối thiểu 6 ký tự và không ép được quy tắc thành
 * phần nào cả. Bỏ tầng này đi là hạ chuẩn mật khẩu của toàn hệ thống xuống 6 ký
 * tự không điều kiện.
 *
 * ## Chỗ chính sách này KHÔNG với tới được
 *
 * Chỉ những đường đi QUA Backend mới bị kiểm: cấp tài khoản, và `POST
 * /auth/password/change`. Nếu sau này bật màn hình "quên mật khẩu" mặc định của
 * Firebase, người dùng đặt mật khẩu thẳng trên trang của Firebase và chỉ bị kiểm
 * theo chuẩn của Firebase. Muốn giữ nguyên chuẩn của hệ thống thì luồng đặt lại
 * mật khẩu cũng phải đi qua Backend.
 */
@Injectable()
export class PasswordService {
  /** Độ dài tối thiểu — lấy từ bản thiết kế màn đổi mật khẩu. */
  static readonly MIN_LENGTH = 8;

  static readonly MAX_LENGTH = 128;

  /**
   * Chính sách độ mạnh mật khẩu.
   *
   * ## Ba điều kiện này đến từ bản thiết kế, không phải từ NIST
   *
   * Bản vẽ màn đổi mật khẩu liệt kê đúng ba dòng — tối thiểu 8 ký tự, có chữ
   * hoa và chữ thường, có ít nhất 1 số hoặc ký tự đặc biệt — và chủ sản phẩm
   * đã chọn lấy chúng làm chính sách thật thay vì để màn hình nói một đằng máy
   * chủ kiểm một nẻo.
   *
   * ⚠ Đây là hạ chuẩn so với bản trước (12 ký tự, không quy tắc thành phần), và
   * đi ngược NIST SP 800-63B: quy tắc thành phần đẩy người dùng tới đúng một
   * khuôn `Matkhau@123` — thoả mọi điều kiện mà nằm đầu mọi danh sách dò. Với
   * mức sàn 8 ký tự, `COMMON_PASSWORDS` bên dưới không còn là lưới an toàn phụ
   * mà là thứ chặn chính những lựa chọn hiển nhiên; giữ nó đầy đủ.
   *
   * Dùng `\p{Ll}` / `\p{Lu}` thay vì `[a-z]` / `[A-Z]`: người dùng gõ tiếng
   * Việt có dấu, và `[a-z]` không khớp `ă` hay `ề` — mật khẩu `Cầuvồng1` sẽ bị
   * từ chối vì "thiếu chữ thường" trong khi nó có tám chữ thường.
   */
  assertStrong(plain: string, context: { email?: string; fullName?: string } = {}): void {
    const reasons: string[] = [];

    if (plain.length < PasswordService.MIN_LENGTH) {
      reasons.push(`Mật khẩu phải dài ít nhất ${PasswordService.MIN_LENGTH} ký tự.`);
    }
    if (plain.length > PasswordService.MAX_LENGTH) {
      reasons.push(`Mật khẩu không được dài quá ${PasswordService.MAX_LENGTH} ký tự.`);
    }
    if (!/\p{Ll}/u.test(plain) || !/\p{Lu}/u.test(plain)) {
      reasons.push('Mật khẩu phải có cả chữ hoa và chữ thường.');
    }
    if (!/[\p{N}]/u.test(plain) && !/[^\p{L}\p{N}]/u.test(plain)) {
      reasons.push('Mật khẩu phải có ít nhất 1 chữ số hoặc ký tự đặc biệt.');
    }

    /*
     * Không còn luật riêng cho "toàn chữ số" và "một ký tự lặp lại".
     *
     * Cả hai đã nằm gọn trong luật chữ hoa + chữ thường: `123456789012` không có
     * chữ cái nào, `aaaaaaaa` không có chữ hoa — chúng bị chặn trước khi tới
     * được hai luật cũ. Giữ lại thì đó là hai nhánh không bao giờ chạy, trông
     * như đang bảo vệ một thứ mà thật ra chúng không còn bảo vệ nữa.
     */

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
   *
   * ## Vì sao phải CẤY sẵn mỗi loại một ký tự
   *
   * Bốc ngẫu nhiên từ bảng gộp KHÔNG bảo đảm đủ ba loại. Bảng này có 8 chữ số
   * trên 56 ký tự, nên một mật khẩu 14 ký tự trượt luật "có ít nhất 1 chữ số"
   * với xác suất (48/56)^14 ≈ **11%**. Nghĩa là cứ chín tài khoản HR cấp thì có
   * một cái mà chính máy chủ từ chối mật khẩu tạm do chính nó vừa sinh ra —
   * hỏng ngay ở bước tạo tài khoản, và chỉ thỉnh thoảng mới hỏng nên rất khó
   * lần ra. Luật thành phần mới làm lỗi này xuất hiện; trước đó không có.
   *
   * Xáo lại bằng Fisher–Yates để ba ký tự cấy sẵn không luôn nằm ở ba vị trí
   * đầu — nếu không, ai nhìn vài mật khẩu tạm cũng đoán ra khuôn.
   */
  generateTemporary(length = 14): string {
    const lower = 'abcdefghijkmnpqrstuvwxyz';
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const digits = '23456789';
    const alphabet = lower + upper + digits;
    const size = Math.max(length, PasswordService.MIN_LENGTH);

    const pick = (from: string) => from[randomInt(from.length)];
    const chars = [pick(lower), pick(upper), pick(digits)];
    while (chars.length < size) {
      chars.push(pick(alphabet));
    }

    for (let index = chars.length - 1; index > 0; index -= 1) {
      const swap = randomInt(index + 1);
      [chars[index], chars[swap]] = [chars[swap], chars[index]];
    }

    return chars.join('');
  }
}

/**
 * Danh sách rút gọn — đủ chặn những lựa chọn tệ nhất mà không cần tệp từ điển.
 *
 * ## Vì sao danh sách này dài hơn hẳn bản trước
 *
 * Bản trước chỉ cần liệt kê chuỗi từ 12 ký tự trở lên, vì ngắn hơn đã bị mức
 * sàn độ dài chặn mất. Mức sàn giờ là 8, nên toàn bộ khoảng 8–11 ký tự mở ra —
 * và đó đúng là khoảng chứa những mật khẩu bị dò đầu tiên.
 *
 * Tệ hơn: luật thành phần mới không loại được chúng, nó SINH ra chúng.
 * `Matkhau@123` và `Password1` thoả cả ba điều kiện của bản vẽ, và chính vì ai
 * cũng bị ép theo cùng một khuôn nên chúng nằm đầu mọi danh sách dò. Danh sách
 * này là thứ duy nhất còn chặn được chúng — mỗi khi thêm một luật thành phần,
 * phải thêm vào đây những khuôn mà luật đó đẻ ra.
 *
 * So khớp trên chuỗi đã hạ chữ thường, nên chỉ cần ghi một dạng.
 */
const COMMON_PASSWORDS = new Set([
  // Khuôn mà chính luật "hoa + thường + số/ký tự đặc biệt" đẻ ra.
  'password1',
  'password@1',
  'password123',
  'password@123',
  'matkhau1',
  'matkhau@1',
  'matkhau123',
  'matkhau@123',
  'abcd1234',
  'abcd@1234',
  'qwerty123',
  'qwerty@123',
  'admin@123',
  'admin1234',
  'welcome1',
  'welcome@123',
  'iloveyou1',
  'vietnam123',
  'smartface1',
  'smartface123',
  'chamcong1',
  'chamcong123',
  'congty123',
  'congty@123',
  // Giữ lại các chuỗi dài của bản trước.
  'password1234',
  'password123456',
  'matkhau123456',
  'qwerty123456',
  'admin1234567',
  'abcd12345678',
  'iloveyou1234',
  '123456789012',
  'smartface1234',
  'chamcong1234',
  'congty123456',
]);
