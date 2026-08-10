"""Sàn kỹ thuật chất lượng ảnh và xác thực nội bộ."""

from __future__ import annotations

import numpy as np
import pytest

from app.config import Settings
from app.core import quality as quality_module
from app.core.imageio import decode_base64_image, decode_bytes
from app.core.types import Quality
from app.errors import ImageRejectedError

from .conftest import encode_base64, make_image


def build_settings(**fields) -> Settings:
    """Dựng `Settings` chỉ từ tham số truyền vào, bỏ qua môi trường của máy.

    Hai chốt, thiếu cái nào cũng làm test "xanh giả":

    `_env_file=None` — bỏ qua `.env` của lập trình viên.

    Đổi tên trường sang alias — `internal_key` khai `alias="AI_SERVER_INTERNAL_KEY"`.
    `populate_by_name=True` cho phép TRUYỀN theo tên trường, nhưng biến môi
    trường theo alias vẫn ghi đè lên: `Settings(internal_key="ngan")` với
    `AI_SERVER_INTERNAL_KEY` đang đặt trong môi trường thì trả về giá trị của
    biến môi trường, không phải "ngan". `conftest.py` đặt đúng biến đó cho toàn
    phiên, nên các test kiểm chốt chặn khoá yếu nhận nhầm khoá hợp lệ rồi báo
    DID NOT RAISE. Truyền thẳng alias thì mới thắng được.
    """
    renamed = {}
    for name, value in fields.items():
        field = Settings.model_fields.get(name)
        renamed[field.alias if field is not None and field.alias else name] = value
    return Settings(_env_file=None, **renamed)


def settings_for_test() -> Settings:
    return build_settings(
        env="development",
        internal_key="x" * 40,
        allow_missing_liveness_model=True,
    )


def production_settings(**overrides) -> Settings:
    """Cấu hình production hợp lệ, rồi phá hỏng đúng MỘT thứ ở mỗi test.

    Phải ghi rõ từng trường thay vì để rơi về biến môi trường: `conftest.py` đã
    đặt ENGINE=stub và ALLOW_MISSING_LIVENESS_MODEL=true cho toàn phiên, nên
    test sẽ dừng ở chốt chặn khác với chốt đang muốn kiểm chứng.

    Đi qua `build_settings` để override thật sự có tác dụng — xem lý do ở đó.
    """
    base = {
        "env": "production",
        "engine": "insightface",
        "internal_key": "x" * 40,
        "allow_missing_liveness_model": False,
        "liveness_model_path": "/models/anti_spoof.onnx",
    }
    base.update(overrides)
    return build_settings(**base)


def quality(
    blur: float = 100.0,
    brightness: float = 128.0,
    face_px: int = 200,
    yaw: float | None = 0.0,
    pitch: float | None = 0.0,
) -> Quality:
    return Quality(blur=blur, brightness=brightness, yaw=yaw, pitch=pitch, face_px=face_px)


NEUTRAL = np.full((300, 300, 3), 128, dtype=np.uint8)


# ---------------------------------------------------------------------------
#  Sàn kỹ thuật
# ---------------------------------------------------------------------------


def test_anh_dat_chuan_di_qua():
    quality_module.enforce_technical_floor(quality(), NEUTRAL, settings_for_test())


def test_mat_qua_toi_bi_tu_choi():
    with pytest.raises(ImageRejectedError) as error:
        quality_module.enforce_technical_floor(
            quality(brightness=10.0), np.full((300, 300, 3), 10, np.uint8), settings_for_test()
        )
    assert error.value.code == "IMG_TOO_DARK"


def test_mat_chay_sang_bi_tu_choi():
    with pytest.raises(ImageRejectedError) as error:
        quality_module.enforce_technical_floor(
            quality(brightness=250.0), np.full((300, 300, 3), 250, np.uint8), settings_for_test()
        )
    assert error.value.code == "IMG_BACKLIT"


def test_nguoc_sang_bi_bat_du_do_sang_mat_van_hop_le():
    """Người đứng trước cửa sổ: mặt 90, nền 220.

    Chỉ nhìn độ sáng vùng mặt thì thấy bình thường. Phải so tương quan với nền.
    """
    with pytest.raises(ImageRejectedError) as error:
        quality_module.enforce_technical_floor(
            quality(brightness=90.0), np.full((300, 300, 3), 220, np.uint8), settings_for_test()
        )
    assert error.value.code == "IMG_BACKLIT"


def test_anh_nhoe_bi_tu_choi():
    with pytest.raises(ImageRejectedError) as error:
        quality_module.enforce_technical_floor(quality(blur=5.0), NEUTRAL, settings_for_test())
    assert error.value.code == "IMG_BLURRY"


def test_bao_loi_anh_sang_truoc_loi_nhoe():
    """Ảnh chụp chỗ tối gần như luôn kèm nhoè do máy tăng thời gian phơi sáng.

    Báo "ảnh mờ" cho người đang đứng chỗ tối là hướng dẫn sai — họ sẽ cố giữ
    tay vững thay vì đi tìm chỗ sáng hơn.
    """
    with pytest.raises(ImageRejectedError) as error:
        quality_module.enforce_technical_floor(
            quality(blur=3.0, brightness=12.0),
            np.full((300, 300, 3), 12, np.uint8),
            settings_for_test(),
        )
    assert error.value.code == "IMG_TOO_DARK"


