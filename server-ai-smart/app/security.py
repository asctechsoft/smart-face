"""Xác thực nội bộ giữa Backend và AI Server (docs/02 mục 6.2)."""

from __future__ import annotations

import hmac

from fastapi import Header, HTTPException, status

from .config import get_settings


async def require_internal_key(
    x_internal_key: str | None = Header(default=None, alias="X-Internal-Key"),
) -> None:
    """Chặn mọi request không đến từ Backend Core.

    Dùng `hmac.compare_digest` chứ không dùng `==`: so sánh chuỗi thông thường
    thoát sớm ở byte đầu tiên khác nhau, thời gian phản hồi rò rỉ dần từng ký tự
    của khoá.
    """
    settings = get_settings()

    if not settings.internal_key:
        # Chỉ xảy ra ở môi trường phát triển — production đã bị chặn ở config.
        return

    if x_internal_key is None or not hmac.compare_digest(x_internal_key, settings.internal_key):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="X-Internal-Key không hợp lệ.",
        )
