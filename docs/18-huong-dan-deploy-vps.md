# 18 — Hướng dẫn deploy lên VPS

> Tài liệu này viết lại theo **trạng thái repo sau khi đã có bộ công cụ deploy** (`docker-compose.prod.yml`, GitHub Actions, `deploy.ps1`).
>
> | Thông tin | Giá trị |
> |---|---|
> | VPS | `76.13.16.235`, Ubuntu, đăng nhập `root` (theo `deploy.ps1`) |
> | Thư mục trên VPS | `/opt/smartface` |
> | Repo | `https://github.com/asctechsoft/smart-face.git`, nhánh `main` |
> | Đã tự động hoá | **Backend** (API + worker + Postgres + Redis + MinIO) |
> | Chưa có | **Frontend**, **AI Server**, **Nginx/TLS** — xem [§5](#5-deploy-frontend-web-smart), [§6](#6-deploy-ai-server), [§7](#7-nginx--https--cloudflare) |

---

## Mục lục

| Mục | Nội dung |
|---|---|
| [§0](#0-repo-hiện-có-sẵn-những-gì) | Ba file deploy đã có, chúng làm gì, còn thiếu gì |
| [§1](#1-ba-cách-deploy--chọn-cách-nào) | GitHub Actions vs `deploy.ps1` vs SSH thủ công |
| [§2](#2-chuẩn-bị-vps-lần-đầu) | Docker, SSH key, firewall, clone repo |
| [§3](#3-file-env-trên-vps--phần-quan-trọng-nhất) | 8 chốt sẽ chặn khởi động, và file `.env` mẫu đầy đủ |
| [§4](#4-deploy-backend) | Chạy `docker-compose.prod.yml`, migration, seed, kiểm chứng |
| [§5](#5-deploy-frontend-web-smart) | Chưa có sẵn — hướng dẫn tạo Dockerfile + compose |
| [§6](#6-deploy-ai-server) | Chưa có trong compose — cách thêm vào |
| [§7](#7-nginx--https--cloudflare) | Bịt lỗ hổng cổng 3000 đang lộ thẳng ra internet |
| [§8](#8-bật-deploy-tự-động-bằng-github-actions) | Khai secret trên GitHub |
| [§9](#9-vận-hành-hằng-ngày) | Log, job nền, backup, dọn đĩa |
| [§10](#10-bảng-lỗi-thường-gặp) | Triệu chứng → nguyên nhân thật → cách sửa |
| [§11](#11-vấn-đề-đã-biết-trong-cấu-hình-hiện-tại) | Những chỗ cần sửa trước khi chạy thật |

---

## 0. Repo hiện có sẵn những gì

### 0.1 Ba file deploy đã được commit

| File | Làm gì |
|---|---|
| `server-backend-smart/docker-compose.prod.yml` | Dựng 5 service trên VPS: `postgres`, `redis`, `minio` (+ `minio-init`), `api`, `worker`. Không expose Postgres/Redis/MinIO ra host |
| `.github/workflows/deploy-backend.yml` | Push lên `main` có đụng `server-backend-smart/**` → SSH vào VPS, `git reset --hard origin/main`, rồi `docker compose up -d --build` |
| `server-backend-smart/deploy.ps1` | Bản chạy tay từ Windows. Cùng logic với workflow, thêm cảnh báo commit chưa push và health check cuối cùng |

Cả ba đều **chỉ lo backend**.

### 0.2 Kiến trúc thực tế sau khi chạy `docker-compose.prod.yml`

```
                    Internet
                       │
                       │ :3000  ⚠ HTTP thuần, không TLS
┌──────────────────────▼───────────────────────────────────┐
│  VPS 76.13.16.235 — /opt/smartface                        │
│                                                           │
│  ┌──────────────────┐      ┌──────────────────┐           │
│  │ api      :3000   │      │ worker           │           │
│  │ WORKER_ENABLED=  │      │ WORKER_ENABLED=  │           │
│  │        false     │      │        true      │           │
│  └───┬────┬────┬────┘      └───┬────┬─────────┘           │
│      │    │    │               │    │                     │
│  ┌───▼────▼────▼───────────────▼────▼──┐                  │
│  │ postgres:5432  redis:6379  minio:9000│  không ra host   │
│  └──────────────────────────────────────┘                 │
│                                                           │
│   ✗ chưa có: web (frontend), ai-server, nginx/TLS         │
└───────────────────────────────────────────────────────────┘
```

### 0.3 Bốn khoảng trống phải xử lý

| # | Thiếu | Hậu quả nếu để nguyên | Xử lý ở |
|---|---|---|---|
| 1 | **Nginx + TLS** | `docker-compose.prod.yml` tự ghi chú: *"⚠ Chưa có Nginx/TLS phía trước — API đang lộ HTTP thẳng ra internet"*. Token đăng nhập và ảnh khuôn mặt đi không mã hoá | [§7](#7-nginx--https--cloudflare) |
| 2 | **Frontend** | `web-smart` không nằm trong compose và chưa có Dockerfile. Chưa có gì phục vụ Web Quản lý | [§5](#5-deploy-frontend-web-smart) |
| 3 | **AI Server** | Không có service `ai-server`, nhưng `AI_SERVER_URL` là biến **bắt buộc** ở production. Thiếu là container `api` chết lúc khởi động | [§6](#6-deploy-ai-server) |
| 4 | ~~`docs/DEPLOY.md` không tồn tại~~ | Workflow và compose vốn dẫn tới file này nhưng nó chưa bao giờ được viết. **Đã sửa** — ba chỗ dẫn chiếu giờ trỏ về chính tài liệu này | — |

---

## 1. Ba cách deploy — chọn cách nào

| Cách | Khi nào dùng | Lệnh |
|---|---|---|
| **GitHub Actions** | Mặc định. Push lên `main` là tự deploy | `git push origin main` |
| **`deploy.ps1`** | Muốn deploy ngay không chờ CI, hoặc CI đang hỏng | `cd server-backend-smart; .\deploy.ps1` |
| **SSH thủ công** | Lần đầu, hoặc khi cần chạy migration/seed riêng | [§4](#4-deploy-backend) |

> **Cả ba cách đều lấy code từ GitHub, không phải từ máy bạn.** Script chạy `git reset --hard origin/main` trên VPS. Commit chưa push thì VPS không thấy — `deploy.ps1` có cảnh báo về việc này, workflow thì không.
>
> ⚠ `git reset --hard` **xoá mọi thay đổi tự sửa trực tiếp trên VPS** trong thư mục repo. File `.env` an toàn vì đã được gitignore và không nằm trong index.

---

## 2. Chuẩn bị VPS lần đầu

### 2.1 Cài Docker Engine + Compose plugin

Dùng repo chính thức của Docker, không dùng `docker.io` của Ubuntu (bản cũ, thiếu `compose` v2):

```bash
apt update && apt upgrade -y
apt install -y ca-certificates curl gnupg git

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  > /etc/apt/sources.list.d/docker.list

apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

docker --version && docker compose version
```

### 2.2 SSH key cho deploy không cần mật khẩu

Trên **máy Windows của bạn** (để `deploy.ps1` chạy được):

```powershell
# Sinh key nếu chưa có
ssh-keygen -t ed25519 -C "deploy-smartface"

# Đẩy public key lên VPS
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh root@76.13.16.235 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"

# Kiểm tra: phải vào được mà không hỏi mật khẩu
ssh root@76.13.16.235 "echo OK"
```

> `deploy.ps1` chạy `ssh -o BatchMode=yes`, tức là **không cho phép nhập mật khẩu**. Chưa có key thì script fail ngay chứ không hỏi.

### 2.3 Firewall

```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status
```

> ⚠ **Docker ghi thẳng vào iptables, đi vòng qua `ufw`.** Service `api` trong `docker-compose.prod.yml` có `ports: - '3000:3000'`, nên cổng 3000 **vẫn mở ra internet dù `ufw` không cho phép**. Đây chính là lỗ hổng ở [§0.3 mục 1](#03-bốn-khoảng-trống-phải-xử-lý). Cách bịt đúng là sửa thành `127.0.0.1:3000:3000` rồi cho nginx đứng trước — xem [§7](#7-nginx--https--cloudflare).

### 2.4 Kiểm tra Postgres sẵn có trên VPS có xung đột không

VPS này đang chạy một Postgres native ở cổng 5432 (chính là host trong `DATABASE_URL` hiện tại của `.env` dev). `docker-compose.prod.yml` dựng **một Postgres riêng trong container**, và service này **không có mục `ports:`** nên không tranh cổng 5432 với bản native. Hai cái sống song song được.

```bash
# Postgres native đang chạy?
ss -lntp | grep 5432
```

> **Muốn dùng Postgres native thay vì container?** Xoá service `postgres` và mục `depends_on: postgres` trong `docker-compose.prod.yml`, rồi bỏ dòng `DATABASE_URL:` khỏi `environment:` của `api` và `worker` để nó lấy từ `.env`. Lưu ý container nói chuyện với host qua `host.docker.internal` (phải thêm `extra_hosts: ["host.docker.internal:host-gateway"]`), không phải `localhost`.

### 2.5 Clone repo

Bước này không bắt buộc — cả workflow lẫn `deploy.ps1` đều tự clone nếu chưa có. Làm tay để tạo `.env` trước:

```bash
git clone https://github.com/asctechsoft/smart-face.git /opt/smartface
cd /opt/smartface/server-backend-smart
```

---

## 3. File `.env` trên VPS — phần quan trọng nhất

Cả workflow lẫn `deploy.ps1` đều **dừng và báo lỗi** nếu `/opt/smartface/server-backend-smart/.env` không tồn tại. Đây là file duy nhất bạn phải tạo bằng tay, và cũng là chỗ sai nhiều nhất.

### 3.1 Tám chốt sẽ chặn khởi động

Có **hai tầng** kiểm tra, và chúng báo lỗi ở hai chỗ khác nhau:

**Tầng 1 — Docker Compose từ chối khởi động** (cú pháp `${BIEN:?...}`, lỗi hiện ngay trên terminal):

| # | Biến | Vì sao |
|---|---|---|
| 1 | `POSTGRES_PASSWORD` | Compose dựng Postgres, không cho mật khẩu rỗng |
| 2 | `REDIS_PASSWORD` | |
| 3 | `S3_ACCESS_KEY` / `S3_SECRET_KEY` | Dùng làm `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` |

**Tầng 2 — `src/config/env.validation.ts` giết tiến trình lúc khởi động** (chỉ thấy khi `docker compose logs api`). Compose đặt `NODE_ENV: production` trong `environment:`, mà `environment:` **thắng** `env_file:`, nên toàn bộ các chốt này luôn bật, kể cả khi `.env` của bạn ghi `NODE_ENV=development`:

| # | Chốt | Điều kiện chết |
|---|---|---|
| 4 | Biến bắt buộc | Thiếu `AI_SERVER_URL`, `AI_SERVER_INTERNAL_KEY`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` |
| 5 | `NFR-SEC-03` | `JWT_ALGORITHM=HS256`, hoặc `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY` rỗng |
| 6 | OTP | `OTP_DEBUG_RETURN=true` |
| 7 | Redis | `REDIS_ENABLED=false` |
| 8 | `AF-02b` + `AF-12` | `TRUSTED_PROXY_HOPS` trống/không phải số 0–5; `ATTENDANCE_SIGNATURE_REQUIRED` ≠ `true` |

> ⚠ **File `.env` hiện tại trên máy dev vi phạm 5 trong 8 chốt.** Copy nguyên nó lên VPS là chắc chắn hỏng:
>
> | Giá trị hiện tại | Kết quả |
> |---|---|
> | `POSTGRES_PASSWORD` không có | Compose từ chối chạy |
> | `REDIS_PASSWORD=` (rỗng) | Compose từ chối chạy |
> | `JWT_PRIVATE_KEY=` / `JWT_PUBLIC_KEY=` (rỗng) | `api` chết — `NFR-SEC-03` |
> | `REDIS_ENABLED=false` | `api` chết |
> | `OTP_DEBUG_RETURN=true` | `api` chết |
> | `ATTENDANCE_SIGNATURE_REQUIRED=false` | `api` chết |
>
> Luôn tạo `.env` trên VPS từ `.env.example`, đừng `scp` file dev lên.

### 3.2 Sinh bí mật — làm một lần trên VPS

```bash
cd /opt/smartface/server-backend-smart

# Cặp khoá JWT RS256 (bắt buộc, production không chạy được với HS256)
openssl genrsa -out /root/jwt-private.pem 2048
openssl rsa -in /root/jwt-private.pem -pubout -out /root/jwt-public.pem

# In ra đúng dạng một dòng để dán vào .env
echo "JWT_PRIVATE_KEY=\"$(awk 'BEGIN{ORS="\\n"} {print}' /root/jwt-private.pem)\""
echo "JWT_PUBLIC_KEY=\"$(awk 'BEGIN{ORS="\\n"} {print}' /root/jwt-public.pem)\""

# Mật khẩu hạ tầng
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
echo "REDIS_PASSWORD=$(openssl rand -hex 24)"
echo "S3_SECRET_KEY=$(openssl rand -hex 24)"
echo "AI_SERVER_INTERNAL_KEY=$(openssl rand -hex 32)"
```

Khoá Firebase (Firebase Console → ⚙ Project settings → Service accounts → **Generate new private key**), chuyển về một dòng:

```bash
python3 - <<'EOF'
import json
d = json.load(open('/root/firebase-admin.json'))
print('FIREBASE_PROJECT_ID='  + d['project_id'])
print('FIREBASE_CLIENT_EMAIL=' + d['client_email'])
print('FIREBASE_PRIVATE_KEY="' + d['private_key'].replace('\n', '\\n') + '"')
EOF
```

### 3.3 File `.env` production mẫu

```bash
cd /opt/smartface/server-backend-smart
cp .env.example .env
chmod 600 .env
nano .env
```

Các giá trị bắt buộc phải đúng (phần còn lại giữ theo `.env.example`, file đó có chú thích đầy đủ từng biến):

```dotenv
# --- Compose đọc (tầng 1) --------------------------------------------------
POSTGRES_USER=smartface
POSTGRES_PASSWORD=<openssl rand -hex 24>
POSTGRES_DB=smartface

REDIS_PASSWORD=<openssl rand -hex 24>

S3_BUCKET=smartface
S3_ACCESS_KEY=smartface
S3_SECRET_KEY=<openssl rand -hex 24>

# --- Ứng dụng (tầng 2) -----------------------------------------------------
# NODE_ENV, PORT, DATABASE_URL, REDIS_HOST/PORT, S3_ENDPOINT, WORKER_ENABLED
# KHÔNG cần khai — compose đã đặt trong `environment:` và ghi đè file này.

API_PREFIX=v1

# ⚠ Số proxy đứng TRƯỚC Backend. Xem bảng ở §3.4.
#   Chưa có nginx  → 0
#   Có nginx       → 1
#   Cloudflare+nginx → 2
TRUSTED_PROXY_HOPS=0

# Bỏ trống = cho phép MỌI origin. Phải khai đúng domain của Web Quản lý.
CORS_ORIGINS=https://<domain-cua-ban>
SWAGGER_ENABLED=false

# --- JWT: bắt buộc RS256 ---------------------------------------------------
JWT_ALGORITHM=RS256
JWT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n"

# --- Firebase --------------------------------------------------------------
FIREBASE_PROJECT_ID=smart-face-bf8e2
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxx@smart-face-bf8e2.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
# KHÔNG được có FIREBASE_AUTH_EMULATOR_HOST — emulator không kiểm chữ ký token.

# --- AI Server -------------------------------------------------------------
# ⚠ Compose CHƯA có service ai-server. Xem §6 trước khi deploy.
AI_SERVER_URL=http://ai-server:8000
AI_SERVER_INTERNAL_KEY=<openssl rand -hex 32>

# --- Bắt buộc bật ở production --------------------------------------------
REDIS_ENABLED=true
ATTENDANCE_SIGNATURE_REQUIRED=true
OTP_DEBUG_RETURN=false
RATE_LIMIT_ENABLED=true

# console = chỉ in OTP ra log server, người dùng không nhận được gì.
SMS_PROVIDER=<nha-cung-cap-that>
SMS_API_URL=
SMS_API_KEY=
SMS_SECRET_KEY=
SMS_BRAND_NAME=
```

### 3.4 `TRUSTED_PROXY_HOPS` — con số dễ sai nhất

Nó quyết định `request.ip` là địa chỉ nào, và chốt *"chỉ chấm công từ mạng văn phòng"* (`AF-02b`) phụ thuộc hoàn toàn vào nó. Sai theo **cả hai hướng** đều hỏng, và một hướng hỏng **âm thầm**:

| Sai kiểu | Hậu quả |
|---|---|
| Quá **thấp** | `request.ip` là IP của proxy → danh sách IP văn phòng không bao giờ khớp → **cả công ty không chấm công được**. Hỏng ồn ào, phát hiện ngay |
| Quá **cao** | Nhân viên tự khai `X-Forwarded-For: <IP văn phòng>` là qua → chốt IP mất tác dụng, **mà log vẫn hiện đúng IP văn phòng**. Hỏng im lặng, tệ hơn không có chốt |

| Kiến trúc | Giá trị |
|---|---|
| Hiện tại (api ra thẳng cổng 3000) | `0` |
| Sau khi thêm nginx ([§7](#7-nginx--https--cloudflare)) | `1` |
| Cloudflare proxy (mây cam) + nginx | `2` |

Nhớ đổi lại giá trị này **mỗi khi thay đổi kiến trúc mạng phía trước**.

---

## 4. Deploy backend

### 4.1 Lần đầu — chạy tay để thấy rõ từng bước

```bash
cd /opt/smartface/server-backend-smart

# 1. Kiểm tra cú pháp và biến còn thiếu (tầng 1 báo lỗi ở đây)
docker compose -f docker-compose.prod.yml config > /dev/null && echo "Cấu hình OK"

# 2. Dựng hạ tầng trước, chờ healthy
docker compose -f docker-compose.prod.yml up -d postgres redis minio minio-init
watch -n 2 docker compose -f docker-compose.prod.yml ps

# 3. Bật api + worker (migration chạy tự động, xem ghi chú bên dưới)
docker compose -f docker-compose.prod.yml up -d --build

# 4. Theo dõi log khởi động — tầng 2 báo lỗi ở đây
docker compose -f docker-compose.prod.yml logs -f api
```

> **Migration chạy ở đâu:** service `api` có `command: sh -c "npx prisma migrate deploy && node dist/main"`, tức migration chạy **bên trong** container api mỗi lần khởi động. Bạn không phải gọi riêng.
>
> ⚠ Nhưng image runtime **không chứa Prisma CLI**: `Dockerfile` stage `runner` cài bằng `npm ci --omit=dev`, mà `prisma` nằm ở `devDependencies`. Vì vậy `npx` phải **tải Prisma CLI từ npm registry mỗi lần container khởi động**. Hệ quả: khởi động chậm hơn, và **container không lên được nếu VPS mất kết nối ra npm**. Cách khắc phục ở [§11](#11-vấn-đề-đã-biết-trong-cấu-hình-hiện-tại).

### 4.2 Áp ràng buộc DB không nằm trong migration

`prisma migrate deploy` chỉ áp schema. Trigger bất biến (`BR-06`), chính sách RLS và ràng buộc auth nằm trong SQL riêng, **không tự chạy**:

```bash
docker compose -f docker-compose.prod.yml exec api \
  npx prisma db execute --schema prisma/schema.prisma --file prisma/sql/01_immutability_and_rls.sql

docker compose -f docker-compose.prod.yml exec api \
  npx prisma db execute --schema prisma/schema.prisma --file prisma/sql/02_auth_constraints.sql
```

> Đây chính là nội dung script `npm run db:guards`. Gọi thẳng `npx prisma db execute` thay vì `npm run db:guards` cũng được — cả hai đều phải tải Prisma CLI về vì lý do ở §4.1.
>
> `prisma/sql/02_partitioning.sql` **không** nằm trong `db:guards`. Xem [§11](#11-vấn-đề-đã-biết-trong-cấu-hình-hiện-tại).

### 4.3 Seed dữ liệu nền — chỉ lần đầu, trên DB trống

```bash
docker compose -f docker-compose.prod.yml run --rm \
  --entrypoint sh api -c "npm install ts-node tsconfig-paths typescript --no-save && npm run seed"
```

> Vì sao rườm rà: `seed` chạy bằng `ts-node`, mà image runtime cài `--omit=dev` nên không có `ts-node`, `typescript` lẫn `tsconfig-paths`. Lệnh trên cài tạm vào container dùng một lần rồi vứt (`--rm`).
>
> Tài khoản seed và mật khẩu: [17-tai-khoan-test.md](./17-tai-khoan-test.md). **Đổi mật khẩu ngay sau lần đăng nhập đầu tiên.**

### 4.4 Kiểm chứng

```bash
cd /opt/smartface/server-backend-smart
alias dc="docker compose -f docker-compose.prod.yml"

# 1. Tất cả container Up, không cái nào Restarting
dc ps

# 2. Backend sống. `/health` nằm NGOÀI prefix v1 (setGlobalPrefix có exclude)
curl -i http://localhost:3000/health

# 3. API trả về dữ liệu
curl -s http://localhost:3000/v1/meta/error-codes | head -c 300

# 4. Worker đã đăng ký lịch job nền
dc logs worker | grep -i "job định kỳ"

# 5. Postgres/Redis/MinIO KHÔNG lộ ra ngoài — cả ba phải fail
for p in 5432 6379 9000; do
  timeout 3 bash -c "</dev/tcp/76.13.16.235/$p" 2>/dev/null \
    && echo "$p LỘ RA NGOÀI - SAI" || echo "$p kín - đúng"
done
```

Mục 5 phải in **"kín"** cho cả ba cổng. Riêng cổng 3000 hiện đang mở ra internet có chủ ý (compose khai `'3000:3000'`) — [§7](#7-nginx--https--cloudflare) sẽ đóng lại.

### 4.5 Các lần deploy sau

```powershell
# Từ Windows
cd server-backend-smart
.\deploy.ps1
```

hoặc chỉ cần `git push origin main` nếu đã bật GitHub Actions ([§8](#8-bật-deploy-tự-động-bằng-github-actions)).

Rollback:

```bash
cd /opt/smartface
git log --oneline -10          # chọn commit muốn quay về
git checkout <commit-hash>
cd server-backend-smart
docker compose -f docker-compose.prod.yml up -d --build
```

> ⚠ Rollback code **không** rollback migration. Migration đã áp thì vẫn nằm trong DB. Đây là lý do nên viết migration kiểu "chỉ thêm cột, không xoá" — code cũ vẫn chạy được trên schema mới.

---

## 5. Deploy frontend (`web-smart`)

Chưa có gì trong repo cho phần này. Ba việc phải làm.

### 5.1 Hiểu ràng buộc trước khi làm

| Sự thật | Hệ quả |
|---|---|
| `web-smart` là SPA tĩnh (Vite build ra `dist/`) | Không cần Node lúc chạy, chỉ cần nginx phục vụ file |
| `VITE_API_BASE_URL` mặc định là `/v1` — **đường dẫn tương đối** | SPA và API **phải cùng origin**. Tách hai domain thì dính CORS và cookie refresh token không gửi kèm được |
| Biến `VITE_*` được **nhúng vào bundle lúc build** | Đổi giá trị phải **build lại**, restart container không có tác dụng |
| `VITE_API_PROXY_TARGET` chỉ dùng cho Vite dev server | Không cần khai ở production |

### 5.2 Tạo `web-smart/Dockerfile.prod`

```dockerfile
# ============================================================================
#  Web Quản lý — build tĩnh rồi cho nginx phục vụ.
#  Vite nhúng VITE_* vào bundle LÚC BUILD, nên dùng ARG chứ không phải ENV runtime.
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

ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY \
    VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN \
    VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID \
    VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID \
    VITE_DEFAULT_TIMEZONE=$VITE_DEFAULT_TIMEZONE \
    VITE_GOOGLE_MAPS_API_KEY=$VITE_GOOGLE_MAPS_API_KEY \
    VITE_WS_URL=$VITE_WS_URL

# npm run build = tsc -b && vite build → dist/
RUN npm run build

FROM nginx:alpine AS runner
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
```

### 5.3 Thêm biến frontend vào `.env`

Frontend nằm ở thư mục khác nên compose ở `server-backend-smart/` phải trỏ ngược ra (`context: ../web-smart`). Thêm vào `server-backend-smart/.env`:

```dotenv
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=smart-face-bf8e2.firebaseapp.com
# ⚠ PHẢI trùng FIREBASE_PROJECT_ID ở trên, khác project là không ai đăng nhập được
VITE_FIREBASE_PROJECT_ID=smart-face-bf8e2
VITE_FIREBASE_APP_ID=
VITE_GOOGLE_MAPS_API_KEY=
VITE_WS_URL=wss://<domain-cua-ban>
```

Lấy các giá trị này ở Firebase Console → ⚙ **Project settings** → **General** → **Your apps** → Web app. Đồng thời thêm domain production vào **Authentication** → **Settings** → **Authorized domains**.

### 5.4 Thêm service `web` vào `docker-compose.prod.yml`

Service này gộp luôn vai trò nginx reverse proxy ở [§7](#7-nginx--https--cloudflare):

```yaml
  web:
    build:
      context: ../web-smart
      dockerfile: Dockerfile.prod
      args:
        VITE_API_BASE_URL: /v1
        VITE_FIREBASE_API_KEY: ${VITE_FIREBASE_API_KEY}
        VITE_FIREBASE_AUTH_DOMAIN: ${VITE_FIREBASE_AUTH_DOMAIN}
        VITE_FIREBASE_PROJECT_ID: ${VITE_FIREBASE_PROJECT_ID}
        VITE_FIREBASE_APP_ID: ${VITE_FIREBASE_APP_ID}
        VITE_DEFAULT_TIMEZONE: Asia/Ho_Chi_Minh
        VITE_GOOGLE_MAPS_API_KEY: ${VITE_GOOGLE_MAPS_API_KEY}
        VITE_WS_URL: ${VITE_WS_URL}
    container_name: smartface-web
    restart: unless-stopped
    depends_on:
      - api
    ports:
      - '80:80'
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
```

> ⚠ **Workflow GitHub Actions chỉ chạy lại khi `server-backend-smart/**` thay đổi.** Sửa code frontend sẽ **không** kích hoạt deploy. Thêm `'web-smart/**'` vào mục `paths:` của `.github/workflows/deploy-backend.yml` nếu muốn tự động cả hai.

---

## 6. Deploy AI Server

`AI_SERVER_URL` và `AI_SERVER_INTERNAL_KEY` là **biến bắt buộc ở production** — thiếu là `api` chết. Nhưng compose chưa có service này.

### 6.1 Tạo `server-ai-smart/.env` trên VPS

```bash
cd /opt/smartface/server-ai-smart
cp .env.example .env
chmod 600 .env
```

| Biến | Giá trị production | Vì sao |
|---|---|---|
| `ENV` | `production` | |
| `AI_SERVER_INTERNAL_KEY` | **Trùng hệt** giá trị trong `server-backend-smart/.env` | Lệch là mọi lượt chấm công báo lỗi gọi AI |
| `ENGINE` | `insightface` | ⚠ `stub` trả **dữ liệu bịa** — xem [§11](#11-vấn-đề-đã-biết-trong-cấu-hình-hiện-tại) |
| `MODEL_ROOT` | `/app/models` | Khớp volume mount |
| `PROVIDERS` | `CPUExecutionProvider` | VPS không có GPU |
| `ALLOW_MISSING_LIVENESS_MODEL` | `false` | Bật = ảnh in ra giấy cũng chấm công được |
| `MAX_CONCURRENCY` | `4` | Tăng cái này để tăng thông lượng, **không** tăng `--workers` — mỗi worker nạp một bản model riêng vào RAM |
| `WARMUP_ON_STARTUP` | `true` | Lượt chấm công đầu không phải chờ nạp model |

### 6.2 Thêm service vào `docker-compose.prod.yml`

```yaml
  ai-server:
    build:
      context: ../server-ai-smart
      args:
        RUNTIME: cpu
    container_name: smartface-ai-server
    restart: unless-stopped
    env_file:
      - ../server-ai-smart/.env
    volumes:
      # Model nằm ngoài image để nâng cấp không phải build lại.
      - ../server-ai-smart/models:/app/models
    # KHÔNG có `ports:` — docs/02 mục 6.2 cấm expose AI Server ra internet.
    mem_limit: 4g
```

Rồi thêm `ai-server` vào `depends_on` của `api` và `worker`.

Với cấu hình này, `AI_SERVER_URL=http://ai-server:8000` trong `.env` của backend là đúng (giao tiếp qua docker network nội bộ).

### 6.3 Tải model thật

```bash
cd /opt/smartface/server-ai-smart
docker compose -f ../server-backend-smart/docker-compose.prod.yml run --rm ai-server \
  python scripts/download_models.py
```

Script này in ra đúng các lệnh cần gõ để lấy `buffalo_l` và chuyển đổi model chống giả mạo (`python scripts/convert_anti_spoof.py`).

---

## 7. Nginx + HTTPS + Cloudflare

Đây là việc cấp bách nhất. Hiện tại `docker-compose.prod.yml` publish `'3000:3000'`, nghĩa là **API đang phục vụ HTTP thuần trực tiếp ra internet**: ID token Firebase, access token và ảnh khuôn mặt đều đi không mã hoá.

### 7.1 Đóng cổng 3000

Trong `docker-compose.prod.yml`, sửa service `api`:

```yaml
    ports:
      # Chỉ nghe trên loopback. Nginx trong cùng network gọi qua `api:3000`,
      # không cần publish ra host nữa.
      - '127.0.0.1:3000:3000'
```

### 7.2 Tạo `server-backend-smart/nginx.conf`

```nginx
# ============================================================================
#  SmartFace — nginx đứng trước SPA + Backend.
#  SPA và API PHẢI cùng origin: web-smart gọi API bằng đường dẫn tương đối /v1.
# ============================================================================

upstream smartface_api {
    server api:3000;
    keepalive 32;
}

server {
    listen 80;
    server_name _;

    # Ảnh chấm công đi qua đây. Backend giới hạn JSON 10mb (src/main.ts); để
    # nginx rộng hơn một chút để lỗi hiện ra ở tầng ứng dụng kèm mã lỗi rõ ràng
    # thay vì 413 trống trơn của nginx.
    client_max_body_size 12m;
    server_tokens off;

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;

    # --- API ---------------------------------------------------------------
    location /v1/ {
        proxy_pass         http://smartface_api;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_set_header   Connection        "";
        proxy_connect_timeout 10s;
        proxy_read_timeout    60s;
    }

    # `/health` và `/metrics` nằm NGOÀI prefix v1.
    location = /health {
        proxy_pass       http://smartface_api;
        proxy_set_header Host $host;
        access_log       off;
    }

    location = /metrics {
        allow 127.0.0.1;
        allow 172.16.0.0/12;
        deny  all;
        proxy_pass       http://smartface_api;
        proxy_set_header Host $host;
    }

    # --- WebSocket (Socket.IO) — thông báo realtime đơn cần duyệt ----------
    location /socket.io/ {
        proxy_pass         http://smartface_api;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host       $host;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
    }

    # --- SPA tĩnh ----------------------------------------------------------
    root  /usr/share/nginx/html;
    index index.html;

    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # `try_files ... /index.html` là BẮT BUỘC với SPA: React Router xử lý đường
    # dẫn ở phía trình duyệt, nginx không có file `/attendance` nên thiếu dòng
    # này thì người dùng bấm F5 ở route con sẽ nhận 404.
    location / {
        try_files $uri $uri/ /index.html;
        # index.html không được cache, nếu không người dùng vẫn chạy bản cũ sau
        # khi deploy vì nó trỏ tới file assets đã bị xoá.
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }
}
```

### 7.3 Đổi `TRUSTED_PROXY_HOPS`

```dotenv
# Có nginx, chưa có Cloudflare
TRUSTED_PROXY_HOPS=1
```

**Đây là bước bắt buộc, không phải tuỳ chọn.** Quên đổi thì `request.ip` thành IP của container nginx, và chốt IP văn phòng chặn sạch mọi nhân viên.

### 7.4 HTTPS qua Cloudflare

1. Cloudflare → **DNS** → thêm record `A` trỏ về `76.13.16.235`, bật proxy (🟠 mây cam).
2. Cloudflare → **SSL/TLS** → **Origin Server** → **Create Certificate** (mặc định 15 năm). Lưu vào VPS:
   ```bash
   nano /opt/smartface/server-backend-smart/certs/origin.pem   # phần Certificate
   nano /opt/smartface/server-backend-smart/certs/origin.key   # phần Private Key
   chmod 600 /opt/smartface/server-backend-smart/certs/origin.key
   ```
3. Mount cert vào service `web` và mở cổng 443:
   ```yaml
       ports:
         - '80:80'
         - '443:443'
       volumes:
         - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
         - ./certs:/etc/nginx/certs:ro
   ```
4. Thêm `server` block nghe 443 vào `nginx.conf` (chép nguyên các `location` từ block cổng 80):
   ```nginx
   server {
       listen 443 ssl;
       http2 on;
       server_name <domain-cua-ban>;

       ssl_certificate     /etc/nginx/certs/origin.pem;
       ssl_certificate_key /etc/nginx/certs/origin.key;
       ssl_protocols       TLSv1.2 TLSv1.3;

       # ... chép toàn bộ phần location của block cổng 80 vào đây ...
   }
   ```
5. Cloudflare → **SSL/TLS** → chọn **Full (strict)**, bật **Always Use HTTPS**.
6. Cloudflare → **Network** → bật **WebSockets** (tắt thì thông báo realtime không hoạt động, frontend âm thầm rơi về polling).
7. Đổi `.env` rồi build lại:
   ```dotenv
   TRUSTED_PROXY_HOPS=2          # Cloudflare + nginx
   CORS_ORIGINS=https://<domain-cua-ban>
   VITE_WS_URL=wss://<domain-cua-ban>
   ```
   ```bash
   docker compose -f docker-compose.prod.yml up -d --build web api
   ```

### 7.5 Bẫy presigned URL của MinIO

`StorageService.getPresignedUrl()` sinh URL dựa trên `S3_ENDPOINT`. Compose đang đặt `S3_ENDPOINT: http://minio:9000` — hostname **chỉ tồn tại trong docker network**. URL trả về cho trình duyệt và App sẽ không mở được, ảnh chấm công hiện lỗi.

Cách sửa: thêm record `storage.<domain>` trỏ về VPS, thêm một `server` block trong nginx proxy sang `minio:9000` (**giữ nguyên header `Host`** — chữ ký presign có ký cả `Host`), rồi trong `docker-compose.prod.yml` đổi:

```yaml
      S3_ENDPOINT: https://storage.<domain-cua-ban>
```

Hoặc bỏ MinIO, dùng S3 thật (Cloudflare R2 / AWS S3) — xem `server-backend-smart/docs/r2-lifecycle.md` cho quy tắc vòng đời từng prefix (`attendance/` giữ tối đa 400 ngày, `exports/` 30 ngày).

---

## 8. Bật deploy tự động bằng GitHub Actions

GitHub → repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

| Secret | Giá trị | Ghi chú |
|---|---|---|
| `VPS_HOST` | `76.13.16.235` | |
| `VPS_USER` | `root` | Khớp `deploy.ps1` |
| `VPS_SSH_KEY` | Nội dung **private key** | Toàn bộ file, kể cả `-----BEGIN...-----` và `-----END...-----` |

Public key tương ứng phải nằm trong `~/.ssh/authorized_keys` trên VPS ([§2.2](#22-ssh-key-cho-deploy-không-cần-mật-khẩu)).

Kiểm tra: GitHub → **Actions** → **Deploy Backend (VPS)** → **Run workflow** (workflow có `workflow_dispatch` nên chạy tay được, không cần push).

> ⚠ Workflow chỉ kích hoạt khi `server-backend-smart/**` thay đổi. Sau khi làm [§5](#5-deploy-frontend-web-smart) và [§6](#6-deploy-ai-server), thêm `'web-smart/**'` và `'server-ai-smart/**'` vào mục `paths:`.

---

## 9. Vận hành hằng ngày

```bash
cd /opt/smartface/server-backend-smart
alias dc="docker compose -f docker-compose.prod.yml"
```

### 9.1 Log

```bash
dc logs -f api --tail=200
dc logs -f worker --tail=200
dc logs api --since 1h | grep -i '"level":50\|error'
```

Giới hạn dung lượng log (mặc định Docker để log phình vô hạn) — thêm vào `/etc/docker/daemon.json` rồi `systemctl restart docker`:

```json
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "50m", "max-file": "5" }
}
```

### 9.2 Theo dõi job nền — chỗ dễ bị bỏ sót nhất

Toàn bộ lịch chạy nền nằm trong container `worker`, đăng ký bằng repeatable job của BullMQ:

| Lịch | Job |
|---|---|
| `0 2 * * *` | Tính lại bảng công hằng đêm |
| `*/15 * * * *` | Quét gian lận |
| `30 3` / `45 3` | Quét gian lận theo ngày |
| `0 4 * * *` | Batch AI |
| `0 5` / `15 5` / `30 5` | Dọn dữ liệu hết hạn lưu trữ |

> ⚠ **Worker chết là một lỗi im lặng.** API vẫn phục vụ chấm công bình thường, không mã lỗi, không ai báo — tới cuối tháng mới phát hiện bảng công chưa được tính lại. Health check của `deploy.ps1` chỉ gọi `/health` của API, **không** kiểm tra worker.
>
> Ngoài ra `SchedulerService` **nuốt lỗi** nếu Redis chưa sẵn sàng lúc worker khởi động và **không tự đăng ký lại**. Thấy log `Không đăng ký được job định kỳ` thì phải `dc restart worker`.

```bash
dc logs worker | grep "Đã đăng ký các job định kỳ"
dc exec redis redis-cli -a "$REDIS_PASSWORD" --no-auth-warning KEYS 'bull:*:repeat:*'
```

### 9.3 Backup

```bash
mkdir -p /opt/backups

# Postgres (trong container)
dc exec -T postgres pg_dump -U smartface -Fc smartface > /opt/backups/db-$(date +%F).dump

# MinIO — mất là mất hẳn ảnh chấm công, ưu tiên mục này
docker run --rm -v server-backend-smart_minio-data:/data -v /opt/backups:/backup \
  alpine tar czf /backup/minio-$(date +%F).tar.gz -C /data .
```

Đặt vào `crontab -e`:

```cron
0 3 * * * cd /opt/smartface/server-backend-smart && ./backup.sh >> /var/log/smartface-backup.log 2>&1
```

> Tên volume có tiền tố là tên thư mục chứa compose. Kiểm tra tên thật bằng `docker volume ls`.

### 9.4 Dọn đĩa

Workflow và `deploy.ps1` đã tự chạy `docker image prune -f` sau mỗi lần deploy. Thỉnh thoảng dọn thêm cache build:

```bash
docker system df
docker builder prune -f
```

> ⚠ **Đừng chạy `docker system prune --volumes`.** Cờ `--volumes` xoá mọi volume không đang gắn vào container nào. Đang chạy thì an toàn, nhưng chỉ cần bạn vừa `docker compose down` để bảo trì là nó xoá sạch **cả Postgres lẫn toàn bộ ảnh chấm công**.

---

## 10. Bảng lỗi thường gặp

| Triệu chứng | Nguyên nhân thật | Cách sửa |
|---|---|---|
| `deploy.ps1` báo `Permission denied (publickey)` | Chưa đẩy public key lên VPS. Script chạy `BatchMode=yes` nên không hỏi mật khẩu | [§2.2](#22-ssh-key-cho-deploy-không-cần-mật-khẩu) |
| Deploy dừng với `Thieu server-backend-smart/.env tren VPS` | Chưa tạo `.env` trên VPS | [§3.3](#33-file-env-production-mẫu) |
| `docker compose` báo `POSTGRES_PASSWORD bắt buộc trong .env` | Chốt tầng 1 — cú pháp `${BIEN:?...}` | Điền `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` |
| `api` restart liên tục, log `Thiếu biến môi trường bắt buộc: ...` | Chốt tầng 2 — `env.validation.ts` | Điền đủ theo [§3.3](#33-file-env-production-mẫu) |
| Log `REDIS_ENABLED=false chỉ dùng được ở môi trường phát triển` | Copy `.env` từ máy dev | `REDIS_ENABLED=true` |
| Log `NFR-SEC-03: production phải dùng RS256/ES256` | `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY` đang rỗng | Sinh cặp khoá [§3.2](#32-sinh-bí-mật--làm-một-lần-trên-vps) |
| Log `OTP_DEBUG_RETURN phải TẮT ở production` | Còn `true` từ `.env` dev | Đặt `false` |
| Log `AF-12: ATTENDANCE_SIGNATURE_REQUIRED phải BẬT` | Còn `false` | Đặt `true`. ⚠ App phải đã triển khai ký HMAC, chưa thì App sẽ chấm công lỗi |
| Log `AF-02b: TRUSTED_PROXY_HOPS bắt buộc phải khai` | Biến trống | Khai theo bảng [§3.4](#34-trusted_proxy_hops--con-số-dễ-sai-nhất) |
| `api` khởi động rất chậm, hoặc treo ở bước `npx prisma` | Image không có Prisma CLI, phải tải từ npm mỗi lần khởi động | [§11](#11-vấn-đề-đã-biết-trong-cấu-hình-hiện-tại) mục 2 |
| **Toàn bộ nhân viên báo "ngoài mạng văn phòng"** | `TRUSTED_PROXY_HOPS` quá thấp → `request.ip` là IP của proxy | Tăng theo đúng số hop |
| Chốt IP có vẻ chạy nhưng ai ở đâu cũng chấm công được | `TRUSTED_PROXY_HOPS` quá cao → client tự giả `X-Forwarded-For` | Giảm về đúng số hop |
| **Ảnh chấm công không hiển thị, URL trỏ `minio:9000`** | `S3_ENDPOINT` là hostname nội bộ | [§7.5](#75-bẫy-presigned-url-của-minio) |
| Chấm công báo lỗi gọi AI | `AI_SERVER_INTERNAL_KEY` lệch giữa backend và ai-server, hoặc chưa có service `ai-server` | [§6](#6-deploy-ai-server) |
| Nhận diện luôn khớp / luôn không khớp một cách vô lý | `ENGINE=stub` trả **dữ liệu bịa** | [§11](#11-vấn-đề-đã-biết-trong-cấu-hình-hiện-tại) mục 1 |
| **Bấm F5 ở `/attendance` trả 404** | nginx thiếu `try_files $uri $uri/ /index.html` | [§7.2](#72-tạo-server-backend-smartnginxconf) |
| Frontend gọi API ra 404 hoặc lỗi CORS | `VITE_API_BASE_URL` không phải `/v1`, hoặc nginx thiếu `location /v1/` | Build lại `web` sau khi sửa |
| Sửa code frontend nhưng deploy không chạy | Workflow chỉ theo dõi `server-backend-smart/**` | Thêm `'web-smart/**'` vào `paths:` |
| Đăng nhập đúng mật khẩu vẫn báo token không hợp lệ | Frontend và backend khác Firebase project | `VITE_FIREBASE_PROJECT_ID` phải trùng `FIREBASE_PROJECT_ID` |
| Đăng nhập báo `auth/unauthorized-domain` | Domain production chưa nằm trong Authorized domains | Firebase Console → Authentication → Settings |
| Không nhận được SMS OTP | `SMS_PROVIDER=console` chỉ in OTP ra log server | Cấu hình nhà cung cấp thật |
| Bảng công không được tính lại ban đêm | Worker chết, hoặc lịch chưa đăng ký được do Redis | [§9.2](#92-theo-dõi-job-nền--chỗ-dễ-bị-bỏ-sót-nhất) |
| Thông báo realtime không tới | Cloudflare chưa bật WebSockets, hoặc nginx thiếu `location /socket.io/`, hoặc `VITE_WS_URL` trống | [§7.4](#74-https-qua-cloudflare) |
| Deploy xong người dùng vẫn thấy giao diện cũ | `index.html` bị cache | nginx đã đặt `no-cache`; xoá cache Cloudflare (Purge Everything) |
| Thay đổi tự sửa trên VPS biến mất sau deploy | Script chạy `git reset --hard origin/main` | Sửa trong repo rồi push, đừng sửa trực tiếp trên VPS |

---

## 11. Vấn đề đã biết trong cấu hình hiện tại

Sắp theo mức độ cấp bách. Mục 1–4 là vấn đề của chính bộ deploy vừa được commit; mục 5–9 là blocker go-live của sản phẩm (ghi trong `server-backend-smart/README.md` mục 8).

| # | Vấn đề | Vì sao nghiêm trọng | Việc phải làm |
|---|---|---|---|
| 1 | **Cổng 3000 lộ HTTP thuần ra internet** | Chính `docker-compose.prod.yml` dòng 92 ghi chú điều này. ID token Firebase, access token và ảnh khuôn mặt đi không mã hoá — bắt được gói tin là mạo danh được bất kỳ ai | [§7](#7-nginx--https--cloudflare) |
| 2 | **Migration phụ thuộc mạng npm mỗi lần khởi động** | `command: npx prisma migrate deploy` chạy trong image cài `--omit=dev`, không có Prisma CLI, nên `npx` tải lại từ registry mỗi lần container lên. Mất mạng ra npm là **api không khởi động được** | Chuyển `prisma` sang `dependencies` trong `package.json`, hoặc tách một service `migrate` build từ stage `builder` (`target: builder`) và cho `api` `depends_on: {migrate: {condition: service_completed_successfully}}` |
| 3 | **Không có service `ai-server`** | `AI_SERVER_URL` là biến bắt buộc ở production. Khai bừa một URL không tồn tại thì `api` khởi động được nhưng **mọi lượt chấm công đều lỗi** | [§6](#6-deploy-ai-server) |
| 4 | ~~`docs/DEPLOY.md` được dẫn chiếu nhưng không tồn tại~~ | **Đã sửa.** Ba chỗ (`deploy-backend.yml` dòng 5 và 55, `docker-compose.prod.yml` dòng 5 và 92) giờ trỏ về tài liệu này | — |
| 5 | **AI Server đang `ENGINE=stub`** | Nhận diện khuôn mặt trả **dữ liệu bịa**. Hệ thống chạy trơn tru mà kết quả hoàn toàn vô nghĩa | `python scripts/download_models.py` lấy `buffalo_l`, `python scripts/convert_anti_spoof.py` cho model chống giả mạo, rồi đặt `ENGINE=insightface` |
| 6 | **Ngưỡng FAR/FRR chưa hiệu chỉnh** | Ngưỡng khớp mặt đang là giá trị mặc định, chưa đo trên dữ liệu thật | Thu thập tập ảnh mẫu, chốt `face_match_threshold` / `liveness_threshold` theo từng công ty |
| 7 | **Row-Level Security chưa bật** | Cách ly dữ liệu giữa các công ty hiện chỉ dựa vào điều kiện `companyId` ở tầng ứng dụng (`BR-09`). Sót một query là rò rỉ dữ liệu chéo khách hàng | Bật RLS trong `prisma/sql/01_immutability_and_rls.sql` và kiểm thử |
| 8 | **`prisma/sql/02_partitioning.sql` chưa được áp** | `db:guards` **không** chạy file này. `attendance_log` không phân vùng sẽ chậm dần theo thời gian | Áp thủ công trước khi dữ liệu lớn: `dc exec api npx prisma db execute --schema prisma/schema.prisma --file prisma/sql/02_partitioning.sql` |
| 9 | **Chưa có test gate trong CI** | Workflow chỉ deploy, không chạy `typecheck` / `test` / `test:e2e`. Không có cổng chặn nào giữa `git push` và production | Thêm job `test` chạy trước job `deploy`, `needs: test` |

---

## Đọc thêm

| Tài liệu | Nội dung liên quan |
|---|---|
| `server-backend-smart/.env.example` | Chú thích đầy đủ từng biến môi trường (7 KB) |
| `server-backend-smart/README.md` mục 4, 7, 8 | Hai chốt mạng, vận hành API/worker, bảng blocker go-live |
| `server-ai-smart/README.md` mục 8 | Tải và chuyển đổi model thật |
| `server-backend-smart/docs/r2-lifecycle.md` | Quy tắc vòng đời từng prefix trên object storage |
| [02-kien-truc-he-thong.md](./02-kien-truc-he-thong.md) mục 12 | Định hướng môi trường, tách pod API/worker, CI/CD |
| [09-yeu-cau-phi-chuc-nang.md](./09-yeu-cau-phi-chuc-nang.md) | Checklist go-live, các mã `NFR-*` nhắc tới ở đây |
| [06-anti-fraud.md](./06-anti-fraud.md) | `AF-02b` (chốt IP), `AF-12` (chữ ký HMAC), `AF-13` (rate limit) |
| [17-tai-khoan-test.md](./17-tai-khoan-test.md) | Tài khoản seed, dùng để kiểm chứng sau khi deploy |
