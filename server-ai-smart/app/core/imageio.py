"""Giải mã ảnh đầu vào.

Đây là bề mặt tấn công đầu tiên của AI Server: dữ liệu do người dùng cuối chụp,
đi qua App, qua Backend, tới đây. Giới hạn kích thước và bắt lỗi giải mã phải
làm ở đây, không đẩy cho tầng dưới.
"""

from __future__ import annotations

import base64
import binascii

import cv2
import numpy as np

from ..errors import FACE_NOT_FOUND, ImageRejectedError

_DATA_URI_PREFIX = "data:image/"

#: Ảnh lớn hơn mức này không giúp nhận diện tốt hơn, chỉ tốn thời gian.
_MAX_EDGE = 1920


def decode_base64_image(payload: str, max_bytes: int) -> np.ndarray:
    """base64 (có hoặc không có tiền tố data URI) → ảnh BGR."""
    data = payload.strip()

    if data.startswith(_DATA_URI_PREFIX):
        _, _, data = data.partition(",")

    # base64 phình ~4/3 so với dữ liệu gốc. Chặn trước khi giải mã để một chuỗi
    # 200MB không kịp cấp phát bộ nhớ.
    if len(data) > max_bytes * 4 // 3 + 8:
        raise ImageRejectedError(FACE_NOT_FOUND, "Ảnh vượt quá kích thước cho phép.")

    try:
        raw = base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ImageRejectedError(FACE_NOT_FOUND, "Chuỗi base64 không hợp lệ.") from error

    return decode_bytes(raw, max_bytes)


def decode_bytes(raw: bytes, max_bytes: int) -> np.ndarray:
    if not raw:
        raise ImageRejectedError(FACE_NOT_FOUND, "Ảnh rỗng.")
    if len(raw) > max_bytes:
        raise ImageRejectedError(FACE_NOT_FOUND, "Ảnh vượt quá kích thước cho phép.")

    buffer = np.frombuffer(raw, dtype=np.uint8)
    image = cv2.imdecode(buffer, cv2.IMREAD_COLOR)

    if image is None:
        raise ImageRejectedError(FACE_NOT_FOUND, "Không giải mã được ảnh (định dạng không hỗ trợ).")

    return _downscale(image)


def _downscale(image: np.ndarray) -> np.ndarray:
    height, width = image.shape[:2]
    longest = max(height, width)
    if longest <= _MAX_EDGE:
        return image

    scale = _MAX_EDGE / longest
    return cv2.resize(
        image,
        (int(width * scale), int(height * scale)),
        interpolation=cv2.INTER_AREA,
    )
