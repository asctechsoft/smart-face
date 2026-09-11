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

import logging
import time
from collections.abc import Callable
from typing import TypeVar

import anyio

from .errors import DeadlineExceededError
from .metrics import CONCURRENT_INFERENCES, INFERENCE_SECONDS

logger = logging.getLogger(__name__)

T = TypeVar("T")

_limiter: anyio.CapacityLimiter | None = None
_queue_budget_seconds: float = 0.0


def configure(max_concurrency: int, max_processing_ms: int = 0) -> None:
    global _limiter, _queue_budget_seconds
    _limiter = anyio.CapacityLimiter(max(1, max_concurrency))

    # Chỉ dành MỘT PHẦN ngân sách cho việc chờ hàng đợi — phần còn lại là để
    # thực sự chạy suy luận. Chờ hết 2000ms rồi mới bắt đầu tính thì cầm chắc
    # vượt hạn; 40% là chỗ để một request vẫn kịp về sau khi đã phải xếp hàng.
    _queue_budget_seconds = (max_processing_ms / 1000.0) * 0.4 if max_processing_ms > 0 else 0.0


async def run_inference(endpoint: str, function: Callable[[], T]) -> T:
    if _limiter is None:  # pragma: no cover — vòng đời ứng dụng luôn gọi configure()
        raise RuntimeError("runner.configure() chưa được gọi.")

    CONCURRENT_INFERENCES.inc()
    started = time.perf_counter()
    acquired = False
    try:
        if _queue_budget_seconds > 0:
            # Tự giữ token thay vì để `to_thread.run_sync(limiter=...)` giữ hộ,
            # vì chỉ khi tách riêng bước xếp hàng mới đặt được hạn cho RIÊNG nó.
            # Đặt hạn cho cả lượt chạy thì `move_on_after` sẽ bỏ mặc thread ONNX
            # đang chạy dở — request trả về nhưng CPU vẫn bị chiếm, tức là không
            # giải quyết gì.
            with anyio.move_on_after(_queue_budget_seconds) as scope:
                await _limiter.acquire()
                acquired = True
            if scope.cancelled_caught:
                logger.warning(
                    "Từ chối %s: chờ hàng đợi quá %.0fms.",
                    endpoint,
                    _queue_budget_seconds * 1000,
                )
                raise DeadlineExceededError(endpoint)
            return await anyio.to_thread.run_sync(function)

        return await anyio.to_thread.run_sync(function, limiter=_limiter)
    finally:
        if acquired:
            _limiter.release()
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
