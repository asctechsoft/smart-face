import { SetMetadata } from '@nestjs/common';
import { SystemRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

/**
 * RBAC — 5 vai trò (docs/02-kien-truc-he-thong.md mục 8.1).
 * `SYSTEM_ADMIN` luôn được RolesGuard cho qua.
 *
 * ```ts
 * @Roles(SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
 * ```
 */
export const Roles = (...roles: SystemRole[]) => SetMetadata(ROLES_KEY, roles);

export const SCOPE_KEY = 'departmentScope';

/**
 * Bật ScopeGuard: vai trò MANAGER chỉ đọc/ghi được dữ liệu của phòng ban
 * mình quản lý (docs/04 mục 1). Kết hợp cùng `@Roles()`, không thay thế.
 */
export const DepartmentScoped = () => SetMetadata(SCOPE_KEY, true);
