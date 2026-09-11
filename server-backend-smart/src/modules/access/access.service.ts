import { Injectable, Logger } from '@nestjs/common';
import { ScopeLevel, SystemRole } from '@prisma/client';
import { AppException } from 'src/common/errors';
import { RedisService } from 'src/infra/redis/redis.service';
import { TransactionManager } from 'src/infra/prisma/transaction.manager';
import { AccessRepository } from './access.repository';
import {
  ALL_PERMISSION_CODES,
  LEGACY_ROLE_MAP,
  PERMISSION_CATALOG,
  SCOPE_RANK,
  SYSTEM_ROLE_DEFINITIONS,
  permissionModule,
  type PermissionCode,
} from './permission.constants';
import type { RequestContext } from 'src/common/types/request-context';

/** Phạm vi dữ liệu đã giải xong, sẵn sàng chèn vào truy vấn. */
export interface ResolvedScope {
  /** Mức rộng nhất mà người này có cho hành động đang xét. */
  level: ScopeLevel;
  /** Id chi nhánh được phép — rỗng khi level là COMPANY/PLATFORM/SELF/TEAM. */
  branchIds: string[];
  /** Id phòng ban được phép — rỗng khi level ≥ COMPANY. */
  departmentIds: string[];
}

export interface EffectiveAccess {
  permissions: Set<string>;
  /** Scope rộng nhất trên từng quyền. */
  scopeByPermission: Map<string, { level: ScopeLevel; scopeIds: string[] }>;
  roleCodes: string[];
  /** Lượt gán sắp hết hạn gần nhất — Web dùng để cảnh báo (FR-GDW-ROLE-03). */
  nextExpiryAt: Date | null;
}

const ACCESS_CACHE_TTL_SECONDS = 60;

/**
 * Phân quyền theo mô hình Role × Permission × Scope (docs/08 §2 · BR-13).
 *
 * ## Vì sao cache chỉ 60 giây
 *
 * Gỡ quyền của một người phải có hiệu lực gần như tức thì — đó là thao tác người
 * ta làm khi có sự cố. Nhưng giải quyền lại đụng 4 bảng cho MỖI request, nên
 * không cache là trả giá ở mọi endpoint. 60 giây là chỗ thoả hiệp; các thao tác
 * cấp/gỡ quyền chủ động gọi `invalidate()` nên đường đi thông thường vẫn tức thì,
 * TTL chỉ là lưới an toàn cho các đường sửa dữ liệu trực tiếp.
 *
 * ## Vì sao vẫn còn `SystemRole`
 *
 * Token đã phát hành mang `roles: SystemRole[]`, và các tenant hiện có chưa có
 * dòng `RoleAssignment` nào. Nếu bắt buộc phải có assignment thì ngay khi deploy
 * là toàn bộ người dùng mất sạch quyền. Nên khi không tìm thấy assignment nào,
 * service suy ra quyền từ vai trò cũ — xem `fallbackFromLegacyRoles`.
 */
@Injectable()
export class AccessService {
  private readonly logger = new Logger(AccessService.name);

  constructor(
    private readonly access: AccessRepository,
    private readonly redis: RedisService,
    private readonly transactions: TransactionManager,
  ) {}

  // ===========================================================================
  //  Giải quyền
  // ===========================================================================

