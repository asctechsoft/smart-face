"""Xác minh hành động liveness (AF-05).

Server chọn ngẫu nhiên một hành động mỗi lượt và kiểm tra người dùng có làm đúng
không. Mục đích: chặn kẻ tấn công quay sẵn một đoạn video rồi phát lại.

**Chỉ số điểm mốc dùng chuẩn iBUG-68**, là bố cục mà `landmark_3d_68` của
insightface tuân theo. Đây là quy ước công khai đã ổn định nhiều năm, không phải
con số đoán ra.

---

## Giới hạn cần biết rõ trước khi tin vào kết quả

Hợp đồng ở docs/08 nhận **một ảnh tĩnh**. Từ một khung hình:

| Hành động | Xác minh được? | Vì sao |
|---|---|---|
| `TURN_LEFT` / `TURN_RIGHT` | Được | Góc yaw đo trực tiếp từ tư thế đầu |
| `NOD` | Được, một phần | Đo được đầu đang cúi, không đo được *động tác* gật |
| `BLINK` | Yếu | Chỉ biết mắt đang nhắm, không biết vừa chớp |
| `SMILE` | Được, một phần | Đo được đang cười, không biết cười lúc nào |

`BLINK` và `NOD` về bản chất là **chuyển động**, cần chuỗi khung hình mới xác
minh đúng nghĩa. Hàm `verify_action_sequence` ở cuối file xử lý trường hợp đó
khi App gửi nhiều khung.

Vì vậy tầng gọi phải trả `action_verified=None` (chứ không phải `True`) khi
không xác định được — Backend coi `None` là **chưa xác minh**. Trả `True` cho
thứ mình không đo được là cách tự tay tạo ra lỗ hổng chấm hộ.
"""

from __future__ import annotations

import numpy as np

# --- Bố cục iBUG-68 ---------------------------------------------------------
# Mắt trái/phải theo góc nhìn CỦA ẢNH, không phải của người trong ảnh.
LEFT_EYE = (36, 37, 38, 39, 40, 41)
RIGHT_EYE = (42, 43, 44, 45, 46, 47)
MOUTH_OUTER_CORNERS = (48, 54)
MOUTH_OUTER_TOP = 51
MOUTH_OUTER_BOTTOM = 57

#: Dưới mức này coi như mắt đang nhắm. Giá trị kinh nghiệm phổ biến cho EAR.
EAR_CLOSED = 0.20

#: Miệng rộng ra tương đối so với chiều cao khuôn mặt khi cười.
SMILE_WIDTH_RATIO = 0.38


def eye_aspect_ratio(points: np.ndarray, eye: tuple[int, ...]) -> float:
    """EAR — tỷ lệ chiều cao trên chiều rộng của mắt.

    Chuẩn hoá theo chiều rộng chính con mắt nên không phụ thuộc khoảng cách chụp.
    """
    p = points[list(eye)][:, :2]
    vertical = np.linalg.norm(p[1] - p[5]) + np.linalg.norm(p[2] - p[4])
    horizontal = np.linalg.norm(p[0] - p[3])
    if horizontal < 1e-6:
        return 0.0
    return float(vertical / (2.0 * horizontal))


def mouth_width_ratio(points: np.ndarray) -> float:
    """Chiều rộng miệng so với chiều cao khuôn mặt.

    Dùng chiều cao khuôn mặt làm mẫu số thay vì chiều cao miệng: há miệng ngạc
    nhiên cũng làm miệng cao lên, nhưng chỉ khi cười miệng mới rộng ra.
    """
    p = points[:, :2]
    left, right = p[MOUTH_OUTER_CORNERS[0]], p[MOUTH_OUTER_CORNERS[1]]
    width = float(np.linalg.norm(right - left))

    face_height = float(np.linalg.norm(p[8] - (p[19] + p[24]) / 2.0))
    if face_height < 1e-6:
        return 0.0
    return width / face_height


def verify_action_single_frame(
    action: str,
    pose: tuple[float, float, float] | None,
    landmarks68: np.ndarray | None,
    yaw_threshold: float,
    pitch_threshold: float,
) -> bool | None:
    """Xác minh hành động từ MỘT khung hình.

    Trả `None` nghĩa là không đủ dữ liệu để kết luận — tuyệt đối không quy đổi
    thành `True`.
    """
    if action in ("TURN_LEFT", "TURN_RIGHT"):
        if pose is None:
            return None
        yaw = float(pose[1])
        # Quy ước insightface: yaw dương = đầu quay sang phải theo góc nhìn ảnh,
        # tức là người trong ảnh quay sang TRÁI của chính họ. Hướng dẫn hiển thị
        # cho người dùng là "quay sang trái" nên bám theo góc nhìn của họ.
        return yaw > yaw_threshold if action == "TURN_LEFT" else yaw < -yaw_threshold

    if action == "NOD":
        if pose is None:
            return None
        return abs(float(pose[0])) > pitch_threshold

    if action == "BLINK":
        if landmarks68 is None or len(landmarks68) < 68:
            return None
        left = eye_aspect_ratio(landmarks68, LEFT_EYE)
        right = eye_aspect_ratio(landmarks68, RIGHT_EYE)
        # Cả hai mắt cùng nhắm. Một mắt nhắm là nheo mắt hoặc lỗi điểm mốc.
        return left < EAR_CLOSED and right < EAR_CLOSED

    if action == "SMILE":
        if landmarks68 is None or len(landmarks68) < 68:
            return None
        return mouth_width_ratio(landmarks68) > SMILE_WIDTH_RATIO

    return None


def verify_action_sequence(
    action: str,
    frames: list[tuple[tuple[float, float, float] | None, np.ndarray | None]],
    yaw_threshold: float,
    pitch_threshold: float,
) -> bool | None:
    """Xác minh trên chuỗi khung hình — cách duy nhất đúng cho BLINK và NOD.

    Yêu cầu thấy được cả trạng thái trước lẫn sau, chứ không chỉ trạng thái cuối.
    Nhờ vậy một tấm ảnh in người đang nhắm mắt không qua được `BLINK`.
    """
    if len(frames) < 2:
        return None

    if action == "BLINK":
        ratios = [
            min(
                eye_aspect_ratio(marks, LEFT_EYE),
                eye_aspect_ratio(marks, RIGHT_EYE),
            )
            for _, marks in frames
            if marks is not None and len(marks) >= 68
        ]
        if len(ratios) < 2:
            return None
        # Phải có lúc mở VÀ có lúc nhắm mới gọi là chớp mắt.
        return max(ratios) > EAR_CLOSED * 1.5 and min(ratios) < EAR_CLOSED

    if action == "NOD":
        pitches = [float(pose[0]) for pose, _ in frames if pose is not None]
        if len(pitches) < 2:
            return None
        return max(pitches) - min(pitches) > pitch_threshold

    # Các hành động tĩnh: chỉ cần một khung nào đó thoả.
    for pose, marks in frames:
        if verify_action_single_frame(action, pose, marks, yaw_threshold, pitch_threshold):
            return True
    return False
