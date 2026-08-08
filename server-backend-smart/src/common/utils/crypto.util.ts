import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Băm token/secret trước khi lưu DB — không bao giờ lưu giá trị gốc. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function sha256Buffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function randomToken(bytes = 48): string {
  return randomBytes(bytes).toString('base64url');
}

/** Nonce dùng một lần cho endpoint chấm công (AF-12). */
export function randomNonce(): string {
  return randomBytes(16).toString('hex');
}

/** Sinh OTP số, dùng nguồn ngẫu nhiên mã hoá (không dùng Math.random). */
export function randomNumericCode(length: number): string {
  let code = '';
  while (code.length < length) {
    code += randomBytes(4).readUInt32BE(0).toString().padStart(10, '0');
  }
  return code.slice(0, length);
}

/**
 * AF-12: chữ ký request của App.
 *
 * ```
 * signature = HMAC-SHA256(method + path + bodyHash + nonce + timestamp, deviceSecret)
 * ```
 */
export function computeRequestSignature(input: {
  method: string;
  path: string;
  bodyHash: string;
  nonce: string;
  timestamp: string;
  deviceSecret: string;
}): string {
  const payload = [
    input.method.toUpperCase(),
    input.path,
    input.bodyHash,
    input.nonce,
    input.timestamp,
  ].join('\n');

  return createHmac('sha256', input.deviceSecret).update(payload).digest('hex');
}

/**
 * AF-12 — băm body của request `multipart/form-data`.
 *
 * ## Vì sao cần hàm riêng thay vì băm thẳng body thô
 *
 * Với request JSON, server giữ được bản sao body thô (`json({verify})` ở
 * `main.ts`) nên băm trực tiếp là xong. Với multipart thì không: multer đọc
 * thẳng từ luồng request và không giữ lại byte gốc. Buffer thêm một bản sao chỉ
 * để băm nghĩa là mỗi ảnh 5MB chiếm 10MB RAM — giờ cao điểm 8h sáng với vài
 * trăm lượt chấm công đồng thời là vài GB.
 *
 * Vì vậy hai bên thoả thuận một **giá trị dẫn xuất** mà cả App lẫn server đều
 * tính lại được độc lập, không cần byte gốc:
 *
 * ```
 * bodyHash = sha256(
 *     "file:" + sha256(bytes của file)                    ← nội dung ảnh
 *   + "\n" + "<độ dài tên>:<tên>=<độ dài giá trị>:<giá trị>"   ← mỗi trường một dòng,
 *                                                                sắp xếp theo tên
 * )
 * ```
 *
 * Sắp xếp theo tên để không phụ thuộc thứ tự trường trong multipart — thứ tự
 * này do thư viện HTTP của từng nền tảng quyết định, không ổn định giữa iOS và
 * Android.
 *
 * ## Vì sao phải ghi kèm độ dài
 *
 * Bản đầu tiên nối thẳng `tên=giá_trị` rồi ghép bằng `\n`. Cách đó **nhập nhằng**:
 *
 * ```
 * { a: "1", b: "2" }      →  "a=1\nb=2"
 * { a: "1\nb=2" }         →  "a=1\nb=2"     ← TRÙNG
 * ```
 *
 * Kẻ tấn công ký một request có đúng một trường `a` chứa ký tự xuống dòng, rồi
 * trình bày lại thành hai trường riêng biệt — hash vẫn khớp, chữ ký vẫn hợp lệ,
 * nhưng dữ liệu server đọc được đã khác hẳn. Ghi kèm độ dài thì hai trường hợp
 * trên cho hai chuỗi khác nhau và không còn cách gói ghém nào qua mặt được.
 *
 * Độ dài tính bằng **byte UTF-8**, không phải số ký tự — tiếng Việt có dấu cho
 * hai con số khác nhau. Phía App: Dart `utf8.encode(s).length`, Swift
 * `s.utf8.count`, Kotlin `s.toByteArray(Charsets.UTF_8).size`.
 *
 * ## Cái này chặn được gì
 *
 * Kẻ chặn được request đã ký giữa đường (proxy độc hại, CA giả) không tạo được
 * request mới vì không có `deviceSecret`. Nhưng nếu chữ ký không ràng buộc nội
 * dung thì hắn **sửa được request đang bay**: tráo ảnh khuôn mặt sang người
 * khác, hoặc đổi toạ độ GPS. Hàm này khép chỗ đó lại.
 *
 * ⚠ Đổi công thức ở đây là đổi hợp đồng với App — hai bên lệch nhau thì mọi
 * lượt chấm công đều trả `AUTH_SIGNATURE_INVALID`.
 */
export function computeMultipartBodyHash(
  file: Buffer | undefined,
  fields: Record<string, unknown>,
): string {
  const lines: string[] = [];

  lines.push(`file:${file && file.length > 0 ? sha256Buffer(file) : ''}`);

  for (const name of Object.keys(fields).sort()) {
    const raw = fields[name];
    if (raw === undefined || raw === null) continue;

    const value = typeof raw === 'string' ? raw : JSON.stringify(raw);
    lines.push(
      `${Buffer.byteLength(name, 'utf8')}:${name}=${Buffer.byteLength(value, 'utf8')}:${value}`,
    );
  }

  return sha256(lines.join('\n'));
}

/** So sánh chuỗi bí mật chống timing attack. */
export function safeCompare(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/**
 * Che số điện thoại khi trả về hoặc ghi log: 0901234567 → 090****567
 *
 * Nhận cả `null` vì số điện thoại không còn bắt buộc từ khi đăng nhập chuyển
 * sang email — bắt mọi chỗ gọi tự xử lý null chỉ dẫn tới `?? ''` rải rác, và
 * sớm muộn có chỗ quên rồi in ra số đầy đủ.
 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone || phone.length < 7) return '***';
  return `${phone.slice(0, 3)}****${phone.slice(-3)}`;
}

/** Chuẩn hoá số điện thoại Việt Nam về dạng 0xxxxxxxxx. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+84')) return `0${digits.slice(3)}`;
  if (digits.startsWith('84') && digits.length >= 11) return `0${digits.slice(2)}`;
  return digits;
}

export function isValidVietnamesePhone(phone: string): boolean {
  return /^0(3|5|7|8|9)\d{8}$/.test(phone);
}

/** Chuyển embedding Float32 sang Buffer để lưu cột Bytes (D8). */
export function embeddingToBuffer(embedding: number[]): Buffer {
  const float32 = Float32Array.from(embedding);
  return Buffer.from(float32.buffer, float32.byteOffset, float32.byteLength);
}

export function bufferToEmbedding(buffer: Buffer): number[] {
  const copy = Buffer.from(buffer);
  const float32 = new Float32Array(copy.buffer, copy.byteOffset, copy.length / 4);
  return Array.from(float32);
}
