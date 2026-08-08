import { INestApplication, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * PrismaService — singleton an toàn với hot-reload (ADR-04, bắt buộc).
 *
 * Trong dev, Nest watch mode tạo lại module nhiều lần; nếu mỗi lần đều `new PrismaClient()`
 * thì connection pool của Postgres sẽ cạn. Vì vậy giữ instance ở globalThis.
 */

const globalForPrisma = globalThis as unknown as { __smartfacePrisma?: PrismaClient };

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log:
        process.env.NODE_ENV === 'production'
          ? [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }]
          : [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }],
      errorFormat: 'minimal',
    });

    if (globalForPrisma.__smartfacePrisma) {
      return globalForPrisma.__smartfacePrisma as PrismaService;
    }
    if (process.env.NODE_ENV !== 'production') {
      globalForPrisma.__smartfacePrisma = this;
    }
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Đã kết nối PostgreSQL');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  async enableShutdownHooks(app: INestApplication): Promise<void> {
    process.on('beforeExit', () => {
      void app.close();
    });
  }

  /**
   * ADR-05 lớp phòng thủ thứ hai: đặt `app.company_id` cho Row-Level Security.
   * Chỉ có tác dụng khi đã bật RLS (xem prisma/sql/01_immutability_and_rls.sql).
   *
   * Phải chạy TRONG cùng transaction với truy vấn nghiệp vụ thì biến mới có hiệu lực.
   */
  async withTenant<T>(
    companyId: string,
    handler: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
      return handler(tx);
    });
  }
}
