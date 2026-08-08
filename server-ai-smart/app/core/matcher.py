"""So khớp embedding — bước 6 của pipeline (docs/02 mục 6.3).

⚠ Ở đây KHÔNG có ngưỡng. Hàm trong file này chỉ tính điểm. Việc điểm 0.42 là
đạt hay không đạt là quyết định nghiệp vụ của Backend, theo cấu hình của từng
công ty (P3).
"""

from __future__ import annotations

import numpy as np


def l2_normalize(vector: np.ndarray) -> np.ndarray:
    norm = float(np.linalg.norm(vector))
    return vector if norm < 1e-12 else vector / norm


def cosine_scores(probe: np.ndarray, gallery: np.ndarray) -> np.ndarray:
    """Điểm tương đồng cosine giữa một vector và một ma trận vector.

    Cả hai phía đều đã L2-normalize nên cosine rút gọn thành tích vô hướng —
    một phép nhân ma trận, chạy nhanh kể cả với hàng chục nghìn vector.
    """
    if gallery.size == 0:
        return np.empty(0, dtype=np.float32)

    probe = l2_normalize(probe.astype(np.float32))
    gallery = gallery.astype(np.float32)

    norms = np.linalg.norm(gallery, axis=1, keepdims=True)
    norms[norms < 1e-12] = 1.0
    gallery = gallery / norms

    return np.clip(gallery @ probe, -1.0, 1.0)


def verify_1to1(probe: np.ndarray, embeddings: list[list[float]]) -> tuple[float, list[float]]:
    """1:1 — so với các embedding đã đăng ký của ĐÚNG một nhân viên.

    Lấy điểm cao nhất trong các góc đã đăng ký (thẳng/trái/phải) chứ không lấy
    trung bình: người dùng chỉ chụp được một góc mỗi lần, trung bình sẽ luôn bị
    kéo xuống bởi những góc không khớp.
    """
    gallery = np.asarray(embeddings, dtype=np.float32)
    if gallery.ndim == 1:
        gallery = gallery[np.newaxis, :]

    scores = cosine_scores(probe, gallery)
    if scores.size == 0:
        return 0.0, []

    rounded = [round(float(value), 4) for value in scores]
    return max(rounded), rounded


def identify_1_to_n(
    probe: np.ndarray,
    gallery: np.ndarray,
    owners: list[str],
    top_k: int,
) -> tuple[list[tuple[str, float]], float | None]:
    """1:N — trả top-K và `margin`.

    `margin` = điểm cao nhất trừ điểm cao nhì **của người khác**. Đây là con số
    quyết định, không phải điểm tuyệt đối: hai anh em sinh đôi có thể cùng đạt
    0.75, điểm cao nhưng chênh nhau 0.01 thì không được tin ai cả.

    Phải loại các vector cùng thuộc một người ra khỏi phép tính margin, nếu
    không thì người đăng ký 4 góc sẽ luôn có margin gần bằng 0 vì top1 và top2
    đều là chính họ — và hệ thống sẽ từ chối đúng người.
    """
    scores = cosine_scores(probe, gallery)
    if scores.size == 0:
        return [], None

    best_per_owner: dict[str, float] = {}
    for owner, score in zip(owners, scores, strict=True):
        value = float(score)
        if value > best_per_owner.get(owner, -1.0):
            best_per_owner[owner] = value

    ranked = sorted(best_per_owner.items(), key=lambda item: item[1], reverse=True)
    margin = round(ranked[0][1] - ranked[1][1], 4) if len(ranked) >= 2 else None

    return [(owner, round(score, 4)) for owner, score in ranked[:top_k]], margin
