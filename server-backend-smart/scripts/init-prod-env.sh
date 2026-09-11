#!/usr/bin/env bash
# ============================================================================
#  Tạo file .env production cho server-backend-smart — chạy MỘT LẦN trên VPS.
#
#  Cách dùng (trong thư mục server-backend-smart):
#      bash scripts/init-prod-env.sh <ten-mien> <file-firebase-admin.json>
#  Ví dụ:
#      bash scripts/init-prod-env.sh smartface.congty.vn /root/firebase-admin.json
#
#  Chưa có tên miền, muốn chạy backend trước (docs/23 phụ lục 4):
#      bash scripts/init-prod-env.sh --backend-truoc /root/firebase-admin.json
#  Có tên miền rồi thì chuyển sang chế độ đầy đủ bằng scripts/enable-domain.sh.
#
#  Script làm:
#    - chép .env.production.example thành .env, quyền 600 (chỉ root đọc được)
#    - sinh ngẫu nhiên mật khẩu Postgres, Redis, khoá nội bộ AI Server
#    - sinh cặp khoá JWT RS256
#    - điền FIREBASE_PROJECT_ID / CLIENT_EMAIL / PRIVATE_KEY từ file JSON
#    - điền CORS_ORIGINS, WEB_BASE_URL, VITE_FIREBASE_AUTH_DOMAIN
#
#  Dán khoá PEM nhiều dòng vào .env bằng tay là chỗ sai nhiều nhất khi deploy:
#  thiếu một `\n` hay một dấu nháy là api chết với lỗi khó hiểu. Script làm hộ.
#
#  KHÔNG BAO GIỜ ghi đè .env đã có: Postgres chỉ nhận mật khẩu lần đầu, sinh
#  mật khẩu mới đè lên là api mất kết nối DB.
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

DOMAIN="${1:-}"
FIREBASE_JSON="${2:-}"

if [ -z "$DOMAIN" ] || [ -z "$FIREBASE_JSON" ]; then
  echo "Cách dùng: bash scripts/init-prod-env.sh <ten-mien> <file-firebase-admin.json>" >&2
  echo "Ví dụ:     bash scripts/init-prod-env.sh smartface.congty.vn /root/firebase-admin.json" >&2
  echo "Chưa có tên miền: bash scripts/init-prod-env.sh --backend-truoc /root/firebase-admin.json" >&2
  exit 1
fi

MODE=full
if [ "$DOMAIN" = "--backend-truoc" ]; then
  MODE=backend
  DOMAIN=""
fi
if [ ! -f "$FIREBASE_JSON" ]; then
  echo "Không thấy file $FIREBASE_JSON — đã chép file JSON của Firebase lên VPS chưa?" >&2
  exit 1
fi
if [ -e .env ]; then
  echo "Đã có file .env — script không ghi đè để giữ nguyên mật khẩu Postgres." >&2
  echo "Chỉ muốn sửa vài dòng thì dùng: nano .env" >&2
  exit 1
fi
for tool in openssl python3; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Thiếu $tool. Cài bằng: apt install -y $tool" >&2
    exit 1
  fi
done

# Người dùng hay dán cả URL — chỉ giữ lại tên miền.
DOMAIN="${DOMAIN#http://}"
DOMAIN="${DOMAIN#https://}"
DOMAIN="${DOMAIN%%/*}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$TMP/jwt.key" 2>/dev/null
openssl pkey -in "$TMP/jwt.key" -pubout -out "$TMP/jwt.pub" 2>/dev/null

# .env tạo ra với quyền 600 ngay từ đầu, không có khoảnh khắc nào người khác đọc được.
umask 077

MODE="$MODE" DOMAIN="$DOMAIN" FIREBASE_JSON="$FIREBASE_JSON" KEY_DIR="$TMP" python3 - <<'PY'
import json
import os
import secrets
import sys


def one_line(pem: str) -> str:
    """PEM nhiều dòng → một dòng có `\\n`, bọc nháy kép (Backend tự khôi phục)."""
    return '"' + pem.strip().replace('\n', '\\n') + '\\n"'


try:
    with open(os.environ['FIREBASE_JSON'], encoding='utf-8') as f:
        firebase = json.load(f)
