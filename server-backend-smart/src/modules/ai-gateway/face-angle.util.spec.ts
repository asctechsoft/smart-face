import { AiImageQuality } from './ai-gateway.types';
import { checkFaceAngle } from './face-angle.util';

/**
 * Ngưỡng góc mặt khi chấm công — nhánh sinh ra `FACE_BAD_ANGLE`.
 *
 * Mục đích của chốt này là **hướng dẫn đúng**, không phải bảo mật: mặt nghiêng làm
 * điểm tương đồng tụt xuống, và người dùng nhận `FACE_NOT_MATCHED` sẽ thử lại nhiều
 * lần mà không biết phải sửa gì.
 */
const quality = (yaw: number | null, pitch: number | null): AiImageQuality => ({
  blur: 140,
  brightness: 128,
  yaw,
  pitch,
  face_px: 220,
});

const MAX_YAW = 30;
const MAX_PITCH = 25;

describe('checkFaceAngle — ngưỡng góc mặt khi chấm công', () => {
  it('CHO QUA khi nhìn thẳng', () => {
    expect(checkFaceAngle(quality(-4.2, 2.1), MAX_YAW, MAX_PITCH)).toBeNull();
  });

  it('CHO QUA ở đúng ngưỡng — so sánh là "lớn hơn", không phải "lớn hơn hoặc bằng"', () => {
    expect(checkFaceAngle(quality(30, 25), MAX_YAW, MAX_PITCH)).toBeNull();
  });

  it.each([
    ['quay sang phải', 45, 0],
    ['quay sang trái', -45, 0],
    ['ngửa lên', 0, 40],
    ['cúi xuống', 0, -40],
  ])('CHẶN khi %s', (_label, yaw, pitch) => {
    // Kiểm cả hai chiều: chỉ chặn một phía là bỏ lọt đúng một nửa số ảnh nghiêng.
    expect(checkFaceAngle(quality(yaw, pitch), MAX_YAW, MAX_PITCH)).not.toBeNull();
  });

  it('trả về chi tiết đủ để dựng thông báo cho người dùng', () => {
    expect(checkFaceAngle(quality(45, 3), MAX_YAW, MAX_PITCH)).toEqual({
      yaw: 45,
      pitch: 3,
      maxYaw: MAX_YAW,
      maxPitch: MAX_PITCH,
    });
  });

  describe('khi AI Server không đo được tư thế đầu', () => {
    /**
     * ⚠ Khác hẳn `action_verified` của AF-05, nơi `null` PHẢI bị coi là chưa xác
     * minh. Ở đây "không đo được" không mở ra lỗ hổng nào — kẻ gian chẳng lợi gì từ
     * việc chụp mặt nghiêng — nên biến thiếu số liệu thành từ chối chỉ làm một
     * thiếu sót cấu hình của AI Server thành sự cố chấm công toàn công ty.
     */
    it('CHO QUA khi cả yaw và pitch là null', () => {
      expect(checkFaceAngle(quality(null, null), MAX_YAW, MAX_PITCH)).toBeNull();
    });

    it('vẫn kiểm trục đo được khi chỉ một trục là null', () => {
      expect(checkFaceAngle(quality(45, null), MAX_YAW, MAX_PITCH)).not.toBeNull();
      expect(checkFaceAngle(quality(null, 5), MAX_YAW, MAX_PITCH)).toBeNull();
    });

    it('CHO QUA khi không có khối quality nào', () => {
      expect(checkFaceAngle(null, MAX_YAW, MAX_PITCH)).toBeNull();
      expect(checkFaceAngle(undefined, MAX_YAW, MAX_PITCH)).toBeNull();
    });
  });
});
