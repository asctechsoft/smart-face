"""Chạy suy luận ngoài event loop, có giới hạn số lượng đồng thời.

Hai vấn đề file này giải quyết:

1. **Suy luận ONNX là tác vụ chặn.** Gọi thẳng trong hàm `async` sẽ đóng băng
   event loop — mọi request khác, kể cả `/health`, treo theo. Phải đẩy sang
   luồng khác.

2. **Thả tự do lại làm chậm hơn.** ONNXRuntime tự chiếm nhiều lõi CPU cho một
   phép suy luận. Chạy 50 request song song không nhanh gấp 50 lần mà làm cả 50
   cùng chậm, p99 nát. Giới hạn bằng semaphore cho phép các request xếp hàng
   thay vì chen nhau.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import TypeVar

import anyio

from .metrics import CONCURRENT_INFERENCES, INFERENCE_SECONDS

T = TypeVar("T")

_limiter: anyio.CapacityLimiter | None = None


def configure(max_concurrency: int) -> None:
    global _limiter
    _limiter = anyio.CapacityLimiter(max(1, max_concurrency))


async def run_inference(endpoint: str, function: Callable[[], T]) -> T:
    if _limiter is None:  # pragma: no cover — vòng đời ứng dụng luôn gọi configure()
        raise RuntimeError("runner.configure() chưa được gọi.")

    CONCURRENT_INFERENCES.inc()
    started = time.perf_counter()
    try:
        return await anyio.to_thread.run_sync(function, limiter=_limiter)
    finally:
        INFERENCE_SECONDS.labels(endpoint=endpoint).observe(time.perf_counter() - started)
        CONCURRENT_INFERENCES.dec()


class Stopwatch:
    """Đo `processing_ms` — trường bắt buộc trong mọi phản hồi (docs/08 mục 8)."""

    __slots__ = ("_started",)

    def __init__(self) -> None:
        self._started = time.perf_counter()

    @property
    def elapsed_ms(self) -> int:
        return int((time.perf_counter() - self._started) * 1000)
