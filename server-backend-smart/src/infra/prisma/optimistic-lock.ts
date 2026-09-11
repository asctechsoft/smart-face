import { AppException } from 'src/common/errors';

/**
 * Delegate Prisma tối thiểu mà các hàm dưới đây cần — mọi model có `rowVersion`
 * đều khớp. Khai riêng thay vì liệt kê union các delegate cụ thể để thêm một
 * model mới không phải sửa file này.
 */
export interface VersionedDelegate {
  findFirst(args: {
    where: Record<string, unknown>;
    select: { rowVersion: true };
  }): Promise<{ rowVersion: number } | null>;
}

/**
 * Khoá lạc quan (`BR-13` kiểm #5).
 *
 * ## Vì sao điều kiện phiên bản phải nằm trong `WHERE`
 *
 * Đọc `rowVersion` rồi so ở tầng service rồi mới ghi là để ngỏ đúng cái cửa sổ
 * mà khoá lạc quan sinh ra để đóng. Hai người cùng mở một ca làm việc, cả hai
 * đọc thấy phiên bản 3, cả hai ghi — người sau xoá mất thay đổi của người trước
 * và không có gì báo cho ai biết. Kiểm chỉ đáng tin khi nó là điều kiện của
 * chính câu lệnh `UPDATE`, tức là do database quyết định chứ không phải ứng dụng.
 *
 * ## Cách dùng trong repository
 *
 * ```ts
 * const where = { id, companyId, deletedAt: null };
 * const updated = await client.shift.updateMany({
 *   where: versionedWhere(where, expectedVersion),
 *   data: { ...data, rowVersion: { increment: 1 } },
 * });
 * if (updated.count === 0) {
 *   await assertNotVersionConflict(client.shift, where, expectedVersion, 'SHIFT');
 *   return null; // bản ghi không tồn tại hoặc không còn khớp điều kiện nghiệp vụ
 * }
 * ```
 */
export function versionedWhere(
  where: Record<string, unknown>,
  expectedVersion?: number,
): Record<string, unknown> {
  return expectedVersion === undefined ? where : { ...where, rowVersion: expectedVersion };
}

/**
 * Giải thích vì sao `updateMany` không đụng dòng nào.
 *
 * Có hai nguyên nhân và người dùng cần hai thông báo khác nhau: bản ghi không
 * tồn tại (hoặc đã rời khỏi trạng thái cho phép sửa) là một chuyện, bị người
 * khác sửa trước là chuyện khác hẳn — chuyện thứ hai thì tải lại là làm tiếp
 * được, chuyện thứ nhất thì không.
 *
 * Chỉ chạm DB thêm một lần khi đã chắc là có vấn đề, và chỉ khi client thực sự
 * gửi `If-Match`.
 */
export async function assertNotVersionConflict(
  delegate: VersionedDelegate,
  where: Record<string, unknown>,
  expectedVersion: number | undefined,
  resource: string,
): Promise<void> {
  if (expectedVersion === undefined) return;

  const current = await delegate.findFirst({ where, select: { rowVersion: true } });
  if (!current) return; // Không phải đụng độ phiên bản — để chỗ gọi xử lý tiếp.

  throw new AppException('VERSION_CONFLICT', {
    resource,
    expectedVersion,
    currentVersion: current.rowVersion,
  });
}
