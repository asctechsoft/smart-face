"""Chuỗi truy vết và envelope lỗi ở tầng HTTP.

Hai thứ được canh ở đây, cả hai đều là khoảng trống thật của bản trước:

1. **`NFR-AUD-02` — nối được log AI với bản ghi ở Backend.** Trước đây AI Server
   không đọc header truy vết nào, nên một dòng log AI không cách gì ghép với
   lượt chấm công đã sinh ra nó.

2. **Lỗi HTTP phải có mã.** 401/422/500 chỉ trả `{"detail": "..."}`, nên Backend
   gộp tất cả thành `SYS_AI_UNAVAILABLE` — một lỗi lập trình (thiếu `namespace`)
   bị báo cho vận hành là "AI Server sập" và còn tính vào circuit breaker.
"""

from __future__ import annotations

from app.correlation import CORRELATION_HEADER, TRACE_HEADER
from app.errors import AI_BAD_REQUEST, AI_UNAUTHORIZED


class TestCorrelationId:
    def test_tra_lai_dung_correlation_id_da_gui(self, client, auth_headers):
        headers = {**auth_headers, CORRELATION_HEADER: "corr-abc-123"}
        response = client.get("/v1/index/stats", headers=headers)

        assert response.status_code == 200
        assert response.headers[CORRELATION_HEADER] == "corr-abc-123"

    def test_nhan_ca_X_Trace_Id_de_tuong_thich(self, client, auth_headers):
        headers = {**auth_headers, TRACE_HEADER: "trace-xyz"}
        response = client.get("/v1/index/stats", headers=headers)

        assert response.headers[CORRELATION_HEADER] == "trace-xyz"

    def test_khong_gui_thi_tu_sinh_chu_khong_de_trong(self, client, auth_headers):
        response = client.get("/v1/index/stats", headers=auth_headers)

        value = response.headers[CORRELATION_HEADER]
        assert value.startswith("ai-")
        assert len(value) > 3

    def test_id_qua_dai_bi_cat_ngan(self, client, auth_headers):
        headers = {**auth_headers, CORRELATION_HEADER: "x" * 500}
        response = client.get("/v1/index/stats", headers=headers)

        assert len(response.headers[CORRELATION_HEADER]) == 64

    def test_endpoint_khong_can_key_cung_co_correlation_id(self, client):
        response = client.get("/health")

        assert response.status_code == 200
        assert CORRELATION_HEADER in response.headers


class TestErrorEnvelope:
    def test_401_mang_ma_loi_chu_khong_chi_chuoi_mo_ta(self, client):
        response = client.post("/v1/verify", json={}, headers={"X-Internal-Key": "sai-khoa"})

        assert response.status_code == 401
        assert response.json()["detail"]["code"] == AI_UNAUTHORIZED

    def test_422_mang_ma_loi_va_van_khong_vong_lai_body(self, client, auth_headers):
        # Thiếu `namespace` khi dùng `scope_ids` — lỗi lập trình, không phải sự cố.
        response = client.post(
            "/v1/identify",
            json={"image_base64": "khong-phai-anh", "scope_ids": ["cmp_1"]},
            headers=auth_headers,
        )

        assert response.status_code == 422
        detail = response.json()["detail"]
        assert detail["code"] == AI_BAD_REQUEST
        # NFR-OBS-08: vẫn không được vọng lại nội dung request.
        assert "input" not in str(detail)
        assert "khong-phai-anh" not in str(detail)

    def test_ma_HTTP_khong_lan_sang_nhom_ma_anh(self):
        """Mã tầng HTTP KHÔNG được nằm trong `KNOWN_ERROR_CODES`.

        Hai nhóm mã trả lời hai câu hỏi khác nhau: "ảnh có dùng được không" và
        "lời gọi có hợp lệ không". Trộn vào nhau thì `ImageRejectedError` sẽ
        nhận được `AI_BAD_REQUEST` mà không ai chặn, và Backend đọc ra một mã nó
        không có trong `AI_ERROR_MAP`.
        """
        from app.errors import AI_INTERNAL_ERROR, KNOWN_ERROR_CODES

        assert AI_UNAUTHORIZED not in KNOWN_ERROR_CODES
        assert AI_BAD_REQUEST not in KNOWN_ERROR_CODES
        assert AI_INTERNAL_ERROR not in KNOWN_ERROR_CODES
