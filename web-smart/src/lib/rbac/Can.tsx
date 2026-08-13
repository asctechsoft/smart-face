import type { ReactNode } from 'react';
import { useAuth } from '@/lib/auth/auth-context';
import { hasPermission, type Permission } from './permissions';

export function usePermission(): (permission: Permission) => boolean {
  const { roles } = useAuth();
  return (permission: Permission) => hasPermission(roles, permission);
}

export function useCan(permission: Permission): boolean {
  const { roles } = useAuth();
  return hasPermission(roles, permission);
}

/**
 * Ẩn/hiện phần tử theo quyền — docs/04 mục 12.2.
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
