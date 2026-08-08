"""Hợp đồng dữ liệu với Backend — docs/08 mục 8.

⚠ Mọi thay đổi ở đây phải khớp với `BackEnd/src/modules/ai-gateway/ai-gateway.types.ts`.

⚠ NGUYÊN TẮC P3: không có trường nào tên `accepted`, `passed`, `verified` ở cấp
kết quả nghiệp vụ. AI Server trả SỐ, Backend so ngưỡng và quyết định. Nếu ai đó
thêm `accepted: bool` vào đây thì đã phá vỡ ranh giới kiến trúc — xem lại ngay.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

LivenessAction = Literal["BLINK", "TURN_LEFT", "TURN_RIGHT", "SMILE", "NOD"]


class ImageQuality(BaseModel):
    """Các chỉ số đo được của tấm ảnh — TOÀN BỘ là số thô, không có kết luận.

    AI Server chỉ đo và trả về; ngưỡng "bao nhiêu là đủ nét / đủ sáng" nằm ở
    `CompanyPolicy` bên Backend, vì mỗi công ty có điều kiện ánh sáng khác nhau
    (nhà xưởng, văn phòng, ngoài trời). Nhúng ngưỡng vào đây sẽ khiến muốn nới
    lỏng cho một công ty là phải sửa code và deploy lại AI Server.
    """

    blur: float = Field(description="Phương sai Laplacian — càng cao càng nét")
    brightness: float = Field(description="Độ sáng trung bình kênh xám, 0..255")
    yaw: float | None = Field(default=None, description="Góc quay trái/phải, độ")
    pitch: float | None = Field(default=None, description="Góc ngẩng/cúi, độ")
    face_px: int = Field(description="Cạnh nhỏ hơn của khung khuôn mặt, pixel")


class Liveness(BaseModel):
    """Kết quả chống giả mạo (AF-05) — ảnh chụp màn hình, ảnh in, mặt nạ, video."""

    score: float = Field(description="Điểm người thật, 0..1. Backend tự so ngưỡng.")
    action_verified: bool | None = Field(
        default=None,
        description=(
            "Đã làm đúng hành động server yêu cầu chưa (AF-05). "
            "`null` = KHÔNG xác định được từ ảnh tĩnh — Backend phải coi như chưa xác minh."
        ),
    )


class ModelInfo(BaseModel):
    """Model nhận diện đang nạp — Backend ghi kèm mỗi bản ghi chấm công.

    Nhờ vậy khi đổi model sau này vẫn truy được bản ghi cũ được chấm bằng model
    nào, và biết ngưỡng cũ có còn dùng lại được không (điểm số giữa hai model
    KHÔNG so sánh trực tiếp với nhau được).
    """

    name: str
    version: str
    loaded_at: str


class GpuInfo(BaseModel):
    """Tình trạng GPU — dùng cho cảnh báo vận hành, không ảnh hưởng nghiệp vụ.

    `available: false` không có nghĩa là hỏng: engine tự lùi về CPU, chỉ chậm hơn.
    """

    available: bool
    utilization: float
    memory_used_mb: int


# ---------------------------------------------------------------------------
#  Request
# ---------------------------------------------------------------------------


class _ImageRequest(BaseModel):
    """Phần chung của mọi request có gửi ảnh lên.

    `model_config = ConfigDict(protected_namespaces=())` là để tắt cảnh báo của
    Pydantic v2 về tiền tố `model_` — hợp đồng với Backend có trường
    `model_version`, đổi tên sẽ phá vỡ giao diện đã thống nhất ở docs/08.
    """

    model_config = ConfigDict(protected_namespaces=())

    image_base64: str = Field(description="Ảnh JPEG/PNG mã hoá base64. Chấp nhận cả data URI.")
    # Bật thì pipeline chạy thêm nhánh chống giả mạo (tốn thêm thời gian suy luận).
    require_liveness: bool = False
    # Hành động server yêu cầu người dùng làm. Do SERVER chọn ngẫu nhiên, không
    # phải client tự khai — client chọn được thì kẻ tấn công chuẩn bị sẵn video.
    liveness_action: LivenessAction | None = None


class EnrollRequest(_ImageRequest):
    """Đăng ký khuôn mặt: chỉ cần ảnh, trả về embedding để Backend lưu."""


class VerifyRequest(_ImageRequest):
    embeddings: list[list[float]] = Field(
        min_length=1,
        description=(
            "Các embedding đã đăng ký của ĐÚNG nhân viên đang chấm công. "
            "Backend đã biết là ai (đã đăng nhập) nên đây là bài toán 1:1."
        ),
    )


class IdentifyCandidate(BaseModel):
    """Một ứng viên trong bài toán 1:N.

    Mỗi nhân viên có NHIỀU embedding (đăng ký nhiều góc mặt, có/không kính…).
    Điểm của ứng viên là điểm cao nhất trong các embedding của họ.
    """

    employee_id: str
    embeddings: list[list[float]] = Field(min_length=1)


class IdentifyRequest(_ImageRequest):
    """So khớp 1:N.

    Hai cách cung cấp tập ứng viên, chọn một:

    - `candidates`: Backend gửi thẳng embedding lên. Không cần đồng bộ, dùng được
      ngay. Phù hợp khi tập nhỏ (kiểm tra trùng danh tính trong một công ty).
    - `scope_ids`: dùng chỉ mục nạp sẵn trong RAM của AI Server qua `/v1/index/*`.
      Đây là dạng ghi trong docs/08, dành cho kiosk khi tập lớn và không muốn
      đẩy hàng nghìn vector qua mạng mỗi lượt.
    """

    scope_ids: list[str] = Field(default_factory=list)
    candidates: list[IdentifyCandidate] = Field(default_factory=list)
    namespace: str | None = Field(
        default=None,
        description=(
            "Bắt buộc khi dùng `scope_ids`. PHẢI là company_id — chỉ mục 1:N "
            "tuyệt đối không được trộn giữa các công ty (ADR-05)."
        ),
    )
    # Số ứng viên trả về. Backend cần ít nhất 2 để tính `margin` — lấy đúng 1
    # thì không biết người đứng thứ hai sát tới đâu, mất luôn chốt an toàn.
    top_k: int = Field(default=5, ge=1, le=100)

    @model_validator(mode="after")
    def _require_namespace_for_scope(self) -> IdentifyRequest:
        """Chặn ngay tại tầng validate việc tìm 1:N mà không giới hạn công ty.

        Thiếu `namespace` thì chỉ mục trong RAM sẽ tìm trên toàn bộ nhân viên của
        MỌI công ty — nhân viên công ty A có thể được nhận diện thành người của
        công ty B. Đây là rò rỉ dữ liệu xuyên tenant, nên phải chết ngay ở đây
        thay vì âm thầm trả về kết quả sai (ADR-05).
        """
        if self.scope_ids and not self.candidates and not self.namespace:
            raise ValueError(
                "Thiếu `namespace` khi dùng `scope_ids`. Không có namespace thì "
                "không thể bảo đảm chỉ tìm trong phạm vi một công ty (ADR-05)."
            )
        return self


class LivenessRequest(_ImageRequest):
    """Chỉ kiểm tra người thật, không so khớp danh tính.

    Dùng ở bước tiền kiểm của App: phát hiện sớm ảnh in / ảnh chụp màn hình
    trước khi tốn một lượt trích xuất embedding.
    """


class BatchAuditItem(BaseModel):
    """Một lượt chấm công cần đối chiếu lại."""

    ref_id: str = Field(description="Định danh do Backend đặt, thường là attendance_log.id")
    image_base64: str
    embeddings: list[list[float]] = Field(min_length=1)


class BatchAuditRequest(BaseModel):
    """Đối chiếu lại hàng loạt — chạy nền ban đêm, không nằm trên đường chấm công.

    Lượt chấm công ban ngày ưu tiên nhanh; job này chấm lại kỹ hơn để phát hiện
    gian lận đã lọt lưới, kết quả đổ vào `FraudFlag` cho người thật xem xét.
    """

    # Chặn 200 để một job không giữ GPU quá lâu, làm nghẽn request chấm công
    # đang chạy song song. Backend tự chia nhỏ khi cần đối chiếu số lượng lớn.
    items: list[BatchAuditItem] = Field(min_length=1, max_length=200)


class IndexUpsertRequest(BaseModel):
    """Nạp/cập nhật embedding vào chỉ mục trong RAM của AI Server.

    ⚠ Chỉ mục nằm trong RAM nên MẤT khi restart. Backend phải nạp lại sau mỗi lần
    AI Server khởi động, không được coi đây là nơi lưu trữ bền vững.
    """

    entries: list[IdentifyCandidate] = Field(min_length=1)
    namespace: str = Field(
        default="default",
        description=(
            "Nên dùng company_id — chỉ mục 1:N tuyệt đối không được trộn "
            "giữa các công ty (ADR-05)."
        ),
    )


class IndexRemoveRequest(BaseModel):
    """Gỡ nhân viên khỏi chỉ mục — gọi khi nghỉ việc hoặc xoá dữ liệu sinh trắc.

    Không gỡ thì người đã nghỉ vẫn được nhận diện ở kiosk.
    """

    employee_ids: list[str] = Field(min_length=1)
    namespace: str = "default"


# ---------------------------------------------------------------------------
#  Response
# ---------------------------------------------------------------------------


class _BaseResponse(BaseModel):
    """Phần chung của mọi phản hồi suy luận.

    Ảnh không dùng được KHÔNG trả HTTP 4xx mà trả 200 với `face_found: false` kèm
    `error_code`. Lý do: Backend có circuit breaker đếm lỗi 5xx/4xx để ngắt AI
    Server khi nó hỏng. Một người dùng chụp ảnh tối om là chuyện bình thường, đếm
    vào đó sẽ khiến AI Server bị ngắt oan giữa giờ cao điểm.
    """

    model_config = ConfigDict(protected_namespaces=())

    face_found: bool
    # Mã lỗi có cấu trúc để App ánh xạ sang thông báo tiếng Việt — xem errors.py.
    error_code: str | None = None
    # Thời gian xử lý phía AI, dùng theo dõi NFR hiệu năng.
    processing_ms: int


class EnrollResponse(_BaseResponse):
    """Kết quả đăng ký khuôn mặt."""

    quality: ImageQuality | None = None
    liveness: Liveness | None = None
    # Đã L2-normalize nên so khớp bằng tích vô hướng là ra luôn cosine similarity,
    # không cần chia chuẩn ở mỗi lần so — quan trọng khi quét 1:N hàng nghìn vector.
    embedding: list[float] | None = Field(
        default=None, description="Vector 512 chiều đã L2-normalize"
    )
    # Backend lưu kèm embedding. Đổi model thì embedding cũ KHÔNG so khớp được
    # với embedding mới, phải biết version để còn đăng ký lại.
    model_version: str | None = None


class MatchResult(BaseModel):
    """Kết quả so khớp 1:1.

    Trả cả `scores` chứ không chỉ `best_score` để Backend điều tra được khi nghi
    ngờ: một embedding lệch hẳn so với các cái còn lại là dấu hiệu ảnh đăng ký
    lúc trước bị lỗi.
    """

    best_score: float
    scores: list[float]


class VerifyResponse(_BaseResponse):
    """Kết quả xác minh 1:1 — dùng cho luồng chấm công của nhân viên đã đăng nhập."""

    quality: ImageQuality | None = None
    liveness: Liveness | None = None
    match: MatchResult | None = None
    model_version: str | None = None


class IdentifyMatch(BaseModel):
    """Một ứng viên khớp trong kết quả 1:N, đã kèm điểm."""

    employee_id: str
    score: float


class IdentifyResponse(_BaseResponse):
    """Kết quả nhận diện 1:N — dùng cho kiosk, nơi chưa biết người đứng trước máy là ai.

    Khó hơn 1:1 rất nhiều: càng nhiều ứng viên thì xác suất có người trông giống
    càng cao. Vì thế `margin` quan trọng ngang, thậm chí hơn, điểm số tuyệt đối.
    """

    quality: ImageQuality | None = None
    liveness: Liveness | None = None
    matches: list[IdentifyMatch] | None = None
    margin: float | None = Field(
        default=None,
        description=(
            "Khoảng cách top1 − top2. Với 1:N đây là con số QUYẾT ĐỊNH: "
            "điểm cao nhưng margin nhỏ nghĩa là hai người giống nhau, không được tin."
        ),
    )
    model_version: str | None = None


class LivenessResponse(_BaseResponse):
    """Kết quả kiểm tra người thật, không kèm so khớp danh tính."""

    quality: ImageQuality | None = None
    liveness: Liveness | None = None
    model_version: str | None = None


class BatchAuditResult(BaseModel):
    """Kết quả đối chiếu lại một lượt chấm công.

    Không kế thừa `_BaseResponse` vì `processing_ms` được tính cho CẢ lô, đặt ở
    `BatchAuditResponse`; lặp lại cho từng phần tử vừa thừa vừa dễ hiểu nhầm.
    """

    ref_id: str
    face_found: bool
    error_code: str | None = None
    # `None` khi không tìm thấy mặt — phân biệt rõ với 0.0 (tìm thấy nhưng không khớp).
    best_score: float | None = None
    liveness_score: float | None = None


class BatchAuditResponse(BaseModel):
    """Phản hồi cả lô. Lỗi ở một phần tử không làm hỏng các phần tử còn lại."""

    model_config = ConfigDict(protected_namespaces=())

    results: list[BatchAuditResult]
    model_version: str | None = None
    processing_ms: int


class HealthResponse(BaseModel):
    """Health check cho readiness probe của K8s.

    `starting` khác `degraded`: lúc mới bật, model nặng vài trăm MB chưa nạp xong.
    K8s cần biết để CHỜ chứ không giết pod và khởi động lại vô tận.
    """

    status: Literal["healthy", "degraded", "starting"]
    engine: str
    model: ModelInfo | None = None
    liveness_model: str
    gpu: GpuInfo | None = None
    uptime_seconds: int


class IndexStatsResponse(BaseModel):
    """Thống kê chỉ mục 1:N trong RAM.

    `total_vectors` lớn hơn `total_employees` là bình thường — mỗi người đăng ký
    nhiều góc mặt. Hai số bằng nhau nghĩa là ai cũng chỉ có một ảnh, độ chính xác
    sẽ kém khi đổi góc chụp hoặc đeo kính.
    """

    namespaces: dict[str, int]
    total_employees: int
    total_vectors: int
