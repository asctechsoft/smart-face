from __future__ import annotations

import base64
import os

import cv2
import numpy as np
import pytest

# Đặt biến môi trường TRƯỚC khi import app: get_settings() dùng lru_cache nên
# lần đọc đầu tiên sẽ bị giữ lại cho toàn bộ phiên chạy.
os.environ.update(
    {
        "ENV": "development",
        "ENGINE": "stub",
        "AI_SERVER_INTERNAL_KEY": "khoa-kiem-thu-du-dai-de-vuot-nguong-32-ky-tu",
        "WARMUP_ON_STARTUP": "false",
        "ALLOW_MISSING_LIVENESS_MODEL": "true",
    }
)

from fastapi.testclient import TestClient

from app.main import app

INTERNAL_KEY = os.environ["AI_SERVER_INTERNAL_KEY"]


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def auth_headers() -> dict[str, str]:
    return {"X-Internal-Key": INTERNAL_KEY}


def make_image(seed: int = 1, size: int = 480) -> np.ndarray:
    """Ảnh nhiễu tất định. Không phải mặt người — engine giả không cần mặt thật."""
    generator = np.random.default_rng(seed)
    return generator.integers(60, 200, size=(size, size, 3), dtype=np.uint8)


def encode_base64(image: np.ndarray) -> str:
    success, buffer = cv2.imencode(".jpg", image)
    assert success, "Không mã hoá được ảnh kiểm thử"
    return base64.b64encode(buffer.tobytes()).decode("ascii")


@pytest.fixture
def image_b64() -> str:
    return encode_base64(make_image(seed=1))


@pytest.fixture
def other_image_b64() -> str:
    return encode_base64(make_image(seed=2))
