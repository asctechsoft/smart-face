import { Injectable } from '@nestjs/common';
import { Notification, Prisma } from '@prisma/client';
import { BaseRepository } from 'src/infra/prisma/base.repository';
import { PrismaService } from 'src/infra/prisma/prisma.service';

export interface CreateNotificationData {
  companyId: string;
  employeeId?: string | null;
  departmentId?: string | null;
  type: string;
  title: string;
  body: string;
  data?: Prisma.InputJsonValue;
  channel: 'PUSH' | 'IN_APP' | 'SMS' | 'EMAIL';
  scheduledAt?: Date | null;
  createdBy?: string | null;
}

/**
 * Truy cập dữ liệu thông báo.
 *
 * Điều kiện `OR: [{ employeeId }, { employeeId: null }]` lặp ở nhiều chỗ nên gom
 * vào `visibleTo()`: thông báo riêng của nhân viên CỘNG thông báo chung toàn
 * công ty. Viết rời rạc thì chỉ cần một chỗ quên nhánh `null` là nhân viên không
 * bao giờ thấy thông báo broadcast, mà lỗi kiểu đó không ai báo.
 */
@Injectable()
export class NotificationRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async create(data: CreateNotificationData, tx?: Prisma.TransactionClient): Promise<Notification> {
    return this.db(tx).notification.create({ data });
  }

  async findById(id: string, tx?: Prisma.TransactionClient): Promise<Notification | null> {
    return this.db(tx).notification.findUnique({ where: { id } });
  }

  async markSent(id: string, sentAt: Date, tx?: Prisma.TransactionClient): Promise<void> {
    await this.db(tx).notification.update({ where: { id }, data: { sentAt } });
  }

  async listForEmployee(
    companyId: string,
    employeeId: string,
    page: { skip: number; take: number },
  ): Promise<{ items: Notification[]; total: number }> {
    const where = this.visibleTo(companyId, employeeId);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return { items, total };
  }

  async countUnread(companyId: string, employeeId: string): Promise<number> {
    return this.db().notification.count({
      where: { ...this.visibleTo(companyId, employeeId), readAt: null },
    });
  }

  async markRead(
    companyId: string,
    employeeId: string,
    notificationId: string,
    readAt: Date,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await this.db(tx).notification.updateMany({
      where: { id: notificationId, ...this.visibleTo(companyId, employeeId) },
      data: { readAt },
    });
    return result.count;
  }

  async markAllRead(
    companyId: string,
    employeeId: string,
    readAt: Date,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await this.db(tx).notification.updateMany({
      where: { ...this.visibleTo(companyId, employeeId), readAt: null },
      data: { readAt },
    });
    return result.count;
  }

  // ---------------------------------------------------------------------------
  //  Địa chỉ gửi push — dùng bởi NotificationProcessor
  // ---------------------------------------------------------------------------

  /** Push token của mọi thiết bị đang hoạt động của MỘT nhân viên. */
  async findPushTokensForEmployee(employeeId: string): Promise<string[]> {
    const employee = await this.db().employee.findUnique({
      where: { id: employeeId },
      select: { userId: true },
    });
    if (!employee?.userId) return [];
    return this.findPushTokensForUsers([employee.userId]);
  }

  /**
   * Số nhân viên sẽ NHÌN THẤY một thông báo broadcast.
   *
   * ⚠ Khác với `findPushTokensForCompany` bên dưới: đó là số THIẾT BỊ nhận được
   * push, còn đây là số NGƯỜI. Nhân viên chưa cài app vẫn thấy thông báo khi mở
   * app lần sau, vì danh sách trong app đọc thẳng từ bảng `notification`. Báo
   * theo số thiết bị sẽ ra một con số nhỏ hơn thực tế và người gửi tưởng thông
   * báo không tới được ai.
   */
  async countBroadcastRecipients(companyId: string, departmentId?: string | null): Promise<number> {
    return this.db().employee.count({
      where: {
        companyId,
        deletedAt: null,
        status: 'ACTIVE',
        ...(departmentId ? { departmentId } : {}),
      },
    });
  }

  /** Push token của toàn công ty, hoặc thu hẹp theo phòng ban khi broadcast. */
  async findPushTokensForCompany(
    companyId: string,
    departmentId?: string | null,
  ): Promise<string[]> {
    const employees = await this.db().employee.findMany({
      where: {
        companyId,
        deletedAt: null,
        status: 'ACTIVE',
        ...(departmentId ? { departmentId } : {}),
        userId: { not: null },
      },
      select: { userId: true },
    });

    const userIds = employees.map((employee) => employee.userId as string);
    if (userIds.length === 0) return [];
    return this.findPushTokensForUsers(userIds);
  }

  private async findPushTokensForUsers(userIds: string[]): Promise<string[]> {
    const devices = await this.db().deviceBinding.findMany({
      where: { userId: { in: userIds }, isActive: true, pushToken: { not: null } },
      select: { pushToken: true },
    });
    return devices.map((device) => device.pushToken as string);
  }

  private visibleTo(companyId: string, employeeId: string): Prisma.NotificationWhereInput {
    return { companyId, OR: [{ employeeId }, { employeeId: null }] };
  }
}
