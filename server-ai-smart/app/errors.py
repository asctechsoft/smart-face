"""Mã lỗi AI Server.

⚠ RÀNG BUỘC QUAN TRỌNG: chỉ được trả về những mã có trong `AI_ERROR_MAP` ở
`server-backend-smart/src/modules/ai-gateway/ai-gateway.types.ts`. Mã lạ sẽ bị Backend hiểu
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

#: Mã mà pipeline hiện ĐANG phát ra. Mỗi mã có một chỗ `raise` thật trong code.
EMITTED_ERROR_CODES: Final[frozenset[str]] = frozenset(
    {
        FACE_NOT_FOUND,  # core/engine.py, core/imageio.py
        MULTIPLE_FACES,  # core/engine.py
        IMG_TOO_DARK,  # core/quality.py
        IMG_BACKLIT,  # core/quality.py
        IMG_BLURRY,  # core/quality.py
        FACE_TOO_SMALL,  # core/engine.py
        BAD_ANGLE,  # core/quality.py
    }
)

#: Mã đã khai và Backend ánh xạ được, nhưng KHÔNG chỗ nào phát ra. Giữ lại có chủ
#: đích, không phải sót:
#:
#: - `MASK_DETECTED`, `FACE_OCCLUDED` — cần một model phân loại riêng, không suy ra
#:   được từ pipeline hiện tại. Xem README mục 8.
#: - `LIVENESS_FAILED` — AI Server sẽ KHÔNG BAO GIỜ phát mã này, và đó là đúng thiết
#:   kế. Theo P3 nó chỉ trả `liveness.score`; việc điểm đó có dưới ngưỡng hay không
#:   là quyết định nghiệp vụ, Backend so rồi tự ném `FACE_LIVENESS_FAILED`. Mã nằm
#:   trong `AI_ERROR_MAP` vì bảng đó là bảng ÁNH XẠ, không phải danh sách mã AI phát.
DECLARED_ONLY_ERROR_CODES: Final[frozenset[str]] = frozenset(
    {
        MASK_DETECTED,
        FACE_OCCLUDED,
        LIVENESS_FAILED,
    }
)

#: Tập mã hợp lệ — Backend ánh xạ được đúng từng mã này.
KNOWN_ERROR_CODES: Final[frozenset[str]] = EMITTED_ERROR_CODES | DECLARED_ONLY_ERROR_CODES


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
