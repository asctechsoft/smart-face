import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { NotificationRepository } from 'src/modules/notification/notification.repository';
import { PushService } from 'src/modules/notification/push.service';
import { JOBS, QUEUES } from '../queue.constants';

/** Queue `notification` — retry 5 lần (docs/02 mục 10). */
@Processor(QUEUES.NOTIFICATION)
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    private readonly notifications: NotificationRepository,
    private readonly push: PushService,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    const { notificationId } = job.data as { notificationId: string };

    const notification = await this.notifications.findById(notificationId);
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

    await this.notifications.markSent(notificationId, new Date());

    return { sent: result.sent, targets: tokens.length };
  }

  private async resolvePushTokens(
    jobName: string,
    notification: {
      companyId: string | null;
      employeeId: string | null;
      departmentId: string | null;
    },
  ): Promise<string[]> {
    if (jobName === JOBS.PUSH_NOTIFICATION && notification.employeeId) {
      return this.notifications.findPushTokensForEmployee(notification.employeeId);
    }

    // Broadcast toàn công ty hoặc theo phòng ban.
    if (!notification.companyId) return [];
    return this.notifications.findPushTokensForCompany(
      notification.companyId,
      notification.departmentId,
    );
  }
}
