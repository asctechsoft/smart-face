import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { SmsService } from 'src/modules/notification/sms.service';
import { JOBS, QUEUES } from '../queue.constants';

interface SendOtpJob {
  phone: string;
  code: string;
  ttlSeconds: number;
}

interface SendInviteJob {
  phone: string;
  companyName: string;
  employeeCode: string;
}

/**
 * Queue `sms` — retry 3 lần, backoff mũ (docs/02 mục 10).
 *
 * Vì sao SMS phải qua hàng đợi thay vì gọi thẳng: nhà mạng thường xuyên chập
 * chờn và một lần gửi có thể mất vài giây. Gọi đồng bộ trong luồng đăng nhập thì
 * gateway SMS chậm là màn hình đăng nhập treo theo.
 *
 * ⚠ Đánh đổi phải biết: OTP nằm trong hàng đợi khi Redis tắc nghẽn sẽ tới CHẬM,
 * có khi tới sau khi mã đã hết hạn. Vì thế queue này cần được ưu tiên theo dõi.
 */
@Processor(QUEUES.SMS)
export class SmsProcessor extends WorkerHost {
  private readonly logger = new Logger(SmsProcessor.name);

  constructor(private readonly sms: SmsService) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case JOBS.SEND_OTP: {
        const data = job.data as SendOtpJob;
        await this.sms.sendOtp(data.phone, data.code, data.ttlSeconds);
        return;
      }
      case JOBS.SEND_INVITE_SMS: {
        const data = job.data as SendInviteJob;
        await this.sms.sendInvite(data.phone, data.companyName, data.employeeCode);
        return;
      }
      default:
        // Ghi cảnh báo rồi trả về BÌNH THƯỜNG, không ném lỗi. Ném thì BullMQ sẽ
        // thử lại 3 lần một job mà đằng nào cũng không xử lý được, rồi đẩy vào
        // hàng đợi thất bại. Job lạ ở đây nghĩa là code cũ và code mới đang chạy
        // song song giữa lúc deploy — không phải sự cố cần báo động.
        this.logger.warn(`Job không xác định trong queue sms: ${job.name}`);
    }
  }
}
