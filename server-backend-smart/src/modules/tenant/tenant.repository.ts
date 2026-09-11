import { Injectable } from '@nestjs/common';
import { Company, CompanyStatus, Prisma, SubscriptionPlan } from '@prisma/client';
import { BaseRepository } from 'src/infra/prisma/base.repository';
import { PrismaService } from 'src/infra/prisma/prisma.service';

export type CompanyWithPlanAndCounts = Prisma.CompanyGetPayload<{
  include: { plan: true; _count: { select: { employees: true; branches: true } } };
}>;

export interface TenantSearchFilter {
  status?: CompanyStatus;
  q?: string;
  skip: number;
  take: number;
}

export interface CreateCompanyData {
  code: string;
  domain: string;
  name: string;
  taxCode: string | null;
  timezone: string;
  planId: string | null;
  status: CompanyStatus;
  trialEndsAt: Date;
}

export interface UpsertPlanData {
  /** Khoá định danh gói, BẤT BIẾN: "FREE" | "PLUS" | "MAX" | ... */
  code: string;
  name: string;
  maxEmployees?: number | null;
  maxBranches?: number | null;
  maxDepartments?: number | null;
  maxShifts?: number | null;
  maxAdminAccounts?: number | null;
  maxRecognitionsPerMonth?: number | null;
  storageGb?: number | null;
  photoRetentionDays?: number;
  dataRetentionDays?: number;
  features?: Prisma.InputJsonValue;
  pricePerMonth?: number | null;
  description?: string | null;
  isDefault?: boolean;
  isActive?: boolean;
  sortOrder?: number;
}

export interface TenantUsageCounters {
  employeeCount: number;
  branchCount: number;
  attendanceCount: number;
  faceProfileCount: number;
}

/**
 * Truy cập dữ liệu tenant và gói dịch vụ — phục vụ Web Admin (`/v1/system/*`).
 *
 * Đây là repository DUY NHẤT thao tác xuyên tenant một cách hợp lệ: đối tượng
 * nghiệp vụ của nó CHÍNH LÀ công ty. Mọi phương thức vẫn nhận `companyId` để chỉ
 * đích danh một công ty; chỉ `searchCompanies` và `listPlans` là quét toàn bộ, và
 * quyền gọi chúng do `@Roles(SYSTEM_ADMIN)` ở controller chặn.
 */
