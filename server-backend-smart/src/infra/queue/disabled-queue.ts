import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';

/**
 * Queue giả dùng khi `REDIS_ENABLED=false`.
 *
 * BullMQ không chạy được nếu thiếu Redis, nhưng 6 service đang inject `Queue`
 * qua `@InjectQueue`. Không đăng ký gì thì Nest ném lỗi DI lúc khởi động
 * ("Nest can't resolve dependencies... BullQueue_payroll"). Vì vậy phải cấp
 * đúng những token đó bằng một vật thể nuốt job.
 *
 * ⚠ Job đẩy vào đây bị VỨT BỎ, không phải xếp hàng chờ. Bật Redis lại cũng
 * không có gì chạy bù. Cụ thể là: không tính lại bảng công, không gửi OTP qua
 * SMS, không xuất Excel, không quét gian lận.
 *
 * Vì vậy mỗi lần vứt đều ghi `warn` kèm tên job. Nuốt im lặng sẽ dẫn tới cảnh
 * lập trình viên ngồi chờ một file Excel không bao giờ tới mà không hiểu vì sao —
 * ồn còn hơn là bí ẩn.
 */
export function createDisabledQueue(queueName: string): Queue {
  const logger = new Logger(`DisabledQueue:${queueName}`);

  const stub = {
    name: queueName,

    add(jobName: string): Promise<Job> {
      logger.warn(`REDIS_ENABLED=false — bỏ qua job "${jobName}" (không được xếp hàng).`);
      return Promise.resolve({ id: null, name: jobName } as unknown as Job);
    },

    addBulk(jobs: Array<{ name: string }>): Promise<Job[]> {
      logger.warn(`REDIS_ENABLED=false — bỏ qua ${jobs.length} job.`);
      return Promise.resolve([]);
    },

    getJobCounts(): Promise<Record<string, number>> {
      return Promise.resolve({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 });
    },

    getFailed(): Promise<Job[]> {
      return Promise.resolve([]);
    },

    close(): Promise<void> {
      return Promise.resolve();
    },
  };

  // Ép kiểu có chủ đích: `Queue` của BullMQ có hàng chục phương thức, cài đủ chỉ
  // để chúng ném lỗi là công vô ích. Chỉ những phương thức code này thực sự gọi
  // mới được hiện thực — thêm chỗ gọi mới mà quên bổ sung ở đây thì lỗi hiện ra
  // ngay lần chạy đầu với REDIS_ENABLED=false, chứ không âm thầm sai kết quả.
  return stub as unknown as Queue;
}
