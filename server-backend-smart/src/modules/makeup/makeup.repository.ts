import { Injectable } from '@nestjs/common';
import { MakeupWorkRecord, Prisma } from '@prisma/client';
import { BaseRepository } from 'src/infra/prisma/base.repository';
import { PrismaService } from 'src/infra/prisma/prisma.service';

export type MakeupRecordWithEmployee = Prisma.MakeupWorkRecordGetPayload<{
  include: {
    employee: {
      select: {
        id: true;
        fullName: true;
        employeeCode: true;
        department: { select: { id: true; name: true } };
      };
    };
  };
}>;

export interface MakeupSearchFilter {
  status?: string;
  employeeId?: string;
  departmentId?: string;
  /** Phạm vi phòng ban của MANAGER — do guard áp, không lấy từ query. */
  departmentScope: string[] | null;
  from?: Date;
  to?: Date;
  /** Chỉ khoản còn nợ mà đã quá hạn tính tới ngày này. */
  overdueBefore?: Date;
  q?: string;
  skip: number;
  take: number;
}

export interface CreateMakeupData {
  employeeId: string;
  debtWorkDate: Date;
  debtMinutes: number;
  remainingMinutes: number;
  dueDate: Date | null;
  makeupWorkDate?: Date | null;
  makeupMinutes?: number;
  requestId?: string | null;
  status: string;
}

/** Tổng hợp cho thẻ chỉ số ở đầu màn hình công làm bù. */
export interface MakeupTotals {
  openDebtMinutes: number;
  madeUpMinutes: number;
  openRecords: number;
  employeesWithDebt: number;
}

/**
 * Truy cập bảng `makeup_work_record` — docs/04 mục 5.
 *
 * Mỗi dòng là MỘT khoản nợ công gắn với TỐI ĐA MỘT lần làm bù. Ràng buộc "một
 * lần bù" không phải tuỳ tiện: engine tính công cộng giờ bù vào ngày
 * `makeupWorkDate` (`payroll.repository.sumMakeupMinutes`), nên một dòng mang
 * hai ngày bù khác nhau là không biểu diễn được — phần chưa bù xong tách thành
 * dòng mới, xem `MakeupService.record`.
 */
