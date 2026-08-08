"""Cấu hình log.

⚠ NFR-OBS-08: KHÔNG BAO GIỜ ghi log ảnh, embedding, token hay OTP.

Ảnh khuôn mặt là dữ liệu sinh trắc học. Embedding tuy không khôi phục lại được
ảnh gốc nhưng vẫn định danh được một con người cụ thể — lọt vào file log là sự
cố dữ liệu cá nhân, không phải phiền toái nhỏ.

`SensitivePayloadFilter` ở dưới là lưới an toàn cuối cùng, không phải giấy phép
để viết ẩu. Đừng đưa dữ liệu nhạy cảm vào lời gọi log ngay từ đầu.
"""

from __future__ import annotations

import logging
import re
import sys

#: base64 dài liên tục ~ ảnh; dãy số dài phân tách bởi dấu phẩy ~ embedding.
_SUSPICIOUS = re.compile(
    r"(data:image/[a-z]+;base64,[A-Za-z0-9+/=]+)"
    r"|([A-Za-z0-9+/]{200,}={0,2})"
    r"|((?:-?\d\.\d{4,},\s*){8,})"
)


class SensitivePayloadFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:  # pragma: no cover — log hỏng không được làm sập app
            return True

        if _SUSPICIOUS.search(message):
            record.msg = _SUSPICIOUS.sub("<đã lược bỏ: dữ liệu nhạy cảm>", message)
            record.args = ()
        return True


def configure_logging(level: str) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)-7s [%(name)s] %(message)s")
    )
    handler.addFilter(SensitivePayloadFilter())

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level.upper())

    # uvicorn.access ghi từng request; giữ lại nhưng cùng định dạng.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(name)
        logger.handlers.clear()
        logger.propagate = True
