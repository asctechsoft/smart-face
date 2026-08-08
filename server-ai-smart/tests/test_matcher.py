"""Kiểm chứng phép so khớp — phần dễ sai nhất và hậu quả nặng nhất."""

from __future__ import annotations

import numpy as np

from app.core.matcher import cosine_scores, identify_1_to_n, l2_normalize, verify_1to1


def unit(*values: float) -> np.ndarray:
    return l2_normalize(np.array(values, dtype=np.float32))


def test_cosine_vector_trung_nhau_cho_diem_1():
    vector = unit(1.0, 2.0, 3.0)
    assert cosine_scores(vector, vector[np.newaxis, :])[0] == np.float32(1.0)


def test_cosine_vector_vuong_goc_cho_diem_0():
    scores = cosine_scores(unit(1.0, 0.0), unit(0.0, 1.0)[np.newaxis, :])
    assert abs(float(scores[0])) < 1e-6


def test_cosine_tu_chuan_hoa_gallery_chua_normalize():
    """Embedding lưu trong DB có thể chưa chuẩn hoá — không được cho điểm > 1."""
    probe = unit(1.0, 0.0, 0.0)
    gallery = np.array([[5.0, 0.0, 0.0]], dtype=np.float32)

    assert abs(float(cosine_scores(probe, gallery)[0]) - 1.0) < 1e-5


def test_verify_lay_diem_cao_nhat_khong_lay_trung_binh():
    """Người dùng đăng ký 3 góc nhưng mỗi lần chấm công chỉ chụp được 1 góc.

    Lấy trung bình sẽ luôn bị hai góc không khớp kéo xuống, khiến đúng người
    cũng bị từ chối.
    """
    probe = unit(1.0, 0.0, 0.0)
    embeddings = [
        [1.0, 0.0, 0.0],  # đúng góc
        [0.0, 1.0, 0.0],  # góc khác
        [0.0, 0.0, 1.0],  # góc khác
    ]

    best, scores = verify_1to1(probe, embeddings)

    assert abs(best - 1.0) < 1e-4
    assert len(scores) == 3
    assert best == max(scores)


def test_identify_margin_loai_tru_vector_cung_mot_nguoi():
    """Đây là cái bẫy tinh vi nhất của so khớp 1:N.

    Một người đăng ký 4 góc = 4 vector trong chỉ mục. Nếu tính margin trên toàn
    bộ vector thì top1 và top2 đều là chính họ, margin ≈ 0, và hệ thống từ chối
    ĐÚNG người mỗi lần. Margin phải tính giữa NGƯỜI với NGƯỜI.
    """
    probe = unit(1.0, 0.0, 0.0)

    gallery = np.array(
        [
            [1.00, 0.00, 0.0],  # nv_a, góc thẳng
            [0.98, 0.20, 0.0],  # nv_a, góc trái — cũng rất giống probe
            [0.10, 0.99, 0.0],  # nv_b
        ],
        dtype=np.float32,
    )
    owners = ["nv_a", "nv_a", "nv_b"]

    ranked, margin = identify_1_to_n(probe, gallery, owners, top_k=5)

    assert [owner for owner, _ in ranked] == ["nv_a", "nv_b"]
    assert margin is not None and margin > 0.8, (
        f"margin = {margin}: đang tính giữa hai vector của cùng một người"
    )


def test_identify_margin_nho_khi_hai_nguoi_that_su_giong_nhau():
    """Điểm cao nhưng margin nhỏ = không được tin ai cả.

    Backend phải nhìn margin, không chỉ nhìn điểm cao nhất.
    """
    probe = unit(1.0, 0.0, 0.0)
    gallery = np.array([[1.0, 0.02, 0.0], [1.0, 0.03, 0.0]], dtype=np.float32)

    ranked, margin = identify_1_to_n(probe, gallery, ["nv_a", "nv_b"], top_k=5)

    assert ranked[0][1] > 0.99
    assert margin is not None and margin < 0.01


def test_identify_margin_none_khi_chi_co_mot_ung_vien():
    probe = unit(1.0, 0.0, 0.0)
    gallery = np.array([[1.0, 0.0, 0.0]], dtype=np.float32)

    ranked, margin = identify_1_to_n(probe, gallery, ["nv_a"], top_k=5)

    assert len(ranked) == 1
    assert margin is None, "Một ứng viên thì không có gì để so — Backend phải tự xử lý"


def test_identify_ton_trong_top_k():
    probe = unit(1.0, 0.0, 0.0, 0.0, 0.0)
    gallery = np.eye(5, dtype=np.float32)
    owners = [f"nv_{index}" for index in range(5)]

    ranked, _ = identify_1_to_n(probe, gallery, owners, top_k=2)
    assert len(ranked) == 2


def test_gallery_rong_khong_lam_no_chuong_trinh():
    probe = unit(1.0, 0.0, 0.0)

    assert cosine_scores(probe, np.empty((0, 0), dtype=np.float32)).size == 0
    assert identify_1_to_n(probe, np.empty((0, 0), dtype=np.float32), [], 5) == ([], None)


def test_l2_normalize_khong_chia_cho_khong():
    zero = np.zeros(512, dtype=np.float32)
    assert not np.isnan(l2_normalize(zero)).any()
