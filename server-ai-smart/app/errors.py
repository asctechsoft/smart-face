"""Mã lỗi AI Server.

⚠ RÀNG BUỘC QUAN TRỌNG: chỉ được trả về những mã có trong `AI_ERROR_MAP` ở
`BackEnd/src/modules/ai-gateway/ai-gateway.types.ts`. Mã lạ sẽ bị Backend hiểu
nhầm thành `FACE_NOT_FOUND` — người dùng nhận được thông báo sai hoàn toàn so
với lỗi thật.

Thêm mã mới ở đây thì PHẢI thêm đồng thời vào `AI_ERROR_MAP` phía Backend.
"""

from __future__ import annotations

from typing import Final

FACE_NOT_FOUND: Final = "FACE_NOT_FOUND"
MULTIPLE_FACES: Final = "MULTIPLE_FACES"
IMG_TOO_DARK: Final = "IMG_TOO_DARK"
IMG_BACKLIT: Final = "IMG_BACKLIT"
IMG_BLURRY: Final = "IMG_BLURRY"
FACE_TOO_SMALL: Final = "FACE_TOO_SMALL"
BAD_ANGLE: Final = "BAD_ANGLE"
MASK_DETECTED: Final = "MASK_DETECTED"
FACE_OCCLUDED: Final = "FACE_OCCLUDED"
LIVENESS_FAILED: Final = "LIVENESS_FAILED"

#: Tập mã hợp lệ — Backend ánh xạ được đúng từng mã này.
KNOWN_ERROR_CODES: Final[frozenset[str]] = frozenset(
    {
        FACE_NOT_FOUND,
        MULTIPLE_FACES,
        IMG_TOO_DARK,
        IMG_BACKLIT,
        IMG_BLURRY,
        FACE_TOO_SMALL,
        BAD_ANGLE,
        MASK_DETECTED,
        FACE_OCCLUDED,
        LIVENESS_FAILED,
    }
)


class ImageRejectedError(Exception):
    """Ảnh không dùng được — trả 200 kèm `face_found: false` và `error_code`.

    Không phải lỗi HTTP: Backend cần đọc được `error_code` để chọn thông báo
    hướng dẫn người dùng chụp lại.
    """

    def __init__(self, code: str, detail: str = "") -> None:
        if code not in KNOWN_ERROR_CODES:
            raise AssertionError(
                f"Mã lỗi {code!r} chưa có trong AI_ERROR_MAP của Backend — "
                "trả về sẽ bị hiểu nhầm thành FACE_NOT_FOUND."
            )
        super().__init__(detail or code)
        self.code = code
        self.detail = detail
