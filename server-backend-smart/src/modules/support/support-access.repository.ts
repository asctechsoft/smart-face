import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BaseRepository } from 'src/infra/prisma/base.repository';
import { PrismaService } from 'src/infra/prisma/prisma.service';

@Injectable()
export class SupportAccessRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  create(
    data: {
      adminUserId: string;
      companyId: string;
      ticketRef: string;
      purpose: string;
      expiresAt: Date;
      readOnly: boolean;
    },
    tx?: Prisma.TransactionClient,
  ) {
    return this.db(tx).supportAccessSession.create({ data });
  }

  /**
   * Phiên đang mở của MỘT quản trị viên trên MỘT công ty.
   *
   * Điều kiện `endedAt: null` và `expiresAt > now` nằm trong truy vấn chứ không
   * lọc ở tầng ứng dụng: guard gọi hàm này ở mọi request xuyên tenant, nên nó
   * phải là một lần chạm DB có index (`@@index([companyId, expiresAt])`) chứ
   * không phải đọc hết rồi lọc.
   */
  findActive(adminUserId: string, companyId: string, now: Date) {
    return this.db().supportAccessSession.findFirst({
      where: { adminUserId, companyId, endedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });
  }

  findById(id: string) {
    return this.db().supportAccessSession.findUnique({ where: { id } });
  }

  end(id: string, endedBy: string) {
    // `updateMany` + điều kiện `endedAt: null` để hai lượt đóng song song không
    // ghi đè mốc thời gian của nhau — lượt thứ hai trả `count: 0`.
    return this.db().supportAccessSession.updateMany({
      where: { id, endedAt: null },
      data: { endedAt: new Date(), endedBy },
    });
  }

  list(filter: { companyId?: string; adminUserId?: string; activeOnly?: boolean }, take: number) {
    const now = new Date();
    return this.db().supportAccessSession.findMany({
      where: {
        companyId: filter.companyId,
        adminUserId: filter.adminUserId,
        ...(filter.activeOnly ? { endedAt: null, expiresAt: { gt: now } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
      include: { company: { select: { id: true, code: true, name: true } } },
    });
  }

  /** Mọi bản ghi audit sinh ra trong một phiên — dùng để đối chiếu sau sự cố. */
  auditTrail(sessionId: string, take: number) {
    return this.db().auditLog.findMany({
      where: { supportSessionId: sessionId },
      orderBy: { createdAt: 'asc' },
      take,
    });
  }

  /** NFR-AUD-02 — lần theo một chuỗi truy vết xuyên Backend → AI Server → Queue. */
  traceByCorrelationId(correlationId: string, take: number) {
    return this.db().auditLog.findMany({
      where: { correlationId },
      orderBy: { createdAt: 'asc' },
      take,
    });
  }
}
