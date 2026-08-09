import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/infra/prisma/base.repository';
import { PrismaService } from 'src/infra/prisma/prisma.service';

/**
 * Truy vấn duy nhất của module health: một phép thử kết nối database.
 *
 * Tách ra một file riêng cho đúng MỘT câu lệnh nhìn có vẻ thừa, nhưng đây là chỗ
 * dễ phá vỡ quy ước nhất: `/health` trông "chỉ là hạ tầng" nên rất dễ bị coi là
 * ngoại lệ, rồi thành tiền lệ cho endpoint tiếp theo.
 */
@Injectable()
export class HealthRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  /** Truy vấn rẻ nhất có thể — chỉ xác nhận connection pool còn sống. */
  async ping(): Promise<void> {
    await this.db().$queryRaw`SELECT 1`;
  }
}
