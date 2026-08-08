import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { PaginatedResult, PaginationQueryDto } from 'src/common/dto';
import { buildMeta } from 'src/common/utils';
import { JOBS, QUEUES } from 'src/infra/queue/queue.constants';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { RealtimeGateway } from './realtime.gateway';

export interface NotifyInput {
  companyId: string;
  employeeId?: string;
  departmentId?: string;
  type: string;
  title: string;
  body: string;
  data?: Prisma.InputJsonValue;
  channel?: 'PUSH' | 'IN_APP' | 'SMS' | 'EMAIL';
  createdBy?: string;
  scheduledAt?: Date;
}

/**
 * Thông báo: lưu bản ghi + đẩy job gửi + phát realtime.
 *
 * Gửi thật (FCM/SMS/email) chạy ở worker qua queue để không chặn request nghiệp vụ —
 * duyệt đơn không được chậm đi chỉ vì FCM lag.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    @InjectQueue(QUEUES.NOTIFICATION) private readonly notificationQueue: Queue,
    @InjectQueue(QUEUES.SMS) private readonly smsQueue: Queue,
  ) {}

  /** Gửi cho một nhân viên cụ thể. */
  async notify(input: NotifyInput): Promise<void> {
    const notification = await this.prisma.notification.create({
      data: {
        companyId: input.companyId,
        employeeId: input.employeeId,
        departmentId: input.departmentId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data,
        channel: input.channel ?? 'PUSH',
        scheduledAt: input.scheduledAt,
        createdBy: input.createdBy,
      },
    });

    // Realtime tới client đang mở app/web (docs/08 mục 9).
    if (input.employeeId) {
      this.realtime.emitToEmployee(input.employeeId, 'notification.new', {
        id: notification.id,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data,
      });
    }

    if (!input.scheduledAt) {
      await this.notificationQueue
        .add(JOBS.PUSH_NOTIFICATION, { notificationId: notification.id })
        .catch((error: Error) =>
          this.logger.warn(`Không đẩy được job push notification: ${error.message}`),
        );
    }
  }

  /** FR-WEB-NOT-01 — thông báo toàn công ty hoặc theo phòng ban. */
  async broadcast(input: Omit<NotifyInput, 'employeeId'>): Promise<{ notificationId: string }> {
    const notification = await this.prisma.notification.create({
      data: {
        companyId: input.companyId,
        departmentId: input.departmentId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data,
        channel: input.channel ?? 'PUSH',
        scheduledAt: input.scheduledAt,
        createdBy: input.createdBy,
      },
    });

    if (!input.scheduledAt) {
      await this.notificationQueue
        .add(JOBS.BROADCAST_NOTIFICATION, { notificationId: notification.id })
        .catch((error: Error) => this.logger.warn(`Không đẩy được job broadcast: ${error.message}`));
    }

    return { notificationId: notification.id };
  }

  /** Gửi SMS qua queue (OTP, lời mời nhân viên). */
  async queueSms(job: string, payload: Record<string, unknown>): Promise<void> {
    await this.smsQueue.add(job, payload).catch((error: Error) => {
      this.logger.error(`Không đẩy được job SMS: ${error.message}`);
    });
  }

  // ---------------------------------------------------------------------------
  // Đọc (App: danh sách thông báo, đếm chưa đọc)
  // ---------------------------------------------------------------------------

  async list(companyId: string, employeeId: string, query: PaginationQueryDto) {
    const where: Prisma.NotificationWhereInput = {
      companyId,
      OR: [{ employeeId }, { employeeId: null }],
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return new PaginatedResult(items, buildMeta(query.page, query.pageSize, total));
  }

  async countUnread(companyId: string, employeeId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { companyId, OR: [{ employeeId }, { employeeId: null }], readAt: null },
    });
  }

  async markRead(companyId: string, employeeId: string, notificationId: string) {
    await this.prisma.notification.updateMany({
      where: { id: notificationId, companyId, OR: [{ employeeId }, { employeeId: null }] },
      data: { readAt: new Date() },
    });
    return { read: true };
  }

  async markAllRead(companyId: string, employeeId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { companyId, OR: [{ employeeId }, { employeeId: null }], readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }
}
