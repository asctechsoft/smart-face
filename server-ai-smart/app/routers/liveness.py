"""`POST /v1/liveness` — chỉ kiểm tra người thật, không cần embedding (docs/08 mục 8).

Nhẹ hơn `/v1/verify` vì bỏ qua bước trích đặc trưng nhận dạng. Dùng khi chỉ cần
sàng lọc trước, ví dụ App muốn báo sớm "ảnh này là chụp lại màn hình" trước khi
người dùng bấm chấm công.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from ..config import Settings, get_settings
from ..core.engine import Engine, get_engine
from ..runner import Stopwatch
from ..schemas import LivenessRequest, LivenessResponse
from ..security import require_internal_key
from ..service import analyze_image, to_liveness, to_quality

router = APIRouter(dependencies=[Depends(require_internal_key)])

ENDPOINT = "liveness"


@router.post("/v1/liveness", response_model=LivenessResponse)
async def check_liveness(
    payload: LivenessRequest,
    engine: Annotated[Engine, Depends(get_engine)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> LivenessResponse:
    """Chấm điểm người thật cho một tấm ảnh.

    ⚠ Kết quả ở đây KHÔNG được dùng thay cho lần kiểm tra trong `/v1/verify`.
    App gọi endpoint này chỉ để phản hồi sớm cho người dùng; client hoàn toàn có
    thể bỏ qua bước này. Lần kiểm tra có giá trị pháp lý là lần chạy trong cùng
    request chấm công, nơi Backend nắm được kết quả (BR-02).
    """
    stopwatch = Stopwatch()

    outcome = await analyze_image(
        endpoint=ENDPOINT,
        engine=engine,
        settings=settings,
        image_base64=payload.image_base64,
        # Bỏ hẳn bước trích đặc trưng nhận dạng: endpoint này không so khớp ai
        # với ai, chạy thêm chỉ tốn thời gian GPU mà không ai dùng kết quả.
        need_embedding=False,
        # Endpoint này tồn tại để đo liveness — luôn bật, bỏ qua cờ của client.
        need_liveness=True,
        liveness_action=payload.liveness_action,
    )

    if outcome.analysis is None:
        return LivenessResponse(
            face_found=False,
            error_code=outcome.error_code,
            processing_ms=stopwatch.elapsed_ms,
        )

    analysis = outcome.analysis
    return LivenessResponse(
        face_found=True,
        quality=to_quality(analysis),
        liveness=to_liveness(analysis),
        model_version=analysis.model_version,
        processing_ms=stopwatch.elapsed_ms,
    )
