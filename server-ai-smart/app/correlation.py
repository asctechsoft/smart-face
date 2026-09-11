"""Chuỗi truy vết xuyên Backend → AI Server (`NFR-AUD-02`, docs/07 §9).

## Vấn đề file này giải quyết

AI Server ghi log riêng, Backend ghi log riêng, và trước đây không có gì nối hai
bên lại. Khi một lượt chấm công bị từ chối vì `livenessScore` thấp, người vận
hành nhìn thấy bản ghi ở Backend nhưng không tìm được dòng log AI tương ứng để
biết mô hình đã thấy gì — trừ khi đoán theo mốc thời gian, và mốc thời gian thì
trùng nhau hàng loạt vào giờ cao điểm.

## Cách hoạt động

Backend gửi `X-Correlation-Id` (và `X-Trace-Id` cho tương thích). Middleware đọc
ra, đặt vào `ContextVar` để mọi dòng log trong cùng request tự mang theo, rồi
trả lại trong header phản hồi để bên gọi ghi nhận được cả chiều về.

`ContextVar` chứ không phải biến toàn cục: mỗi request là một context riêng,
nên hai request chạy song song không giẫm lên id của nhau.
"""

from __future__ import annotations

import logging
import uuid
from contextvars import ContextVar

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

CORRELATION_HEADER = "X-Correlation-Id"
TRACE_HEADER = "X-Trace-Id"

#: Giá trị khi không có request nào đang chạy (log lúc khởi động, log của worker).
_UNSET = "-"

_correlation_id: ContextVar[str] = ContextVar("correlation_id", default=_UNSET)


def get_correlation_id() -> str:
    return _correlation_id.get()


def set_correlation_id(value: str) -> None:
    _correlation_id.set(value)


class CorrelationIdFilter(logging.Filter):
    """Gắn `correlation_id` vào mọi bản ghi log để formatter dùng được."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.correlation_id = get_correlation_id()
        return True


class CorrelationIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):  # type: ignore[override]
        incoming = (
            request.headers.get(CORRELATION_HEADER)
            or request.headers.get(TRACE_HEADER)
            # Không có thì tự sinh: log vẫn nối được trong phạm vi một request,
            # và đường không có id trở thành thứ nhìn thấy được khi đối chiếu.
            or f"ai-{uuid.uuid4().hex[:16]}"
        )
        # Cắt ngắn phòng người gọi nhét cả một chuỗi dài vào header — id đi vào
        # mọi dòng log nên độ dài của nó là chi phí thật.
        value = incoming[:64]

        set_correlation_id(value)
        response: Response = await call_next(request)
        response.headers[CORRELATION_HEADER] = value
        return response
