"""Kiểm chứng hợp đồng với Backend — docs/08 mục 8.

Test ở đây FAIL nghĩa là Backend sẽ không đọc được phản hồi. Đây là ranh giới
giữa hai service viết bằng hai ngôn ngữ khác nhau: không có trình biên dịch nào
bắt được lỗi lệch hợp đồng, chỉ có test này.
"""

from __future__ import annotations

import pytest

from .conftest import make_image

# ---------------------------------------------------------------------------
#  Nguyên tắc P3 — AI Server không ra quyết định nghiệp vụ
# ---------------------------------------------------------------------------

DECISION_FIELDS = {"accepted", "passed", "verified", "is_match", "matched", "decision", "allowed"}


def test_khong_endpoint_nao_tra_ve_quyet_dinh_nghiep_vu(client, auth_headers, image_b64):
    """Vi phạm P3 là lỗi kiến trúc, không phải lỗi nhỏ.

    Nếu AI Server tự kết luận đạt/không đạt thì ngưỡng nằm ở AI Server, và đổi
    ngưỡng cho một công ty sẽ phải deploy lại model.
    """
    responses = [
        client.post("/v1/enroll", json={"image_base64": image_b64}, headers=auth_headers),
        client.post(
            "/v1/verify",
            json={"image_base64": image_b64, "embeddings": [[0.1] * 512]},
            headers=auth_headers,
        ),
        client.post("/v1/liveness", json={"image_base64": image_b64}, headers=auth_headers),
    ]

    for response in responses:
        assert response.status_code == 200
        leaked = DECISION_FIELDS & set(response.json())
        assert not leaked, f"Vi phạm P3: phản hồi chứa trường quyết định {leaked}"


# ---------------------------------------------------------------------------
#  /v1/enroll
# ---------------------------------------------------------------------------


def test_enroll_tra_dung_hinh_dang_tai_lieu_mo_ta(client, auth_headers, image_b64):
    response = client.post(
        "/v1/enroll",
        json={"image_base64": image_b64, "require_liveness": True, "liveness_action": "BLINK"},
        headers=auth_headers,
    )
    assert response.status_code == 200

    body = response.json()
    assert body["face_found"] is True
    assert isinstance(body["processing_ms"], int)
    assert body["model_version"]

    # docs/08: embedding là vector 512 chiều đã L2-normalize.
    embedding = body["embedding"]
    assert len(embedding) == 512
    norm = sum(value * value for value in embedding) ** 0.5
    assert abs(norm - 1.0) < 1e-3, f"Embedding chưa L2-normalize (norm = {norm})"

    for key in ("blur", "brightness", "face_px"):
        assert key in body["quality"]
    assert "score" in body["liveness"]


