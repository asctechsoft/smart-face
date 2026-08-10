"""Tiền xử lý cho model chống giả mạo (AF-05..AF-09).

Bộ test này canh giữ hai thứ đã từng sai và **không hề báo lỗi khi sai**: model
vẫn chạy, vẫn trả về một con số, chỉ là con số vô nghĩa. Không có test ở đây thì
cách duy nhất phát hiện là chạy trên ảnh thật đã gán nhãn — việc không ai làm khi
chỉ đi sửa một dòng tưởng là vô hại.

Cả hai đều bắt nguồn từ một điều: MiniFASNet chỉ đúng khi được cho ăn dữ liệu
GIỐNG HỆT lúc huấn luyện.
"""

from __future__ import annotations

import numpy as np

from app.core.liveness import _CROP_SCALE, LivenessModel, _crop_with_context


class _RecordingSession:
    """Ghi lại blob mà `LivenessModel` đưa vào phiên suy luận."""

    def __init__(self, logits: list[float]) -> None:
        self.logits = logits
        self.blob: np.ndarray | None = None

    def run(self, _outputs, feed):
        self.blob = next(iter(feed.values()))
        return [np.asarray([self.logits], dtype=np.float32)]


def _model_with(session: _RecordingSession) -> LivenessModel:
    """Dựng `LivenessModel` không qua `__init__` — không cần file ONNX thật."""
    model = object.__new__(LivenessModel)
    model.session = session
    model.input_name = "input"
    model.name = "test"
    return model


# ---------------------------------------------------------------------------
#  Thang giá trị đầu vào
# ---------------------------------------------------------------------------


def test_dua_vao_model_thang_0_255_khong_chia_255():
    """MiniFASNet được huấn luyện trên thang 0..255, KHÔNG phải 0..1.

    Repo gốc vô hiệu hoá phép chia trong `ToTensor` của chính nó
    (`src/data_io/functional.py`: `# return img.float().div(255)` bị chú thích
    lại, trả thẳng `img.float()`). Thống kê BatchNorm lớp đầu xác nhận:
    `running_mean ≈ -49`, `running_var ≈ 958`.

    Chia thêm 255 thì model trả ≈0.005 cho MỌI ảnh — mặt thật cũng như ảnh in.
    Hậu quả tuỳ ngưỡng: hoặc chặn tất cả mọi người, hoặc nếu ai đó hạ ngưỡng cho
    "chạy được" thì cho qua tất cả ảnh giả.
    """
    session = _RecordingSession([0.0, 5.0, 0.0])
    image = np.full((400, 400, 3), 200, dtype=np.uint8)

    _model_with(session).score(image, (150, 150, 250, 250))

    assert session.blob is not None
    assert session.blob.max() > 1.5, (
        f"Blob đưa vào model có max={session.blob.max()} — đang bị chuẩn hoá về [0,1]. "
        "MiniFASNet cần thang 0..255."
    )
    assert 199 <= session.blob.max() <= 201


def test_blob_dung_dinh_dang_nchw_80x80():
    session = _RecordingSession([0.0, 5.0, 0.0])
    image = np.full((400, 400, 3), 128, dtype=np.uint8)

    _model_with(session).score(image, (150, 150, 250, 250))

    assert session.blob.shape == (1, 3, 80, 80)
    assert session.blob.dtype == np.float32


def test_lay_dung_lop_1_lam_diem_nguoi_that():
    """MiniFASNet 3 lớp: [giả-in, THẬT, giả-màn hình].

    Lấy nhầm lớp nghĩa là đảo ngược kết luận — ảnh in được chấm điểm cao.
    """
    # Logit lớp 1 vượt trội → điểm phải gần 1.
    session = _RecordingSession([-5.0, 10.0, -5.0])
    image = np.full((400, 400, 3), 128, dtype=np.uint8)
    assert _model_with(session).score(image, (150, 150, 250, 250)) > 0.99

    # Logit lớp 2 (giả-màn hình) vượt trội → điểm phải gần 0.
    session = _RecordingSession([-5.0, -5.0, 10.0])
    assert _model_with(session).score(image, (150, 150, 250, 250)) < 0.01


# ---------------------------------------------------------------------------
#  Cách cắt ảnh
# ---------------------------------------------------------------------------


def test_giu_nguyen_ty_le_khung_mat_khong_ep_vuong():
    """Chiều rộng và chiều cao nhân CÙNG một hệ số.

    Ép vuông rồi co về 80×80 làm khuôn mặt méo khác lúc huấn luyện.
    """
    image = np.zeros((2000, 2000, 3), dtype=np.uint8)
    # Khung mặt cao hơn rộng, đúng như bộ phát hiện thường trả về.
    crop = _crop_with_context(image, (900, 800, 1000, 1000))

    height, width = crop.shape[:2]
    assert abs(width / height - 100 / 200) < 0.02, (
        f"Tỷ lệ vùng cắt {width}x{height} không giữ được tỷ lệ khung mặt 100x200"
    )


def test_cham_bien_thi_doi_cua_so_chu_khong_cat_cut():
    """Mặt sát mép ảnh vẫn phải cho vùng cắt ĐỦ KÍCH THƯỚC.

    Cắt cụt làm tỷ lệ nới thực tế nhỏ hơn 2.7 — sai đúng thứ mà tên checkpoint
    `2.7_80x80_MiniFASNetV2.pth` ghi rõ. Người cầm điện thoại hiếm khi để mặt vào
    chính giữa khung nên nhánh này chạy thường xuyên, không phải trường hợp hiếm.
    """
    image = np.zeros((1000, 1000, 3), dtype=np.uint8)
    box = (0, 0, 100, 100)  # mặt nằm sát góc trên trái

    crop = _crop_with_context(image, box)

    expected = int(101 * _CROP_SCALE)
    assert crop.shape[0] >= expected - 2, f"Vùng cắt bị cụt: cao {crop.shape[0]}, cần ~{expected}"
    assert crop.shape[1] >= expected - 2, f"Vùng cắt bị cụt: rộng {crop.shape[1]}, cần ~{expected}"


def test_kep_ty_le_khi_anh_qua_nho():
    """Ảnh nhỏ hơn vùng cắt mong muốn thì kẹp lại, không tràn ra ngoài."""
    image = np.zeros((120, 120, 3), dtype=np.uint8)

    crop = _crop_with_context(image, (10, 10, 110, 110))

    assert crop.shape[0] <= 120
    assert crop.shape[1] <= 120
    assert crop.size > 0


def test_khung_mat_khong_hop_le_thi_tra_ve_ca_anh():
    """Không bao giờ trả về mảng rỗng — tầng trên sẽ nổ ở chỗ khó lần ra."""
    image = np.zeros((200, 200, 3), dtype=np.uint8)

    assert _crop_with_context(image, (100, 100, 50, 50)).size > 0