@Injectable()
export class MakeupRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async search(
    companyId: string,
    filter: MakeupSearchFilter,
  ): Promise<{ items: MakeupRecordWithEmployee[]; total: number }> {
    const where = this.buildWhere(companyId, filter);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.makeupWorkRecord.findMany({
        where,
        include: {
          employee: {
            select: {
              id: true,
              fullName: true,
              employeeCode: true,
              department: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { debtWorkDate: 'desc' }],
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.makeupWorkRecord.count({ where }),
    ]);

    return { items, total };
  }

  async findById(companyId: string, id: string): Promise<MakeupWorkRecord | null> {
    return this.db().makeupWorkRecord.findFirst({ where: { id, companyId } });
  }

  async create(
    companyId: string,
    data: CreateMakeupData,
    tx?: Prisma.TransactionClient,
  ): Promise<MakeupWorkRecord> {
    return this.db(tx).makeupWorkRecord.create({ data: { companyId, ...data } });
  }

  /**
   * `updateMany` + đọc lại thay vì `update({ where: { id } })`: `where` của
   * `update` chỉ nhận khoá duy nhất nên không chèn được `companyId` (BR-09).
   */
  async update(
    companyId: string,
    id: string,
    data: Prisma.MakeupWorkRecordUpdateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<MakeupWorkRecord | null> {
    const updated = await this.db(tx).makeupWorkRecord.updateMany({
      where: { id, companyId },
      data,
    });
    if (updated.count === 0) return null;
    return this.db(tx).makeupWorkRecord.findFirst({ where: { id, companyId } });
  }

  /**
   * Số dòng ĐÃ BÙ XONG của cùng một khoản nợ (cùng người, cùng ngày phát sinh).
   *
   * Dùng để khôi phục đúng trạng thái khi gia hạn một khoản đã hết hạn: dòng
   * mang phần nợ còn lại sau một lần bù dở dang phải quay về `PARTIAL`, còn dòng
   * chưa bù lần nào thì về `OPEN`. Không có phép đếm này thì cả hai cùng về
   * `OPEN` và mất thông tin "khoản này đã bù được một phần".
   */
  async countCompletedSiblings(
    companyId: string,
    employeeId: string,
    debtWorkDate: Date,
    excludeId: string,
  ): Promise<number> {
    return this.db().makeupWorkRecord.count({
      where: {
        companyId,
        employeeId,
        debtWorkDate,
        status: 'COMPLETED',
        id: { not: excludeId },
      },
    });
  }

  async delete(companyId: string, id: string): Promise<number> {
    const result = await this.db().makeupWorkRecord.deleteMany({ where: { id, companyId } });
    return result.count;
  }

  /**
   * Đánh dấu quá hạn hàng loạt.
   *
   * Chạy khi mở màn hình chứ không bằng cron: số bản ghi nhỏ, và cron thêm một
   * thứ phải giám sát để đổi lấy việc trạng thái đúng sớm hơn vài giờ.
   */
  async markExpired(companyId: string, before: Date): Promise<number> {
    const result = await this.db().makeupWorkRecord.updateMany({
      where: {
        companyId,
        status: { in: ['OPEN', 'PARTIAL'] },
        dueDate: { not: null, lt: before },
      },
      data: { status: 'EXPIRED' },
    });
    return result.count;
  }

  async totals(companyId: string, filter: MakeupSearchFilter): Promise<MakeupTotals> {
    const openWhere = this.buildWhere(companyId, { ...filter, status: undefined });
    openWhere.status = { in: ['OPEN', 'PARTIAL'] };

    const allWhere = this.buildWhere(companyId, { ...filter, status: undefined });

    const [open, madeUp, employees] = await this.prisma.$transaction([
      this.prisma.makeupWorkRecord.aggregate({
        where: openWhere,
        _sum: { remainingMinutes: true },
        _count: { _all: true },
      }),
      this.prisma.makeupWorkRecord.aggregate({ where: allWhere, _sum: { makeupMinutes: true } }),
      this.prisma.makeupWorkRecord.groupBy({
        by: ['employeeId'],
        where: openWhere,
        orderBy: { employeeId: 'asc' },
      }),
    ]);

    return {
      openDebtMinutes: open._sum.remainingMinutes ?? 0,
      openRecords: open._count._all,
      madeUpMinutes: madeUp._sum.makeupMinutes ?? 0,
      employeesWithDebt: employees.length,
    };
  }

  private buildWhere(
    companyId: string,
    filter: MakeupSearchFilter,
  ): Prisma.MakeupWorkRecordWhereInput {
    const where: Prisma.MakeupWorkRecordWhereInput = { companyId };

    if (filter.status) where.status = filter.status;
    if (filter.employeeId) where.employeeId = filter.employeeId;

    const employeeWhere: Prisma.EmployeeWhereInput = {};
    if (filter.departmentId) employeeWhere.departmentId = filter.departmentId;
    // Phạm vi của MANAGER thu hẹp, không mở rộng — ghi đè bộ lọc client gửi lên.
    if (filter.departmentScope) employeeWhere.departmentId = { in: filter.departmentScope };
    if (filter.q) {
      employeeWhere.OR = [
        { fullName: { contains: filter.q, mode: 'insensitive' } },
        { employeeCode: { contains: filter.q, mode: 'insensitive' } },
      ];
    }
    if (Object.keys(employeeWhere).length > 0) where.employee = employeeWhere;

    if (filter.from || filter.to) {
      where.debtWorkDate = {
        ...(filter.from ? { gte: filter.from } : {}),
        ...(filter.to ? { lte: filter.to } : {}),
      };
    }

    if (filter.overdueBefore) {
      where.status = { in: ['OPEN', 'PARTIAL', 'EXPIRED'] };
      where.dueDate = { not: null, lt: filter.overdueBefore };
    }

    return where;
  }
}
