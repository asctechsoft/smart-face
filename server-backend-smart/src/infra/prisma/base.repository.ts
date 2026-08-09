import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

/**
 * Lớp cơ sở cho mọi Repository.
 *
 * Repository là NƠI DUY NHẤT được phép chạm vào Prisma. Service gọi Repository,
 * Controller gọi Service — xem README mục 2 "Quy ước bắt buộc trong mỗi module".
 *
 * Hai quy tắc không được vi phạm:
 *
 *  1. `companyId` LUÔN là tham số bắt buộc, đứng đầu, KHÔNG có giá trị mặc định
 *     (BR-09). Repository nào cần đọc xuyên tenant thì đặt tên có tiền tố
 *     `acrossTenants…` để chỗ gọi phải cố ý gõ ra, không thể lỡ tay.
 *
 *  2. Mọi phương thức nhận `tx?: Prisma.TransactionClient` ở tham số cuối và
 *     chạy truy vấn qua `this.db(tx)`. Nhờ vậy Service ghép nhiều Repository vào
 *     một transaction qua `TransactionManager` mà Repository không cần biết gì
 *     về transaction đó.
 */
export abstract class BaseRepository {
  constructor(protected readonly prisma: PrismaService) {}

  /**
   * Client để chạy truy vấn: transaction đang mở nếu có, không thì client gốc.
   *
   * Kiểu trả về là `Prisma.TransactionClient` (= `PrismaClient` trừ `$transaction`,
   * `$connect`…) nên gọi nhầm `$transaction` bên trong một transaction khác sẽ
   * bị TypeScript chặn ngay — đó là lỗi treo connection pool rất khó lần ra.
   */
  protected db(tx?: Prisma.TransactionClient): Prisma.TransactionClient {
    return tx ?? this.prisma;
  }
}
