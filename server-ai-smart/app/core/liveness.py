"""Chống giả mạo (anti-spoofing) — bước 4 của pipeline (docs/02 mục 6.3).

Trả lời câu hỏi: trước camera là người thật, hay là ảnh in / màn hình điện thoại
/ mặt nạ? Đây là tuyến phòng thủ chính chống chấm hộ (AF-05..AF-09).

⚠ AI Server chỉ trả `score`, KHÔNG bao giờ tự kết luận đạt hay không. Ngưỡng
`liveness_threshold` nằm ở Backend theo từng công ty (P3).
"""

from __future__ import annotations

import logging
from pathlib import Path

import cv2
import numpy as np

logger = logging.getLogger(__name__)

#: MiniFASNet nhận ảnh 80×80 cắt rộng hơn khung mặt.
_INPUT_SIZE = 80

#: Tỷ lệ nới khung mặt. Manh mối giả mạo (viền màn hình, mép giấy, phản chiếu)
#: nằm NGOÀI khuôn mặt, cắt sát mặt là cắt mất đúng thứ cần nhìn.
_CROP_SCALE = 2.7


class LivenessModel:
    """Bọc model ONNX chống giả mạo."""

    def __init__(self, model_path: str, providers: list[str]) -> None:
        import onnxruntime as ort

        path = Path(model_path)
        if not path.is_file():
            raise FileNotFoundError(f"Không tìm thấy model chống giả mạo tại {path}")

        self.session = ort.InferenceSession(str(path), providers=providers)
        self.input_name = self.session.get_inputs()[0].name
        self.name = path.stem
        logger.info("Đã nạp model chống giả mạo: %s", self.name)

    def score(self, image: np.ndarray, face_box: tuple[int, int, int, int]) -> float:
        patch = _crop_with_context(image, face_box)
        blob = cv2.resize(patch, (_INPUT_SIZE, _INPUT_SIZE)).astype(np.float32)
        blob = np.transpose(blob, (2, 0, 1))[np.newaxis, ...] / 255.0

        raw = self.session.run(None, {self.input_name: blob})[0][0]
        probabilities = _softmax(np.asarray(raw, dtype=np.float64))

        # MiniFASNet 3 lớp: [giả-in, thật, giả-màn hình]. Lớp 1 là "thật".
        if probabilities.shape[0] >= 3:
            return float(probabilities[1])
        return float(probabilities[-1])


class HeuristicLivenessModel:
    """Ước lượng thô khi chưa có model thật — CHỈ dùng để phát triển.

    Nhìn vào hai dấu hiệu của ảnh chụp lại màn hình: kết cấu da bị bệt (ảnh in,
    ảnh nén lại nhiều lần mất chi tiết tần số cao) và độ bão hoà màu bất thường.

    ⚠ Cách này KHÔNG chống được kẻ tấn công thật sự. Một tấm ảnh in chất lượng
    cao sẽ qua được dễ dàng. `config.py` cấm dùng ở production, và `/health`
    luôn báo `liveness_model = "heuristic-fallback"` để người vận hành nhìn thấy.
    """

    name = "heuristic-fallback"

    def score(self, image: np.ndarray, face_box: tuple[int, int, int, int]) -> float:
        patch = _crop_with_context(image, face_box)
        if patch.size == 0:
            return 0.0

        grey = cv2.cvtColor(patch, cv2.COLOR_BGR2GRAY)

        # Da thật có kết cấu tần số cao; ảnh in hoặc chụp lại màn hình bị bệt.
        texture = float(cv2.Laplacian(grey, cv2.CV_64F).var())
        texture_score = min(texture / 120.0, 1.0)

        # Màn hình thường cho độ bão hoà cao bất thường.
        saturation = float(cv2.cvtColor(patch, cv2.COLOR_BGR2HSV)[:, :, 1].mean())
        saturation_score = 1.0 - min(max(saturation - 90.0, 0.0) / 110.0, 1.0)

        return round(min(texture_score * 0.65 + saturation_score * 0.35, 0.95), 4)


def _crop_with_context(image: np.ndarray, face_box: tuple[int, int, int, int]) -> np.ndarray:
    x1, y1, x2, y2 = face_box
    centre_x, centre_y = (x1 + x2) / 2.0, (y1 + y2) / 2.0
    half = max(x2 - x1, y2 - y1) * _CROP_SCALE / 2.0

    height, width = image.shape[:2]
    left = int(max(centre_x - half, 0))
    top = int(max(centre_y - half, 0))
    right = int(min(centre_x + half, width))
    bottom = int(min(centre_y + half, height))

    crop = image[top:bottom, left:right]
    return crop if crop.size else image


def _softmax(values: np.ndarray) -> np.ndarray:
    shifted = values - values.max()
    exponentials = np.exp(shifted)
    return exponentials / exponentials.sum()
