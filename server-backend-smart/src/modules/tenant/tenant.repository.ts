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
  name: string;
  maxEmployees?: number | null;
  maxBranches?: number | null;
  maxRecognitionsPerMonth?: number | null;
  storageGb?: number | null;
  photoRetentionDays?: number;
  features?: Prisma.InputJsonValue;
  pricePerMonth?: number | null;
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

  async upsertPlan(data: UpsertPlanData): Promise<SubscriptionPlan> {
    return this.db().subscriptionPlan.upsert({
      where: { name: data.name },
      create: {
        name: data.name,
        maxEmployees: data.maxEmployees,
        maxBranches: data.maxBranches,
        maxRecognitionsPerMonth: data.maxRecognitionsPerMonth,
        storageGb: data.storageGb,
        photoRetentionDays: data.photoRetentionDays ?? 90,
        features: data.features ?? {},
        pricePerMonth: data.pricePerMonth,
      },
      update: {
        maxEmployees: data.maxEmployees,
        maxBranches: data.maxBranches,
        maxRecognitionsPerMonth: data.maxRecognitionsPerMonth,
        storageGb: data.storageGb,
        photoRetentionDays: data.photoRetentionDays,
        features: data.features,
        pricePerMonth: data.pricePerMonth,
      },
    });
  }
}
