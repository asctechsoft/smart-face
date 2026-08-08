"""`POST /v1/identify` — so khớp 1:N (docs/08 mục 8).

Dùng cho kiosk (giai đoạn sau) và kiểm tra trùng danh tính (BR-10).

⚠ 1:N khó hơn 1:1 rất nhiều. Với N người, xác suất có ít nhất một người lạ vượt
ngưỡng tăng gần như tuyến tính theo N — ngưỡng dùng cho 1:1 đem sang 1:N sẽ cho
kết quả sai hàng loạt. Vì vậy phản hồi luôn kèm `margin`, và Backend BẮT BUỘC
kiểm tra `margin` chứ không chỉ nhìn điểm cao nhất.
"""

from __future__ import annotations

from typing import Annotated

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, status

from ..config import Settings, get_settings
from ..core.engine import Engine, get_engine
from ..core.index import INDEX
from ..core.matcher import identify_1_to_n
from ..runner import Stopwatch
from ..schemas import IdentifyMatch, IdentifyRequest, IdentifyResponse
from ..security import require_internal_key
from ..service import analyze_image, to_liveness, to_quality

router = APIRouter(dependencies=[Depends(require_internal_key)])

ENDPOINT = "identify"


@router.post("/v1/identify", response_model=IdentifyResponse)
async def identify(
    payload: IdentifyRequest,
    engine: Annotated[Engine, Depends(get_engine)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> IdentifyResponse:
    """Tìm xem người trong ảnh là ai, trong một tập ứng viên có giới hạn."""
    stopwatch = Stopwatch()

    # Không có ứng viên nào thì không phải "không tìm thấy ai" mà là Backend gọi
    # sai. Trả 422 để lỗi lập trình lộ ra ngay, thay vì âm thầm trả mảng rỗng và
    # bị hiểu nhầm thành "người này chưa đăng ký khuôn mặt".
    if not payload.candidates and not payload.scope_ids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Phải cung cấp `candidates` hoặc `scope_ids`.",
        )

    outcome = await analyze_image(
        endpoint=ENDPOINT,
        engine=engine,
        settings=settings,
        image_base64=payload.image_base64,
        need_embedding=True,
        need_liveness=payload.require_liveness,
        liveness_action=payload.liveness_action,
    )

    if outcome.analysis is None:
        return IdentifyResponse(
            face_found=False,
            error_code=outcome.error_code,
            processing_ms=stopwatch.elapsed_ms,
        )

    analysis = outcome.analysis
    gallery, owners = _build_gallery(payload)

    matches: list[IdentifyMatch] = []
    margin: float | None = None

    # `owners` rỗng nghĩa là scope_ids không khớp gì trong chỉ mục (thường do
    # AI Server vừa restart, RAM đã sạch). Bỏ qua để không chia cho tập rỗng;
    # Backend nhận `matches: []` và tự hiểu là chưa nạp lại chỉ mục.
    if analysis.embedding is not None and owners:
        ranked, margin = identify_1_to_n(analysis.embedding, gallery, owners, payload.top_k)
        matches = [IdentifyMatch(employee_id=key, score=score) for key, score in ranked]

    return IdentifyResponse(
        face_found=True,
        quality=to_quality(analysis),
        liveness=to_liveness(analysis),
        matches=matches,
        margin=margin,
        model_version=analysis.model_version,
        processing_ms=stopwatch.elapsed_ms,
    )


def _build_gallery(payload: IdentifyRequest) -> tuple[np.ndarray, list[str]]:
    """`candidates` được ưu tiên: dữ liệu gửi thẳng luôn mới hơn chỉ mục cache.

    Trả về một cặp SONG SONG nhau:

    - `gallery` — ma trận (tổng_số_vector × 512), gộp phẳng embedding của mọi người.
    - `owners`  — employee_id của từng HÀNG trong ma trận đó.

    Gộp phẳng để so khớp thành một phép nhân ma trận duy nhất trên toàn bộ tập,
    thay vì lặp Python qua từng người. Đây là điểm quyết định tốc độ khi N lớn.
    `owners` giữ ánh xạ ngược hàng → người, vì sau khi gộp thì thông tin ai sở
    hữu hàng nào không còn nằm trong ma trận nữa.
    """
    if payload.candidates:
        owners: list[str] = []
        blocks: list[np.ndarray] = []
        for candidate in payload.candidates:
            matrix = np.asarray(candidate.embeddings, dtype=np.float32)
            # Backend gửi một embedding đơn dạng [0.1, 0.2, …] thay vì [[0.1, …]]
            # thì numpy hiểu thành mảng 1 chiều. Nâng lên 2 chiều để `vstack` bên
            # dưới không ghép sai trục và làm hỏng toàn bộ ma trận.
            if matrix.ndim == 1:
                matrix = matrix[np.newaxis, :]
            # Lặp employee_id đúng bằng số hàng người đó đóng góp — nhờ vậy
            # owners[i] luôn là chủ của gallery[i].
            owners.extend([candidate.employee_id] * matrix.shape[0])
            blocks.append(matrix)
        return np.vstack(blocks), owners

    # `namespace` đã được schema bắt buộc khi dùng `scope_ids` — không có đường
    # nào tới đây với namespace rỗng. Xem cảnh báo cách ly tenant ở core/index.py.
    return INDEX.gather(payload.namespace or "default", payload.scope_ids)