@Injectable()
export class TenantRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  // ===========================================================================
  //  Công ty
  // ===========================================================================

  async searchCompanies(
    filter: TenantSearchFilter,
  ): Promise<{ items: CompanyWithPlanAndCounts[]; total: number }> {
    const where: Prisma.CompanyWhereInput = { deletedAt: null };
    if (filter.status) where.status = filter.status;
    if (filter.q) {
      where.OR = [
        { name: { contains: filter.q, mode: 'insensitive' } },
        { code: { contains: filter.q, mode: 'insensitive' } },
        { taxCode: { contains: filter.q } },
      ];
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.company.findMany({
        where,
        include: { plan: true, _count: { select: { employees: true, branches: true } } },
        orderBy: { createdAt: 'desc' },
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.company.count({ where }),
    ]);

    return { items, total };
  }

  async findCompany(companyId: string): Promise<CompanyWithPlanAndCounts | null> {
    return this.db().company.findFirst({
      where: { id: companyId, deletedAt: null },
      include: { plan: true, _count: { select: { employees: true, branches: true } } },
    });
  }

  async findCompanyByCode(code: string): Promise<Company | null> {
    return this.db().company.findUnique({ where: { code } });
  }

  async findCompanyByDomain(domain: string): Promise<Company | null> {
    return this.db().company.findUnique({ where: { domain } });
  }

  /**
   * Sua thong tin cong ty do chinh tenant khai.
   *
   * `where` chi co `id` vi `id` la khoa chinh — nhung goi tu service da xac
   * dinh `companyId` tu JWT, khong tu tham so nguoi dung gui, nen khong co
   * duong nao sua sang cong ty khac (`BR-09`).
   *
   * `undefined` bo qua, `null` xoa. Prisma phan biet hai thu do, va do la cach
   * duy nhat de "khong dong den ma so thue" khac voi "xoa ma so thue".
   */
  async updateCompanyProfile(
    companyId: string,
    data: { name?: string; domain?: string; taxCode?: string | null; timezone?: string },
  ): Promise<Company> {
    return this.db().company.update({ where: { id: companyId }, data });
  }

  /**
   * So lieu tong quan tang NEN TANG — khong thuoc mot cong ty nao.
   *
   * Moi truy van o day co tinh KHONG loc theo `companyId`: goi tu
   * `AdminController`, noi da khai `@SkipTenant()` va `@Roles(SYSTEM_ADMIN)` o
   * cap class. Do la ranh gioi #2 cua `docs/08` §1.1 — day la mot trong rat it
   * cho duoc phep nhin xuyen qua ranh gioi cong ty.
   */
  async loadPlatformOverview(since: Date) {
    const [byStatus, totalUsers, byPlan, recent] = await Promise.all([
      this.db().company.groupBy({
        by: ['status'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      this.db().userAccount.count({ where: { deletedAt: null } }),
      this.db().company.groupBy({
        by: ['planId'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      // Ngay tao cua tung cong ty trong khoang — gom theo ngay o tang service.
      // `groupBy` tren `createdAt` khong dung duoc vi no la timestamp: moi ban
      // ghi mot gia tri rieng, nhom xong van la tung dong.
      this.db().company.findMany({
        where: { deletedAt: null, createdAt: { gte: since } },
        select: { createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const plans = await this.db().subscriptionPlan.findMany({
      select: { id: true, code: true, name: true },
    });

    return { byStatus, totalUsers, byPlan, recent, plans };
  }

  async findCompanyById(companyId: string): Promise<Company | null> {
    return this.db().company.findFirst({ where: { id: companyId, deletedAt: null } });
  }

  async createCompany(data: CreateCompanyData, tx?: Prisma.TransactionClient): Promise<Company> {
    return this.db(tx).company.create({ data });
  }

  async updateStatus(
    companyId: string,
    data: {
      status: CompanyStatus;
      suspendedAt?: Date | null;
      suspendReason?: string | null;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await this.db(tx).company.update({ where: { id: companyId }, data });
  }

  async assignPlan(
    companyId: string,
    planId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await this.db(tx).company.update({ where: { id: companyId }, data: { planId } });
  }

  /** userId của nhân viên công ty — dùng để thu hồi phiên khi tạm ngưng dịch vụ. */
  async findLinkedUserIds(companyId: string): Promise<string[]> {
    const rows = await this.db().employee.findMany({
      where: { companyId, userId: { not: null } },
      select: { userId: true },
    });
    return [...new Set(rows.map((row) => row.userId).filter(Boolean))] as string[];
  }

  // ===========================================================================
  //  Thống kê sử dụng (FR-ADM-TEN-07)
  // ===========================================================================

  async countUsage(companyId: string, from: Date, to: Date): Promise<TenantUsageCounters> {
    const [employeeCount, branchCount, attendanceCount, faceProfileCount] =
      await this.prisma.$transaction([
        this.prisma.employee.count({ where: { companyId, deletedAt: null } }),
        this.prisma.branch.count({ where: { companyId, deletedAt: null } }),
        this.prisma.attendanceLog.count({
          where: { companyId, recordedAt: { gte: from, lte: to } },
        }),
        this.prisma.faceProfile.count({ where: { companyId, status: 'ACTIVE' } }),
      ]);

    return { employeeCount, branchCount, attendanceCount, faceProfileCount };
  }

  // ===========================================================================
  //  Gói dịch vụ
  // ===========================================================================

  async listPlans(): Promise<SubscriptionPlan[]> {
    return this.db().subscriptionPlan.findMany({ orderBy: { createdAt: 'asc' } });
  }

  async findPlan(planId: string): Promise<SubscriptionPlan | null> {
    return this.db().subscriptionPlan.findUnique({ where: { id: planId } });
  }

  /**
   * Khoá upsert là `code`, không phải `name`.
   *
   * `name` là nhãn hiển thị và công ty vận hành có thể muốn đổi ("Pro" thành
   * "Business"). Khoá theo nhãn thì một lần đổi tên là tạo ra gói thứ hai bên
   * cạnh gói cũ, còn tenant vẫn trỏ vào gói cũ.
   */
  async upsertPlan(data: UpsertPlanData): Promise<SubscriptionPlan> {
    const { code, name, ...rest } = data;
    return this.db().subscriptionPlan.upsert({
      where: { code },
      create: {
        code,
        name,
        ...rest,
        photoRetentionDays: rest.photoRetentionDays ?? 90,
        dataRetentionDays: rest.dataRetentionDays ?? 365,
        features: rest.features ?? {},
      },
      update: { name, ...rest },
    });
  }
}
