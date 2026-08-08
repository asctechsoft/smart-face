"""Pipeline nhận diện khuôn mặt — docs/02 mục 6.3.

    Ảnh vào
      ├─ 1. Phát hiện khuôn mặt (SCRFD/RetinaFace)
      ├─ 2. Đo chất lượng trên vùng mặt, chặn ảnh hỏng
      ├─ 3. Căn chỉnh 112×112 theo 5 điểm mốc  ← insightface làm sẵn
      ├─ 4. Chống giả mạo (MiniFASNet)
      ├─ 5. Trích embedding 512 chiều (ArcFace), đã L2-normalize
      └─ 6. So khớp  ← ở matcher.py

Bước 3 là lý do chính khiến phần này viết bằng Python thay vì nhúng vào Backend
Node (ADR-01): phép biến đổi affine đưa mặt về đúng tư thế chuẩn không báo lỗi
khi sai — nó chỉ làm độ chính xác tụt xuống âm thầm. Dùng lại đúng hàm căn chỉnh
mà model được huấn luyện cùng là cách duy nhất tránh được chuyện đó.
"""

from __future__ import annotations

import hashlib
import logging
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol

import numpy as np

from ..config import Settings
from ..errors import (
    FACE_NOT_FOUND,
    FACE_TOO_SMALL,
    MULTIPLE_FACES,
    ImageRejectedError,
)
from . import quality as quality_module
from .landmarks import verify_action_single_frame
from .liveness import HeuristicLivenessModel, LivenessModel
from .matcher import l2_normalize
from .types import Analysis, LivenessOutcome, Quality

logger = logging.getLogger(__name__)


class Engine(Protocol):
    name: str
    model_version: str
    liveness_model_name: str
    loaded_at: datetime

    def analyze(
        self,
        image: np.ndarray,
        *,
        need_embedding: bool,
        need_liveness: bool,
        liveness_action: str | None,
    ) -> Analysis: ...

    def warmup(self) -> None: ...


# ---------------------------------------------------------------------------
#  Engine thật
# ---------------------------------------------------------------------------


class InsightFaceEngine:
    name = "insightface"

    def __init__(self, settings: Settings) -> None:
        from insightface.app import FaceAnalysis

        self.settings = settings
        self.model_version = settings.model_version_label
        self.loaded_at = datetime.now(UTC)

        # `landmark_3d_68` cung cấp `face.pose` (pitch, yaw, roll) dùng cho xác
        # minh hành động liveness. Không nạp `genderage` — không dùng tới, chỉ
        # tốn RAM và thời gian khởi động.
        self.app = FaceAnalysis(
            name=settings.model_pack,
            root=settings.model_root,
            providers=settings.provider_list,
            allowed_modules=["detection", "landmark_3d_68", "recognition"],
        )
        self.app.prepare(ctx_id=0, det_size=(settings.det_size, settings.det_size))

        self.liveness = self._load_liveness(settings)
        self.liveness_model_name = self.liveness.name if self.liveness else "none"

        logger.info(
            "Engine sẵn sàng: %s / %s, chống giả mạo: %s, provider: %s",
            self.name,
            self.model_version,
            self.liveness_model_name,
            settings.provider_list,
        )

    @staticmethod
    def _load_liveness(settings: Settings) -> LivenessModel | HeuristicLivenessModel | None:
        # Điều kiện là TỆP CÓ TỒN TẠI, không phải "đường dẫn có được khai".
        #
        # `.env.example` khai sẵn LIVENESS_MODEL_PATH, còn model chống giả mạo thì
        # `download_models.py` KHÔNG tải được (nguồn chỉ phát hành checkpoint
        # PyTorch, phải tự chuyển sang ONNX). Nếu chỉ xét chuỗi rỗng thì nhánh này
        # luôn thắng và ALLOW_MISSING_LIVENESS_MODEL thành cờ chết — server đổ với
        # FileNotFoundError đúng lúc khởi động, kể cả khi đã bật cờ.
        path = settings.liveness_model_path
        if path and Path(path).is_file():
            return LivenessModel(path, settings.provider_list)

        if settings.allow_missing_liveness_model:
            logger.warning(
                "CHƯA CÓ MODEL CHỐNG GIẢ MẠO (%s) — đang dùng ước lượng thô. "
                "Ảnh in ra cũng có thể chấm công được. Chỉ chấp nhận khi phát triển.",
                path or "chưa khai LIVENESS_MODEL_PATH",
            )
            return HeuristicLivenessModel()

        raise RuntimeError(
            f"Không nạp được model chống giả mạo: {path or 'chưa khai LIVENESS_MODEL_PATH'}. "
            "Chạy `python scripts/download_models.py` để xem hướng dẫn lấy model, "
            "hoặc đặt ALLOW_MISSING_LIVENESS_MODEL=true nếu đang phát triển."
        )

    def warmup(self) -> None:
        """Chạy một lần suy luận giả để tránh request thật đầu tiên bị chậm.

        ONNXRuntime cấp phát bộ nhớ và tối ưu đồ thị ở lần chạy đầu, mất vài
        trăm ms tới vài giây. Không hâm nóng thì đúng nhân viên đầu tiên bấm
        chấm công buổi sáng sẽ là người phải chờ.
        """
        blank = np.full((self.settings.det_size, self.settings.det_size, 3), 127, np.uint8)
        self.app.get(blank)
        logger.info("Hâm nóng model xong.")

    def analyze(
        self,
        image: np.ndarray,
        *,
        need_embedding: bool,
        need_liveness: bool,
        liveness_action: str | None,
    ) -> Analysis:
        faces = self.app.get(image)
        faces = [f for f in faces if float(f.det_score) >= self.settings.floor_detection_score]

        if not faces:
            raise ImageRejectedError(FACE_NOT_FOUND, "Không tìm thấy khuôn mặt nào trong ảnh.")

        if len(faces) > 1:
            # Nhiều mặt là tình huống nguy hiểm với chấm công: không có cách nào
            # biết chắc mặt nào là người đang chấm. Từ chối thay vì đoán mặt to
            # nhất — đoán sai nghĩa là chấm công cho nhầm người.
            raise ImageRejectedError(
                MULTIPLE_FACES,
                f"Tìm thấy {len(faces)} khuôn mặt. Yêu cầu chỉ một người trong khung hình.",
            )

        face = faces[0]
        box = tuple(int(value) for value in face.bbox[:4])  # type: ignore[assignment]
        raw_pose = getattr(face, "pose", None)
        pose = None if raw_pose is None else tuple(float(value) for value in raw_pose)

        measured = quality_module.measure(image, box, pose)  # type: ignore[arg-type]

        if measured.face_px < self.settings.floor_face_px:
            raise ImageRejectedError(
                FACE_TOO_SMALL,
                f"Khuôn mặt chỉ {measured.face_px}px, dưới sàn kỹ thuật "
                f"{self.settings.floor_face_px}px. Hãy lại gần camera hơn.",
            )

        quality_module.enforce_technical_floor(measured, image, self.settings)

        liveness = None
        if need_liveness and self.liveness is not None:
            score = self.liveness.score(image, box)  # type: ignore[arg-type]
            action_verified = (
                verify_action_single_frame(
                    liveness_action,
                    pose,
                    getattr(face, "landmark_3d_68", None),
                    self.settings.pose_yaw_threshold,
                    self.settings.pose_pitch_threshold,
                )
                if liveness_action
                else None
            )
            liveness = LivenessOutcome(
                score=round(float(score), 4),
                action_verified=action_verified,
            )

        embedding = None
        if need_embedding:
            raw = getattr(face, "normed_embedding", None)
            if raw is None:
                raw = getattr(face, "embedding", None)
            if raw is None:
                raise ImageRejectedError(FACE_NOT_FOUND, "Không trích được embedding từ khuôn mặt.")
            embedding = l2_normalize(np.asarray(raw, dtype=np.float32))

        return Analysis(
            quality=measured,
            embedding=embedding,
            liveness=liveness,
            model_version=self.model_version,
        )


