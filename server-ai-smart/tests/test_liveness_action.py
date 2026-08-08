"""Xác minh hành động liveness (AF-05).

Điểm quan trọng nhất trong toàn bộ file: **không xác định được thì phải trả
`None`, không bao giờ trả `True`**. Backend đọc `action_verified === false` để
từ chối; nếu AI Server trả `True` cho thứ nó không đo được thì lỗ hổng chấm hộ
được mở ra từ chính chỗ đáng lẽ phải đóng nó lại.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.core.landmarks import (
    EAR_CLOSED,
    eye_aspect_ratio,
    verify_action_sequence,
    verify_action_single_frame,
)

YAW = 18.0
PITCH = 14.0


def pose(pitch: float = 0.0, yaw: float = 0.0, roll: float = 0.0):
    return (pitch, yaw, roll)


def landmarks68(eye_openness: float = 0.30, mouth_width: float = 40.0) -> np.ndarray:
    """Dựng bộ điểm mốc 68 tối thiểu đủ để tính EAR và độ rộng miệng."""
    points = np.zeros((68, 3), dtype=np.float32)

    # Cằm và lông mày — mẫu số cho chiều cao khuôn mặt.
    points[8] = (100, 200, 0)
    points[19] = (80, 60, 0)
    points[24] = (120, 60, 0)

    half = eye_openness * 20.0
    for start in (36, 42):
        offset = 0 if start == 36 else 40
        points[start] = (60 + offset, 100, 0)
        points[start + 1] = (67 + offset, 100 - half, 0)
        points[start + 2] = (73 + offset, 100 - half, 0)
        points[start + 3] = (80 + offset, 100, 0)
        points[start + 4] = (73 + offset, 100 + half, 0)
        points[start + 5] = (67 + offset, 100 + half, 0)

    points[48] = (100 - mouth_width / 2, 160, 0)
    points[54] = (100 + mouth_width / 2, 160, 0)
    points[51] = (100, 155, 0)
    points[57] = (100, 168, 0)
    return points


# ---------------------------------------------------------------------------
#  Xác minh từ tư thế đầu — đáng tin từ một khung hình
# ---------------------------------------------------------------------------


def test_quay_trai_dat_khi_yaw_du_lon():
    assert verify_action_single_frame("TURN_LEFT", pose(yaw=30.0), None, YAW, PITCH) is True


def test_quay_trai_khong_dat_khi_dau_dung_yen():
    assert verify_action_single_frame("TURN_LEFT", pose(yaw=2.0), None, YAW, PITCH) is False


def test_quay_trai_khong_dat_khi_quay_nham_huong():
    """Kẻ tấn công quay sẵn video quay phải, server yêu cầu quay trái."""
    assert verify_action_single_frame("TURN_LEFT", pose(yaw=-30.0), None, YAW, PITCH) is False


def test_quay_phai_dat():
    assert verify_action_single_frame("TURN_RIGHT", pose(yaw=-30.0), None, YAW, PITCH) is True


def test_gat_dau_dat_khi_pitch_du_lon():
    assert verify_action_single_frame("NOD", pose(pitch=25.0), None, YAW, PITCH) is True


def test_khong_co_tu_the_thi_tra_none_chu_khong_phai_false():
    """`None` = không đo được. `False` = đo được và không đạt.

    Hai thứ khác nhau: Backend có thể muốn cho chụp lại thay vì từ chối thẳng.
    """
    assert verify_action_single_frame("TURN_LEFT", None, None, YAW, PITCH) is None
    assert verify_action_single_frame("NOD", None, None, YAW, PITCH) is None


# ---------------------------------------------------------------------------
#  Xác minh từ điểm mốc
# ---------------------------------------------------------------------------


def test_ear_giam_khi_mat_nham():
    mo = eye_aspect_ratio(landmarks68(eye_openness=0.30), (36, 37, 38, 39, 40, 41))
    nham = eye_aspect_ratio(landmarks68(eye_openness=0.02), (36, 37, 38, 39, 40, 41))

    assert mo > EAR_CLOSED
    assert nham < EAR_CLOSED


def test_chop_mat_mot_khung_hinh_chi_thay_duoc_mat_dang_nham():
    assert verify_action_single_frame("BLINK", None, landmarks68(eye_openness=0.02), YAW, PITCH) is True
    assert verify_action_single_frame("BLINK", None, landmarks68(eye_openness=0.30), YAW, PITCH) is False


def test_khong_co_diem_moc_thi_tra_none():
    assert verify_action_single_frame("BLINK", pose(), None, YAW, PITCH) is None
    assert verify_action_single_frame("SMILE", pose(), None, YAW, PITCH) is None


def test_cuoi_lam_mieng_rong_ra():
    assert verify_action_single_frame("SMILE", None, landmarks68(mouth_width=70.0), YAW, PITCH) is True
    assert verify_action_single_frame("SMILE", None, landmarks68(mouth_width=30.0), YAW, PITCH) is False


def test_hanh_dong_la_tra_none():
    assert verify_action_single_frame("JUMP", pose(yaw=40.0), landmarks68(), YAW, PITCH) is None


# ---------------------------------------------------------------------------
#  Xác minh trên chuỗi khung hình — cách duy nhất đúng cho BLINK và NOD
# ---------------------------------------------------------------------------


def test_chuoi_khung_hinh_bat_duoc_chop_mat_that():
    """Phải thấy CẢ mở lẫn nhắm mới gọi là chớp mắt."""
    frames = [
        (pose(), landmarks68(eye_openness=0.35)),
        (pose(), landmarks68(eye_openness=0.02)),
        (pose(), landmarks68(eye_openness=0.35)),
    ]
    assert verify_action_sequence("BLINK", frames, YAW, PITCH) is True


def test_anh_in_nguoi_dang_nham_mat_khong_qua_duoc_chuoi_khung_hinh():
    """Đây chính là lý do BLINK cần nhiều khung hình.

    Một khung hình chỉ trả lời "mắt có đang nhắm không" — tấm ảnh in người nhắm
    mắt trả lời có. Chuỗi khung hình hỏi "mắt có TỪNG mở rồi nhắm không" — ảnh
    tĩnh không trả lời được.
    """
    frames = [
        (pose(), landmarks68(eye_openness=0.02)),
        (pose(), landmarks68(eye_openness=0.02)),
    ]
    assert verify_action_sequence("BLINK", frames, YAW, PITCH) is False


def test_chuoi_khung_hinh_bat_duoc_gat_dau_that():
    frames = [(pose(pitch=-2.0), None), (pose(pitch=25.0), None)]
    assert verify_action_sequence("NOD", frames, YAW, PITCH) is True


def test_dau_dung_yen_khong_phai_gat_dau():
    frames = [(pose(pitch=20.0), None), (pose(pitch=21.0), None)]
    assert verify_action_sequence("NOD", frames, YAW, PITCH) is False


@pytest.mark.parametrize("action", ["BLINK", "NOD", "TURN_LEFT"])
def test_mot_khung_hinh_khong_du_cho_chuoi(action):
    assert verify_action_sequence(action, [(pose(yaw=40.0), landmarks68())], YAW, PITCH) is None
