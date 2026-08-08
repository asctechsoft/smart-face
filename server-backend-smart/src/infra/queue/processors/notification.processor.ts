import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { PushService } from 'src/modules/notification/push.service';
import { JOBS, QUEUES } from '../queue.constants';

/** Queue `notification` — retry 5 lần (docs/02 mục 10). */
@Processor(QUEUES.NOTIFICATION)
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    const { notificationId } = job.data as { notificationId: string };

    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });
    if (!notification || notification.sentAt) {
      return { skipped: true };
    }

    const tokens = await this.resolvePushTokens(job.name, notification);
    const result = await this.push.send(tokens, {
      title: notification.title,
      body: notification.body,
      data: {
        notificationId: notification.id,
        type: notification.type,
        ...(notification.data as Record<string, unknown> | null),
      },
    });

    await this.prisma.notification.update({
      where: { id: notificationId },
      data: { sentAt: new Date() },
    });

    return { sent: result.sent, targets: tokens.length };
  }

  private async resolvePushTokens(
    jobName: string,
    notification: { companyId: string | null; employeeId: string | null; departmentId: string | null },
  ): Promise<string[]> {
    if (jobName === JOBS.PUSH_NOTIFICATION && notification.employeeId) {
      const employee = await this.prisma.employee.findUnique({
        where: { id: notification.employeeId },
        select: { userId: true },
      });
      if (!employee?.userId) return [];

      const devices = await this.prisma.deviceBinding.findMany({
        where: { userId: employee.userId, isActive: true, pushToken: { not: null } },
        select: { pushToken: true },
      });
      return devices.map((device) => device.pushToken as string);
    }

    // Broadcast toàn công ty hoặc theo phòng ban.
    if (!notification.companyId) return [];

    const employees = await this.prisma.employee.findMany({
      where: {
        companyId: notification.companyId,
        deletedAt: null,
        status: 'ACTIVE',
        ...(notification.departmentId ? { departmentId: notification.departmentId } : {}),
        userId: { not: null },
      },
      select: { userId: true },
    });
    const userIds = employees.map((employee) => employee.userId as string);
    if (userIds.length === 0) return [];

    const devices = await this.prisma.deviceBinding.findMany({
      where: { userId: { in: userIds }, isActive: true, pushToken: { not: null } },
      select: { pushToken: true },
    });
    return devices.map((device) => device.pushToken as string);
  }
}
