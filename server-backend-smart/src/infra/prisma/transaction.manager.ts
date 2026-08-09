import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

export interface TransactionOptions {
  maxWait?: number;
  timeout?: number;
  isolationLevel?: Prisma.TransactionIsolationLevel;
}

/**
 * Ranh giới transaction cho tầng Service.
 *
 * Service cần gộp nhiều lời gọi Repository vào một transaction, nhưng nếu vì thế
 * mà inject thẳng `PrismaService` thì quy ước "Service không chạm Prisma" mất
 * hiệu lực — chỉ cần một dòng `this.prisma.employee.findMany` lọt vào là tầng
 * Repository trở thành trang trí.
 *
 * `TransactionManager` mở transaction rồi trao `tx` cho Service truyền xuống các
 * Repository. Service điều phối, Repository truy vấn, không ai vượt tuyến.
 *
 * ```ts
 * await this.transactions.run(async (tx) => {
 *   const request = await this.requests.updateStatus(companyId, id, 'APPROVED', tx);
 *   await this.requests.createApprovalStep(companyId, { ... }, tx);
 *   return request;
 * });
 * ```
 */
@Injectable()
export class TransactionManager {
  constructor(private readonly prisma: PrismaService) {}

  /** Transaction tương tác thông thường. */
  run<T>(
    handler: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    return this.prisma.$transaction(handler, options);
  }

  /**
   * Như `run()` nhưng đặt sẵn `app.company_id` cho Row-Level Security (ADR-05).
   *
   * Dùng cho thao tác ghi nhiều bảng của một tenant. Khi RLS được bật (hiện đang
   * comment trong `prisma/sql/01_immutability_and_rls.sql`) thì đây là lớp phòng
   * thủ thứ hai nếu một `where` nào đó lỡ quên `companyId`.
   */
  runForTenant<T>(
    companyId: string,
    handler: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.withTenant(companyId, handler);
  }
}
