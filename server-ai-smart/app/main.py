"""Điểm vào AI Server (ADR-01).

Service Python độc lập, chỉ nhận request từ Backend Core trong mạng nội bộ.
Không có khái niệm người dùng, không có cơ sở dữ liệu, không có nghiệp vụ —
chỉ nhận ảnh và trả số liệu.

Chạy:
    uvicorn app.main:app --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from . import runner
from .config import get_settings
from .core.engine import build_engine, set_engine
from .logging_config import configure_logging
from .metrics import MODEL_INFO
from .routers import batch, enroll, health, identify, index, liveness, verify

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    configure_logging(settings.log_level)
    runner.configure(settings.max_concurrency)

    logger.info("Đang nạp model (%s)...", settings.engine)
    engine = build_engine(settings)
    set_engine(engine)

    if settings.warmup_on_startup:
        engine.warmup()

    MODEL_INFO.labels(
        engine=engine.name,
        model_version=engine.model_version,
        liveness_model=engine.liveness_model_name,
    ).set(1)

    if settings.env != "production" and engine.name == "stub":
        logger.warning("=" * 70)
        logger.warning("AI SERVER ĐANG CHẠY ENGINE GIẢ — SỐ LIỆU NHẬN DIỆN KHÔNG CÓ Ý NGHĨA")
        logger.warning("=" * 70)

    yield

    logger.info("AI Server dừng.")


app = FastAPI(
    title="SmartFace AI Server",
    version="1.0.0",
    description=(
        "Dịch vụ nhận diện khuôn mặt nội bộ.\n\n"
        "**Chỉ trả số liệu, không ra quyết định nghiệp vụ** (nguyên tắc P3, "
        "docs/02 mục 6.1). Ngưỡng nằm ở Backend, theo từng công ty."
    ),
    lifespan=lifespan,
    # Không expose ra internet nên giữ docs để đội phát triển dùng.
    docs_url="/docs",
    openapi_url="/openapi.json",
)

for module in (enroll, verify, identify, liveness, batch, index, health):
    app.include_router(module.router)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request, error: RequestValidationError
) -> JSONResponse:
    """Trả 422 mà KHÔNG vọng lại nội dung request.

    Handler mặc định của FastAPI đưa nguyên `exc.errors()` vào phản hồi, trong đó
    có khoá `input` chứa body thô. Ở service này body là ẢNH KHUÔN MẶT — để mặc
    định thì ảnh sinh trắc học bị chép vào payload lỗi và vào log, đúng thứ
    `NFR-OBS-08` cấm.

    Nó còn làm hỏng cả đường lỗi: `jsonable_encoder` gọi `bytes.decode()` trên
    body, nên mọi request sai định dạng mang theo ảnh JPEG đều nổ UnicodeDecodeError
    và biến 422 thành 500 — Backend đọc thành "AI Server hỏng" rồi mở circuit
    breaker, thay vì thấy "request sai" và sửa lời gọi.

    Chỉ giữ vị trí và loại lỗi, bỏ `input` lẫn `ctx`.
    """
    fields = [
        {"loc": [str(part) for part in item.get("loc", ())], "type": item.get("type", "")}
        for item in error.errors()
    ]
    logger.warning("Request sai định dạng tại %s: %s", request.url.path, fields)
    return JSONResponse(status_code=422, content={"detail": fields})


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, error: Exception) -> JSONResponse:
    """Lưới an toàn cuối cùng.

    Trả 500 để circuit breaker phía Backend đếm được lỗi (NFR-REL-05). Nội dung
    lỗi KHÔNG lộ ra ngoài phản hồi — chi tiết chỉ nằm trong log.
    """
    logger.exception("Lỗi chưa xử lý tại %s: %s", request.url.path, error)
    return JSONResponse(
        status_code=500,
        content={"detail": "Lỗi nội bộ AI Server."},
    )


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level.lower(),
    )
