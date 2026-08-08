"""`POST /v1/verify` — so khớp 1:1, dùng cho chấm công qua App (docs/08 mục 8).

Bài toán 1:1 vì Backend đã biết người chấm công là ai (đã đăng nhập) và gửi lên
đúng các embedding của người đó.

⚠ Phản hồi trả `match.best_score`, KHÔNG trả kết luận. Backend lấy ngưỡng của
công ty rồi tự quyết định (P3). Xem `attendance.service.ts` phía Backend.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from ..config import Settings, get_settings
from ..core.engine import Engine, get_engine
from ..core.matcher import verify_1to1
from ..metrics import MATCH_SCORE
from ..runner import Stopwatch
from ..schemas import MatchResult, VerifyRequest, VerifyResponse
from ..security import require_internal_key
from ..service import analyze_image, to_liveness, to_quality

# Khoá nội bộ áp ở cấp router, không phải từng hàm — thêm endpoint mới sau này
# tự động được bảo vệ, không thể quên. AI Server KHÔNG được expose ra internet.
router = APIRouter(dependencies=[Depends(require_internal_key)])

ENDPOINT = "verify"


@router.post("/v1/verify", response_model=VerifyResponse)
async def verify(
    payload: VerifyRequest,
    engine: Annotated[Engine, Depends(get_engine)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> VerifyResponse:
    """So khớp ảnh vừa chụp với các embedding đã đăng ký của đúng nhân viên đó.

    Luôn `need_embedding=True` vì không có embedding thì không so khớp được.
    Nhánh liveness thì tuỳ chính sách công ty, do Backend bật qua `require_liveness`.
    """
    # Bấm giờ từ đầu hàm để `processing_ms` tính cả phần chờ xếp hàng ở semaphore,
    # không chỉ thời gian GPU chạy. Backend cần con số người dùng thật sự cảm nhận.
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

    # Ảnh không dùng được → vẫn trả HTTP 200 kèm `face_found: false`. Trả 4xx sẽ
    # làm circuit breaker của Backend hiểu nhầm là AI Server đang hỏng.
    if outcome.analysis is None:
        return VerifyResponse(
            face_found=False,
            error_code=outcome.error_code,
            processing_ms=stopwatch.elapsed_ms,
        )

    analysis = outcome.analysis
    match = None

    if analysis.embedding is not None:
        best, scores = verify_1to1(analysis.embedding, payload.embeddings)
        # Chỉ ghi metric điểm CAO NHẤT. Ghi cả `scores` sẽ làm lệch phân bố:
        # người đăng ký 5 góc mặt sẽ đóng góp gấp 5 lần người đăng ký 1 góc.
        MATCH_SCORE.observe(best)
        # Trả số thô, KHÔNG kèm kết luận đạt/không đạt (P3). Ngưỡng nằm ở
        # CompanyPolicy bên Backend vì mỗi công ty chấp nhận mức rủi ro khác nhau.
        match = MatchResult(best_score=best, scores=scores)

    return VerifyResponse(
        face_found=True,
        quality=to_quality(analysis),
        liveness=to_liveness(analysis),
        match=match,
        model_version=analysis.model_version,
        processing_ms=stopwatch.elapsed_ms,
    )