  async resolveEffectiveAccess(ctx: RequestContext): Promise<EffectiveAccess> {
    if (!ctx.companyId || !ctx.employeeId) {
      return this.fallbackFromLegacyRoles(ctx);
    }

    const cacheKey = `access:${ctx.companyId}:${ctx.employeeId}`;
    const cached = await this.redis
      .remember(cacheKey, ACCESS_CACHE_TTL_SECONDS, async () => {
        const rows = await this.access.findEffectiveAssignments(ctx.companyId!, ctx.employeeId!);
        return rows;
      })
      .catch((error: Error) => {
        this.logger.warn(`Không đọc được phân quyền từ cache: ${error.message}`);
        return this.access.findEffectiveAssignments(ctx.companyId!, ctx.employeeId!);
      });

    if (cached.length === 0) {
      return this.fallbackFromLegacyRoles(ctx);
    }

    const permissions = new Set<string>();
    const scopeByPermission = new Map<string, { level: ScopeLevel; scopeIds: string[] }>();
    const roleCodes: string[] = [];
    let nextExpiryAt: Date | null = null;

    for (const row of cached) {
      roleCodes.push(row.roleCode);
      const validTo = row.validTo ? new Date(row.validTo) : null;
      if (validTo && (nextExpiryAt === null || validTo < nextExpiryAt)) {
        nextExpiryAt = validTo;
      }

      for (const code of row.permissions) {
        permissions.add(code);
        // Cùng một quyền đến từ nhiều vai trò thì lấy scope RỘNG NHẤT: người vừa
        // là Trưởng phòng A vừa là Giám đốc chi nhánh phải nhìn được cả chi nhánh.
        const current = scopeByPermission.get(code);
        if (!current || SCOPE_RANK[row.scopeLevel] > SCOPE_RANK[current.level]) {
          scopeByPermission.set(code, { level: row.scopeLevel, scopeIds: row.scopeIds });
        } else if (SCOPE_RANK[row.scopeLevel] === SCOPE_RANK[current.level]) {
          scopeByPermission.set(code, {
            level: current.level,
            scopeIds: [...new Set([...current.scopeIds, ...row.scopeIds])],
          });
        }
      }
    }

    return { permissions, scopeByPermission, roleCodes, nextExpiryAt };
  }

  /**
   * Suy quyền từ `SystemRole` cũ khi tài khoản chưa có `RoleAssignment`.
   *
   * ⚠ Đây là LỚP TƯƠNG THÍCH NGƯỢC, không phải mô hình đích. Nó không diễn đạt
   * được quyền có thời hạn hay scope BRANCH/TEAM — mọi thứ rơi về COMPANY hoặc
   * DEPARTMENT như bản cũ. Bỏ được sau khi mọi tenant đã chạy migration gán vai
   * trò; theo dõi bằng log `access.legacy_fallback`.
   */
  private fallbackFromLegacyRoles(ctx: RequestContext): EffectiveAccess {
    const permissions = new Set<string>();
    const scopeByPermission = new Map<string, { level: ScopeLevel; scopeIds: string[] }>();
    const roleCodes: string[] = [];

    for (const legacyRole of ctx.roles) {
      const code = LEGACY_ROLE_MAP[legacyRole];
      const definition = SYSTEM_ROLE_DEFINITIONS.find((role) => role.code === code);
      if (!definition) continue;
      roleCodes.push(code);

      const level =
        legacyRole === SystemRole.MANAGER ? ScopeLevel.DEPARTMENT : definition.defaultScope;
      const scopeIds = level === ScopeLevel.DEPARTMENT ? ctx.scopeDepartmentIds : [];

      for (const permission of definition.permissions) {
        permissions.add(permission);
        const current = scopeByPermission.get(permission);
        if (!current || SCOPE_RANK[level] > SCOPE_RANK[current.level]) {
          scopeByPermission.set(permission, { level, scopeIds });
        }
      }
    }

    return { permissions, scopeByPermission, roleCodes, nextExpiryAt: null };
  }

  /**
   * Phạm vi dữ liệu cho một quyền cụ thể, đã nở ra thành danh sách id dùng được.
   *
   * `BRANCH` được nở thành danh sách phòng ban vì hầu hết truy vấn nghiệp vụ lọc
   * theo `departmentId`. Nở ở đây một lần thay vì bắt mỗi service tự join.
   */
  async resolveScope(
    ctx: RequestContext,
    permission: PermissionCode,
    access?: EffectiveAccess,
  ): Promise<ResolvedScope> {
    const effective = access ?? (await this.resolveEffectiveAccess(ctx));
    const grant = effective.scopeByPermission.get(permission);

    if (!grant) {
      return { level: ScopeLevel.SELF, branchIds: [], departmentIds: [] };
    }

    switch (grant.level) {
      case ScopeLevel.PLATFORM:
      case ScopeLevel.COMPANY:
        return { level: grant.level, branchIds: [], departmentIds: [] };

      case ScopeLevel.BRANCH: {
        const departmentIds = ctx.companyId
          ? await this.access.findDepartmentIdsInBranches(ctx.companyId, grant.scopeIds)
          : [];
        return { level: grant.level, branchIds: grant.scopeIds, departmentIds };
      }

      case ScopeLevel.DEPARTMENT:
        return { level: grant.level, branchIds: [], departmentIds: grant.scopeIds };

      case ScopeLevel.TEAM:
      case ScopeLevel.SELF:
      default:
        return { level: grant.level, branchIds: [], departmentIds: [] };
    }
  }

