import { AiImageQuality } from './ai-gateway.types';

export interface AngleViolation {
  yaw: number | null;
  pitch: number | null;
  maxYaw: number;
  maxPitch: number;
}

/**
 * Kiểm góc mặt so với ngưỡng nghiệp vụ của công ty (P3 — AI Server chỉ trả số).
 *
 * Tách thành hàm thuần thay vì viết thẳng trong `AttendanceService` vì service đó
 * có 9 phụ thuộc; dựng cả nó lên chỉ để kiểm một nhánh so sánh là đắt và giòn. Ở
 * đây test chạy trên ĐÚNG hàm mà production gọi, không phải bản sao logic.
 *
 * ⚠ `yaw`/`pitch` là `null` khi AI Server không đo được tư thế đầu (chưa nạp module
 * `landmark_3d_68`). Không đo được thì KHÔNG chặn — khác hẳn `action_verified` của
 * AF-05. Ở đây "không đo được" không mở ra lỗ hổng nào: kẻ gian chẳng lợi gì từ việc
 * chụp mặt nghiêng, nên biến thiếu số liệu thành từ chối chỉ tạo sự cố cho người thật.
 *
 * ⚠ Chỉ dùng cho luồng CHẤM CÔNG. Luồng đăng ký cố ý chụp hai bước lệch trục
 * (`TURN_LEFT`, `TURN_RIGHT`) — áp hàm này vào đó là tự chặn hai bước bắt buộc của
 * chính mình.
 *
 * @returns chi tiết vi phạm để đưa vào `details` của lỗi, hoặc `null` khi đạt.
 */
export function checkFaceAngle(
  quality: AiImageQuality | null | undefined,
  maxYaw: number,
  maxPitch: number,
): AngleViolation | null {
  const yaw = quality?.yaw ?? null;
  const pitch = quality?.pitch ?? null;

  const yawExceeded = yaw !== null && Math.abs(yaw) > maxYaw;
  const pitchExceeded = pitch !== null && Math.abs(pitch) > maxPitch;

  if (!yawExceeded && !pitchExceeded) return null;
  return { yaw, pitch, maxYaw, maxPitch };
}
