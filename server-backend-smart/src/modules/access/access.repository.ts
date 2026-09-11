import { Injectable } from '@nestjs/common';
import { Prisma, Role, ScopeLevel } from '@prisma/client';
import { BaseRepository } from 'src/infra/prisma/base.repository';
import { PrismaService } from 'src/infra/prisma/prisma.service';

export interface EffectiveAssignmentRow {
  roleId: string;
  roleCode: string;
  scopeLevel: ScopeLevel;
  scopeIds: string[];
  validTo: Date | null;
  permissions: string[];
}

@Injectable()
export class AccessRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  // ===========================================================================
  //  Danh mục quyền & vai trò
  // ===========================================================================

  async upsertPermission(
    code: string,
    module: string,
    description: string,
    tx?: Prisma.TransactionClient,
  ) {
    return this.db(tx).permission.upsert({
      where: { code },
      create: { code, module, description },
      update: { module, description },
    });
  }

  async listPermissions() {
    return this.db().permission.findMany({ orderBy: [{ module: 'asc' }, { code: 'asc' }] });
  }

  /**
   * Vai trò hệ thống dùng chung mọi tenant có `companyId = null`.
   *
   * `findUnique` trên `@@unique([companyId, code])` KHÔNG khớp được khi
   * `companyId` là null — Postgres coi mọi NULL là khác nhau nên ràng buộc unique
   * không áp cho hàng có null, và Prisma phản ánh đúng điều đó. Vì vậy phải
   * `findFirst` rồi tự quyết định create hay update.
   */
  async upsertSystemRole(
    code: string,
    data: { name: string; description: string },
    tx?: Prisma.TransactionClient,
  ): Promise<Role> {
    const client = this.db(tx);
    const existing = await client.role.findFirst({ where: { companyId: null, code } });
    if (existing) {
      return client.role.update({
        where: { id: existing.id },
        data: { ...data, isSystem: true, deletedAt: null },
      });
    }
    return client.role.create({ data: { companyId: null, code, ...data, isSystem: true } });
  }

  async replaceRolePermissions(
    roleId: string,
    permissionCodes: string[],
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = this.db(tx);
    const permissions = await client.permission.findMany({
      where: { code: { in: permissionCodes } },
      select: { id: true },
    });
    await client.rolePermission.deleteMany({ where: { roleId } });
    if (permissions.length > 0) {
      await client.rolePermission.createMany({
        data: permissions.map((permission) => ({ roleId, permissionId: permission.id })),
      });
    }
  }

  async findRoleByCode(companyId: string | null, code: string): Promise<Role | null> {
    return this.db().role.findFirst({ where: { companyId, code, deletedAt: null } });
  }

  /** Vai trò khả dụng cho một tenant = vai trò hệ thống + vai trò riêng của tenant. */
  async listRolesForCompany(companyId: string) {
    return this.db().role.findMany({
      where: { deletedAt: null, OR: [{ companyId: null }, { companyId }] },
      include: { permissions: { include: { permission: true } } },
      orderBy: [{ isSystem: 'desc' }, { code: 'asc' }],
    });
  }

  // ===========================================================================
  //  Gán vai trò
  // ===========================================================================

  /**
   * Các lượt gán CÒN HIỆU LỰC tại `at`.
   *
   * Lọc theo thời gian ngay trong truy vấn chứ không lọc ở tầng ứng dụng: quyền
   * hết hạn phải TỰ mất tác dụng, không phụ thuộc job dọn dẹp nào (docs/13 §5.1).
   */
  async findEffectiveAssignments(
    companyId: string,
    employeeId: string,
    at: Date = new Date(),
  ): Promise<EffectiveAssignmentRow[]> {
    const rows = await this.db().roleAssignment.findMany({
      where: {
        companyId,
        employeeId,
        validFrom: { lte: at },
        OR: [{ validTo: null }, { validTo: { gt: at } }],
      },
      include: {
        role: { include: { permissions: { include: { permission: true } } } },
      },
    });

    return rows
      .filter((row) => row.role.deletedAt === null)
      .map((row) => ({
        roleId: row.roleId,
        roleCode: row.role.code,
        scopeLevel: row.scopeLevel,
        scopeIds: row.scopeIds,
        validTo: row.validTo,
        permissions: row.role.permissions.map((link) => link.permission.code),
      }));
  }

  async createAssignment(
    companyId: string,
    data: {
      employeeId: string;
      roleId: string;
      scopeLevel: ScopeLevel;
      scopeIds: string[];
      validFrom?: Date;
      validTo?: Date | null;
      grantedById: string;
      reason?: string;
    },
    tx?: Prisma.TransactionClient,
  ) {
    return this.db(tx).roleAssignment.create({ data: { companyId, ...data } });
  }

  async revokeAssignment(companyId: string, assignmentId: string, at: Date = new Date()) {
    return this.db().roleAssignment.updateMany({
      where: { id: assignmentId, companyId },
      data: { validTo: at },
    });
  }

  async listAssignments(companyId: string, employeeId?: string) {
    return this.db().roleAssignment.findMany({
      where: { companyId, ...(employeeId ? { employeeId } : {}) },
      include: {
        role: true,
        employee: { select: { id: true, fullName: true, employeeCode: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ===========================================================================
  //  Owner công ty (BR-15)
  // ===========================================================================

  async countActiveOwners(companyId: string, tx?: Prisma.TransactionClient): Promise<number> {
    return this.db(tx).companyOwner.count({ where: { companyId, revokedAt: null } });
  }

  async listActiveOwners(companyId: string) {
    return this.db().companyOwner.findMany({
      where: { companyId, revokedAt: null },
      include: {
        employee: { select: { id: true, fullName: true, employeeCode: true, email: true } },
      },
      orderBy: { grantedAt: 'asc' },
    });
  }

  async findOwner(companyId: string, employeeId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).companyOwner.findUnique({
      where: { companyId_employeeId: { companyId, employeeId } },
    });
  }

  async grantOwner(
    companyId: string,
    employeeId: string,
    grantedBy: string,
    tx?: Prisma.TransactionClient,
  ) {
    return this.db(tx).companyOwner.upsert({
      where: { companyId_employeeId: { companyId, employeeId } },
      create: { companyId, employeeId, grantedBy },
      // Cấp lại cho người từng bị gỡ: xoá dấu thu hồi thay vì tạo dòng thứ hai.
      update: {
        revokedAt: null,
        revokedBy: null,
        revokeReason: null,
        grantedBy,
        grantedAt: new Date(),
      },
    });
  }

  async revokeOwner(
    companyId: string,
    employeeId: string,
    revokedBy: string,
    reason: string,
    tx?: Prisma.TransactionClient,
  ) {
    return this.db(tx).companyOwner.updateMany({
      where: { companyId, employeeId, revokedAt: null },
      data: { revokedAt: new Date(), revokedBy, revokeReason: reason },
    });
  }

  // ===========================================================================
  //  Uỷ quyền duyệt
  // ===========================================================================

  async findActiveDelegationsFor(companyId: string, delegateId: string, at: Date = new Date()) {
    return this.db().approvalDelegation.findMany({
      where: {
        companyId,
        delegateId,
        revokedAt: null,
        validFrom: { lte: at },
        validTo: { gt: at },
      },
    });
  }

  async createDelegation(
    companyId: string,
    data: {
      delegatorId: string;
      delegateId: string;
      requestTypeId?: string | null;
      scopeLevel: ScopeLevel;
      scopeIds: string[];
      validFrom: Date;
      validTo: Date;
      reason?: string;
      createdBy: string;
    },
    tx?: Prisma.TransactionClient,
  ) {
    return this.db(tx).approvalDelegation.create({ data: { companyId, ...data } });
  }

  // ===========================================================================
  //  Tra cứu phục vụ scope
  // ===========================================================================

  /** Phòng ban thuộc các chi nhánh cho trước — dùng khi scope là BRANCH. */
  async findDepartmentIdsInBranches(companyId: string, branchIds: string[]): Promise<string[]> {
    if (branchIds.length === 0) return [];
    const rows = await this.db().department.findMany({
      where: { companyId, branchId: { in: branchIds } },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /** Nhân viên báo cáo trực tiếp — dùng khi scope là TEAM. */
  async findDirectReportIds(companyId: string, managerEmployeeId: string): Promise<string[]> {
    const rows = await this.db().employee.findMany({
      where: { companyId, directManagerId: managerEmployeeId, deletedAt: null },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }
}
