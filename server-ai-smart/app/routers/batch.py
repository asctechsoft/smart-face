"""`POST /v1/batch/audit` — đối chiếu hàng loạt (docs/08 mục 8, AF-08).

Backend chạy tác vụ nền hằng đêm (`ai-batch.processor.ts`), lấy ngẫu nhiên một
tỷ lệ phần trăm lượt chấm công trong ngày và đối chiếu lại với ảnh hồ sơ. Mục
đích là bắt hai thứ:

1. Trường hợp lọt qua ngưỡng nhưng thực chất không phải người đó.
2. Model đang suy giảm chất lượng theo thời gian.

Hàng đợi nằm ở phía Backend (BullMQ). Endpoint này xử lý đồng bộ theo từng lô —
worker của Backend cắt lô rồi gọi vào đây.

⚠ Vẫn chỉ trả số. Việc điểm thấp có đáng gắn cờ nghi vấn hay không do
`fraud.service.ts` quyết định.
"""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends

from ..config import Settings, get_settings
from ..core.engine import Engine, get_engine
from ..core.matcher import verify_1to1
from ..metrics import MATCH_SCORE
from ..runner import Stopwatch
from ..schemas import BatchAuditRequest, BatchAuditResponse, BatchAuditResult
from ..security import require_internal_key
from ..service import analyze_image

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(require_internal_key)])

ENDPOINT = "batch_audit"


@router.post("/v1/batch/audit", response_model=BatchAuditResponse)
async def batch_audit(
    payload: BatchAuditRequest,
    engine: Annotated[Engine, Depends(get_engine)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> BatchAuditResponse:
    stopwatch = Stopwatch()
    results: list[BatchAuditResult] = []

    # Xử lý tuần tự có chủ đích. Tác vụ nền chạy ban đêm không cần nhanh, nhưng
    # tuyệt đối không được giành tài nguyên GPU với chấm công thời gian thực nếu
    # lô chạy trễ sang giờ hành chính.
    for item in payload.items:
        outcome = await analyze_image(
            endpoint=ENDPOINT,
            engine=engine,
            settings=settings,
            image_base64=item.image_base64,
            need_embedding=True,
            need_liveness=False,
            liveness_action=None,
        )

        if outcome.analysis is None or outcome.analysis.embedding is None:
            results.append(
                BatchAuditResult(
                    ref_id=item.ref_id,
                    face_found=False,
                    error_code=outcome.error_code,
                )
            )
            continue

        best, _ = verify_1to1(outcome.analysis.embedding, item.embeddings)
        MATCH_SCORE.observe(best)

        results.append(
            BatchAuditResult(
                ref_id=item.ref_id,
                face_found=True,
                best_score=best,
                liveness_score=(
                    outcome.analysis.liveness.score if outcome.analysis.liveness else None
                ),
            )
        )

    logger.info("Đối chiếu hàng loạt xong: %d bản ghi", len(results))

    return BatchAuditResponse(
        results=results,
        model_version=engine.model_version,
        processing_ms=stopwatch.elapsed_ms,
    )
