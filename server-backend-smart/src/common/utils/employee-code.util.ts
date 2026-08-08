/**
 * Sinh mã nhân viên theo docs/01-tong-quan-he-thong.md mục 8.
 *
 * Định dạng: `<viết tắt họ tên>.<mã công ty>`
 *
 * ```
 * Nguyễn Văn Đức + công ty AMOBI  →  ducnv.amobi
 *                                     │    │
 *                                     │    └── mã công ty (bất biến)
 *                                     └─────── tên chính + viết tắt họ và tên lót
 * ```
 *
 * Thuật toán:
 *   1. Bỏ dấu tiếng Việt, chuyển chữ thường, bỏ khoảng trắng/ký tự đặc biệt.
 *   2. Lấy TÊN CHÍNH (từ cuối) + chữ cái đầu của họ và các tên lót theo thứ tự.
 *   3. Ghép với mã công ty bằng dấu chấm.
 *   4. Trùng trong cùng công ty → thêm số thứ tự: ducnv2.amobi, ducnv3.amobi
 */

/**
 * Dải Unicode "Combining Diacritical Marks" (U+0300–U+036F).
 * Viết dạng escape thay vì ký tự thô để file không phụ thuộc encoding khi lưu/merge.
 */
const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');

/** Bỏ dấu tiếng Việt (bao gồm đ/Đ mà NFD không tách được). */
export function removeVietnameseTones(input: string): string {
  return input
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

/** Chuẩn hoá họ tên: bỏ dấu, chữ thường, gộp khoảng trắng thừa. */
export function normalizeFullName(fullName: string): string {
  return removeVietnameseTones(fullName)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Sinh phần tên viết tắt (chưa gắn mã công ty).
 * `Nguyễn Văn Đức` → `ducnv` (tên chính `duc` + họ `n` + tên lót `v`)
 */
export function buildNameSlug(fullName: string): string {
  const normalized = normalizeFullName(fullName);
  if (!normalized) return '';

  const parts = normalized.split(' ').filter(Boolean);
  if (parts.length === 1) return parts[0];

  const givenName = parts[parts.length - 1];
  const initials = parts
    .slice(0, -1)
    .map((part) => part.charAt(0))
    .join('');

  return `${givenName}${initials}`;
}

/** Mã cơ sở chưa xử lý trùng: `ducnv.amobi` */
export function buildEmployeeCode(fullName: string, companyCode: string): string {
  const slug = buildNameSlug(fullName);
  const company = normalizeFullName(companyCode).replace(/\s/g, '');
  return `${slug}.${company}`;
}

/**
 * Sinh mã duy nhất trong phạm vi công ty.
 *
 * @param takenCodes tập mã ĐÃ dùng trong công ty (đã lấy từ DB, tính cả mã đang
 *                   chờ ghi trong cùng lô import — xem docs/04 mục 8.4).
 */
export function buildUniqueEmployeeCode(
  fullName: string,
  companyCode: string,
  takenCodes: ReadonlySet<string>,
): string {
  const slug = buildNameSlug(fullName);
  const company = normalizeFullName(companyCode).replace(/\s/g, '');

  const base = `${slug}.${company}`;
  if (!takenCodes.has(base)) return base;

  // Trùng → thêm số thứ tự vào SAU phần tên viết tắt: ducnv2.amobi
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${slug}${index}.${company}`;
    if (!takenCodes.has(candidate)) return candidate;
  }

  throw new Error(`Không sinh được employee code duy nhất cho "${fullName}" @ ${companyCode}`);
}

const EMPLOYEE_CODE_PATTERN = /^[a-z0-9]+\.[a-z0-9]+$/;

/** Kiểm tra mã do HR sửa tay có hợp lệ không. */
export function isValidEmployeeCode(code: string): boolean {
  return EMPLOYEE_CODE_PATTERN.test(code);
}
