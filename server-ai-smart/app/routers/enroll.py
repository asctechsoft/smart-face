"""`POST /v1/enroll` — trích embedding từ ảnh đăng ký (docs/08 mục 8).

Nhận cả hai định dạng:

- **JSON** `{image_base64, require_liveness, liveness_action}` — đây là cái
  `AiGatewayService.enroll()` của Backend đang gửi.
- **multipart/form-data** — đúng như docs/08 mô tả.

Tài liệu và code Backend lệch nhau ở điểm này. Nhận cả hai để không bên nào phải
sửa, và ghi lại ở đây để người đọc sau không tưởng là nhầm lẫn.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, UploadFile

from ..config import Settings, get_settings
from ..core.engine import Engine, get_engine
from ..runner import Stopwatch
from ..schemas import EnrollRequest, EnrollResponse, LivenessAction
from ..security import require_internal_key
from ..service import (
    analyze_image,
    analyze_raw,
    embedding_to_list,
    to_liveness,
    to_quality,
)

router = APIRouter(dependencies=[Depends(require_internal_key)])

ENDPOINT = "enroll"


@router.post("/v1/enroll", response_model=EnrollResponse)
async def enroll_json(
    payload: EnrollRequest,
    engine: Annotated[Engine, Depends(get_engine)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> EnrollResponse:
    """Nhánh JSON — đúng thứ `AiGatewayService.enroll()` của Backend đang gửi."""
    stopwatch = Stopwatch()

    outcome = await analyze_image(
        endpoint=ENDPOINT,
        engine=engine,
        settings=settings,
        image_base64=payload.image_base64,
        need_embedding=True,
        need_liveness=payload.require_liveness,
        liveness_action=payload.liveness_action,
    )
    return _build(outcome, stopwatch)


@router.post("/v1/enroll/multipart", response_model=EnrollResponse)
async def enroll_multipart(
    engine: Annotated[Engine, Depends(get_engine)],
    settings: Annotated[Settings, Depends(get_settings)],
    image: Annotated[UploadFile, File()],
    require_liveness: Annotated[bool, Form()] = False,
    liveness_action: Annotated[LivenessAction | None, Form()] = None,
) -> EnrollResponse:
    """Nhánh multipart — đúng như docs/08 mô tả.

    Tiết kiệm ~33% băng thông so với base64 (base64 làm phình dữ liệu 4/3 lần),
    đáng kể khi App upload nhiều ảnh đăng ký liên tiếp qua mạng di động.
    """
    stopwatch = Stopwatch()
    # `imageio.decode_bytes` bên dưới mới là chỗ chặn ảnh quá lớn theo
    # `max_image_bytes`. Ở tầng này nên đặt thêm giới hạn kích thước body ở
    # reverse proxy (Nginx `client_max_body_size`) để chặn từ vòng ngoài.
    raw = await image.read()

    outcome = await analyze_raw(
        endpoint=ENDPOINT,
        engine=engine,
        settings=settings,
        raw=raw,
        need_embedding=True,
        need_liveness=require_liveness,
        liveness_action=liveness_action,
    )
    return _build(outcome, stopwatch)


def _build(outcome, stopwatch: Stopwatch) -> EnrollResponse:
    """Dựng phản hồi chung cho cả hai nhánh JSON và multipart.

    Gom vào một chỗ để hai nhánh không bao giờ trả về hình dạng khác nhau — App
    sẽ không phải xử lý hai kiểu phản hồi cho cùng một nghiệp vụ đăng ký.
    """
    if outcome.analysis is None:
        return EnrollResponse(
            face_found=False,
            error_code=outcome.error_code,
            processing_ms=stopwatch.elapsed_ms,
        )

    analysis = outcome.analysis
    return EnrollResponse(
        face_found=True,
        quality=to_quality(analysis),
        liveness=to_liveness(analysis),
        embedding=embedding_to_list(analysis.embedding),
        model_version=analysis.model_version,
        processing_ms=stopwatch.elapsed_ms,
    )
