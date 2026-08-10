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
#:
#: ⚠ Con số này KHÔNG tự chọn được. Nó nằm trong tên checkpoint
#: `2.7_80x80_MiniFASNetV2.pth` — model chỉ nhìn thấy ảnh cắt ở đúng tỷ lệ này
#: trong suốt quá trình huấn luyện. Đổi nó là đưa cho model một phân bố dữ liệu
#: nó chưa từng gặp; model vẫn chạy, chỉ trả số vô nghĩa.
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

        # ⚠ KHÔNG chia cho 255. Trông như thiếu sót nhưng là có chủ đích.
        #
        # MiniFASNet được huấn luyện trên thang 0..255: repo gốc vô hiệu hoá phép
        # chia trong `ToTensor` của chính nó (`src/data_io/functional.py`, dòng
        # `# return img.float().div(255)  modify by zkx` bị chú thích lại, trả
        # thẳng `img.float()`). Thống kê BatchNorm lớp đầu xác nhận điều đó:
        # `running_mean ≈ -49`, `running_var ≈ 958` — không thể là của dữ liệu
        # nằm trong [0, 1].
        #
        # Chia thêm 255 thì model vẫn chạy, không báo lỗi, và trả ≈0.005 cho MỌI
        # tấm ảnh — mặt thật cũng như ảnh in. Nghĩa là hoặc chặn hết mọi người,
        # hoặc (nếu hạ ngưỡng cho "chạy được") cho qua hết mọi ảnh giả.
        blob = np.transpose(blob, (2, 0, 1))[np.newaxis, ...]

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
    """Cắt vùng mặt kèm lề, theo ĐÚNG cách model được huấn luyện cùng.

    Dịch từ `CropImage._get_new_box` của repo Silent-Face-Anti-Spoofing. Hai chi
    tiết trông vụn vặt nhưng quyết định kết quả:

    **Giữ nguyên tỷ lệ khung mặt**, không ép vuông. Chiều rộng và chiều cao được
    nhân cùng một hệ số rồi mới co về 80×80, nên khuôn mặt bị bóp méo theo đúng
    cách nó bị bóp méo lúc huấn luyện.

    **Chạm biên thì DỜI cửa sổ vào trong, không cắt cụt.** Cắt cụt làm vùng ảnh
    nhỏ lại, tức tỷ lệ nới thực tế không còn là 2.7 nữa — sai đúng thứ mà tên
    checkpoint ghi rõ. Người dùng cầm điện thoại hiếm khi để mặt vào chính giữa
    khung, nên nhánh này chạy thường xuyên chứ không phải trường hợp hiếm.
    """
    x1, y1, x2, y2 = face_box
    box_w, box_h = x2 - x1 + 1, y2 - y1 + 1
    height, width = image.shape[:2]

    if box_w <= 0 or box_h <= 0:
        return image

    # Kẹp lại cho vùng cắt không vượt quá kích thước ảnh.
    scale = min((height - 1) / box_h, (width - 1) / box_w, _CROP_SCALE)

    new_w, new_h = box_w * scale, box_h * scale
    centre_x, centre_y = x1 + box_w / 2.0, y1 + box_h / 2.0

    left, top = centre_x - new_w / 2.0, centre_y - new_h / 2.0
    right, bottom = centre_x + new_w / 2.0, centre_y + new_h / 2.0

    if left < 0:
        right -= left
        left = 0
    if top < 0:
        bottom -= top
        top = 0
    if right > width - 1:
        left -= right - width + 1
        right = width - 1
    if bottom > height - 1:
        top -= bottom - height + 1
        bottom = height - 1

    crop = image[int(top) : int(bottom) + 1, int(left) : int(right) + 1]
    return crop if crop.size else image


def _softmax(values: np.ndarray) -> np.ndarray:
    shifted = values - values.max()
    exponentials = np.exp(shifted)
    return exponentials / exponentials.sum()
