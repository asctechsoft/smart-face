"""Lớp dùng chung cho các endpoint suy luận.

Gom vào một chỗ ba việc mà mọi endpoint đều phải làm đúng như nhau:

- Giải mã ảnh và chạy pipeline ngoài event loop.
- Chuyển `ImageRejectedError` thành phản hồi 200 kèm `face_found: false` — Backend
  cần đọc được `error_code` chứ không phải nhận một mã HTTP 4xx trống rỗng.
- Ghi metrics.

Để mỗi router tự làm sẽ dẫn tới việc mã lỗi trả về khác nhau giữa các endpoint,
và App sẽ hiển thị thông báo không nhất quán cho cùng một tình huống.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np

from .config import Settings
from .core import imageio
from .core.engine import Engine
from .core.types import Analysis
from .errors import FACE_NOT_FOUND, ImageRejectedError
from .metrics import IMAGE_REJECTED_TOTAL, LIVENESS_SCORE, REQUESTS_TOTAL
from .runner import run_inference
from .schemas import ImageQuality, Liveness

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class Outcome:
    """Kết quả một lượt phân tích: hoặc thành công, hoặc bị từ chối kèm mã lỗi."""

    analysis: Analysis | None
    error_code: str | None
    detail: str | None = None

    @property
    def face_found(self) -> bool:
        return self.analysis is not None


async def analyze_image(
    *,
    endpoint: str,
    engine: Engine,
    settings: Settings,
    image_base64: str,
    need_embedding: bool,
    need_liveness: bool,
    liveness_action: str | None,
) -> Outcome:
    """Nhánh JSON — ảnh gửi lên dưới dạng base64.

    `need_embedding` / `need_liveness` để router bật đúng phần mình cần. Trích
    xuất embedding và chạy model chống giả mạo đều tốn kém; `/v1/liveness` không
    cần embedding, bật thừa là mỗi lượt gánh thêm chi phí vô ích.
    """

    def work() -> Analysis:
        image = imageio.decode_base64_image(image_base64, settings.max_image_bytes)
        return engine.analyze(
            image,
            need_embedding=need_embedding,
            need_liveness=need_liveness,
            liveness_action=liveness_action,
        )

    return await _guard(endpoint, work)


async def analyze_raw(
    *,
    endpoint: str,
    engine: Engine,
    settings: Settings,
    raw: bytes,
    need_embedding: bool,
    need_liveness: bool,
    liveness_action: str | None,
) -> Outcome:
    """Nhánh multipart — docs/08 mô tả `/v1/enroll` nhận `multipart/form-data`."""

    def work() -> Analysis:
        image = imageio.decode_bytes(raw, settings.max_image_bytes)
        return engine.analyze(
            image,
            need_embedding=need_embedding,
            need_liveness=need_liveness,
            liveness_action=liveness_action,
        )

    return await _guard(endpoint, work)


async def _guard(endpoint: str, work) -> Outcome:
    """Chạy pipeline và quy MỌI thất bại về cùng một hợp đồng phản hồi.

    Phân biệt hai loại hỏng, vì hậu quả vận hành khác hẳn nhau:

    - `ImageRejectedError` — ảnh không dùng được (tối, mờ, không có mặt). Đây là
      chuyện thường ngày, KHÔNG phải sự cố. Trả về bình thường kèm mã lỗi.
    - `Exception` khác — bug thật trong pipeline. Ghi log kèm traceback để còn
      điều tra, nhưng vẫn trả đúng hợp đồng để một tấm ảnh dị dạng không kéo sập
      cả luồng chấm công.
    """
    try:
        analysis = await run_inference(endpoint, work)
    except ImageRejectedError as rejected:
        IMAGE_REJECTED_TOTAL.labels(error_code=rejected.code).inc()
        REQUESTS_TOTAL.labels(endpoint=endpoint, outcome="rejected").inc()
        return Outcome(analysis=None, error_code=rejected.code, detail=rejected.detail)
    except Exception as error:
        # Lỗi bất ngờ trong pipeline: ghi log đầy đủ để điều tra, nhưng vẫn trả
        # về hợp đồng chuẩn. Backend đã có circuit breaker cho lỗi 5xx; ở đây
        # một tấm ảnh dị dạng không nên bị tính là "AI Server chết".
        logger.exception("Lỗi không lường trước ở %s: %s", endpoint, error)
        IMAGE_REJECTED_TOTAL.labels(error_code=FACE_NOT_FOUND).inc()
        REQUESTS_TOTAL.labels(endpoint=endpoint, outcome="error").inc()
        return Outcome(analysis=None, error_code=FACE_NOT_FOUND, detail="Lỗi xử lý ảnh.")

    REQUESTS_TOTAL.labels(endpoint=endpoint, outcome="ok").inc()
    if analysis.liveness is not None:
        LIVENESS_SCORE.observe(analysis.liveness.score)
    return Outcome(analysis=analysis, error_code=None)


def to_quality(analysis: Analysis) -> ImageQuality:
    """Đổi kiểu nội bộ sang schema trả ra ngoài.

    Làm tròn 2 chữ số: các số này chỉ để Backend so ngưỡng và cho người vận hành
    đọc, giữ 15 chữ số thập phân của float chỉ làm phình payload và log.
    """
    quality = analysis.quality
    return ImageQuality(
        blur=round(quality.blur, 2),
        brightness=round(quality.brightness, 2),
        yaw=quality.yaw,
        pitch=quality.pitch,
        face_px=quality.face_px,
    )


def to_liveness(analysis: Analysis) -> Liveness | None:
    """Trả `None` khi endpoint không yêu cầu kiểm tra người thật.

    ⚠ `None` nghĩa là CHƯA KIỂM TRA, không phải "đã kiểm tra và đạt". Backend
    phải phân biệt hai trường hợp này, coi lẫn nhau là bỏ lọt lớp chống giả mạo.
    """
    if analysis.liveness is None:
        return None
    return Liveness(
        score=analysis.liveness.score,
        action_verified=analysis.liveness.action_verified,
    )


def embedding_to_list(embedding: np.ndarray | None) -> list[float] | None:
    """Đổi vector numpy sang list để serialize JSON.

    Làm tròn 6 chữ số: đủ giữ độ chính xác khi so khớp (sai số ở mức 1e-6 không
    đổi kết quả) nhưng giảm đáng kể kích thước payload — 512 chiều × mỗi lượt
    đăng ký, cộng dồn lại là thật.
    """
    if embedding is None:
        return None
    return [round(float(value), 6) for value in embedding]
