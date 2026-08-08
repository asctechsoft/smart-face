"""Kiểu dữ liệu nội bộ của pipeline xử lý ảnh."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(slots=True)
class Quality:
    blur: float
    brightness: float
    yaw: float | None
    pitch: float | None
    face_px: int


@dataclass(slots=True)
class LivenessOutcome:
    score: float
    #: `None` = không xác định được từ ảnh tĩnh. Backend PHẢI coi như chưa xác minh.
    action_verified: bool | None


@dataclass(slots=True)
class Analysis:
    """Kết quả phân tích một ảnh.

    Không chứa trường nào mang tính quyết định (`accepted`, `passed`). Chỉ số liệu.
    """

    quality: Quality
    embedding: np.ndarray | None
    liveness: LivenessOutcome | None
    model_version: str
