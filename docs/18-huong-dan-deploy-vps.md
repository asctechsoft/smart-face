# 18 — Hướng dẫn deploy lên VPS (Docker Compose)

> **Kịch bản của tài liệu này**
>
> | Điều kiện | Giá trị |
> |---|---|
> | VPS | Ubuntu 22.04 / 24.04 LTS, tối thiểu 4 vCPU / 8 GB RAM / 60 GB SSD |
> | Cách chạy | Docker Compose (một máy) |
> | Phạm vi | Backend (API + worker) · Frontend `web-smart` · AI Server |
> | Tên miền | Có domain, **đi qua Cloudflare proxy** (mây cam) |
> | PostgreSQL | **Đã có sẵn**, nằm ngoài VPS |
> | Redis + MinIO | **Dựng mới** bằng container trên chính VPS |
>
> Nếu điều kiện của bạn khác, các mục có ⚠ là chỗ phải sửa.

Tài liệu này **không** thêm file cấu hình nào vào repo. Toàn bộ nội dung file cần tạo nằm trong các khối mã bên dưới — bạn tạo chúng trực tiếp trên VPS.

---

## Mục lục

| Mục | Nội dung |
|---|---|
| [§0](#0-kiến-trúc-triển-khai) | Kiến trúc triển khai, cổng nào mở ra internet |
| [§1](#1-chuẩn-bị-vps) | Chuẩn bị VPS: Docker, firewall, lấy mã nguồn |
| [§2](#2-sinh-bí-mật--làm-một-lần) | Sinh khoá RS256, khoá nội bộ AI, khoá Firebase |
| [§3](#3-bốn-file-cấu-hình-cần-tạo-trên-vps) | Nội dung đầy đủ 4 file cấu hình |
| [§4](#4-biến-môi-trường-production) | Bảng biến môi trường + vì sao từng giá trị |
| [§5](#5-trình-tự-deploy-lần-đầu) | Chuỗi lệnh deploy lần đầu |
| [§6](#6-cloudflare--https) | Cloudflare, HTTPS, WebSocket |
| [§7](#7-cập-nhật-code-deploy-lần-thứ-n) | Deploy lần sau và rollback |
| [§8](#8-vận-hành-hằng-ngày) | Log, job nền, backup, dọn đĩa |
| [§9](#9-bảng-lỗi-thường-gặp) | Triệu chứng → nguyên nhân thật → cách sửa |
| [§10](#10-những-thứ-chưa-xong-trước-khi-chạy-thật) | Hạn chế đã biết, phải xử lý trước khi chạy thật |

---

## 0. Kiến trúc triển khai

```
                    Internet
                       │
              ┌────────▼────────┐
              │   Cloudflare    │  TLS, WAF, cache  ← proxy hop #1
              └────────┬────────┘
                       │ 443
┌──────────────────────▼───────────────────────────────────┐
│  VPS Ubuntu — docker network `smartface`                  │
│                                                           │
│  ┌─────────────────────────────────────────┐              │
│  │ web (nginx:alpine)  :80/:443            │ ← proxy hop #2
│  │  ├─ /            → dist/ (SPA tĩnh)     │              │
│  │  ├─ /v1          → api:3000             │              │
│  │  ├─ /health      → api:3000             │              │
│  │  └─ /socket.io   → api:3000 (WebSocket) │              │
│  └───────────┬─────────────────────────────┘              │
│              │                                            │
│  ┌───────────▼──────────┐   ┌──────────────────────────┐  │
│  │ api (node)   :3000   │   │ worker (node)            │  │
│  │ WORKER_ENABLED=false │   │ WORKER_ENABLED=true      │  │
│  └───┬────┬────┬────────┘   └───┬────┬─────────────────┘  │
│      │    │    │                │    │                    │
│      │    │    └────────────────┼────┼──► ai-server :8000 │
│      │    │                     │    │    (KHÔNG ra ngoài)│
│      │    └─────────┬───────────┘    │                    │
│      │        ┌─────▼─────┐    ┌─────▼─────┐              │
│      │        │ redis :6379│    │minio :9000│              │
│      │        └───────────┘    └───────────┘              │
└──────┼───────────────────────────────────────────────────┘
       │
       └──────────────► PostgreSQL 16 (ngoài VPS)
```

**Hai `hop` proxy** trong sơ đồ là lý do `TRUSTED_PROXY_HOPS=2`. Đây là con số quan trọng nhất trong toàn bộ cấu hình — xem [§4](#trusted_proxy_hops--con-số-dễ-sai-nhất).

### Cổng nào mở ra internet

| Cổng | Mở ra ngoài? | Ghi chú |
|---|---|---|
| 22 (SSH) | ✅ | Nên giới hạn theo IP nếu được |
| 80, 443 | ✅ | Chỉ container `web` publish |
| 3000 (api) | ❌ | Chỉ trong docker network |
| 6379 (redis) | ❌ | Không `ports:` |
| 9000/9001 (minio) | ❌ | Đi qua nginx nếu cần công khai — xem [§4](#minio-và-bẫy-presigned-url) |
| 8000 (ai-server) | ❌ | `docs/02` mục 6.2 cấm expose AI Server ra internet |

---

## 1. Chuẩn bị VPS

### 1.1 Cài Docker Engine + Compose plugin

Dùng repo chính thức của Docker, **không** dùng `docker.io` của Ubuntu (bản cũ, thiếu `compose` v2):

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl gnupg git

sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io \
                    docker-buildx-plugin docker-compose-plugin

# Kiểm tra
docker --version && docker compose version
```

### 1.2 Tạo user deploy (không dùng root)

```bash
sudo adduser --disabled-password --gecos "" deploy
sudo usermod -aG docker deploy
sudo mkdir -p /opt/smartface && sudo chown -R deploy:deploy /opt/smartface
```

Từ đây trở đi mọi lệnh chạy bằng user `deploy` (`sudo -iu deploy`).

### 1.3 Firewall

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
sudo ufw status
```

> ⚠ **Docker ghi thẳng vào iptables và đi vòng qua `ufw`.** Vì vậy trong `docker-compose.prod.yml` bên dưới, các service nội bộ **không có mục `ports:`** — đó mới là thứ thật sự giữ chúng kín, không phải `ufw`. Nếu bạn tự thêm `ports: - "6379:6379"` cho redis, cổng đó sẽ mở ra internet dù `ufw` đang bật.

### 1.4 Lấy mã nguồn

```bash
cd /opt/smartface
git clone <URL-repo> .
git checkout main   # hoặc tag phiên bản muốn deploy
```

### 1.5 Cho phép Postgres bên ngoài nhận kết nối từ VPS

Postgres của bạn nằm ngoài VPS. Mở firewall phía Postgres cho **IP public của VPS**:

```bash
# Lấy IP public của VPS
curl -s ifconfig.me
```

Rồi ở phía máy chủ Postgres, thêm IP đó vào `pg_hba.conf` / security group. Kiểm tra thông từ VPS:

```bash
docker run --rm postgres:16-alpine \
  psql "postgresql://USER:PASS@HOST:5432/DBNAME" -c "select version();"
```

Chạy được dòng này rồi mới đi tiếp — nếu không, `migrate` ở [§5](#5-trình-tự-deploy-lần-đầu) sẽ treo và bạn sẽ mất thời gian tìm nhầm chỗ.

---

## 2. Sinh bí mật — làm một lần

Tạo thư mục chứa bí mật, quyền chỉ user `deploy` đọc được:

```bash
mkdir -p /opt/smartface/secrets && chmod 700 /opt/smartface/secrets
cd /opt/smartface/secrets
```

### 2.1 Cặp khoá JWT RS256 — bắt buộc

Production **không chạy được với HS256**. `env.validation.ts` kiểm tra và ném lỗi ngay lúc khởi động (`NFR-SEC-03`).

```bash
openssl genrsa -out jwt-private.pem 2048
openssl rsa -in jwt-private.pem -pubout -out jwt-public.pem
chmod 600 jwt-private.pem
```

Biến môi trường phải là **một dòng**, xuống dòng viết thành `\n`. Lệnh sau in ra đúng dạng để dán vào `.env`:

```bash
echo "JWT_PRIVATE_KEY=\"$(awk 'BEGIN{ORS="\\n"} {print}' jwt-private.pem)\""
echo "JWT_PUBLIC_KEY=\"$(awk 'BEGIN{ORS="\\n"} {print}' jwt-public.pem)\""
```

Dán nguyên hai dòng in ra (kể cả dấu nháy kép) vào `server-backend-smart/.env`.

### 2.2 Khoá nội bộ AI Server

```bash
openssl rand -hex 32
```

Giá trị này phải **giống hệt nhau** ở hai chỗ, nếu lệch thì mọi lượt chấm công trả lỗi gọi AI:

- `server-backend-smart/.env` → `AI_SERVER_INTERNAL_KEY=`
- `server-ai-smart/.env` → `AI_SERVER_INTERNAL_KEY=`

### 2.3 Mật khẩu Redis và MinIO

```bash
openssl rand -hex 24   # REDIS_PASSWORD
openssl rand -hex 24   # MINIO_ROOT_PASSWORD / S3_SECRET_KEY
```

### 2.4 Khoá Firebase (Backend)

Firebase Console → ⚙ **Project settings** → **Service accounts** → **Generate new private key** → tải file JSON về.

Từ file JSON lấy 3 giá trị. Lệnh sau chuyển `private_key` về một dòng đúng định dạng:

```bash
# Đặt file JSON là firebase-admin.json trong /opt/smartface/secrets
python3 - <<'EOF'
import json
d = json.load(open('firebase-admin.json'))
print('FIREBASE_PROJECT_ID=' + d['project_id'])
print('FIREBASE_CLIENT_EMAIL=' + d['client_email'])
print('FIREBASE_PRIVATE_KEY="' + d['private_key'].replace('\n', '\\n') + '"')
EOF
```

### 2.5 Cấu hình Firebase Web (Frontend)

Firebase Console → ⚙ **Project settings** → **General** → **Your apps** → Web app. Lấy `apiKey`, `authDomain`, `projectId`, `appId`.

> ⚠ **`projectId` của Web phải trùng `FIREBASE_PROJECT_ID` của Backend.** Khác dự án thì Backend không xác minh được ID token do Web gửi lên, và triệu chứng là "đăng nhập đúng mật khẩu vẫn báo token không hợp lệ".

Thêm domain production vào Firebase Console → **Authentication** → **Settings** → **Authorized domains**.

### 2.6 Ba file `.env` đã được gitignore sẵn

`server-backend-smart/.gitignore`, `web-smart/.gitignore`, `server-ai-smart/.gitignore` đều có dòng `.env`, và `git ls-files` xác nhận repo chỉ theo dõi các file `.env.example`. **Đừng dùng `git add -f`** để đưa `.env` lên repo.

---

## 3. Bốn file cấu hình cần tạo trên VPS

### 3.1 `/opt/smartface/docker-compose.prod.yml`

```yaml
# ============================================================================
#  SmartFace — production một máy (VPS)
#  Khác docker-compose.yml của server-backend-smart ở chỗ:
#    - NODE_ENV=production, không có mật khẩu hardcode
#    - migration là service RIÊNG chạy trước, không chạy inline trong `api`
#      (docs/02 mục 12.3)
#    - Postgres nằm ngoài, không dựng ở đây
#    - Redis / MinIO / AI Server không publish cổng ra ngoài
# ============================================================================

name: smartface

services:
  # --------------------------------------------------------------------------
  #  Hạ tầng
  # --------------------------------------------------------------------------
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    # requirepass: redis không publish cổng, nhưng mọi container cùng network
    # đều gọi tới được — mật khẩu là lớp chặn thứ hai.
    command: >
      redis-server --appendonly yes
      --requirepass ${REDIS_PASSWORD}
      --maxmemory 512mb --maxmemory-policy noeviction
    volumes:
      - redis-data:/data
    healthcheck:
      test: ['CMD', 'redis-cli', '-a', '${REDIS_PASSWORD}', 'ping']
      interval: 10s
      timeout: 3s
      retries: 5
    networks: [smartface]

  minio:
    image: minio/minio:latest
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD}
    volumes:
      - minio-data:/data
    healthcheck:
      test: ['CMD', 'mc', 'ready', 'local']
      interval: 15s
      timeout: 5s
      retries: 5
    networks: [smartface]

  # Tạo bucket rồi thoát.
  minio-init:
    image: minio/mc:latest
    depends_on:
      minio:
        condition: service_healthy
    entrypoint: >
      /bin/sh -c "
      until mc alias set local http://minio:9000 ${MINIO_ROOT_USER} ${MINIO_ROOT_PASSWORD}; do sleep 2; done;
      mc mb --ignore-existing local/smartface;
      echo 'Bucket smartface san sang';
      "
    networks: [smartface]

  # --------------------------------------------------------------------------
  #  Migration — chạy một lần rồi thoát, TRƯỚC khi rollout api/worker
  # --------------------------------------------------------------------------
  #
  # `target: builder` chứ không phải image runtime: stage `runner` cài bằng
  # `npm ci --omit=dev` nên KHÔNG có prisma CLI và ts-node. Stage `builder` có
  # đủ devDependencies + mã nguồn, nên `prisma migrate deploy`, `db:guards` và
  # `seed` đều chạy được ở đây.
  migrate:
    build:
      context: ./server-backend-smart
      target: builder
    restart: 'no'
    env_file: ./server-backend-smart/.env
    command: sh -c "npx prisma migrate deploy"
    networks: [smartface]

  # --------------------------------------------------------------------------
  #  Backend
  # --------------------------------------------------------------------------
  api:
    build:
      context: ./server-backend-smart
    restart: unless-stopped
    env_file: ./server-backend-smart/.env
    environment:
      # Pod API không xử lý job nền — docs/02 mục 12.2.
      WORKER_ENABLED: 'false'
    depends_on:
      redis:
        condition: service_healthy
      minio:
        condition: service_healthy
      migrate:
        condition: service_completed_successfully
    command: ['node', 'dist/main']
    networks: [smartface]

  worker:
    build:
      context: ./server-backend-smart
    restart: unless-stopped
    env_file: ./server-backend-smart/.env
    environment:
      WORKER_ENABLED: 'true'
    depends_on:
      redis:
        condition: service_healthy
      migrate:
        condition: service_completed_successfully
    command: ['node', 'dist/worker']
    # Worker không có HTTP server nên healthcheck của image (curl /health) luôn
    # fail. Tắt đi để `docker compose ps` không báo unhealthy giả.
    healthcheck:
      disable: true
    networks: [smartface]

  # --------------------------------------------------------------------------
  #  AI Server — KHÔNG publish cổng (docs/02 mục 6.2)
  # --------------------------------------------------------------------------
  ai-server:
    build:
      context: ./server-ai-smart
      args:
        RUNTIME: cpu
    restart: unless-stopped
    env_file: ./server-ai-smart/.env
    volumes:
      # Model nằm ngoài image để nâng cấp không phải build lại.
      - ./server-ai-smart/models:/app/models
    # Nạp model tốn vài trăm MB. Trần này để một rò rỉ bộ nhớ không kéo sập
    # cả VPS đang chạy Backend cùng chỗ.
    mem_limit: 4g
    networks: [smartface]

  # --------------------------------------------------------------------------
  #  Frontend + reverse proxy
  # --------------------------------------------------------------------------
  web:
    build:
      context: ./web-smart
      dockerfile: Dockerfile.prod
      args:
        # ⚠ Biến VITE_* được NHÚNG vào bundle lúc build, không đọc lúc chạy.
        # Đổi giá trị ở đây bắt buộc phải `docker compose build web` lại.
        VITE_API_BASE_URL: /v1
        VITE_FIREBASE_API_KEY: ${VITE_FIREBASE_API_KEY}
        VITE_FIREBASE_AUTH_DOMAIN: ${VITE_FIREBASE_AUTH_DOMAIN}
        VITE_FIREBASE_PROJECT_ID: ${VITE_FIREBASE_PROJECT_ID}
        VITE_FIREBASE_APP_ID: ${VITE_FIREBASE_APP_ID}
        VITE_DEFAULT_TIMEZONE: Asia/Ho_Chi_Minh
        VITE_GOOGLE_MAPS_API_KEY: ${VITE_GOOGLE_MAPS_API_KEY}
        VITE_WS_URL: ${VITE_WS_URL}
    restart: unless-stopped
    depends_on:
      - api
    ports:
      - '80:80'
      # Bỏ comment khi dùng Cloudflare Full (strict) — xem §6.2
      # - '443:443'
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
      # - ./secrets/cloudflare-origin.pem:/etc/nginx/certs/origin.pem:ro
      # - ./secrets/cloudflare-origin.key:/etc/nginx/certs/origin.key:ro
    networks: [smartface]

volumes:
  redis-data:
  minio-data:

networks:
  smartface:
    driver: bridge
```

### 3.2 `/opt/smartface/.env` — biến cho chính file compose

Compose đọc file `.env` **cùng thư mục** để thay `${...}`. File này khác với `.env` của từng service.

```dotenv
# Hạ tầng
REDIS_PASSWORD=<openssl rand -hex 24>
MINIO_ROOT_USER=smartface
MINIO_ROOT_PASSWORD=<openssl rand -hex 24>

# Frontend — nhúng vào bundle lúc build
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=smartface-xxxx.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=smartface-xxxx
VITE_FIREBASE_APP_ID=
VITE_GOOGLE_MAPS_API_KEY=
VITE_WS_URL=wss://<domain-cua-ban>
```

```bash
chmod 600 /opt/smartface/.env
```

### 3.3 `/opt/smartface/web-smart/Dockerfile.prod`

`web-smart` chưa có Dockerfile. Tạo file này (đặt tên `Dockerfile.prod` để không đụng nếu sau này repo thêm `Dockerfile` cho mục đích khác):

```dockerfile
# ============================================================================
#  Web Quản lý — build tĩnh rồi cho nginx phục vụ.
#
#  Vite nhúng biến VITE_* vào bundle LÚC BUILD (không đọc lúc chạy), nên mỗi
#  môi trường phải build riêng. Đó là lý do dùng ARG chứ không phải ENV.
# ============================================================================

FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ARG VITE_API_BASE_URL=/v1
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_APP_ID
ARG VITE_DEFAULT_TIMEZONE=Asia/Ho_Chi_Minh
ARG VITE_GOOGLE_MAPS_API_KEY
ARG VITE_WS_URL

# Vite chỉ đọc biến từ process.env khi chúng được export.
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY \
    VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN \
    VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID \
    VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID \
    VITE_DEFAULT_TIMEZONE=$VITE_DEFAULT_TIMEZONE \
    VITE_GOOGLE_MAPS_API_KEY=$VITE_GOOGLE_MAPS_API_KEY \
    VITE_WS_URL=$VITE_WS_URL

# `npm run build` = tsc -b && vite build → dist/
RUN npm run build

FROM nginx:alpine AS runner
COPY --from=builder /app/dist /usr/share/nginx/html
# nginx.conf được mount từ ngoài vào /etc/nginx/conf.d/default.conf
EXPOSE 80
```

### 3.4 `/opt/smartface/nginx.conf`

```nginx
# ============================================================================
#  SmartFace — nginx trước SPA + Backend.
#
#  SPA và API PHẢI cùng origin: web-smart gọi API bằng VITE_API_BASE_URL=/v1
#  (đường dẫn tương đối). Tách hai origin thì trình duyệt sẽ đòi CORS và cookie
#  refresh token không gửi kèm được.
# ============================================================================

upstream smartface_api {
    server api:3000;
    keepalive 32;
}

server {
    listen 80;
    server_name _;

    # Ảnh chấm công đi qua đây. Backend giới hạn JSON 10mb (src/main.ts), để
    # nginx rộng hơn một chút để lỗi hiện ra ở tầng ứng dụng kèm mã lỗi rõ ràng,
    # thay vì 413 trống trơn của nginx.
    client_max_body_size 12m;

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;

    # Ẩn phiên bản nginx.
    server_tokens off;

    # ------------------------------------------------------------------------
    #  API
    # ------------------------------------------------------------------------
    location /v1/ {
        proxy_pass         http://smartface_api;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        # Nối IP client vào chuỗi. Backend đọc chuỗi này với trust proxy = 2.
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_set_header   Connection        "";

        # Nhận diện khuôn mặt có thể mất vài giây (NFR-PERF-01 đặt trần 2s,
        # nhưng lượt đầu sau khi AI Server khởi động phải nạp model).
        proxy_connect_timeout 10s;
        proxy_send_timeout    60s;
        proxy_read_timeout    60s;
    }

    # `/health` và `/metrics` nằm NGOÀI prefix v1 (setGlobalPrefix có exclude).
    location = /health {
        proxy_pass       http://smartface_api;
        access_log       off;
        proxy_set_header Host $host;
    }

    # `/metrics` chỉ cho mạng nội bộ.
    location = /metrics {
        allow 127.0.0.1;
        allow 172.16.0.0/12;
        deny  all;
        proxy_pass       http://smartface_api;
        proxy_set_header Host $host;
    }

    # ------------------------------------------------------------------------
    #  WebSocket (Socket.IO) — thông báo realtime đơn cần duyệt
    # ------------------------------------------------------------------------
    location /socket.io/ {
        proxy_pass         http://smartface_api;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host       $host;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        # Kết nối realtime nhàn rỗi lâu — timeout ngắn sẽ ngắt liên tục.
        proxy_read_timeout 3600s;
    }

    # ------------------------------------------------------------------------
    #  SPA tĩnh
    # ------------------------------------------------------------------------
    root  /usr/share/nginx/html;
    index index.html;

    # File có hash trong tên → cache vĩnh viễn.
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # `try_files ... /index.html` là bắt buộc với SPA: React Router xử lý
    # đường dẫn ở phía trình duyệt, nginx không có file `/attendance` nên nếu
    # thiếu dòng này, người dùng bấm F5 ở route con sẽ nhận 404.
    location / {
        try_files $uri $uri/ /index.html;
        # index.html KHÔNG được cache, nếu không người dùng vẫn chạy bản cũ
        # sau khi deploy vì nó trỏ tới file assets đã bị xoá.
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }
}
```

---

## 4. Biến môi trường production

Tạo `server-backend-smart/.env` từ `.env.example` (7 KB, có chú thích đầy đủ từng biến):

```bash
cd /opt/smartface
cp server-backend-smart/.env.example server-backend-smart/.env
cp server-ai-smart/.env.example      server-ai-smart/.env
chmod 600 server-backend-smart/.env server-ai-smart/.env
```

### 4.1 Sáu chốt sẽ giết tiến trình lúc khởi động

`src/config/env.validation.ts` kiểm tra khi `NODE_ENV=production` và **ném lỗi cho container chết ngay**, thay vì cảnh báo rồi chạy tiếp. Đây là chủ ý: cảnh báo lúc khởi động trôi qua trong hàng nghìn dòng log và không ai đọc.

| # | Chốt | Điều kiện chết | Sửa |
|---|---|---|---|
| 1 | Biến bắt buộc | Thiếu bất kỳ biến nào trong danh sách §4.2 | Điền đủ |
| 2 | `NFR-SEC-03` | `JWT_ALGORITHM=HS256` hoặc thiếu cặp khoá | `RS256` + khoá ở [§2.1](#21-cặp-khoá-jwt-rs256--bắt-buộc) |
| 3 | OTP | `OTP_DEBUG_RETURN=true` | Đặt `false` |
| 4 | Redis | `REDIS_ENABLED=false` | Đặt `true` |
| 5 | `AF-02b` | `TRUSTED_PROXY_HOPS` trống, hoặc không phải số nguyên 0–5 | Đặt `2` |
| 6 | `AF-12` | `ATTENDANCE_SIGNATURE_REQUIRED` ≠ `true` | Đặt `true` |

> ⚠ File `.env` trên máy lập trình viên có `REDIS_ENABLED=false` và `TRUSTED_PROXY_HOPS=0`. **Copy nguyên file đó lên VPS là container `api` sẽ restart vô hạn.** Luôn bắt đầu từ `.env.example`.

### 4.2 Backend — `server-backend-smart/.env`

**Bắt buộc phải có, thiếu là không khởi động:**

| Biến | Giá trị | Vì sao |
|---|---|---|
| `DATABASE_URL` | `postgresql://user:pass@host:5432/smartface?schema=public&sslmode=require` | Postgres ngoài VPS. ⚠ Đi qua internet thì `sslmode=require` là bắt buộc |
| `REDIS_HOST` | `redis` | Tên service trong compose |
| `AI_SERVER_URL` | `http://ai-server:8000` | Trong docker network, không qua nginx |
| `AI_SERVER_INTERNAL_KEY` | Chuỗi ≥32 ký tự từ [§2.2](#22-khoá-nội-bộ-ai-server) | Phải trùng `server-ai-smart/.env` |
| `S3_BUCKET` | `smartface` | `minio-init` đã tạo sẵn |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | = `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | |
| `FIREBASE_PROJECT_ID` | Từ service account JSON | Thiếu là không ai đăng nhập được |
| `FIREBASE_CLIENT_EMAIL` | Từ service account JSON | |
| `FIREBASE_PRIVATE_KEY` | Một dòng, xuống dòng là `\n` | [§2.4](#24-khoá-firebase-backend) |

**Bắt buộc đúng giá trị, sai là hỏng nghiệp vụ:**

| Biến | Giá trị | Vì sao |
|---|---|---|
| `NODE_ENV` | `production` | Bật toàn bộ 6 chốt trên. Để `development` là chạy được nhưng mất hết lớp bảo vệ |
| `TRUSTED_PROXY_HOPS` | **`2`** | Xem mục dưới |
| `REDIS_ENABLED` | `true` | `false` thay Redis bằng `Map` trong tiến trình: rate limit `AF-13` đếm riêng từng tiến trình, nonce chống replay `AF-12` không dùng chung, và **mọi job nền bị vứt bỏ chứ không xếp hàng** — không tính lương, không gửi OTP |
| `JWT_ALGORITHM` | `RS256` | |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` | Từ [§2.1](#21-cặp-khoá-jwt-rs256--bắt-buộc) | |
| `ATTENDANCE_SIGNATURE_REQUIRED` | `true` | `AF-12` — chữ ký HMAC là lớp **duy nhất** chặn được kẻ đã đánh cắp access token |
| `OTP_DEBUG_RETURN` | `false` | Bật là trả mã OTP thẳng trong response API |
| `CORS_ORIGINS` | `https://<domain-cua-ban>` | Bỏ trống → code rơi về `origin: true`, tức **cho phép mọi origin** |
| `SWAGGER_ENABLED` | `false` | Không công khai danh mục ~100 endpoint |
| `SMS_PROVIDER` | Nhà cung cấp thật | `console` chỉ in OTP ra log server, người dùng không nhận được gì |
| `WORKER_ENABLED` | Do compose đặt | `false` cho `api`, `true` cho `worker` |
| `PORT` | `3000` | Khớp `EXPOSE` và `nginx.conf` |
| `API_PREFIX` | `v1` | Khớp `VITE_API_BASE_URL=/v1` và `location /v1/` |

**Không được có mặt:** `FIREBASE_AUTH_EMULATOR_HOST`. Emulator không kiểm chữ ký ID token — ai cũng tự tạo được token hợp lệ. Có biến này là container chết ngay.

<a id="trusted_proxy_hops--con-số-dễ-sai-nhất"></a>

#### `TRUSTED_PROXY_HOPS` — con số dễ sai nhất

Nó quyết định `request.ip` là địa chỉ nào, và chốt "chỉ chấm công từ mạng văn phòng" (`AF-02b`) phụ thuộc hoàn toàn vào nó. Sai theo **cả hai hướng** đều hỏng:

| Giá trị | Hậu quả |
|---|---|
| Quá **thấp** (`0`, `1`) | `request.ip` là IP của Cloudflare/nginx → danh sách IP văn phòng không bao giờ khớp → **cả công ty không chấm công được** |
| Quá **cao** (`3`+) hoặc `true` | Nhân viên tự khai `X-Forwarded-For: <IP văn phòng>` là qua → chốt IP mất tác dụng mà **log vẫn hiện đúng IP văn phòng**, tạo cảm giác an toàn giả |

Đếm số proxy đứng **trước** Backend theo đúng kiến trúc của bạn:

| Kiến trúc | Giá trị |
|---|---|
| Cloudflare (mây cam) → nginx → api | **`2`** ← kịch bản của tài liệu này |
| nginx → api, không có Cloudflare | `1` |
| Cloudflare (mây xám / DNS only) → nginx → api | `1` |
| Chạy thẳng api ra internet | `0` |

Kiểm chứng sau khi deploy: mở `https://<domain>/v1/...` từ máy có IP đã biết, rồi soi log `api` xem IP ghi nhận có đúng là IP máy bạn không.

<a id="minio-và-bẫy-presigned-url"></a>

#### MinIO và bẫy presigned URL

`StorageService.getPresignedUrl()` sinh URL dựa trên `S3_ENDPOINT`. Nếu để `S3_ENDPOINT=http://minio:9000`, URL trả về cho trình duyệt/App sẽ là `http://minio:9000/...` — **hostname chỉ tồn tại trong docker network**, client không mở được, ảnh chấm công hiện lỗi.

Chọn một trong hai:

**A. Dùng subdomain riêng cho storage** (khuyến nghị) — thêm record `storage.<domain>` trỏ về VPS, thêm một `server` block trong nginx proxy sang `minio:9000` (giữ nguyên header `Host`, vì chữ ký presign có ký cả `Host`), rồi đặt:

```dotenv
S3_ENDPOINT=https://storage.<domain-cua-ban>
S3_FORCE_PATH_STYLE=true
S3_REGION=ap-southeast-1
S3_PRESIGN_TTL_SECONDS=300
```

**B. Dùng dịch vụ S3 thật** (Cloudflare R2 / AWS S3) thay MinIO — bỏ service `minio` và `minio-init` khỏi compose, điền `S3_ENDPOINT` của nhà cung cấp. Xem `server-backend-smart/docs/r2-lifecycle.md` cho quy tắc vòng đời từng prefix (`attendance/` giữ tối đa 400 ngày, `exports/` 30 ngày).

### 4.3 AI Server — `server-ai-smart/.env`

| Biến | Giá trị production | Vì sao |
|---|---|---|
| `ENV` | `production` | |
| `AI_SERVER_INTERNAL_KEY` | **Trùng** backend | Lệch là mọi lượt chấm công lỗi |
| `ENGINE` | `insightface` | ⚠ `stub` trả **dữ liệu bịa** — xem [§10](#10-những-thứ-chưa-xong-trước-khi-chạy-thật) |
| `MODEL_PACK` | `buffalo_l` | |
| `MODEL_ROOT` | `/app/models` | Khớp volume mount |
| `PROVIDERS` | `CPUExecutionProvider` | VPS không GPU |
| `LIVENESS_MODEL_PATH` | `/app/models/anti_spoof/MiniFASNetV2.onnx` | |
| `ALLOW_MISSING_LIVENESS_MODEL` | `false` | Bật = ảnh in ra giấy cũng chấm công được |
| `MAX_CONCURRENCY` | `4` | Tăng cái này để tăng thông lượng, **không** tăng `--workers` (mỗi worker nạp một bản model riêng vào RAM) |
| `WARMUP_ON_STARTUP` | `true` | Lượt chấm công đầu tiên không phải chờ nạp model |

### 4.4 Frontend — truyền qua build arg, không qua `.env`

`web-smart` là SPA tĩnh: Vite **nhúng** giá trị `VITE_*` vào file JS lúc build. Vì vậy chúng nằm ở `args:` của service `web` trong compose (đọc từ `/opt/smartface/.env`), không phải file `web-smart/.env`.

| Biến | Giá trị | Vì sao |
|---|---|---|
| `VITE_API_BASE_URL` | `/v1` | Đường dẫn tương đối → cùng origin với SPA, không dính CORS, cookie hoạt động đúng |
| `VITE_FIREBASE_PROJECT_ID` | **Trùng** `FIREBASE_PROJECT_ID` backend | |
| `VITE_WS_URL` | `wss://<domain>` | Bỏ trống → dùng polling thay vì realtime |
| `VITE_DEFAULT_TIMEZONE` | `Asia/Ho_Chi_Minh` | |

`VITE_API_PROXY_TARGET` **chỉ dùng lúc dev** (Vite dev server proxy) — trên production nginx làm việc đó, không cần khai.

> Hệ quả cần nhớ: **đổi bất kỳ biến `VITE_*` nào cũng phải `docker compose build web` lại.** Restart container không có tác dụng.

---

## 5. Trình tự deploy lần đầu

```bash
sudo -iu deploy
cd /opt/smartface
```

### Bước 1 — Kiểm tra cú pháp compose trước khi build

```bash
docker compose -f docker-compose.prod.yml config > /dev/null && echo "Cú pháp OK"
```

### Bước 2 — Build toàn bộ image

Lần đầu mất 5–15 phút (npm ci cho backend + frontend, pip install cho AI Server).

```bash
docker compose -f docker-compose.prod.yml build
```

### Bước 3 — Dựng hạ tầng trước

```bash
docker compose -f docker-compose.prod.yml up -d redis minio minio-init

# Chờ tới khi cả hai `healthy`
watch -n 2 docker compose -f docker-compose.prod.yml ps
```

### Bước 4 — Chạy migration (tách riêng, trước rollout)

```bash
docker compose -f docker-compose.prod.yml run --rm migrate
```

Bước này phải in ra danh sách migration đã áp và kết thúc với exit code 0. Lỗi ở đây gần như luôn là `DATABASE_URL` sai hoặc firewall Postgres chưa mở — quay lại [§1.5](#15-cho-phép-postgres-bên-ngoài-nhận-kết-nối-từ-vps).

### Bước 5 — Áp ràng buộc DB không nằm trong migration

`prisma migrate deploy` chỉ áp schema. Các trigger bất biến (`BR-06`), chính sách RLS và ràng buộc auth nằm trong SQL riêng:

```bash
docker compose -f docker-compose.prod.yml run --rm migrate npm run db:guards
```

> Lệnh này chạy `prisma/sql/01_immutability_and_rls.sql` và `02_auth_constraints.sql`. Lưu ý `prisma/sql/02_partitioning.sql` **không** nằm trong script này — xem [§10](#10-những-thứ-chưa-xong-trước-khi-chạy-thật).

### Bước 6 — Seed dữ liệu nền (chỉ lần đầu, trên DB trống)

```bash
docker compose -f docker-compose.prod.yml run --rm migrate npm run seed
```

Tài khoản seed và mật khẩu: [17-tai-khoan-test.md](./17-tai-khoan-test.md). **Đổi mật khẩu ngay sau khi đăng nhập lần đầu.**

> Vì sao chạy trên service `migrate` chứ không phải `api`: `seed` dùng `ts-node`, mà image runtime của `api` cài bằng `npm ci --omit=dev` nên không có `ts-node`. Service `migrate` build từ stage `builder` — có đủ devDependencies.

### Bước 7 — Bật toàn bộ ứng dụng

```bash
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
```

### Bước 8 — Kiểm chứng

```bash
# 1. Backend sống
curl -i http://localhost/health

# 2. SPA trả về HTML
curl -s http://localhost/ | head -5

# 3. SPA fallback hoạt động (route con phải trả 200, không phải 404)
curl -o /dev/null -w "%{http_code}\n" http://localhost/attendance

# 4. API đi qua nginx
curl -i http://localhost/v1/meta/error-codes

# 5. AI Server KHÔNG lộ ra ngoài — phải fail
curl -m 3 http://<IP-public-VPS>:8000/health ; echo "exit=$?"

# 6. Worker đã đăng ký lịch job
docker compose -f docker-compose.prod.yml logs worker | grep -i "job định kỳ"

# 7. Không container nào đang restart
docker compose -f docker-compose.prod.yml ps --format "table {{.Service}}\t{{.Status}}"
```

Mục 5 phải **thất bại** (timeout hoặc connection refused). Nếu nó trả về JSON thì AI Server đang lộ ra internet — kiểm tra lại là service `ai-server` không có mục `ports:`.

---

## 6. Cloudflare + HTTPS

### 6.1 DNS

Cloudflare Dashboard → **DNS** → thêm:

| Type | Name | Content | Proxy |
|---|---|---|---|
| A | `@` hoặc `app` | IP public của VPS | 🟠 Proxied |
| A | `storage` | IP public của VPS | 🟠 Proxied |

Bật proxy (mây cam) là điều kiện để có `TRUSTED_PROXY_HOPS=2`. Nếu bạn để mây xám (DNS only), phải đổi thành `1`.

### 6.2 Chế độ TLS

Cloudflare → **SSL/TLS** → **Overview**:

| Chế độ | Chặng CF → VPS | Đánh giá |
|---|---|---|
| **Flexible** | ❌ HTTP thuần | Nhanh nhất để lên sóng, nhưng dữ liệu chấm công đi không mã hoá giữa Cloudflare và VPS. Chỉ dùng tạm |
| **Full (strict)** + Origin Certificate | ✅ HTTPS | **Khuyến nghị.** Cấu hình dưới đây |

Cách bật Full (strict):

1. Cloudflare → **SSL/TLS** → **Origin Server** → **Create Certificate** (mặc định 15 năm).
2. Lưu hai phần vào VPS:
   ```bash
   nano /opt/smartface/secrets/cloudflare-origin.pem   # dán phần Certificate
   nano /opt/smartface/secrets/cloudflare-origin.key   # dán phần Private Key
   chmod 600 /opt/smartface/secrets/cloudflare-origin.key
   ```
3. Bỏ comment 3 dòng đã đánh dấu trong service `web` của compose (cổng `443` và hai volume cert).
4. Thêm `server` block sau vào cuối `nginx.conf`, và đổi block cổng 80 hiện có thành chuyển hướng:

   ```nginx
   server {
       listen 443 ssl;
       http2 on;
       server_name <domain-cua-ban>;

       ssl_certificate     /etc/nginx/certs/origin.pem;
       ssl_certificate_key /etc/nginx/certs/origin.key;
       ssl_protocols       TLSv1.2 TLSv1.3;

       # ... chép nguyên toàn bộ phần location của block cổng 80 vào đây ...
   }
   ```
5. Cloudflare → **SSL/TLS** → chọn **Full (strict)**, và bật **Always Use HTTPS**.
6. `docker compose -f docker-compose.prod.yml up -d --force-recreate web`

### 6.3 Ba thiết lập Cloudflare dễ quên

| Thiết lập | Vị trí | Vì sao |
|---|---|---|
| **WebSockets: On** | Network | Tắt là thông báo realtime (đơn mới cần duyệt) không hoạt động, FE âm thầm rơi về polling |
| **Giới hạn upload 100 MB** | Mặc định gói Free | Ảnh chấm công nhỏ hơn nhiều nên không ảnh hưởng, nhưng file export lớn thì có |
| **Đừng cache `/v1/*`** | Rules → Cache Rules | Cloudflare mặc định không cache response có `Cache-Control` phù hợp, nhưng nếu bạn bật "Cache Everything" thì phải loại trừ `/v1/*`, không thì người dùng nhận dữ liệu của nhau |

Sau khi bật HTTPS, cập nhật lại và **build lại frontend**:

```dotenv
# /opt/smartface/.env
VITE_WS_URL=wss://<domain-cua-ban>

# server-backend-smart/.env
CORS_ORIGINS=https://<domain-cua-ban>
```

```bash
docker compose -f docker-compose.prod.yml build web
docker compose -f docker-compose.prod.yml up -d web api
```

---

## 7. Cập nhật code (deploy lần thứ N)

```bash
cd /opt/smartface

# 1. Ghi lại phiên bản đang chạy để rollback được
git rev-parse HEAD > /opt/smartface/.last-deployed

# 2. Lấy code mới
git pull origin main

# 3. Build image mới (container cũ vẫn đang phục vụ)
docker compose -f docker-compose.prod.yml build

# 4. Migration TRƯỚC khi rollout — docs/02 mục 12.3
docker compose -f docker-compose.prod.yml run --rm migrate

# 5. Nếu migration mới có kèm thay đổi trigger/RLS
docker compose -f docker-compose.prod.yml run --rm migrate npm run db:guards

# 6. Thay container
docker compose -f docker-compose.prod.yml up -d

# 7. Kiểm tra
curl -i http://localhost/health
docker compose -f docker-compose.prod.yml ps
```

**Vì sao migration luôn chạy trước rollout:** nếu code mới đọc một cột chưa tồn tại, container mới sẽ lỗi hàng loạt trong khoảng thời gian giữa hai bước. Ngược lại, migration chạy trước thì code cũ vẫn chạy bình thường trên schema mới (miễn là migration chỉ thêm chứ không xoá — quy tắc "expand rồi mới contract").

### Rollback

```bash
git checkout $(cat /opt/smartface/.last-deployed)
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

> ⚠ Rollback code **không** tự rollback migration. Nếu bản mới có migration phá vỡ tương thích ngược, phải viết migration hoàn tác thủ công. Đây là lý do nên dùng migration kiểu "chỉ thêm".

---

## 8. Vận hành hằng ngày

### 8.1 Xem log

```bash
cd /opt/smartface
alias dc="docker compose -f docker-compose.prod.yml"

dc logs -f api --tail=200
dc logs -f worker --tail=200
dc logs -f ai-server --tail=100

# Chỉ lọc lỗi
dc logs api --since 1h | grep -i '"level":50\|error'
```

Giới hạn dung lượng log (mặc định Docker để log phình vô hạn) — thêm vào `/etc/docker/daemon.json` rồi `sudo systemctl restart docker`:

```json
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "50m", "max-file": "5" }
}
```

### 8.2 Theo dõi job nền — phần dễ bị bỏ sót nhất

Toàn bộ lịch chạy nền nằm trong container `worker`, đăng ký bằng repeatable job của BullMQ:

| Lịch | Job |
|---|---|
| `0 2 * * *` | Tính lại bảng công hằng đêm |
| `*/15 * * * *` | Quét gian lận |
| `30 3` / `45 3` | Quét gian lận theo ngày |
| `0 4 * * *` | Batch AI |
| `0 5` / `15 5` / `30 5` | Dọn dữ liệu hết hạn lưu trữ |

> ⚠ **Worker chết là một lỗi im lặng.** API vẫn phục vụ chấm công bình thường, không có mã lỗi nào, không ai báo — chỉ tới cuối tháng mới phát hiện bảng công chưa được tính lại. Đặt cảnh báo riêng cho container này.
>
> Ngoài ra, `SchedulerService` **nuốt lỗi** nếu Redis chưa sẵn sàng lúc worker khởi động, và **không tự đăng ký lại**. Thấy dòng log `Không đăng ký được job định kỳ` thì phải `dc restart worker` sau khi Redis hồi phục.

Kiểm tra nhanh:

```bash
dc logs worker | grep "Đã đăng ký các job định kỳ"
dc exec redis redis-cli -a "$REDIS_PASSWORD" --no-auth-warning KEYS 'bull:*:repeat:*'
```

### 8.3 Backup

**PostgreSQL** (nằm ngoài VPS — backup ở phía đó, hoặc chạy từ VPS):

```bash
docker run --rm postgres:16-alpine \
  pg_dump "$DATABASE_URL" -Fc \
  > /opt/smartface/backups/db-$(date +%F).dump
```

**MinIO và Redis** (volume trên VPS):

```bash
mkdir -p /opt/smartface/backups

docker run --rm -v smartface_minio-data:/data -v /opt/smartface/backups:/backup \
  alpine tar czf /backup/minio-$(date +%F).tar.gz -C /data .

docker run --rm -v smartface_redis-data:/data -v /opt/smartface/backups:/backup \
  alpine tar czf /backup/redis-$(date +%F).tar.gz -C /data .
```

Đặt vào cron của user `deploy` (`crontab -e`):

```cron
0 3 * * * cd /opt/smartface && ./backup.sh >> /var/log/smartface-backup.log 2>&1
```

> Redis chứa nonce chống replay và hàng đợi job. Mất Redis không mất dữ liệu nghiệp vụ (dữ liệu thật nằm ở Postgres và S3), nhưng các job đang xếp hàng sẽ mất. MinIO thì **mất là mất hẳn ảnh chấm công** — ưu tiên backup mục này.

### 8.4 Dọn đĩa

Mỗi lần build để lại image cũ. Sau vài chục lần deploy sẽ đầy đĩa:

```bash
docker system df           # xem đang chiếm bao nhiêu
docker image prune -a -f   # xoá image không container nào dùng
docker builder prune -f    # xoá cache build
```

> ⚠ **Đừng chạy `docker system prune --volumes`.** Cờ `--volumes` xoá mọi volume không đang gắn vào container nào. Đang chạy bình thường thì `minio-data` an toàn, nhưng chỉ cần bạn vừa `docker compose down` để bảo trì là nó xoá sạch **toàn bộ ảnh chấm công**. Dùng `docker image prune -a` và `docker builder prune` như trên là đủ để giải phóng đĩa.

---

## 9. Bảng lỗi thường gặp

| Triệu chứng | Nguyên nhân thật | Cách sửa |
|---|---|---|
| `api` restart liên tục, log `Thiếu biến môi trường bắt buộc: ...` | Danh sách `REQUIRED_IN_PRODUCTION` trong `env.validation.ts` | Điền đủ theo [§4.2](#42-backend--server-backend-smartenv) |
| Log `REDIS_ENABLED=false chỉ dùng được ở môi trường phát triển` | Copy nguyên `.env` từ máy dev | `REDIS_ENABLED=true`, `REDIS_HOST=redis`, `REDIS_PASSWORD=...` |
| Log `AF-02b: TRUSTED_PROXY_HOPS bắt buộc phải khai` | Chưa khai | `TRUSTED_PROXY_HOPS=2` |
| Log `NFR-SEC-03: production phải dùng RS256/ES256` | Còn dùng `JWT_SECRET` / `JWT_ALGORITHM=HS256` | Sinh cặp khoá [§2.1](#21-cặp-khoá-jwt-rs256--bắt-buộc) |
| Log `FIREBASE_AUTH_EMULATOR_HOST không được đặt ở production` | Biến còn sót từ `.env` dev | Xoá dòng đó |
| Log `AF-12: ATTENDANCE_SIGNATURE_REQUIRED phải BẬT` | Đang `false` | Đặt `true`. ⚠ App phải đã triển khai ký HMAC, nếu chưa thì App sẽ chấm công lỗi |
| `migrate` treo rồi timeout | Postgres ngoài chưa mở firewall cho IP VPS | [§1.5](#15-cho-phép-postgres-bên-ngoài-nhận-kết-nối-từ-vps) |
| **Bấm F5 ở `/attendance` trả 404** | nginx thiếu `try_files $uri $uri/ /index.html` | [§3.4](#34-optsmartfacenginxconf) |
| FE gọi API trả 404, hoặc lỗi CORS | `VITE_API_BASE_URL` không phải `/v1`, hoặc nginx thiếu `location /v1/` | Build lại `web` sau khi sửa |
| Đăng nhập đúng mật khẩu vẫn báo token không hợp lệ | FE và BE khác Firebase project | `VITE_FIREBASE_PROJECT_ID` phải trùng `FIREBASE_PROJECT_ID` |
| Đăng nhập báo `auth/unauthorized-domain` | Domain production chưa nằm trong Authorized domains | Firebase Console → Authentication → Settings |
| **Toàn bộ nhân viên báo "ngoài mạng văn phòng"** | `TRUSTED_PROXY_HOPS` quá thấp → `request.ip` là IP Cloudflare | Đặt `2` |
| Chốt IP có vẻ hoạt động nhưng ai ở đâu cũng chấm công được | `TRUSTED_PROXY_HOPS` quá cao → client tự giả `X-Forwarded-For` | Đặt `2` |
| **Ảnh chấm công không hiển thị, URL trỏ `minio:9000`** | `S3_ENDPOINT` là hostname nội bộ, presigned URL sinh theo nó | [§4.2 — bẫy presigned URL](#minio-và-bẫy-presigned-url) |
| Upload ảnh trả `413 Request Entity Too Large` | `client_max_body_size` của nginx | Đã đặt `12m`; nếu vẫn lỗi thì kiểm tra giới hạn của Cloudflare |
| Chấm công trả lỗi gọi AI | `AI_SERVER_INTERNAL_KEY` lệch giữa backend và ai-server | Đặt lại cùng giá trị, restart cả hai |
| `ai-server` bị OOM / restart lặp | Vượt `mem_limit: 4g`, hoặc thiếu file model trong `./server-ai-smart/models` | Nâng `mem_limit`, hoặc tải model — [§10](#10-những-thứ-chưa-xong-trước-khi-chạy-thật) |
| Nhận diện luôn khớp / luôn không khớp một cách vô lý | `ENGINE=stub` — engine trả **dữ liệu bịa** | [§10](#10-những-thứ-chưa-xong-trước-khi-chạy-thật) |
| Không nhận được SMS OTP | `SMS_PROVIDER=console` — OTP chỉ in ra log server | Cấu hình nhà cung cấp thật |
| Bảng công không được tính lại vào ban đêm | Container `worker` chết, hoặc lịch chưa đăng ký được do Redis | [§8.2](#82-theo-dõi-job-nền--phần-dễ-bị-bỏ-sót-nhất) |
| Thông báo realtime không tới | Cloudflare chưa bật WebSockets, hoặc nginx thiếu `location /socket.io/`, hoặc `VITE_WS_URL` trống | [§6.3](#63-ba-thiết-lập-cloudflare-dễ-quên) |
| Deploy xong người dùng vẫn thấy giao diện cũ | `index.html` bị cache | `nginx.conf` đã đặt `no-cache` cho `/`; xoá cache Cloudflare (Purge Everything) |
| `docker compose run --rm api npm run seed` báo `ts-node: not found` | Image `api` cài `--omit=dev`, không có `ts-node` | Chạy trên service `migrate` (stage `builder`) |
| Ổ đĩa đầy sau vài lần deploy | Image cũ và cache build | [§8.4](#84-dọn-đĩa) |

---

## 10. Những thứ chưa xong trước khi chạy thật

Các mục dưới đây **không phải lỗi deploy** — chúng là hạn chế đã biết của mã nguồn hiện tại, được ghi trong `server-backend-smart/README.md` mục 8 và `server-ai-smart/README.md` mục 8. Deploy theo tài liệu này sẽ chạy được, nhưng chưa dùng cho khách hàng thật được cho tới khi xử lý xong.

| # | Vấn đề | Vì sao nghiêm trọng | Việc phải làm |
|---|---|---|---|
| 1 | **AI Server đang `ENGINE=stub`** | Nhận diện khuôn mặt trả **dữ liệu bịa**. Hệ thống chạy trơn tru mà kết quả hoàn toàn vô nghĩa | Chạy `python scripts/download_models.py` để lấy `buffalo_l`, và `python scripts/convert_anti_spoof.py` cho model chống giả mạo. Đặt `ENGINE=insightface`, `ALLOW_MISSING_LIVENESS_MODEL=false` |
| 2 | **Ngưỡng FAR/FRR chưa hiệu chỉnh** | Ngưỡng khớp mặt đang là giá trị mặc định, chưa đo trên dữ liệu thật của khách hàng | Thu thập tập ảnh mẫu, đo và chốt `face_match_threshold` / `liveness_threshold` theo từng công ty |
| 3 | **Row-Level Security chưa bật** | Cách ly dữ liệu giữa các công ty hiện chỉ dựa vào điều kiện `companyId` ở tầng ứng dụng (`BR-09`). Sót một query là rò rỉ dữ liệu chéo khách hàng | Bật RLS trong `prisma/sql/01_immutability_and_rls.sql` và kiểm thử |
| 4 | **`prisma/sql/02_partitioning.sql` chưa được áp** | `db:guards` **không** chạy file này. Bảng `attendance_log` không phân vùng sẽ chậm dần theo thời gian | Áp thủ công trước khi dữ liệu lớn: `docker compose -f docker-compose.prod.yml run --rm migrate npx prisma db execute --schema prisma/schema.prisma --file prisma/sql/02_partitioning.sql` |
| 5 | **Chưa có CI** | Repo không có `.github/workflows`. Không có cổng chặn nào giữa `git push` và production | Dựng pipeline chạy `typecheck` + `test` + `test:e2e` |
| 6 | **Chưa bắt buộc 2FA cho admin** | Tài khoản admin chỉ cần mật khẩu | Bật 2FA ở tầng Firebase Authentication |
| 7 | **Test cách ly tenant chưa chạy được** | Thiếu `.env.test` nên `npm run test:e2e` không chạy — chốt quan trọng nhất về bảo mật đang không được kiểm chứng tự động | Tạo `.env.test` trỏ vào DB test riêng |
| 8 | **Chưa có giám sát** | `docs/02` mục 12.4 dự kiến Prometheus/Grafana/Sentry, hiện chưa dựng. Endpoint `/metrics` đã có sẵn | Tối thiểu: cảnh báo khi container `worker` không chạy, và khi `/health` fail |

---

## Đọc thêm

| Tài liệu | Nội dung liên quan |
|---|---|
| [02-kien-truc-he-thong.md](./02-kien-truc-he-thong.md) mục 12 | Định hướng môi trường, tách pod API/worker, CI/CD |
| [09-yeu-cau-phi-chuc-nang.md](./09-yeu-cau-phi-chuc-nang.md) | Checklist go-live, các mã `NFR-*` nhắc tới trong tài liệu này |
| [06-anti-fraud.md](./06-anti-fraud.md) | `AF-02b` (chốt IP), `AF-12` (chữ ký HMAC), `AF-13` (rate limit) |
| [17-tai-khoan-test.md](./17-tai-khoan-test.md) | Tài khoản seed, dùng để kiểm chứng sau khi deploy |
| `server-backend-smart/README.md` mục 4, 7, 8 | Hai chốt mạng, vận hành API/worker, bảng blocker go-live |
| `server-ai-smart/README.md` mục 8 | Tải và chuyển đổi model thật |
| `server-backend-smart/docs/r2-lifecycle.md` | Quy tắc vòng đời từng prefix trên object storage |
