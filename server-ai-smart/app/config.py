"""Cấu hình AI Server.

⚠ NGUYÊN TẮC P3 (docs/02 mục 6.1): file này KHÔNG chứa ngưỡng nghiệp vụ.

Ngưỡng nghiệp vụ (`face_match_threshold`, `liveness_threshold`, `min_face_pixels`)
nằm ở Backend, theo từng công ty, trong `SystemConfig`/`CompanyPolicy`. AI Server
không biết chúng và không được biết.

Những gì ở đây chỉ là **sàn kỹ thuật**: mức mà bên dưới nó tấm ảnh hỏng tới mức
embedding trích ra là rác, nên trả về số liệu cũng vô nghĩa. Đó là chuyện chất
lượng đầu vào, không phải chuyện chính sách chấm công.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        # `model_version` va vào namespace `model_` được bảo vệ của pydantic.
        protected_namespaces=(),
        # Cho phép gán bằng tên trường lẫn tên biến môi trường. Không có cờ này
        # thì `Settings(internal_key=...)` bị bỏ qua âm thầm — giá trị mặc định
        # vẫn được dùng và test tưởng là đã kiểm chứng được điều gì đó.
        populate_by_name=True,
    )

    # --- Môi trường ---------------------------------------------------------
    env: Literal["development", "staging", "production"] = "development"
    log_level: str = "INFO"
    host: str = "0.0.0.0"  # noqa: S104 — chạy trong container mạng nội bộ
    port: int = 8000

    # --- Bảo mật ------------------------------------------------------------
    # docs/02 mục 6.2: AI Server KHÔNG expose ra internet, chỉ nhận request từ
    # Backend Core trong mạng nội bộ, xác thực bằng X-Internal-Key.
    internal_key: str = Field(default="", alias="AI_SERVER_INTERNAL_KEY")
    max_image_bytes: int = 20 * 1024 * 1024

    # --- Engine -------------------------------------------------------------
    engine: Literal["insightface", "stub"] = "insightface"
    model_pack: str = "buffalo_l"
    model_root: str = "./models"
    model_version_label: str = "buffalo_l@2.1"
    providers: str = "CPUExecutionProvider"
    det_size: int = 640
    """Kích thước ảnh đưa vào bộ phát hiện khuôn mặt. Lớn hơn = bắt được mặt nhỏ
    hơn nhưng chậm hơn."""

    # Số suy luận chạy song song. ONNX chiếm trọn CPU/GPU trong lúc chạy nên
    # thả tự do sẽ làm p99 tệ đi thay vì tốt lên.
    max_concurrency: int = 4
    warmup_on_startup: bool = True

    # --- Liveness -----------------------------------------------------------
    liveness_model_path: str = ""
    """Đường dẫn tới model chống giả mạo ONNX (MiniFASNet). Trống = chưa có."""

    allow_missing_liveness_model: bool = False
    """Chỉ để phát triển. Production bật cờ này = tự tay tháo chốt chống chấm hộ."""

    # --- Sàn kỹ thuật cho chất lượng ảnh ------------------------------------
    # KHÔNG phải ngưỡng nghiệp vụ. Đây là mức mà dưới nó ảnh hỏng tới mức
    # embedding trích ra không dùng được.
    floor_blur: float = 25.0
    """Phương sai Laplacian. Dưới mức này ảnh nhoè tới mức mất đặc trưng."""

    floor_brightness_dark: float = 35.0
    floor_brightness_bright: float = 235.0
    floor_face_px: int = 48
    """Sàn cứng. Ngưỡng nghiệp vụ `min_face_pixels` (mặc định 112) do Backend áp."""

    floor_detection_score: float = 0.5

    # --- Xác minh hành động liveness từ tư thế đầu --------------------------
    pose_yaw_threshold: float = 18.0
    pose_pitch_threshold: float = 14.0

    @model_validator(mode="after")
    def _guard_production(self) -> Settings:
        if self.env != "production":
            return self

        if not self.internal_key:
            raise ValueError(
                "AI_SERVER_INTERNAL_KEY bắt buộc phải đặt ở production "
                "(docs/02 mục 6.2)."
            )
        if len(self.internal_key) < 32:
            raise ValueError("AI_SERVER_INTERNAL_KEY ở production phải dài ít nhất 32 ký tự.")
        if self.engine == "stub":
            raise ValueError(
                "ENGINE=stub bị cấm ở production. Engine giả trả embedding bịa ra "
                "— mọi lượt chấm công sẽ vô nghĩa."
            )
        if self.allow_missing_liveness_model:
            raise ValueError(
                "ALLOW_MISSING_LIVENESS_MODEL=true bị cấm ở production: "
                "không có model chống giả mạo thì ảnh in ra cũng chấm công được (AF-05..AF-09)."
            )
        if not self.liveness_model_path:
            raise ValueError(
                "LIVENESS_MODEL_PATH bắt buộc ở production. "
                "Chạy `python scripts/download_models.py` để tải model."
            )
        return self

    @property
    def provider_list(self) -> list[str]:
        return [item.strip() for item in self.providers.split(",") if item.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
