# AI Server — image chạy production.
#
# Build CPU (mặc định):
#   docker build -t smartface-ai:cpu .
# Build GPU:
#   docker build --build-arg RUNTIME=gpu -t smartface-ai:gpu .
#
# Model KHÔNG nằm trong image: vài trăm MB, và nâng cấp model phải làm được mà
# không cần build lại. Mount volume vào /app/models.

FROM python:3.11-slim AS base

ARG RUNTIME=cpu

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    MODEL_ROOT=/app/models

# libGL + libglib: OpenCV cần, kể cả bản headless.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libgl1 \
        libglib2.0-0 \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .

RUN pip install --upgrade pip \
    && pip install -r requirements.txt \
    && if [ "$RUNTIME" = "gpu" ]; then \
         pip uninstall -y onnxruntime \
         && pip install onnxruntime-gpu==1.20.1 pynvml==11.5.3 ; \
       fi

COPY app ./app
COPY scripts ./scripts

# Chạy bằng người dùng thường: một lỗ hổng trong thư viện giải mã ảnh không
# được biến thành quyền root trong container.
RUN useradd --create-home --uid 10001 aiserver \
    && mkdir -p /app/models \
    && chown -R aiserver:aiserver /app
USER aiserver

EXPOSE 8000

# start-period dài vì nạp model mất vài giây.
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
    CMD curl -fsS http://localhost:8000/health || exit 1

# Một worker duy nhất: mỗi worker nạp một bản model riêng vào RAM. Muốn tăng
# thông lượng thì tăng MAX_CONCURRENCY, hoặc chạy thêm replica ở tầng
# Kubernetes — đừng tăng --workers ở đây.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