except (OSError, json.JSONDecodeError) as error:
    sys.exit(f'Không đọc được file JSON của Firebase: {error}')

missing = [k for k in ('project_id', 'client_email', 'private_key') if not firebase.get(k)]
if missing or firebase.get('type') != 'service_account':
    sys.exit(
        'File JSON không phải khoá service account (thiếu: ' + ', '.join(missing or ['type']) + ').\n'
        'Lấy đúng file ở Firebase Console → ⚙ Project settings → Service accounts → '
        'Generate new private key.'
    )

key_dir = os.environ['KEY_DIR']
with open(f'{key_dir}/jwt.key', encoding='utf-8') as f:
    jwt_private = f.read()
with open(f'{key_dir}/jwt.pub', encoding='utf-8') as f:
    jwt_public = f.read()

domain = os.environ['DOMAIN']
if os.environ['MODE'] == 'backend':
    # Ba dòng đầu phải đi CÙNG NHAU: mở cổng api mà vẫn tin 2 proxy thì ai cũng
    # tự khai được IP văn phòng. Giai đoạn này không có web production nên
    # CORS chỉ mở cho web chạy trên máy lập trình viên.
    mode_values = {
        'COMPOSE_PROFILES': '',
        'API_BIND': '0.0.0.0',
        'TRUSTED_PROXY_HOPS': '0',
        'CORS_ORIGINS': 'http://localhost:5173',
        'WEB_BASE_URL': '',
    }
else:
    mode_values = {
        'COMPOSE_PROFILES': 'web',
        'API_BIND': '127.0.0.1',
        'TRUSTED_PROXY_HOPS': '2',
        'CORS_ORIGINS': f'https://{domain}',
        'WEB_BASE_URL': f'https://{domain}',
    }

values = {
    **mode_values,
    'POSTGRES_PASSWORD': secrets.token_hex(24),
    'REDIS_PASSWORD': secrets.token_hex(24),
    'AI_SERVER_INTERNAL_KEY': secrets.token_hex(32),
    'JWT_PRIVATE_KEY': one_line(jwt_private),
    'JWT_PUBLIC_KEY': one_line(jwt_public),
    'FIREBASE_PROJECT_ID': firebase['project_id'],
    'FIREBASE_CLIENT_EMAIL': firebase['client_email'],
    'FIREBASE_PRIVATE_KEY': one_line(firebase['private_key']),
    'VITE_FIREBASE_AUTH_DOMAIN': f"{firebase['project_id']}.firebaseapp.com",
}

with open('.env.production.example', encoding='utf-8') as f:
    lines = f.read().splitlines()

written = set()
output = []
for line in lines:
    key = line.split('=', 1)[0] if '=' in line and not line.lstrip().startswith('#') else None
    if key in values:
        output.append(f'{key}={values[key]}')
        written.add(key)
    else:
        output.append(line)

# Mẫu và script lệch nhau thì dừng, không để lại một .env thiếu nửa.
not_found = sorted(set(values) - written)
if not_found:
    sys.exit('.env.production.example thiếu dòng: ' + ', '.join(not_found))

with open('.env', 'x', encoding='utf-8', newline='\n') as f:
    f.write('\n'.join(output) + '\n')

print(f"Dự án Firebase: {firebase['project_id']}")
PY

echo
echo "Đã tạo $(pwd)/.env (quyền 600)."
if [ "$MODE" = backend ]; then
  echo "  Chế độ:              BACKEND TRƯỚC — api mở HTTP ở cổng 3000, chưa có web"
  echo "                       Chỉ dùng dữ liệu thử. Có tên miền: bash scripts/enable-domain.sh <ten-mien>"
else
  echo "  Tên miền:            https://$DOMAIN"
fi
echo "  Đã tự sinh:          mật khẩu Postgres, Redis, khoá AI Server, cặp khoá JWT"
echo
echo "Còn phải điền tay (mở bằng: nano .env):"
echo "  FIREBASE_STORAGE_BUCKET  — kiểm tra tên bucket (xem ghi chú trong file)"
if [ "$MODE" = full ]; then
  echo "  VITE_FIREBASE_API_KEY    — bắt buộc"
  echo "  VITE_FIREBASE_APP_ID     — nên có"
fi
echo "  SMS_*                    — khi có nhà cung cấp SMS"