# ---------------------------------------------------------------------------
#  Engine giả — chỉ để phát triển và kiểm thử hợp đồng
# ---------------------------------------------------------------------------


class StubEngine:
    """Trả dữ liệu bịa ra, có tính tất định theo nội dung ảnh.

    Mục đích duy nhất: cho phép phát triển App và Backend khi chưa có GPU hoặc
    chưa tải model. Cùng một ảnh luôn cho cùng một embedding, nên luồng
    "đăng ký rồi chấm công bằng chính ảnh đó" chạy thông.

    ⚠ KHÔNG dùng để đánh giá độ chính xác: hai ảnh khác nhau của cùng một người
    sẽ cho điểm gần 0. `config.py` cấm engine này ở production và `/health` luôn
    báo `engine = "stub"`.
    """

    name = "stub"
    liveness_model_name = "stub"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.model_version = "stub@0"
        self.loaded_at = datetime.now(UTC)
        logger.warning("ĐANG CHẠY ENGINE GIẢ — mọi số liệu nhận diện đều là dữ liệu bịa.")

    def warmup(self) -> None:
        return

    def analyze(
        self,
        image: np.ndarray,
        *,
        need_embedding: bool,
        need_liveness: bool,
        liveness_action: str | None,
    ) -> Analysis:
        height, width = image.shape[:2]
        side = int(min(height, width) * 0.6)
        box = (
            (width - side) // 2,
            (height - side) // 2,
            (width + side) // 2,
            (height + side) // 2,
        )

        measured = quality_module.measure(image, box, (0.0, 0.0, 0.0))
        # Bỏ qua sàn kỹ thuật: ảnh kiểm thử thường là ảnh đặc một màu.
        measured = Quality(
            blur=max(measured.blur, 100.0),
            brightness=measured.brightness,
            yaw=0.0,
            pitch=0.0,
            face_px=max(measured.face_px, self.settings.floor_face_px),
        )

        embedding = None
        if need_embedding:
            digest = hashlib.sha256(image.tobytes()).digest()
            generator = np.random.default_rng(int.from_bytes(digest[:8], "big"))
            embedding = l2_normalize(generator.standard_normal(512).astype(np.float32))

        liveness = LivenessOutcome(score=0.99, action_verified=True) if need_liveness else None

        return Analysis(
            quality=measured,
            embedding=embedding,
            liveness=liveness,
            model_version=self.model_version,
        )


# ---------------------------------------------------------------------------
#  Khởi tạo
# ---------------------------------------------------------------------------

_engine: Engine | None = None
_lock = threading.Lock()


def build_engine(settings: Settings) -> Engine:
    if settings.engine == "stub":
        return StubEngine(settings)
    return InsightFaceEngine(settings)


def set_engine(engine: Engine) -> None:
    global _engine
    with _lock:
        _engine = engine


def get_engine() -> Engine:
    if _engine is None:
        raise RuntimeError("Engine chưa được khởi tạo — vòng đời ứng dụng chưa chạy xong.")
    return _engine
