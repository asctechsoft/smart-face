"""`GET /health` và `GET /metrics` (docs/08 mục 8).

Hai endpoint này KHÔNG yêu cầu `X-Internal-Key`: Kubernetes probe và Prometheus
scraper không mang được khoá đó. Bù lại chúng không tiết lộ dữ liệu cá nhân nào
— chỉ tình trạng model và số liệu tổng hợp.
"""

from __future__ import annotations

import time
from typing import Annotated

from fastapi import APIRouter, Depends, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from ..core.engine import Engine, get_engine
from ..metrics import REGISTRY
from ..schemas import GpuInfo, HealthResponse, ModelInfo

router = APIRouter()

_STARTED_AT = time.time()


@router.get("/health", response_model=HealthResponse)
async def health(engine: Annotated[Engine, Depends(get_engine)]) -> HealthResponse:
    name, _, version = engine.model_version.partition("@")

    # `degraded` khi đang chạy ở chế độ không dùng được cho production. Người
    # vận hành phải nhìn thấy điều này trên dashboard chứ không phải phát hiện
    # ra khi đã có sự cố chấm công hộ.
    healthy = engine.name != "stub" and engine.liveness_model_name not in (
        "none",
        "heuristic-fallback",
    )

    return HealthResponse(
        status="healthy" if healthy else "degraded",
        engine=engine.name,
        model=ModelInfo(
            name=name,
            version=version or "unknown",
            loaded_at=engine.loaded_at.isoformat().replace("+00:00", "Z"),
        ),
        liveness_model=engine.liveness_model_name,
        gpu=_gpu_info(),
        uptime_seconds=int(time.time() - _STARTED_AT),
    )


@router.get("/metrics")
async def metrics() -> Response:
    return Response(content=generate_latest(REGISTRY), media_type=CONTENT_TYPE_LATEST)


def _gpu_info() -> GpuInfo | None:
    """Đọc tình trạng GPU qua NVML nếu có.

    Không cài `pynvml` thì trả `None` — đây là thông tin để giám sát, thiếu nó
    không được làm health check thất bại.
    """
    try:
        import pynvml  # type: ignore[import-not-found]

        pynvml.nvmlInit()
        handle = pynvml.nvmlDeviceGetHandleByIndex(0)
        utilization = pynvml.nvmlDeviceGetUtilizationRates(handle)
        memory = pynvml.nvmlDeviceGetMemoryInfo(handle)
        return GpuInfo(
            available=True,
            utilization=round(utilization.gpu / 100.0, 4),
            memory_used_mb=int(memory.used / 1024 / 1024),
        )
    except Exception:
        return None
