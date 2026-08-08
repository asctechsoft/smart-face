import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/**
 * Push notification qua Firebase Cloud Messaging (FR-APP-REQ-07).
 *
 * Chưa cấu hình `FCM_SERVER_KEY` thì service chỉ log — hệ thống vẫn chạy được
 * ở môi trường dev mà không cần tài khoản Firebase.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(private readonly config: ConfigService) {}

  async send(pushTokens: string[], message: PushMessage): Promise<{ sent: number }> {
    const tokens = pushTokens.filter(Boolean);
    if (tokens.length === 0) return { sent: 0 };

    const serverKey = this.config.get<string>('fcm.serverKey');
    if (!serverKey) {
      this.logger.debug(`[FCM:noop] ${tokens.length} thiết bị — "${message.title}"`);
      return { sent: 0 };
    }

    let sent = 0;
    // FCM legacy API giới hạn 1000 token mỗi request.
    for (let index = 0; index < tokens.length; index += 1000) {
      const chunk = tokens.slice(index, index + 1000);
      try {
        await axios.post(
          'https://fcm.googleapis.com/fcm/send',
          {
            registration_ids: chunk,
            notification: { title: message.title, body: message.body },
            data: message.data ?? {},
            priority: 'high',
          },
          { headers: { Authorization: `key=${serverKey}` }, timeout: 10_000 },
        );
        sent += chunk.length;
      } catch (error) {
        this.logger.error(`Gửi FCM thất bại: ${(error as Error).message}`);
        throw error; // để BullMQ retry
      }
    }

    return { sent };
  }
}
