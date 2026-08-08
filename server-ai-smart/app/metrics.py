"""Prometheus metrics — docs/02 mục 12 và FR-ADM-AI-03.

Web Admin đọc các chỉ số này qua `GET /v1/system/ai/metrics` của Backend.
Cảnh báo đã định nghĩa: AI Server latency p95 > 2s trong 5 phút (docs/02 mục 12).
"""

from __future__ import annotations

from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram

# Dùng registry RIÊNG thay vì registry mặc định toàn cục của prometheus_client.
# Registry mặc định tự động gom cả metric của tiến trình Python (GC, fd, RSS…) và
# dễ va tên khi thư viện bên thứ ba cũng đăng ký metric. Registry riêng khiến
# `/metrics` chỉ phơi đúng những gì khai ở đây, và test tạo lại được sạch sẽ.
REGISTRY = CollectorRegistry()

INFERENCE_SECONDS = Histogram(
    "ai_inference_seconds",
    "Thời gian xử lý một request suy luận",
    labelnames=("endpoint",),
    # Mốc bám sát NFR-PERF-01 (chấm công < 2s) và max_processing_ms = 2000.
    buckets=(0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 5.0),
    registry=REGISTRY,
)

# `outcome` nhận đúng 3 giá trị, đặt ở service._guard():
#   ok       — xử lý xong, tìm thấy mặt
#   rejected — ảnh không dùng được (tối, mờ, không có mặt). BÌNH THƯỜNG, không báo động.
#   error    — bug trong pipeline. Chỉ số này tăng là phải vào xem log ngay.
# Tách `rejected` khỏi `error` để cảnh báo không kêu mỗi khi có người chụp ảnh xấu.
REQUESTS_TOTAL = Counter(
    "ai_requests_total",
    "Tổng số request theo kết quả",
    labelnames=("endpoint", "outcome"),
    registry=REGISTRY,
)

IMAGE_REJECTED_TOTAL = Counter(
    "ai_image_rejected_total",
    "Số ảnh bị từ chối, tách theo mã lỗi — theo dõi tỷ lệ FACE_NOT_FOUND (docs/02 mục 12)",
    labelnames=("error_code",),
    registry=REGISTRY,
)

MATCH_SCORE = Histogram(
    "ai_match_score",
    "Phân bố điểm tương đồng. Phân bố lệch dần theo thời gian = model đang suy giảm.",
    buckets=(0.0, 0.1, 0.2, 0.3, 0.4, 0.45, 0.5, 0.55, 0.6, 0.7, 0.8, 0.9, 1.0),
    registry=REGISTRY,
)

LIVENESS_SCORE = Histogram(
    "ai_liveness_score",
    "Phân bố điểm liveness",
    buckets=(0.0, 0.1, 0.3, 0.5, 0.7, 0.8, 0.9, 0.95, 1.0),
    registry=REGISTRY,
)

# Chạm trần semaphore trong runner.py nghĩa là request đang phải xếp hàng chờ.
# Đây là chỉ báo SỚM nhất của quá tải — nó tăng trước khi p95 latency kịp xấu đi.
CONCURRENT_INFERENCES = Gauge(
    "ai_concurrent_inferences",
    "Số suy luận đang chạy đồng thời",
    registry=REGISTRY,
)

# Mẫu "info metric" quen thuộc của Prometheus: giá trị luôn 1, thông tin nằm hết
# ở nhãn. Nhờ vậy join được với metric khác để biết đợt điểm số tụt xuống rơi vào
# model version nào — chính là bằng chứng cần có khi nghi model mới kém hơn.
MODEL_INFO = Gauge(
    "ai_model_info",
    "Luôn bằng 1; nhãn cho biết model nào đang chạy",
    labelnames=("engine", "model_version", "liveness_model"),
    registry=REGISTRY,
)

# Chỉ mục nằm trong RAM nên MẤT sau mỗi lần restart. Số này tụt về 0 mà Backend
# chưa nạp lại thì kiosk sẽ không nhận diện được ai — cần cảnh báo.
INDEX_SIZE = Gauge(
    "ai_index_vectors",
    "Số vector trong chỉ mục 1:N theo namespace",
    labelnames=("namespace",),
    registry=REGISTRY,
)
