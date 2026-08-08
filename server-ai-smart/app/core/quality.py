"""Đo chất lượng ảnh — bước 1 của pipeline (docs/02 mục 6.3).

Phân biệt rõ hai loại ngưỡng, đây là chỗ hay bị lẫn:

- **Sàn kỹ thuật** (trong file này): ảnh hỏng tới mức embedding trích ra là rác.
  Trả số liệu cũng vô nghĩa nên từ chối luôn kèm mã lỗi cụ thể để App hướng dẫn
  người dùng chụp lại.
- **Ngưỡng nghiệp vụ** (ở Backend): `min_face_pixels`, `liveness_threshold`,
  `face_match_threshold`. Mỗi công ty một giá trị, đổi được không cần deploy.

Ví dụ: mặt 60px vượt sàn kỹ thuật 48px nên AI Server trả số liệu bình thường,
rồi Backend từ chối vì chính sách công ty đòi tối thiểu 112px.
"""

from __future__ import annotations

import cv2
import numpy as np

from ..config import Settings
from ..errors import (
    IMG_BACKLIT,
    IMG_BLURRY,
    IMG_TOO_DARK,
    ImageRejectedError,
)
from .types import Quality


def measure(
    image: np.ndarray,
    face_box: tuple[int, int, int, int],
    pose: tuple[float, float, float] | None,
) -> Quality:
    """Đo trên VÙNG KHUÔN MẶT, không phải toàn ảnh.

    Đo toàn ảnh là sai lầm phổ biến: người đứng trước cửa sổ sáng chói vẫn có độ
    sáng trung bình đẹp trong khi mặt tối đen.
    """
    x1, y1, x2, y2 = face_box
    crop = image[max(y1, 0) : max(y2, 0), max(x1, 0) : max(x2, 0)]

    if crop.size == 0:
        crop = image

    grey = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)

    return Quality(
        blur=float(cv2.Laplacian(grey, cv2.CV_64F).var()),
        brightness=float(grey.mean()),
        yaw=None if pose is None else round(float(pose[1]), 2),
        pitch=None if pose is None else round(float(pose[0]), 2),
        face_px=int(min(x2 - x1, y2 - y1)),
    )


def enforce_technical_floor(quality: Quality, image: np.ndarray, settings: Settings) -> None:
    """Chặn ảnh hỏng tới mức không trích được đặc trưng.

    Thứ tự kiểm tra có chủ đích: báo lỗi ánh sáng trước lỗi nhoè, vì ảnh chụp
    thiếu sáng gần như luôn kèm nhoè do máy tự tăng thời gian phơi sáng. Báo
    "ảnh mờ" cho người đang đứng chỗ tối là hướng dẫn sai — họ sẽ cố giữ tay
    thật vững thay vì đi tìm chỗ sáng hơn.
    """
    if quality.brightness < settings.floor_brightness_dark:
        raise ImageRejectedError(
            IMG_TOO_DARK,
            f"Vùng khuôn mặt quá tối (độ sáng {quality.brightness:.0f}).",
        )

    if quality.brightness > settings.floor_brightness_bright:
        raise ImageRejectedError(
            IMG_BACKLIT,
            f"Vùng khuôn mặt cháy sáng (độ sáng {quality.brightness:.0f}).",
        )

    # Ngược sáng: nền sáng hơn hẳn mặt. Độ sáng vùng mặt vẫn có thể nằm trong
    # khoảng hợp lệ nên phải so tương quan mới phát hiện được.
    background = float(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY).mean())
    if background - quality.brightness > 70.0:
        raise ImageRejectedError(
            IMG_BACKLIT,
            "Ngược sáng: nền sáng hơn khuôn mặt quá nhiều.",
        )

    if quality.blur < settings.floor_blur:
        raise ImageRejectedError(
            IMG_BLURRY,
            f"Ảnh nhoè (phương sai Laplacian {quality.blur:.1f}).",
        )
