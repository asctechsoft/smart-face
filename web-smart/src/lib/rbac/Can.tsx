import type { ReactNode } from 'react';
import { useAccess } from './access-context';
import {
  SCOPE_RANK,
  findGrant,
  hasPermission,
  hasScopedPermission,
  type Permission,
  type ScopeLevel,
} from './permissions';

/**
 * Kiểm quyền trong component.
 *
 * ⚠ Toàn bộ file này là TRẢI NGHIỆM, không phải bảo mật. Ẩn một nút không chặn
 * được ai gọi thẳng API — Backend kiểm lại ở từng request bằng `PermissionGuard`
 * và `ScopeGuard`. Mục đích duy nhất ở đây là người dùng không nhìn thấy những
 * nút mà bấm vào sẽ nhận `RBAC_PERMISSION_DENIED`.
 */
export function usePermission(): (permission: Permission) => boolean {
  const { access } = useAccess();
  return (permission: Permission) => hasPermission(access, permission);
}

export function useCan(permission: Permission): boolean {
  const { access } = useAccess();
  return hasPermission(access, permission);
}

/**
 * Phạm vi dữ liệu của một quyền.
 *
 * Trả về mức phạm vi và danh sách id, để màn hình biết mình đang nhìn bao nhiêu
 * phần của công ty. Ví dụ dùng thật: bộ lọc phòng ban chỉ liệt kê các phòng
 * trong `scopeIds` thay vì liệt kê hết rồi để người dùng chọn một phòng và nhận
 * bảng trống.
 *
 * `isCompanyWide` là câu hỏi hay gặp nhất nên tách sẵn: nhiều màn hình chỉ cần
 * biết "có phải xem được toàn công ty không" để quyết định hiện hay ẩn bộ lọc.
 */
export function useScope(permission: Permission): {
  level: ScopeLevel | null;
  ids: string[];
  isCompanyWide: boolean;
} {
  const { access } = useAccess();
  const grant = findGrant(access, permission);

  const level = grant?.scope ?? null;
  return {
    level,
    ids: grant?.scopeIds ?? [],
    isCompanyWide: level !== null && SCOPE_RANK[level] >= SCOPE_RANK.COMPANY,
  };
}

/**
 * Ẩn/hiện phần tử theo quyền.
 *
 * ```tsx
 * <Can do="attendance.adjust">
 *   <Button onClick={openAdjustModal}>Hiệu chỉnh công</Button>
 * </Can>
 * ```
 *
 * `fallback` dùng khi cần giải thích vì sao trống, thay vì để người dùng nhìn
 * một khoảng trắng không rõ nguyên nhân.
 */
export function Can({
  do: permission,
  children,
  fallback = null,
}: {
  do: Permission;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return useCan(permission) ? <>{children}</> : <>{fallback}</>;
}

/**
 * Ẩn/hiện theo quyền VÀ phạm vi của một đối tượng cụ thể.
 *
 * ```tsx
 * <RequireScope do="employee.update" scopeId={employee.departmentId}>
 *   <Button>Sửa hồ sơ</Button>
 * </RequireScope>
 * ```
 *
 * Khác `<Can>` ở chỗ nó hỏi thêm "trên đối tượng NÀY". Một trưởng phòng có
 * `employee.update` với phạm vi phòng ban: nút "Sửa" nên hiện trên dòng nhân
 * viên phòng họ và biến mất trên dòng phòng khác. Dùng `<Can>` ở đây thì nút
 * hiện trên mọi dòng và người dùng chỉ biết mình không có quyền sau khi đã điền
 * xong biểu mẫu.
 *
 * Với phạm vi `SELF`/`TEAM` thì component cho qua và để Backend quyết: hai mức
 * đó giải theo `employeeId` chứ không theo id phòng ban, nên đoán ở client là
 * đoán sai và giấu mất nút của người thực sự có quyền.
 */
export function RequireScope({
  do: permission,
  scopeId,
  children,
  fallback = null,
}: {
  do: Permission;
  /** departmentId hoặc branchId của đối tượng đang thao tác. */
  scopeId?: string | null;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { access } = useAccess();
  return hasScopedPermission(access, permission, scopeId) ? <>{children}</> : <>{fallback}</>;
}
