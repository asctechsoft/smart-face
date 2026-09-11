#!/usr/bin/env bash
# ============================================================================
#  Chuyển từ chế độ "backend trước" sang chế độ ĐẦY ĐỦ khi đã có tên miền.
#
#  Cách dùng (trên VPS, trong thư mục server-backend-smart):
#      bash scripts/enable-domain.sh <ten-mien>
#  Ví dụ:
#      bash scripts/enable-domain.sh smartface.congty.vn
#
#  Đổi đúng 5 dòng trong .env, cùng một lúc:
#      COMPOSE_PROFILES=web   API_BIND=127.0.0.1   TRUSTED_PROXY_HOPS=2
#      CORS_ORIGINS=https://<ten-mien>   WEB_BASE_URL=https://<ten-mien>
#  Ba dòng đầu mà lệch nhau là hỏng chốt IP văn phòng (AF-02b) — nên không sửa tay.
#
#  Mọi dòng khác (mật khẩu, khoá) giữ nguyên.
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  echo "Cách dùng: bash scripts/enable-domain.sh <ten-mien>" >&2
  exit 1
fi
DOMAIN="${DOMAIN#http://}"
DOMAIN="${DOMAIN#https://}"
DOMAIN="${DOMAIN%%/*}"

if [ ! -f .env ]; then
  echo "Chưa có .env — chế độ đầy đủ tạo bằng: bash scripts/init-prod-env.sh $DOMAIN <file-firebase.json>" >&2
  exit 1
fi

# Kiểm trước những thứ mà thiếu thì web chắc chắn hỏng, thay vì để nginx
# khởi động lại liên tục hoặc bản build giao diện dừng giữa chừng.
problems=()
[ -s certs/origin.pem ] || problems+=("thiếu certs/origin.pem (chứng chỉ Origin của Cloudflare — docs/23 A5, E4)")
[ -s certs/origin.key ] || problems+=("thiếu certs/origin.key")
grep -qE '^VITE_FIREBASE_API_KEY=.+' .env || problems+=("VITE_FIREBASE_API_KEY trong .env đang trống (docs/23 B2, E3)")
grep -qE '^VITE_FIREBASE_AUTH_DOMAIN=.+' .env || problems+=("VITE_FIREBASE_AUTH_DOMAIN trong .env đang trống")
if [ ${#problems[@]} -gt 0 ]; then
  echo "Chưa chuyển được — còn thiếu:" >&2
  printf '  - %s\n' "${problems[@]}" >&2
  exit 1
fi

DOMAIN="$DOMAIN" python3 - <<'PY'
import os
import sys

domain = os.environ['DOMAIN']
new = {
    'COMPOSE_PROFILES': 'web',
    'API_BIND': '127.0.0.1',
    'TRUSTED_PROXY_HOPS': '2',
    'CORS_ORIGINS': f'https://{domain}',
    'WEB_BASE_URL': f'https://{domain}',
}

with open('.env', encoding='utf-8') as f:
    lines = f.read().splitlines()

seen = set()
out = []
for line in lines:
    key = line.split('=', 1)[0] if '=' in line and not line.lstrip().startswith('#') else None
    if key in new:
        out.append(f'{key}={new[key]}')
        seen.add(key)
    else:
        out.append(line)
# .env tạo từ bản mẫu cũ có thể chưa có COMPOSE_PROFILES / API_BIND — thêm vào cuối.
for key in new:
    if key not in seen:
        out.append(f'{key}={new[key]}')

with open('.env', 'w', encoding='utf-8', newline='\n') as f:
    f.write('\n'.join(out) + '\n')
PY

echo "Đã chuyển .env sang chế độ đầy đủ cho https://$DOMAIN"
echo "  COMPOSE_PROFILES=web  API_BIND=127.0.0.1  TRUSTED_PROXY_HOPS=2"
echo
echo "Bước tiếp theo:"
echo "  docker compose -f docker-compose.prod.yml up -d --build"
echo "  → api đóng cổng 3000 khỏi internet, web (nginx) mở 80/443."
echo "  Nhớ báo đội app đổi địa chỉ API sang https://$DOMAIN/v1"
