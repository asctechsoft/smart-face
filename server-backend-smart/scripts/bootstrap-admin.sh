#!/usr/bin/env bash
# ============================================================================
#  Tạo tài khoản Quản trị nền tảng ĐẦU TIÊN — chạy MỘT LẦN trên VPS.
#
#  Cách dùng (trong thư mục server-backend-smart, khi api đã chạy):
#      bash scripts/bootstrap-admin.sh
#
#  Vì sao không làm trên web (/khoi-tao-nen-tang): endpoint này mở cho bất kỳ
#  ai, chỉ khoá lại SAU khi đã có quản trị viên đầu tiên. Làm trên web thì
#  trong khoảng từ lúc bật web tới lúc bạn bấm tạo, người lạ biết đường dẫn có
#  thể chiếm tài khoản đó trước. Script này gọi api qua 127.0.0.1 — chạy nó
#  TRƯỚC khi bật service `web` thì không có khoảng hở nào.
#
#  Mật khẩu nhập ẩn, không nằm trong lịch sử lệnh, không nằm trong tham số
#  tiến trình (ai chạy `ps` cũng không thấy).
# ============================================================================
set -euo pipefail

API="${API_URL:-http://127.0.0.1:3000}"

if ! curl -fsS "$API/health" > /dev/null 2>&1; then
  echo "Không gọi được api tại $API/health." >&2
  echo "Kiểm tra: docker compose -f docker-compose.prod.yml ps" >&2
  exit 1
fi

echo "Tạo tài khoản Quản trị nền tảng đầu tiên."
echo "Mật khẩu: tối thiểu 8 ký tự, có cả chữ HOA lẫn chữ thường, có ít nhất một chữ số"
echo "hoặc ký tự đặc biệt, không chứa phần đầu địa chỉ email."
echo
read -rp "Họ và tên:        " FULL_NAME
read -rp "Email đăng nhập:  " EMAIL
read -rp "Số điện thoại:    " PHONE
read -rsp "Mật khẩu:         " PASSWORD
echo
read -rsp "Nhập lại mật khẩu: " PASSWORD_AGAIN
echo

if [ "$PASSWORD" != "$PASSWORD_AGAIN" ]; then
  echo "Hai lần nhập mật khẩu không khớp. Chạy lại script." >&2
  exit 1
fi

# python3 dựng JSON để tên có dấu, dấu nháy hay ký tự đặc biệt trong mật khẩu
# không làm vỡ request.
BODY="$(FULL_NAME="$FULL_NAME" EMAIL="$EMAIL" PHONE="$PHONE" PASSWORD="$PASSWORD" python3 -c '
import json, os
print(json.dumps({
    "fullName": os.environ["FULL_NAME"].strip(),
    "email": os.environ["EMAIL"].strip(),
    "phone": os.environ["PHONE"].strip(),
    "password": os.environ["PASSWORD"],
}))')"

RESPONSE="$(curl -sS -X POST "$API/v1/platform/bootstrap" \
  -H 'Content-Type: application/json' \
  --data-binary @- <<< "$BODY")"

RESPONSE="$RESPONSE" python3 - <<'PY'
import json
import os
import sys

raw = os.environ["RESPONSE"]
try:
    body = json.loads(raw)
except json.JSONDecodeError:
    sys.exit(f"api trả về dữ liệu không đọc được:\n{raw}")

if body.get("success"):
    data = body.get("data", {})
    print()
    print(f"ĐÃ TẠO quản trị viên: {data.get('fullName')} <{data.get('email')}>")
    print("Đăng nhập trên web bằng email và mật khẩu vừa đặt.")
    sys.exit(0)

error = body.get("error", {})
print()
print(f"KHÔNG TẠO ĐƯỢC — {error.get('code', '?')}: {error.get('message', raw)}", file=sys.stderr)
if error.get("hint"):
    print(f"Gợi ý: {error['hint']}", file=sys.stderr)
if error.get("details"):
    print(f"Chi tiết: {json.dumps(error['details'], ensure_ascii=False)}", file=sys.stderr)
sys.exit(1)
PY