@pytest.mark.parametrize(
    ("field", "value"),
    [("yaw", 70.0), ("yaw", -70.0), ("pitch", 55.0), ("pitch", -55.0)],
    ids=["quay-phai", "quay-trai", "ngua-len", "cui-xuong"],
)
def test_mat_nghieng_qua_san_ky_thuat_bi_tu_choi(field, value):
    """Vượt sàn thì bước căn chỉnh 112×112 không đưa được mặt về tư thế chuẩn nữa.

    Kiểm cả hai chiều: chỉ chặn một phía là bỏ lọt đúng một nửa số ảnh hỏng.
    """
    with pytest.raises(ImageRejectedError) as error:
        quality_module.enforce_technical_floor(
            quality(**{field: value}), NEUTRAL, settings_for_test()
        )
    assert error.value.code == "BAD_ANGLE"


def test_goc_mat_trong_san_ky_thuat_van_di_qua():
    """Sàn 50° cố ý rộng: luồng đăng ký có hai bước cố ý chụp lệch trục.

    Đặt hẹp là tự chặn `TURN_LEFT`/`TURN_RIGHT` — hai bước bắt buộc của chính mình.
    Ngưỡng chặt hơn (30°) nằm ở Backend và chỉ áp cho luồng chấm công.
    """
    quality_module.enforce_technical_floor(quality(yaw=35.0), NEUTRAL, settings_for_test())


def test_khong_do_duoc_tu_the_dau_thi_khong_tu_choi():
    """`yaw`/`pitch` là `None` khi model không trả được tư thế đầu.

    Từ chối vì thiếu số liệu sẽ biến một thiếu sót cấu hình (chưa nạp module
    landmark) thành sự cố chấm công toàn hệ thống. Ảnh vẫn có thể dùng tốt.
    """
    quality_module.enforce_technical_floor(
        quality(yaw=None, pitch=None), NEUTRAL, settings_for_test()
    )


def test_do_chat_luong_tren_vung_mat_khong_phai_toan_anh():
    """Nền sáng chói không được che đi việc khuôn mặt đang tối."""
    image = np.full((400, 400, 3), 240, dtype=np.uint8)
    image[150:250, 150:250] = 20  # vùng mặt tối

    measured = quality_module.measure(image, (150, 150, 250, 250), None)

    assert measured.brightness < 40, "Đang đo toàn ảnh thay vì vùng mặt"
    assert measured.face_px == 100


# ---------------------------------------------------------------------------
#  Giải mã ảnh
# ---------------------------------------------------------------------------


def test_tu_choi_anh_vuot_kich_thuoc_truoc_khi_giai_ma():
    """Chặn trước khi base64 phình ra bộ nhớ — nếu không thì một chuỗi 200MB
    đủ để làm cạn RAM của container."""
    with pytest.raises(ImageRejectedError):
        decode_base64_image("A" * 10_000_000, max_bytes=1024)


def test_tu_choi_du_lieu_khong_phai_anh():
    with pytest.raises(ImageRejectedError) as error:
        decode_bytes(b"day khong phai anh", max_bytes=1024)
    assert error.value.code == "FACE_NOT_FOUND"


def test_anh_qua_lon_duoc_thu_nho_lai():
    """Ảnh 4000px không giúp nhận diện tốt hơn, chỉ làm chậm."""
    large = encode_base64(make_image(seed=3, size=3000))
    decoded = decode_base64_image(large, max_bytes=20 * 1024 * 1024)

    assert max(decoded.shape[:2]) <= 1920


# ---------------------------------------------------------------------------
#  Xác thực nội bộ (docs/02 mục 6.2)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "path,payload",
    [
        ("/v1/enroll", {"image_base64": "x"}),
        ("/v1/verify", {"image_base64": "x", "embeddings": [[0.1]]}),
        ("/v1/liveness", {"image_base64": "x"}),
        ("/v1/index/upsert", {"entries": [{"employee_id": "a", "embeddings": [[0.1]]}]}),
    ],
)
def test_khong_co_internal_key_thi_bi_chan(client, path, payload):
    assert client.post(path, json=payload).status_code == 401


def test_internal_key_sai_thi_bi_chan(client, image_b64):
    response = client.post(
        "/v1/enroll",
        json={"image_base64": image_b64},
        headers={"X-Internal-Key": "khoa-sai"},
    )
    assert response.status_code == 401


# ---------------------------------------------------------------------------
#  Chốt chặn cấu hình production
# ---------------------------------------------------------------------------


def test_cau_hinh_production_hop_le_thi_khoi_tao_duoc():
    """Chốt ngược: bảo đảm các test dưới đây fail vì đúng lý do, không phải vì
    cấu hình nền đã sai sẵn."""
    assert production_settings().env == "production"


def test_production_tu_choi_engine_gia():
    with pytest.raises(ValueError, match="stub"):
        production_settings(engine="stub")


def test_production_tu_choi_chay_khong_co_model_chong_gia_mao():
    """Không có model chống giả mạo thì ảnh in ra cũng chấm công được."""
    with pytest.raises(ValueError, match="LIVENESS_MODEL_PATH"):
        production_settings(liveness_model_path="")


def test_production_tu_choi_cho_phep_thieu_model_chong_gia_mao():
    with pytest.raises(ValueError, match="ALLOW_MISSING_LIVENESS_MODEL"):
        production_settings(allow_missing_liveness_model=True)


def test_production_tu_choi_khoa_noi_bo_yeu():
    with pytest.raises(ValueError, match="32 ký tự"):
        production_settings(internal_key="ngan")


def test_production_tu_choi_khi_khong_dat_khoa():
    with pytest.raises(ValueError, match="AI_SERVER_INTERNAL_KEY"):
        production_settings(internal_key="")