  /** Nhân viên mà người này được phép đụng tới, khi scope là TEAM hoặc SELF. */
  async resolveEmployeeScope(ctx: RequestContext, scope: ResolvedScope): Promise<string[] | null> {
    if (scope.level === ScopeLevel.COMPANY || scope.level === ScopeLevel.PLATFORM) return null;
    if (scope.level === ScopeLevel.SELF) return ctx.employeeId ? [ctx.employeeId] : [];
    if (scope.level === ScopeLevel.TEAM) {
      if (!ctx.companyId || !ctx.employeeId) return [];
      const reports = await this.access.findDirectReportIds(ctx.companyId, ctx.employeeId);
      return [ctx.employeeId, ...reports];
    }
    return null; // BRANCH/DEPARTMENT lọc bằng departmentIds, không bằng employeeId
  }

  async invalidate(companyId: string, employeeId: string): Promise<void> {
    await this.redis.del(`access:${companyId}:${employeeId}`).catch((error: Error) => {
      this.logger.warn(`Không xoá được cache phân quyền: ${error.message}`);
    });
  }

  // ===========================================================================
  //  Owner (BR-15)
  // ===========================================================================

  async listOwners(companyId: string) {
    return this.access.listActiveOwners(companyId);
  }

  async grantOwner(companyId: string, employeeId: string, grantedBy: string) {
    const existing = await this.access.findOwner(companyId, employeeId);
    if (existing && existing.revokedAt === null) {
      throw new AppException('OWNER_ALREADY_GRANTED');
    }
    const owner = await this.access.grantOwner(companyId, employeeId, grantedBy);
    await this.invalidate(companyId, employeeId);
    return owner;
  }

  /**
   * Gỡ Owner — chặn khi đó là Owner cuối cùng (BR-15).
   *
   * Đếm và ghi nằm trong CÙNG transaction. Đếm ở tầng ứng dụng rồi mới ghi là để
   * ngỏ một cửa sổ đua: hai request gỡ hai Owner cuối cùng chạy song song, cả
   * hai đều đếm được 2, cả hai đều ghi, công ty còn 0 Owner và không ai vào được
   * phần cấu hình nữa.
   */
  async revokeOwner(companyId: string, employeeId: string, revokedBy: string, reason: string) {
    await this.transactions.run(async (tx) => {
      const owner = await this.access.findOwner(companyId, employeeId, tx);
      if (!owner || owner.revokedAt !== null) {
        throw new AppException('RBAC_ROLE_NOT_FOUND', {
          reason: 'Người này không phải Owner đang hiệu lực của công ty.',
        });
      }

      const remaining = await this.access.countActiveOwners(companyId, tx);
      if (remaining <= 1) {
        throw new AppException('OWNER_LAST_ONE');
      }

      await this.access.revokeOwner(companyId, employeeId, revokedBy, reason, tx);
    });

    await this.invalidate(companyId, employeeId);
    return { revoked: true };
  }

  // ===========================================================================
  //  Seed danh mục
  // ===========================================================================

  /**
   * Đồng bộ danh mục quyền và vai trò hệ thống từ code xuống DB.
   *
   * Idempotent — chạy được ở mỗi lần khởi động hoặc trong seed. KHÔNG xoá quyền
   * lạ trong DB: quyền bị gỡ khỏi code mà vẫn còn trong bảng thì chỉ là rác vô
   * hại, còn xoá nhầm là gỡ quyền của người đang dùng.
   */
  async syncCatalog(): Promise<{ permissions: number; roles: number }> {
    for (const code of ALL_PERMISSION_CODES) {
      await this.access.upsertPermission(code, permissionModule(code), PERMISSION_CATALOG[code]);
    }

    for (const definition of SYSTEM_ROLE_DEFINITIONS) {
      const role = await this.access.upsertSystemRole(definition.code, {
        name: definition.name,
        description: definition.description,
      });
      await this.access.replaceRolePermissions(role.id, definition.permissions);
    }

    return { permissions: ALL_PERMISSION_CODES.length, roles: SYSTEM_ROLE_DEFINITIONS.length };
  }

  listCatalog() {
    return ALL_PERMISSION_CODES.map((code) => ({
      code,
      module: permissionModule(code),
      description: PERMISSION_CATALOG[code],
    }));
  }

  listRoles(companyId: string) {
    return this.access.listRolesForCompany(companyId);
  }
}