def test_enroll_nhan_ca_multipart(client, auth_headers):
    """docs/08 ghi multipart, Backend gửi JSON. Phải nhận được cả hai."""
    import cv2

    success, buffer = cv2.imencode(".jpg", make_image(seed=7))
    assert success

    response = client.post(
        "/v1/enroll/multipart",
        files={"image": ("face.jpg", buffer.tobytes(), "image/jpeg")},
        data={"require_liveness": "false"},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json()["face_found"] is True


def test_enroll_nhan_data_uri(client, auth_headers, image_b64):
    """App gửi ảnh từ canvas thường kèm tiền tố `data:image/jpeg;base64,`."""
    response = client.post(
        "/v1/enroll",
        json={"image_base64": f"data:image/jpeg;base64,{image_b64}"},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json()["face_found"] is True


# ---------------------------------------------------------------------------
#  /v1/verify
# ---------------------------------------------------------------------------


def test_verify_tra_best_score_va_toan_bo_scores(client, auth_headers, image_b64):
    enrolled = client.post(
        "/v1/enroll", json={"image_base64": image_b64}, headers=auth_headers
    ).json()["embedding"]

    response = client.post(
        "/v1/verify",
        json={
            "image_base64": image_b64,
            "embeddings": [enrolled, [0.0] * 511 + [1.0]],
            "require_liveness": True,
            "liveness_action": "TURN_LEFT",
        },
        headers=auth_headers,
    )
    assert response.status_code == 200

    body = response.json()
    match = body["match"]
    assert len(match["scores"]) == 2
    assert match["best_score"] == max(match["scores"])

    # Engine giả cho embedding tất định theo nội dung ảnh: cùng ảnh phải khớp gần 1.
    assert match["best_score"] > 0.99


def test_verify_cung_nguoi_khac_anh_thi_diem_thap_voi_engine_gia(
    client, auth_headers, image_b64, other_image_b64
):
    """Ghi lại giới hạn của engine giả để không ai hiểu nhầm.

    Engine giả sinh embedding từ băm nội dung ảnh, nên hai ảnh khác nhau luôn
    cho điểm gần 0 kể cả khi là cùng một người. KHÔNG dùng engine giả để đánh
    giá độ chính xác.
    """
    enrolled = client.post(
        "/v1/enroll", json={"image_base64": image_b64}, headers=auth_headers
    ).json()["embedding"]

    response = client.post(
        "/v1/verify",
        json={"image_base64": other_image_b64, "embeddings": [enrolled]},
        headers=auth_headers,
    )
    assert abs(response.json()["match"]["best_score"]) < 0.3


def test_verify_bat_buoc_co_embeddings(client, auth_headers, image_b64):
    response = client.post(
        "/v1/verify",
        json={"image_base64": image_b64, "embeddings": []},
        headers=auth_headers,
    )
    assert response.status_code == 422


# ---------------------------------------------------------------------------
#  /v1/identify
# ---------------------------------------------------------------------------


def test_identify_tra_margin(client, auth_headers, image_b64, other_image_b64):
    first = client.post(
        "/v1/enroll", json={"image_base64": image_b64}, headers=auth_headers
    ).json()["embedding"]
    second = client.post(
        "/v1/enroll", json={"image_base64": other_image_b64}, headers=auth_headers
    ).json()["embedding"]

    response = client.post(
        "/v1/identify",
        json={
            "image_base64": image_b64,
            "candidates": [
                {"employee_id": "emp_a", "embeddings": [first]},
                {"employee_id": "emp_b", "embeddings": [second]},
            ],
            "top_k": 5,
        },
        headers=auth_headers,
    )
    assert response.status_code == 200

    body = response.json()
    assert body["matches"][0]["employee_id"] == "emp_a"
    assert body["margin"] is not None
    assert body["margin"] > 0.5


def test_identify_tu_choi_khi_thieu_ca_candidates_lan_scope_ids(client, auth_headers, image_b64):
    response = client.post(
        "/v1/identify", json={"image_base64": image_b64}, headers=auth_headers
    )
    assert response.status_code == 422


def test_identify_bat_buoc_namespace_khi_dung_scope_ids(client, auth_headers, image_b64):
    """ADR-05 — không có namespace thì không bảo đảm được cách ly tenant."""
    response = client.post(
        "/v1/identify",
        json={"image_base64": image_b64, "scope_ids": ["emp_a", "emp_b"]},
        headers=auth_headers,
    )
    assert response.status_code == 422


# ---------------------------------------------------------------------------
#  Chỉ mục 1:N và cách ly tenant
# ---------------------------------------------------------------------------


def test_chi_muc_khong_tra_ket_qua_xuyen_namespace(client, auth_headers, image_b64):
    """ADR-05 — nhân viên công ty A không được nhận diện trong phạm vi công ty B."""
    embedding = client.post(
        "/v1/enroll", json={"image_base64": image_b64}, headers=auth_headers
    ).json()["embedding"]

    client.post(
        "/v1/index/upsert",
        json={"namespace": "company_a", "entries": [{"employee_id": "nv_1", "embeddings": [embedding]}]},
        headers=auth_headers,
    )

    response = client.post(
        "/v1/identify",
        json={
            "image_base64": image_b64,
            "scope_ids": ["nv_1"],
            "namespace": "company_b",
        },
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json()["matches"] == []


def test_chi_muc_tim_duoc_trong_dung_namespace(client, auth_headers, image_b64):
    embedding = client.post(
        "/v1/enroll", json={"image_base64": image_b64}, headers=auth_headers
    ).json()["embedding"]

    client.post(
        "/v1/index/upsert",
        json={"namespace": "company_c", "entries": [{"employee_id": "nv_9", "embeddings": [embedding]}]},
        headers=auth_headers,
    )

    response = client.post(
        "/v1/identify",
        json={"image_base64": image_b64, "scope_ids": ["nv_9"], "namespace": "company_c"},
        headers=auth_headers,
    )
    matches = response.json()["matches"]
    assert matches[0]["employee_id"] == "nv_9"
    assert matches[0]["score"] > 0.99


# ---------------------------------------------------------------------------
#  /v1/batch/audit
# ---------------------------------------------------------------------------


def test_batch_audit_giu_nguyen_ref_id(client, auth_headers, image_b64, other_image_b64):
    """`ref_id` là attendance_log.id. Lệch thứ tự = gắn cờ nhầm người."""
    embedding = client.post(
        "/v1/enroll", json={"image_base64": image_b64}, headers=auth_headers
    ).json()["embedding"]

    response = client.post(
        "/v1/batch/audit",
        json={
            "items": [
                {"ref_id": "log_1", "image_base64": image_b64, "embeddings": [embedding]},
                {"ref_id": "log_2", "image_base64": other_image_b64, "embeddings": [embedding]},
            ]
        },
        headers=auth_headers,
    )
    assert response.status_code == 200

    results = response.json()["results"]
    assert [item["ref_id"] for item in results] == ["log_1", "log_2"]
    assert results[0]["best_score"] > results[1]["best_score"]


# ---------------------------------------------------------------------------
#  Ảnh hỏng
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "payload",
    ["", "khong-phai-base64!!!", "aGVsbG8gd29ybGQ="],
    ids=["rong", "base64-sai", "khong-phai-anh"],
)
def test_anh_hong_tra_200_kem_error_code_chu_khong_phai_500(client, auth_headers, payload):
    """Backend cần đọc được `error_code` để hiển thị hướng dẫn cụ thể.

    Trả 5xx còn làm circuit breaker phía Backend hiểu nhầm là AI Server chết,
    rồi chặn luôn cả những người chấm công bình thường.
    """
    response = client.post("/v1/enroll", json={"image_base64": payload}, headers=auth_headers)

    assert response.status_code == 200
    body = response.json()
    assert body["face_found"] is False
    assert body["error_code"] == "FACE_NOT_FOUND"


def test_moi_ma_loi_deu_co_trong_bang_anh_xa_cua_backend():
    """Mã lỗi không có trong AI_ERROR_MAP sẽ bị Backend hiểu nhầm thành FACE_NOT_FOUND."""
    from app.errors import KNOWN_ERROR_CODES

    # Sao chép từ server-backend-smart/src/modules/ai-gateway/ai-gateway.types.ts
    backend_map = {
        "FACE_NOT_FOUND",
        "MULTIPLE_FACES",
        "FACE_MULTIPLE",
        "IMG_TOO_DARK",
        "IMG_BACKLIT",
        "IMG_BLURRY",
        "FACE_TOO_SMALL",
        "BAD_ANGLE",
        "MASK_DETECTED",
        "FACE_OCCLUDED",
        "LIVENESS_FAILED",
    }
    assert backend_map >= KNOWN_ERROR_CODES


# ---------------------------------------------------------------------------
#  /health và /metrics
# ---------------------------------------------------------------------------


def test_health_bao_degraded_khi_dang_chay_engine_gia(client):
    """Người vận hành phải nhìn thấy ngay, chứ không phải phát hiện khi có sự cố."""
    body = client.get("/health").json()

    assert body["engine"] == "stub"
    assert body["status"] == "degraded"
    assert body["model"]["name"]
    assert isinstance(body["uptime_seconds"], int)


def test_health_va_metrics_khong_can_internal_key(client):
    """Probe của Kubernetes và scraper của Prometheus không mang được khoá."""
    assert client.get("/health").status_code == 200
    assert client.get("/metrics").status_code == 200


def test_metrics_dung_dinh_dang_prometheus(client):
    response = client.get("/metrics")
    assert "ai_inference_seconds" in response.text
    assert "ai_requests_total" in response.text
