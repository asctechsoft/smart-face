# AI Server — dịch vụ nhận diện khuôn mặt

Service Python độc lập, chỉ nhận request từ Backend Core trong mạng nội bộ.

> Tài liệu gốc: [ADR-01](../docs/02-kien-truc-he-thong.md#adr-01--tách-ai-server-thành-service-python-độc-lập) ·
> [Thiết kế AI Server](../docs/02-kien-truc-he-thong.md#6-ai-server--thiết-kế) ·
> [Hợp đồng API](../docs/08-hop-dong-api.md#8-api-ai-server-nội-bộ) ·
> [Cách chấm công hoạt động](../docs/11-cach-hoat-dong-cham-cong-mat-va-van-tay.md)
>
> 👉 **Chưa hình dung được service này nằm ở đâu trong luồng chấm công?** Đọc
> [12 — Một lượt chấm công đi qua những đâu](../docs/12-luong-cham-cong-chi-tiet.md)
> trước: nó thuật lại toàn bộ đường đi App → Backend → AI Server kèm payload thật
> ở từng chặng.

---

## Mục lục

1. [Vì sao tách riêng khỏi Backend](#1-vì-sao-tách-riêng-khỏi-backend)
2. [Ranh giới trách nhiệm](#2-ranh-giới-trách-nhiệm--nguyên-tắc-p3)
3. [Chạy thử](#3-chạy-thử)
4. [Cấu trúc thư mục](#4-cấu-trúc-thư-mục)
5. [API](#5-api)
6. [Những điều không được vi phạm](#6-những-điều-không-được-vi-phạm)
7. [Vận hành](#7-vận-hành)
8. [Việc còn lại trước khi go-live](#8-việc-còn-lại-trước-khi-go-live)

---

## 1. Vì sao tách riêng khỏi Backend

Câu hỏi hợp lý: Backend đã viết bằng NestJS, sao không nhúng luôn nhận diện
khuôn mặt vào đó cho gọn?

`ADR-01` đưa ra năm lý do:

| Lý do | Ý nghĩa thực tế |
|---|---|
| Hệ sinh thái Python mạnh hơn hẳn | InsightFace/ArcFace, RetinaFace, MiniFASNet, OpenCV đều là Python. Thư viện Node tương đương đã ngừng bảo trì |
| AI ngốn GPU, Backend ngốn I/O | Scale độc lập: 2 node GPU cho AI, 6 pod CPU cho Backend |
| Model chiếm vài trăm MB RAM, nạp mất vài giây | Cần process sống dai giữ model |
| Model crash không kéo sập nghiệp vụ | Segfault trong thư viện native sẽ giết cả process Node, kéo theo tính lương và duyệt đơn đang chạy dở |
| Thay model không cần deploy lại Backend | Nâng version ArcFace mà không đụng vào code lương |

Lý do kỹ thuật nặng nhất nằm ở **bước căn chỉnh khuôn mặt**: xoay và co giãn
ảnh về đúng tư thế chuẩn 112×112 theo 5 điểm mốc, đúng như lúc model được huấn
luyện. Sai ở bước này **không báo lỗi** — nó chỉ làm độ chính xác tụt xuống âm
thầm. Dùng lại đúng hàm căn chỉnh đi kèm model là cách duy nhất chắc chắn không
sai, và hàm đó chỉ có trong hệ sinh thái Python.

**Cái giá phải trả:** thêm một service để vận hành, phải định nghĩa hợp đồng API
rõ ràng, phải xử lý timeout và circuit breaker phía Backend. Ba việc đó đã làm
xong: hợp đồng ở `docs/08` mục 8, circuit breaker ở
`server-backend-smart/src/modules/ai-gateway/ai-gateway.service.ts`.

---

## 2. Ranh giới trách nhiệm — nguyên tắc P3

**AI Server trả số liệu. Backend ra quyết định.**

```
                    ┌──────────────────────────────────────┐
   Ảnh + embedding  │            AI SERVER                 │
  ────────────────► │                                      │
                    │  Có mặt người không?                 │
                    │  Ảnh có đủ nét, đủ sáng không?       │
                    │  Là người thật hay ảnh in?  → 0.88   │
                    │  Giống người này bao nhiêu? → 0.62   │
                    └───────────────┬──────────────────────┘
                                    │  { best_score: 0.62,
                                    │    liveness: { score: 0.88 } }
                                    ▼
                    ┌──────────────────────────────────────┐
                    │            BACKEND                   │
                    │                                      │
                    │  Ngưỡng của công ty này là bao nhiêu?│
                    │  0.62 ≥ 0.45  → đạt                  │
                    │  0.88 ≥ 0.70  → đạt                  │
                    │  → CHO CHẤM CÔNG                     │
                    └──────────────────────────────────────┘
```

AI Server **không biết ngưỡng là bao nhiêu**, và không được biết. Nhờ vậy:

- Mỗi công ty đặt ngưỡng riêng mà không cần bản model riêng.
- Đổi ngưỡng là đổi một dòng cấu hình, không phải deploy lại model.
- Muốn siết chặt sau một vụ gian lận thì làm được ngay trong ngày.

Có một test canh giữ ranh giới này:
`tests/test_contract.py::test_khong_endpoint_nao_tra_ve_quyet_dinh_nghiep_vu`.
Nó fail nếu ai đó thêm trường `accepted`/`passed`/`verified` vào phản hồi.

### Sàn kỹ thuật khác ngưỡng nghiệp vụ

Chỗ này hay bị lẫn:

| | Ai giữ | Ví dụ | Đổi được không |
|---|---|---|---|
| **Sàn kỹ thuật** | AI Server (`config.py`) | Ảnh tối dưới 35, nhoè dưới 25, mặt nhỏ hơn 48px, nghiêng quá 50° | Hiếm khi cần đổi |
| **Ngưỡng nghiệp vụ** | Backend, theo từng công ty | `face_match_threshold`, `liveness_threshold`, `min_face_pixels`, `maxYawDegrees` | Đổi bất cứ lúc nào |

Sàn kỹ thuật trả lời "ảnh này có dùng được không". Ngưỡng nghiệp vụ trả lời
"có cho chấm công không". Mặt 60px vượt sàn kỹ thuật nên AI Server trả số liệu
bình thường, rồi Backend từ chối vì chính sách công ty đòi tối thiểu 112px.

---

## 3. Chạy thử

### Cách nhanh nhất — engine giả, không cần tải model

Dùng để phát triển App và Backend khi chưa có GPU:

```bash
cd server-ai-smart
python -m venv .venv && .venv/Scripts/activate     # Linux/macOS: source .venv/bin/activate
pip install -r requirements-dev.txt

cp .env.example .env
# Sửa .env:  ENGINE=stub   ALLOW_MISSING_LIVENESS_MODEL=true

uvicorn app.main:app --reload --port 8000
```

Kiểm tra:

```bash
curl http://localhost:8000/health
# → { "status": "degraded", "engine": "stub", ... }
```

`degraded` là đúng — engine giả trả embedding bịa ra từ mã băm của ảnh. Cùng
một ảnh luôn cho cùng một embedding, nên luồng "đăng ký rồi chấm công bằng
chính ảnh đó" chạy thông. **Hai ảnh khác nhau của cùng một người sẽ cho điểm
gần 0** — đừng dùng engine giả để đánh giá độ chính xác.

### Chạy với model thật

```bash
python scripts/download_models.py
# Tự tải buffalo_l. Model chống giả mạo KHÔNG tải tự động được — xem dưới.

# Sửa .env:  ENGINE=insightface   ALLOW_MISSING_LIVENESS_MODEL=false
uvicorn app.main:app --port 8000

curl http://localhost:8000/health
# → { "status": "healthy", "engine": "insightface",
#     "liveness_model": "MiniFASNetV2", ... }
```

### Lấy model chống giả mạo

Không có bước này thì `/health` trả `degraded` và ảnh in ra cũng chấm công được.

```bash
git clone --depth 1 \
    https://github.com/minivision-ai/Silent-Face-Anti-Spoofing /tmp/sfas

python -m venv /tmp/conv
/tmp/conv/Scripts/pip install torch --index-url https://download.pytorch.org/whl/cpu
/tmp/conv/Scripts/pip install onnx onnxruntime numpy

/tmp/conv/Scripts/python scripts/convert_anti_spoof.py --repo /tmp/sfas
```

Ba điều đáng chú ý:

**Vì sao venv riêng.** `torch` cố ý không nằm trong `requirements.txt` — lúc chạy
AI Server chỉ cần `onnxruntime`, thêm torch là kéo theo ~1 GB cho một việc làm
đúng một lần.

**Vì sao tự chuyển đổi thay vì tải ONNX dựng sẵn.** Trên mạng có vài bản ONNX của
model này nhưng không bản nào truy được về checkpoint gốc. Đây là bộ phận quyết
định ảnh in có chấm công được hay không; tin vào một file lạ ở đúng chỗ này là bỏ
trống tuyến phòng thủ mà vẫn tưởng đã dựng xong. Script ghi rõ `sha256` của
checkpoint đã kiểm chứng và cảnh báo nếu nguồn đổi.

**Script tự đối chiếu.** Xuất ONNX thành công KHÔNG có nghĩa là đúng: một toán tử
bị ánh xạ sai vẫn cho ra file hợp lệ, chỉ khác số. Script chạy 20 mẫu qua cả hai
đường PyTorch và ONNX, lệch quá `1e-5` thì xoá file và báo lỗi.

`models/` nằm trong `.gitignore` nên file `.onnx` không vào repo — mỗi môi trường
tự sinh lại bằng lệnh trên.

### Docker

```bash
docker compose up --build              # CPU
docker compose --profile gpu up        # GPU, cần nvidia-container-toolkit
```

### Nối với Backend

Trong `server-backend-smart/.env`:

```
AI_SERVER_URL=http://localhost:8000
AI_SERVER_INTERNAL_KEY=<phải trùng với AI_SERVER_INTERNAL_KEY trong server-ai-smart/.env>
AI_SERVER_TIMEOUT_MS=2000
```

Backend gọi sang bằng `AiGatewayService`, đã có sẵn circuit breaker.

### Chạy test

```bash
pytest -q          # 82 test, chạy bằng engine giả, không cần model
ruff check .
```

---

## 4. Cấu trúc thư mục

```
server-ai-smart/
├── app/
│   ├── main.py            Khởi tạo FastAPI, nạp model lúc khởi động
│   ├── config.py          Cấu hình + chốt chặn không cho cấu hình sai lên production
│   ├── errors.py          Mã lỗi — PHẢI khớp AI_ERROR_MAP của Backend
│   ├── schemas.py         Hợp đồng dữ liệu, khớp ai-gateway.types.ts
│   ├── security.py        Kiểm tra X-Internal-Key
│   ├── service.py         Lớp dùng chung: giải mã ảnh, bắt lỗi, ghi metrics
│   ├── runner.py          Chạy suy luận ngoài event loop, giới hạn đồng thời
│   ├── metrics.py         Prometheus
│   ├── logging_config.py  Lưới chặn không cho ảnh/embedding lọt vào log
│   ├── core/
│   │   ├── engine.py      Pipeline chính + engine giả
│   │   ├── imageio.py     Giải mã base64/binary, chặn ảnh quá lớn
│   │   ├── quality.py     Đo chất lượng, áp sàn kỹ thuật
│   │   ├── liveness.py    Chống giả mạo (MiniFASNet)
│   │   ├── landmarks.py   Xác minh hành động liveness (AF-05)
│   │   ├── matcher.py     Cosine 1:1 và 1:N kèm margin
│   │   └── index.py       Chỉ mục 1:N trong RAM, chia theo company_id
│   └── routers/           Một file một nhóm endpoint
├── scripts/
│   ├── download_models.py      Tải buffalo_l, kiểm tra model chống giả mạo
│   └── convert_anti_spoof.py   MiniFASNet .pth → ONNX (cần venv riêng có torch)
├── tests/                 82 test, chạy được không cần model
├── Dockerfile             Build arg RUNTIME=cpu|gpu
└── docker-compose.yml
```

---

## 5. API

Tất cả endpoint nghiệp vụ đều cần header `X-Internal-Key`. `/health` và
`/metrics` thì không — probe của Kubernetes và scraper của Prometheus không mang
được khoá đó, và hai endpoint này không lộ dữ liệu cá nhân nào.

| Endpoint | Mục đích | Backend đã nối chưa |
|---|---|---|
| `POST /v1/enroll` | Trích embedding từ ảnh đăng ký | ✅ `biometric.service.ts` → `AiGatewayService.enroll()` |
| `POST /v1/enroll/multipart` | Như trên, dạng multipart | ➖ dự phòng, xem ghi chú dưới |
| `POST /v1/verify` | So khớp 1:1 — chấm công qua App | ✅ `attendance.service.ts` → `AiGatewayService.verify()` |
| `POST /v1/identify` | So khớp 1:N — kiosk, kiểm tra trùng danh tính | ⚠ `AiGatewayService.identify()` đã có, **chưa ai gọi** |
| `POST /v1/liveness` | Chỉ kiểm tra người thật | ❌ chưa có method ở `AiGatewayService` |
| `POST /v1/batch/audit` | Đối chiếu hàng loạt hằng đêm (AF-08) | ❌ chưa nối — xem ghi chú 3 |
| `POST /v1/index/upsert` · `remove` · `GET stats` | Nạp chỉ mục 1:N | ❌ chưa nối, giai đoạn kiosk |
| `GET /health` · `GET /metrics` | Giám sát | ✅ `admin.service.ts`, K8s, Prometheus |

Tài liệu tương tác: `http://localhost:8000/docs`.

### Ghi chú: ba chỗ lệch so với tài liệu

**1. Định dạng của `/v1/enroll`.** `docs/08` mô tả `multipart/form-data`, nhưng
`AiGatewayService.enroll()` phía Backend lại gửi JSON `image_base64`. Đây là
lệch pha có sẵn giữa tài liệu và code. Tôi cho AI Server nhận **cả hai** —
`/v1/enroll` nhận JSON (đúng cái Backend đang gửi), `/v1/enroll/multipart` nhận
multipart (đúng cái tài liệu mô tả) — để không bên nào phải sửa.

**2. `/v1/identify` cần embedding, mà `scope_ids` chỉ có định danh.** Tài liệu
mô tả request gửi `scope_ids: ["emp_1", "emp_2"]`. Nhưng AI Server không có cơ
sở dữ liệu, nó không biết `emp_1` có embedding nào. Hai đường đi:

- **`candidates`** — Backend gửi thẳng embedding lên. Dùng được ngay, không cần
  đồng bộ gì. Phù hợp cho tập nhỏ.
- **`scope_ids` + `namespace`** — dùng chỉ mục nạp sẵn qua `/v1/index/*`. Đúng
  như tài liệu mô tả, dành cho kiosk khi tập lớn.

`AiGatewayService.identify()` nhận cả hai đường qua tham số `scope`. `namespace`
**bắt buộc** khi dùng `scope_ids`, và phải là `company_id` — xem mục 6 dưới đây.

Chưa có nơi nào gọi method này. Kiểm tra trùng danh tính (BR-10) hiện làm hoàn
toàn ở Backend: `biometric.service.ts::assertNoDuplicateIdentity()` tự tính
cosine trong TypeScript trên các embedding đã lưu, không đi qua AI Server. Cách
đó chạy đúng khi công ty còn ít nhân viên; khi tập lớn thì chuyển sang gọi
`/v1/identify` với `candidates` sẽ nhanh hơn nhiều vì ở đây so khớp bằng một
phép nhân ma trận thay vì vòng lặp Node.

**3. `/v1/batch/audit` chưa được nối.** `ai-batch.processor.ts` phía Backend
hiện KHÔNG gọi AI Server: nó so `matchScore` đã lưu sẵn của mỗi lượt chấm công
với trung bình lịch sử 30 ngày của chính nhân viên đó, thấp hơn 20% thì gắn cờ.

Hai cách phát hiện khác nhau, không thay thế nhau:

| | Cách đang chạy | `/v1/batch/audit` |
|---|---|---|
| Dữ liệu vào | Điểm đã lưu lúc chấm công | Chấm lại từ ẢNH GỐC |
| Bắt lượt gian lận lọt ngưỡng | Chỉ khi điểm tụt so với chính người đó | Có, chấm lại độc lập |
| Bắt model suy giảm | Không | Có |
| Chi phí | Vài truy vấn SQL | Một lượt suy luận cho mỗi bản ghi lấy mẫu |

Cách đang chạy không bắt được trường hợp model suy giảm đồng loạt (mọi điểm cùng
tụt thì trung bình lịch sử cũng tụt theo, không có gì "bất thường" để so). Đó là
đúng một trong hai mục đích mà AF-08 đặt ra cho endpoint này.

---

## 6. Những điều không được vi phạm

### Không bao giờ trả về quyết định nghiệp vụ (P3)

Nếu thấy phản hồi có `accepted: true` thì ranh giới kiến trúc đã bị phá. Ngưỡng
nằm ở Backend, theo từng công ty. Có test canh giữ.

### Chỉ mục 1:N không được trộn giữa các công ty (ADR-05)

`namespace` của `EmbeddingIndex` phải là `company_id`. Trộn hai công ty vào một
namespace nghĩa là nhân viên công ty A có thể được nhận diện thành nhân viên
công ty B — dạng rò rỉ dữ liệu chéo khách hàng nghiêm trọng nhất.

Schema bắt buộc `namespace` khi dùng `scope_ids`, và có test kiểm chứng không
tìm được kết quả xuyên namespace.

### Không xác định được thì trả `None`, không trả `True`

`liveness.action_verified` có ba giá trị:

| Giá trị | Nghĩa |
|---|---|
| `true` | Đã đo được và người dùng làm đúng hành động |
| `false` | Đã đo được và người dùng **không** làm đúng |
| `null` | **Không đo được** — Backend phải coi như chưa xác minh |

Trả `true` cho thứ không đo được chính là tự tay mở lỗ hổng chấm công hộ ở đúng
chỗ đáng lẽ phải đóng nó lại.

Phía Backend cưỡng chế điều này ở `attendance.service.ts` và `biometric.service.ts`:
điều kiện là `action_verified !== true`, **không phải** `=== false`. Hai nhánh trả
`details.reason` khác nhau — `null` trả `ACTION_NOT_MEASURABLE` kèm `logger.warn`,
vì đó là dấu hiệu module `landmark_3d_68` hỏng chứ không phải người dùng làm sai.
Không tách ra thì sự cố model hiện lên dưới dạng "cả công ty đột nhiên không chấm
công được" mà không ai biết vì sao.

### Ảnh hỏng trả 200 kèm `error_code`, không trả 5xx

Backend cần đọc `error_code` để hiển thị hướng dẫn cụ thể ("ảnh quá tối" khác
hẳn "không thấy khuôn mặt"). Trả 5xx còn làm circuit breaker phía Backend hiểu
nhầm là AI Server chết, rồi chặn luôn những người đang chấm công bình thường.

### Mã lỗi phải có trong `AI_ERROR_MAP` của Backend

Mã lạ sẽ bị Backend hiểu nhầm thành `FACE_NOT_FOUND` và người dùng nhận thông
báo sai hoàn toàn. `errors.py` chặn ngay lúc khởi tạo `ImageRejectedError` nếu
mã không nằm trong danh sách, và có test đối chiếu hai phía.

### Không ghi log ảnh, embedding, token (NFR-OBS-08)

`logging_config.py` có bộ lọc chặn lại như lưới an toàn cuối cùng — không phải
giấy phép để viết ẩu.

### Không expose ra internet (docs/02 mục 6.2)

`docker-compose.yml` bind `127.0.0.1:8000`. Trên Kubernetes phải dùng
`ClusterIP`, không dùng `LoadBalancer`.

---

## 7. Vận hành

### Sức chứa và độ trễ

`MAX_CONCURRENCY` giới hạn số suy luận chạy cùng lúc. Tăng bừa **làm chậm hơn
chứ không nhanh hơn**: ONNXRuntime tự chiếm nhiều lõi CPU cho một phép suy luận,
50 request song song sẽ làm cả 50 cùng chậm.

| Cấu hình | Thời gian một lượt `verify` | `MAX_CONCURRENCY` gợi ý |
|---|---|---|
| CPU 4 lõi | 200–600 ms | 2 |
| CPU 16 lõi | 120–300 ms | 4–6 |
| GPU T4 | 20–50 ms | 8–16 |

`NFR-PERF-01` yêu cầu chấm công dưới 2 giây tính cả mạng và Backend. CPU vẫn
kịp, nhưng hết dư địa cho giờ cao điểm 8h sáng.

Muốn tăng thông lượng thì **thêm replica**, đừng tăng `--workers` của uvicorn:
mỗi worker nạp một bản model riêng vào RAM.

### Giám sát

`GET /metrics` trả Prometheus. Các chỉ số đáng theo dõi:

| Chỉ số | Vì sao |
|---|---|
| `ai_inference_seconds` | Cảnh báo p95 > 2s trong 5 phút (docs/02 mục 12) |
| `ai_image_rejected_total{error_code}` | `FACE_NOT_FOUND` tăng vọt = App đổi cách chụp, hoặc model hỏng |
| `ai_match_score` | Phân bố lệch dần theo thời gian = model đang suy giảm |
| `ai_concurrent_inferences` | Chạm trần `MAX_CONCURRENCY` liên tục = cần thêm replica |
| `ai_model_info` | Xác nhận đúng version model đang chạy |
| `ai_liveness_score` | Phân bố dồn về 0 = tiền xử lý sai, xem cảnh báo dưới |

`GET /health` trả `degraded` khi đang chạy engine giả hoặc chưa có model chống
giả mạo. **Nên đặt cảnh báo cho trạng thái này** — nó nghĩa là hệ thống đang
chạy mà không có tuyến phòng thủ chống chấm công hộ.

> ⚠ **`ai_liveness_score` dồn hết về ~0.005 là dấu hiệu tiền xử lý sai**, không
> phải "ai cũng dùng ảnh giả". MiniFASNet chỉ đúng khi nhận đúng khung ảnh và
> đúng thang giá trị nó được huấn luyện cùng; lệch đi thì nó không báo lỗi, chỉ
> trả cùng một con số vô nghĩa cho mọi tấm ảnh. Xem chú thích trong
> `core/liveness.py` và bộ test `tests/test_liveness_preprocessing.py`.

### Chốt chặn cấu hình production

`ENV=production` sẽ **từ chối khởi động** nếu:

- `ENGINE=stub`
- Thiếu `AI_SERVER_INTERNAL_KEY`, hoặc khoá ngắn hơn 32 ký tự
- Thiếu `LIVENESS_MODEL_PATH`
- `ALLOW_MISSING_LIVENESS_MODEL=true`

Chết lúc khởi động tốt hơn nhiều so với chạy êm ru rồi phát hiện ba tháng sau
rằng ai cũng chấm công được bằng ảnh in.

---

## 8. Việc còn lại trước khi go-live

| # | Việc | Vì sao quan trọng |
|---|---|---|
| 1 | ~~**Lấy model chống giả mạo thật**~~ **XONG** | MiniFASNetV2 (Apache-2.0) đã chuyển sang ONNX bằng `scripts/convert_anti_spoof.py`. `/health` trả `healthy`. Mỗi môi trường phải tự chạy lệnh đó vì `models/` không vào git |
| 2 | **Hiệu chỉnh ngưỡng bằng dữ liệu thật** | 0.45 và 0.70 chỉ là điểm khởi đầu. `docs/02` mục 6.4 nói rõ phải đo FAR/FRR trên dữ liệu khách hàng trước khi go-live. Ngưỡng đặt ở Backend nên việc này không cần đụng tới AI Server. **Riêng với chống giả mạo, việc này càng cần**: model huấn luyện trên dữ liệu công khai, chủ yếu không phải người Việt |
| 3 | **Xác minh `BLINK` bằng chuỗi khung hình** | Một ảnh tĩnh chỉ trả lời "mắt có đang nhắm không", không trả lời được "có vừa chớp không". `verify_action_sequence` trong `landmarks.py` đã viết sẵn và có test, nhưng App phải gửi nhiều khung và hợp đồng API phải mở rộng. **Đã xử lý tạm:** `LIVENESS_ACTIONS` phía Backend đã bỏ `BLINK`, còn `TURN_LEFT`/`TURN_RIGHT`/`NOD`/`SMILE`. AI Server vẫn nhận `BLINK` như giá trị hợp lệ để không phải sửa hợp đồng khi bật lại |
| 4 | **Kiểm chứng chỉ số điểm mốc với đúng phiên bản model** | `landmarks.py` dùng bố cục iBUG-68, là quy ước ổn định. Vẫn nên chạy thử trên vài chục ảnh thật để xác nhận `landmark_3d_68` của bản buffalo_l đang dùng trả đúng bố cục đó |
| 5 | **Đo lại sau mỗi lần nâng cấp thư viện** | `requirements.txt` ghim phiên bản có chủ đích. Model nhận diện rất nhạy với thay đổi onnxruntime/numpy — nâng cấp phải đo lại FAR/FRR |
| 6 | **Đồng bộ chỉ mục 1:N** | Chỉ cần khi làm kiosk. Backend phải đẩy embedding lên `/v1/index/upsert` khi có người đăng ký/huỷ khuôn mặt, và nạp lại toàn bộ khi AI Server khởi động lại |
| 7 | **Cân nhắc TensorRT nếu chạy GPU** | Nhanh hơn ONNXRuntime-CUDA đáng kể, nhưng phải biên dịch engine riêng cho từng đời GPU |
| 8 | **Phát hiện khẩu trang và che mặt** | `MASK_DETECTED` và `FACE_OCCLUDED` đã khai trong `errors.py` (nhóm `DECLARED_ONLY_ERROR_CODES`) và Backend ánh xạ được, nhưng chưa chỗ nào phát ra — cần một model phân loại riêng, không suy ra được từ pipeline hiện tại. Trong lúc chờ, khẩu trang biểu hiện gián tiếp qua điểm tương đồng thấp và bị `FACE_NOT_MATCHED` chặn, chỉ là người dùng không được hướng dẫn đúng |

Mục 1 đã xong. Mục 2 và 3 là điều kiện cần còn lại trước khi cho người thật
dùng; năm mục sau tuỳ quy mô triển khai.
