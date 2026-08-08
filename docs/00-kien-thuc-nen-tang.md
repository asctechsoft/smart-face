# SmartFace — Kiến thức nền tảng để xây hệ thống chấm công bằng khuôn mặt

> Tài liệu dành cho người **lần đầu** làm hệ thống loại này.
> Đọc theo thứ tự. Mỗi phần đều giải thích "tại sao", không chỉ "làm gì".

**Mục lục**

- [Phần 0 — Nhìn tổng thể: hệ thống này gồm những gì](#phần-0)
- [Phần 1 — Nhận diện khuôn mặt hoạt động thế nào](#phần-1)
- [Phần 2 — Ngưỡng, FAR/FRR và cái bẫy 1:N](#phần-2)
- [Phần 3 — Liveness: chống giơ ảnh chấm công](#phần-3)
- [Phần 4 — Kiến trúc hệ thống](#phần-4)
- [Phần 5 — Luồng nghiệp vụ chi tiết](#phần-5)
- [Phần 6 — Thiết kế cơ sở dữ liệu](#phần-6)
- [Phần 7 — Engine tính công (phần tốn code nhất)](#phần-7)
- [Phần 8 — Chống gian lận](#phần-8)
- [Phần 9 — Bảo mật và pháp lý Việt Nam](#phần-9)
- [Phần 10 — Vận hành thực tế](#phần-10)
- [Phần 11 — Lộ trình học và lộ trình build](#phần-11)
- [Phần 12 — Từ điển thuật ngữ](#phần-12)

---

<a name="phần-0"></a>
## Phần 0 — Nhìn tổng thể: hệ thống này gồm những gì

Sai lầm đầu tiên của người mới là nghĩ "đây là dự án AI". **Không phải.**

Nếu chia khối lượng công việc thực tế của một hệ thống chấm công thương mại:

```
Nhận diện khuôn mặt (AI)        ████                      ~15%
Nghiệp vụ tính công             ████████████████████      ~45%
Web quản lý (CRUD, báo cáo)     ████████████              ~25%
Hạ tầng, bảo mật, vận hành      ██████                    ~15%
```

Phần AI bạn **không tự huấn luyện model** — bạn dùng model có sẵn (InsightFace/ArcFace) đã được train trên hàng chục triệu ảnh. Việc của bạn là ghép nó vào đúng chỗ, chọn ngưỡng đúng, và chống gian lận.

Phần khiến dự án kéo dài 6 tháng thay vì 2 tháng là **nghiệp vụ chấm công**: ca đêm, ca gãy, OT, đơn nghỉ duyệt ngược về quá khứ, chốt kỳ công...

### 5 khối chức năng

```
┌─────────────────────────────────────────────────────────────┐
│  1. THIẾT BỊ CHẤM CÔNG                                       │
│     Kiosk tablet ở cửa  hoặc  App điện thoại nhân viên       │
│     → Bật camera, bắt mặt, gửi lên server                    │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  2. FACE SERVICE (Python)                                    │
│     Detect → Align → Liveness → Embed → Search 1:N           │
│     → Trả về: "đây là nhân viên #123, độ tin cậy 0.72"       │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  3. BACKEND NGHIỆP VỤ (Next.js API)                          │
│     Ghi log chấm công, kiểm tra device/GPS/nonce,            │
│     xác định IN hay OUT, phát job tính công                  │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  4. ENGINE TÍNH CÔNG (job chạy nền)                          │
│     Log thô + Ca làm việc + Đơn từ + Lễ → Bảng công ngày     │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  5. WEB QUẢN LÝ (Next.js)                                    │
│     Nhân sự · Ca · Duyệt đơn · Báo cáo · Chốt kỳ · Export    │
└─────────────────────────────────────────────────────────────┘
```

---

<a name="phần-1"></a>
## Phần 1 — Nhận diện khuôn mặt hoạt động thế nào

### 1.1. Tại sao không thể "so ảnh với ảnh"

Ý tưởng ngây thơ: lưu ảnh của nhân viên, khi chấm công thì so ảnh mới với ảnh cũ xem giống bao nhiêu %.

Cách này **không hoạt động**, vì:

- Đổi ánh sáng → mọi pixel đổi giá trị, dù vẫn là cùng một người.
- Nghiêng đầu 15° → pixel lệch hoàn toàn.
- Hai người khác nhau chụp cùng góc, cùng đèn có thể "giống" về pixel hơn là cùng một người chụp ở hai điều kiện khác nhau.

So sánh pixel đo **điều kiện chụp**, không đo **danh tính**.

### 1.2. Embedding — ý tưởng cốt lõi

Giải pháp là dùng một mạng nơ-ron biến ảnh khuôn mặt thành một **vector số**, gọi là **embedding** (hoặc *face template*, *feature vector*).

```
   Ảnh mặt 112×112×3            Mạng nơ-ron            Vector 512 số
   (37.632 con số)      ──────► (ArcFace) ──────►   [0.031, -0.842, 0.117, ...]
```

Mạng này được huấn luyện với một mục tiêu duy nhất:

> **Hai ảnh của CÙNG một người → hai vector nằm gần nhau.**
> **Hai ảnh của người KHÁC nhau → hai vector nằm xa nhau.**

Bất kể ánh sáng, góc mặt, biểu cảm, kính, râu.

Hãy hình dung một không gian 512 chiều (không tưởng tượng nổi thì cứ nghĩ là bản đồ 2 chiều). Mỗi người có một "vùng" riêng trên bản đồ đó. Mọi ảnh của bạn — sáng, tối, cười, nghiêm — đều rơi vào cụm nhỏ của bạn. Ảnh của người khác rơi vào cụm khác.

```
        Không gian embedding (minh hoạ 2D)

              ●●        ← 4 ảnh của An (sáng/tối/nghiêng/cười)
             ● ●            đều tụ lại một chỗ

                          ▲▲
                         ▲ ▲   ← 4 ảnh của Bình, cụm riêng, xa cụm của An

                                    ■ ■
                                   ■■     ← Cường
```

Nhận diện = **chụp ảnh mới, tính vector, xem nó rơi gần cụm của ai nhất.**

### 1.3. ArcFace — vì sao nó tốt

Model phổ biến nhất hiện nay là **ArcFace** (và họ hàng: CosFace, AdaFace). Điểm khác biệt nằm ở hàm mất mát (loss function) khi huấn luyện: nó không chỉ ép các cụm tách nhau, mà ép chúng tách nhau **một khoảng lề góc (angular margin)** nhất định. Kết quả là các cụm co chặt và cách xa nhau rõ rệt hơn — nghĩa là dễ chọn ngưỡng hơn, ít nhầm hơn.

Bạn **không cần huấn luyện lại**. Dùng bộ trọng số có sẵn:

- **InsightFace `buffalo_l`** — bộ chuẩn công nghiệp, gồm cả detector và recognizer, chạy ONNX. Đây là lựa chọn mặc định nên dùng.
- **MobileFaceNet** — nhẹ, cho thiết bị di động, chính xác thấp hơn một chút.

### 1.4. Pipeline đầy đủ 4 bước

Nhận diện khuôn mặt không phải một model, mà là bốn bước nối tiếp. **Bỏ bước nào cũng tụt chính xác nghiêm trọng.**

#### Bước 1 — Detect (phát hiện mặt)

Tìm xem trong khung hình có mặt nào, ở đâu. Trả về khung bao (bounding box) + 5 điểm mốc (landmark): 2 mắt, 1 mũi, 2 khoé miệng.

- Server: **RetinaFace** (trong InsightFace), **YuNet** (OpenCV, rất nhanh).
- Mobile: **Google ML Kit Face Detection** (Android/iOS), **BlazeFace** (MediaPipe).

Trong ảnh có nhiều mặt (đồng nghiệp đứng phía sau) → chọn mặt **to nhất và gần tâm nhất**, vì đó là người đang đứng chấm công.

#### Bước 2 — Align (căn chỉnh)

Đây là bước **người mới hay bỏ qua nhất và trả giá đắt nhất.**

Dùng 5 landmark để xoay–co giãn–dịch chuyển (biến đổi affine) khuôn mặt về đúng một khuôn mẫu chuẩn: ảnh 112×112, mắt trái luôn ở toạ độ cố định, mắt phải ở toạ độ cố định.

```
   Mặt nghiêng, lệch                Sau khi align
   ┌──────────┐                     ┌──────────┐
   │   ●      │                     │  ●    ●  │   ← mắt luôn ở đúng vị trí
   │      ●   │        ──────►      │    ●     │
   │    ●     │                     │  ●───●   │
   │  ●   ●   │                     │          │
   └──────────┘                     └──────────┘
```

Lý do: model embedding được huấn luyện trên ảnh đã align. Đưa vào ảnh chưa align là đưa vào dữ liệu khác phân phối → vector sai lệch. **Chính xác có thể tụt từ 99% xuống 85%** chỉ vì thiếu bước này.

InsightFace làm sẵn bước này khi bạn gọi `app.get(img)`.

#### Bước 3 — Embed (trích xuất vector)

Đưa ảnh 112×112 đã align vào mạng ArcFace → nhận vector 512 chiều.

Sau đó **chuẩn hoá L2** (chia vector cho độ dài của nó) để mọi vector đều có độ dài bằng 1. Việc này khiến phép so sánh sau đó đơn giản hơn nhiều.

#### Bước 4 — Match (so khớp)

Đo độ giống nhau giữa hai vector bằng **cosine similarity** — chính là góc giữa hai vector:

```
similarity = (A · B) / (|A| × |B|)
```

Vì đã chuẩn hoá L2 nên `|A| = |B| = 1`, công thức rút gọn thành tích vô hướng:

```
similarity = A · B = a₁b₁ + a₂b₂ + ... + a₅₁₂b₅₁₂
```

Giá trị nằm trong khoảng −1 đến 1:

| Similarity | Ý nghĩa thực tế |
|---|---|
| 0.9 – 1.0 | Gần như chắc chắn cùng ảnh / cùng người, cùng điều kiện |
| 0.5 – 0.9 | Cùng người, khác điều kiện chụp |
| 0.3 – 0.5 | **Vùng xám** — nguy hiểm, cần ngưỡng cẩn thận |
| 0.0 – 0.3 | Người khác nhau |

> Một số tài liệu dùng **cosine distance** = `1 − similarity`. Khi đó "gần" nghĩa là số nhỏ. Đọc tài liệu nào cũng phải xác định rõ đang dùng đại lượng nào, kẻo đảo ngược điều kiện so sánh.

### 1.5. Code minh hoạ

```python
# pip install insightface onnxruntime numpy opencv-python
import cv2
import numpy as np
from insightface.app import FaceAnalysis

# Khởi tạo 1 lần khi service start — KHÔNG khởi tạo mỗi request (rất chậm)
app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
app.prepare(ctx_id=0, det_size=(640, 640))

def get_embedding(image_path: str) -> np.ndarray | None:
    """Trả về vector 512 chiều đã chuẩn hoá, hoặc None nếu không thấy mặt."""
    img = cv2.imread(image_path)
    faces = app.get(img)          # detect + align + embed, cả 3 bước trong 1 lệnh
    if not faces:
        return None
    # Nhiều mặt → chọn mặt có diện tích lớn nhất
    face = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
    return face.normed_embedding  # đã chuẩn hoá L2 sẵn, shape (512,)

def similarity(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b))    # vì đã chuẩn hoá nên dot product = cosine

# Ví dụ
emb1 = get_embedding("an_dang_ky.jpg")
emb2 = get_embedding("an_cham_cong.jpg")
print(similarity(emb1, emb2))     # ví dụ: 0.68 → cùng người
```

### 1.6. Enrollment — đăng ký khuôn mặt

Khi nhân viên mới vào, bạn phải "dạy" hệ thống nhớ mặt họ. Đây gọi là **enrollment**.

**Nên chụp 5–10 ảnh**, không phải 1:

- Chính diện, nghiêng trái ~15°, nghiêng phải ~15°, hơi cúi, hơi ngẩng
- Có kính / không kính (nếu người đó thỉnh thoảng đeo)
- Ít nhất 2 điều kiện ánh sáng khác nhau

**Lưu tất cả các embedding, đừng lấy trung bình.** Trung bình cộng làm mất thông tin về sự đa dạng: nếu người đó lúc đeo kính lúc không, vector trung bình sẽ nằm lơ lửng giữa hai trạng thái và không giống trạng thái nào cả.

Khi so khớp, lấy **similarity cao nhất** trong số các ảnh đã đăng ký của người đó:

```python
score = max(similarity(query_emb, e) for e in employee_embeddings)
```

**Kiểm tra chất lượng ngay lúc enroll** — đây là lúc rẻ nhất để phát hiện vấn đề:

| Tiêu chí | Ngưỡng gợi ý | Lý do |
|---|---|---|
| Kích thước mặt trong ảnh | ≥ 112px chiều rộng | Nhỏ hơn thì thiếu chi tiết |
| Độ nét (variance of Laplacian) | ≥ 100 | Ảnh mờ cho vector rác |
| Độ sáng trung bình | 80 – 200 (thang 0–255) | Quá tối/quá cháy đều hỏng |
| Góc mặt (yaw/pitch) | \|góc\| ≤ 25° | Nghiêng quá thì mất nửa mặt |
| Số mặt trong khung | đúng bằng 1 | Tránh enroll nhầm người |
| Similarity giữa các ảnh của chính họ | ≥ 0.5 | Nếu thấp bất thường → có ảnh sai người |

Thêm một kiểm tra quan trọng: **so vector mới với toàn bộ người đã có trong hệ thống**. Nếu trùng cao (> 0.6) với người khác → cảnh báo. Đây là cách bắt lỗi nhập trùng, hoặc phát hiện anh em sinh đôi.

---

<a name="phần-2"></a>
## Phần 2 — Ngưỡng, FAR/FRR và cái bẫy 1:N

Đây là phần **quan trọng nhất về mặt kỹ thuật** trong toàn bộ tài liệu. Hiểu sai chỗ này thì hệ thống hoặc là chấm nhầm người, hoặc là nhân viên đứng xếp hàng chửi.

### 2.1. Hai loại lỗi

Hệ thống nhận diện có đúng hai kiểu sai:

| | Tên | Nghĩa | Hậu quả |
|---|---|---|---|
| **Lỗi loại 1** | **FAR** — False Acceptance Rate | Nhận **nhầm** người lạ thành người quen | Gian lận, chấm công hộ, mất tiền |
| **Lỗi loại 2** | **FRR** — False Rejection Rate | **Từ chối** đúng người thật | Nhân viên bực, xếp hàng, gọi IT |

Hai lỗi này **đối nghịch nhau**, điều chỉnh bằng một con số duy nhất: **ngưỡng (threshold)**.

```
   Phân bố similarity trên dữ liệu thật

   Số cặp
     │           ██                              ████
     │          ████  ← cặp KHÁC người          ██████  ← cặp CÙNG người
     │         ██████                          ████████
     │        ████████                        ██████████
     │       ██████████                      ████████████
     │      ████████████░░░░░░░░░░░░░░░░░░░▒▒██████████████
     └──────────────────────┬──────────┬──────────────────────► similarity
          0.1      0.2     0.3   ↑    0.45      0.6      0.8
                              ngưỡng
                                     ╰─ vùng chồng lấn ─╯
```

- Kéo ngưỡng **sang trái** (dễ dãi hơn): ít từ chối nhầm (FRR ↓) nhưng dễ nhận nhầm (FAR ↑).
- Kéo ngưỡng **sang phải** (khắt khe hơn): an toàn hơn (FAR ↓) nhưng hay từ chối người thật (FRR ↑).

**Không có ngưỡng "đúng" phổ quát.** Nó phụ thuộc vào model, camera, ánh sáng, và mức độ chấp nhận rủi ro của bạn.

### 2.2. Cái bẫy 1:N — điều mà hầu hết người mới không biết

Có hai chế độ so khớp:

**Verification (1:1)** — "Người này có phải là nhân viên #123 không?"
Nhân viên nhập mã / quẹt thẻ / chọn tên trước, rồi hệ thống chỉ so mặt với đúng một người.
→ **Một phép so sánh.**

**Identification (1:N)** — "Người này là ai trong 1.000 nhân viên?"
Chỉ cần đứng trước camera, hệ thống tự tìm ra.
→ **N phép so sánh.**

Chế độ 1:N tiện hơn nhiều, ai cũng muốn dùng. Nhưng đây là vấn đề:

> Giả sử ngưỡng của bạn có FAR = 0,1% (tức là 1 phần nghìn khả năng nhận nhầm **mỗi lần so sánh**).
>
> Với 1.000 nhân viên trong hệ thống, mỗi lần ai đó đứng trước camera là **1.000 phép so sánh**.
>
> Xác suất có **ít nhất một** nhận nhầm:
>
> ```
> P = 1 − (1 − 0,001)^1000 = 1 − 0,999^1000 ≈ 63%
> ```

**63%.** Nghĩa là cứ mỗi lần chấm công, hơn một nửa số lần sẽ có ít nhất một người trong danh sách bị chấm "khớp sai" — và nếu điểm của người đó cao hơn người thật, hệ thống chấm công cho nhầm người.

Đây là lý do FAR ở chế độ 1:N phải chặt hơn 1:1 **rất nhiều lần**. Công thức thô để chọn:

```
FAR_mỗi_so_sánh  ≤  FAR_mong_muốn / N
```

Muốn tỉ lệ nhầm toàn hệ thống ≤ 0,1% với N = 1.000 → FAR mỗi phép so sánh phải ≤ 0,0001% . Ngưỡng phải nâng lên rất cao, kéo theo FRR tăng — nhiều người thật bị từ chối.

### 2.3. Bốn cách xử lý cái bẫy này

**Cách 1 — Thu hẹp N (nên làm, luôn luôn)**
Không bao giờ tìm trên toàn bộ nhân viên. Giới hạn theo:
- **Chi nhánh của thiết bị** — kiosk ở Hà Nội chỉ tìm trong nhân viên Hà Nội
- **Ca làm việc hôm nay** — 7h sáng chỉ tìm trong nhóm có ca sáng
- **Đang không nghỉ phép**

N từ 1.000 xuống 80 → bài toán dễ hơn 12 lần.

**Cách 2 — Chuyển sang 1:1 hoặc 1:few (an toàn nhất)**
Nhân viên gõ 4 số cuối mã nhân viên → chỉ còn vài người → verify mặt.
Mất 2 giây thao tác nhưng độ an toàn tăng hàng trăm lần. **Với hệ thống dính đến tiền lương, đây là lựa chọn đúng.**

Trên app điện thoại thì mặc nhiên là 1:1 — vì đã đăng nhập nên biết chính xác đang xác thực ai.

**Cách 3 — Kiểm tra khoảng cách với người xếp thứ hai**
Không chỉ hỏi "điểm cao nhất có vượt ngưỡng không", mà còn hỏi "nó có **vượt trội** so với người xếp nhì không":

```python
best, second = sorted(scores, reverse=True)[:2]
accept = best >= THRESHOLD and (best - second) >= MARGIN   # MARGIN ~ 0.05–0.10
```

Nếu hai người cùng đạt 0.52 và 0.51 → hệ thống đang phân vân → **từ chối và yêu cầu nhập mã**, đừng đoán.

**Cách 4 — Luôn có đường thoát**
Khi không chắc, chuyển sang PIN/QR/thẻ. Từ chối an toàn hơn đoán bừa.

### 2.4. Cách tự đo ngưỡng cho hệ thống của bạn

**Đừng tin con số benchmark trên mạng.** "99,83% trên LFW" là kết quả trên ảnh người nổi tiếng chụp bởi phóng viên chuyên nghiệp. Camera tablet 5MP đặt ngược sáng ở cửa văn phòng là một thế giới khác.

Quy trình đo, làm trong Phase 0 trước khi viết dòng code nghiệp vụ nào:

**Bước 1 — Thu dữ liệu thật**
Tối thiểu 30 người × 10 ảnh = 300 ảnh, chụp **bằng đúng thiết bị và đúng vị trí sẽ lắp thật**, ở các thời điểm khác nhau trong ngày (sáng ngược sáng, trưa, chiều tối bật đèn).

**Bước 2 — Tính toàn bộ cặp**
- **Cặp genuine** (cùng người): 30 người × C(10,2) = 30 × 45 = 1.350 cặp
- **Cặp impostor** (khác người): C(30,2) × 10 × 10 = 43.500 cặp

```python
import itertools, numpy as np

genuine, impostor = [], []
for pid_a, pid_b in itertools.combinations_with_replacement(people, 2):
    for ea in embeddings[pid_a]:
        for eb in embeddings[pid_b]:
            s = float(np.dot(ea, eb))
            (genuine if pid_a == pid_b else impostor).append(s)
```

**Bước 3 — Vẽ đường FAR/FRR theo ngưỡng**

```python
for t in np.arange(0.20, 0.80, 0.01):
    far = np.mean(np.array(impostor) >= t)   # người lạ bị nhận nhầm
    frr = np.mean(np.array(genuine)  <  t)   # người thật bị từ chối
    print(f"t={t:.2f}  FAR={far*100:7.4f}%  FRR={frr*100:6.2f}%")
```

**Bước 4 — Chọn ngưỡng theo mức FAR mục tiêu, không theo "điểm cân bằng"**

Nhiều tài liệu khuyên chọn **EER** (Equal Error Rate — điểm FAR = FRR). **Với chấm công thì đây là lựa chọn sai**, vì hai lỗi không có giá như nhau: nhận nhầm = gian lận tiền lương, từ chối nhầm = phiền 10 giây.

Cách đúng: **cố định FAR ở mức chấp nhận được, rồi xem FRR là bao nhiêu.**

| Kịch bản | FAR mục tiêu (mỗi so sánh) | Ghi chú |
|---|---|---|
| 1:1 (đã nhập mã NV) | 0,1% | FRR thường 1–3% |
| 1:N, N ≤ 100 | 0,001% | Thu hẹp theo chi nhánh + ca |
| 1:N, N ≥ 500 | 0,0001% | FRR sẽ cao, cân nhắc chuyển 1:1 |

Nếu ở FAR mục tiêu mà FRR > 10% → dữ liệu enroll hoặc điều kiện lắp camera có vấn đề. Sửa gốc (đèn, vị trí, enroll lại) chứ đừng hạ ngưỡng.

**Bước 5 — Đo lại định kỳ.** Mỗi quý, chạy lại trên log thật. Ánh sáng theo mùa thay đổi, nhân viên thay đổi ngoại hình.

### 2.5. Tìm kiếm 1:N về mặt kỹ thuật

Với quy mô vừa, đừng vội dùng vector database:

| Số embedding | Giải pháp | Thời gian tìm |
|---|---|---|
| < 10.000 | Nạp hết vào RAM, nhân ma trận NumPy | < 5 ms |
| 10.000 – 1 triệu | `pgvector` + index HNSW trên PostgreSQL | 5 – 20 ms |
| > 1 triệu | FAISS / Milvus / Qdrant | tuỳ cấu hình |

Tìm bằng nhân ma trận (nhanh và đơn giản nhất):

```python
# M: ma trận (N, 512) — toàn bộ embedding đã đăng ký, đã chuẩn hoá
# q: vector (512,) của người đang chấm công
scores = M @ q                 # (N,) — một phép nhân ma trận, cực nhanh
top = np.argsort(scores)[::-1][:5]
```

10.000 embedding × 512 chiều × 4 byte = **20 MB RAM**. Không đáng lo. Nạp lúc khởi động, cập nhật khi có người enroll mới.

Với pgvector:

```sql
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE face_profiles ADD COLUMN embedding vector(512);

CREATE INDEX ON face_profiles
  USING hnsw (embedding vector_cosine_ops);

-- Toán tử <=> là cosine DISTANCE (0 = giống hệt), không phải similarity
SELECT employee_id, 1 - (embedding <=> $1) AS similarity
FROM face_profiles
WHERE branch_id = $2 AND is_active = true
ORDER BY embedding <=> $1
LIMIT 5;
```

---

<a name="phần-3"></a>
## Phần 3 — Liveness: chống giơ ảnh chấm công

### 3.1. Vì sao đây là phần quan trọng nhất

Model nhận diện khuôn mặt **không quan tâm** đầu vào là người thật hay ảnh in. Nó chỉ thấy các pixel tạo thành khuôn mặt.

Nghĩa là: **không có liveness, chỉ cần mở ảnh đồng nghiệp trên điện thoại giơ trước camera là chấm công thành công.** Toàn bộ hệ thống trở nên vô nghĩa trong tuần đầu tiên triển khai.

Thuật ngữ chuẩn: **PAD — Presentation Attack Detection** (chuẩn ISO/IEC 30107-3).

### 3.2. Các kiểu tấn công

| Kiểu | Cách làm | Độ khó chống |
|---|---|---|
| **Print attack** | In ảnh ra giấy, giơ trước camera | Dễ chống — giấy không có phản xạ, không có chiều sâu |
| **Screen / replay attack** | Mở ảnh hoặc video trên điện thoại | Trung bình — có hiệu ứng moiré, phản xạ màn hình, viền thiết bị |
| **Cut-out / mask 2D** | Ảnh in khoét mắt, đeo lên mặt | Trung bình |
| **Mask 3D** | Mặt nạ silicon | Khó — cần camera depth hoặc hồng ngoại |
| **Deepfake / video injection** | Chèn luồng video giả vào camera ảo | Khó nhất — cần chứng thực từ phần cứng |

Trong môi trường chấm công doanh nghiệp, 95% các vụ gian lận thực tế là **replay attack**: nhân viên nhờ đồng nghiệp giơ ảnh mình lên. Chống được cái này là đã giải quyết phần lớn vấn đề.

### 3.3. Ba nhóm giải pháp

#### A. Passive liveness (khuyến nghị dùng làm chính)

Một model học sâu nhìn **một khung hình** và phán đoán mặt thật hay giả, dựa trên:
- Kết cấu da (da thật có lỗ chân lông, ảnh in thì phẳng)
- Hiệu ứng moiré (vân sóng đặc trưng khi chụp lại màn hình)
- Phản xạ ánh sáng bất thường
- Viền của giấy/thiết bị lọt vào khung

Model dùng được: **MiniFASNet** (Silent-Face-Anti-Spoofing của Minivision, mã nguồn mở, nhẹ, chạy được trên CPU ~10ms).

**Ưu điểm:** người dùng không phải làm gì, chấm công trong 1 giây.
**Nhược điểm:** không hoàn hảo, cần đo và chỉnh ngưỡng riêng như phần nhận diện.

#### B. Active liveness (challenge–response)

Server phát ngẫu nhiên một yêu cầu: "chớp mắt", "quay đầu sang trái", "cười", "đọc số 4-7-2". Client phải thực hiện đúng trong vài giây.

**Ưu điểm:** chống video quay sẵn rất tốt, vì kẻ tấn công không đoán được yêu cầu.
**Nhược điểm:** mất 5–10 giây/người. Vào 8h sáng với 200 người thì thành thảm hoạ xếp hàng.

**Cách dùng hợp lý:** không bật cho mọi lần, chỉ kích hoạt khi passive liveness nghi ngờ (điểm nằm vùng xám), hoặc ngẫu nhiên 5% số lần để răn đe.

#### C. Phần cứng chuyên dụng

- **Camera depth** (iPad Pro TrueDepth, Intel RealSense, camera ToF) — gần như miễn nhiễm với ảnh và màn hình vì đo được chiều sâu thật.
- **Camera hồng ngoại (NIR)** — màn hình điện thoại không phát hồng ngoại nên hiện ra đen sì. Rất hiệu quả, giá rẻ hơn depth.

Nếu ngân sách cho phép mua kiosk có camera NIR, đây là giải pháp mạnh nhất trên mỗi đồng bỏ ra.

### 3.4. Chiến lược thực dụng nên áp dụng

```
1. Client chụp burst 3 khung hình cách nhau 200ms
      ↓
2. Kiểm tra 3 khung KHÔNG giống hệt nhau
   (ảnh tĩnh giơ lên cho 3 khung gần như y hệt; người thật luôn vi động)
      ↓
3. Passive liveness trên khung rõ nhất
      ↓
   ┌─ score > 0.7  → CHẤP NHẬN, cho chấm công
   ├─ 0.4 – 0.7    → NGHI NGỜ → yêu cầu challenge (chớp mắt)
   └─ score < 0.4  → TỪ CHỐI + ghi log cảnh báo + báo admin
      ↓
4. Ghi lại điểm liveness vào mỗi bản ghi chấm công (để audit sau này)
```

**Nguyên tắc bắt buộc: liveness phải chạy ở SERVER, không phải client.**

Nếu để client kiểm tra rồi báo về "tôi đã kiểm tra rồi, hợp lệ", kẻ tấn công chỉ cần dịch ngược app và gửi thẳng request `{"liveness_ok": true}` lên. Client chỉ được phép làm **tiền lọc để tiết kiệm băng thông** (không gửi ảnh mờ, ảnh không có mặt). Quyết định cuối cùng luôn thuộc về server.

---

<a name="phần-4"></a>
## Phần 4 — Kiến trúc hệ thống

### 4.1. Sơ đồ tổng thể

```
 ┌──────────────────┐        ┌──────────────────┐
 │  KIOSK (tablet)  │        │  APP điện thoại  │
 │  PWA / Flutter   │        │  Flutter / RN    │
 │  đặt ở cửa       │        │  của nhân viên   │
 └────────┬─────────┘        └────────┬─────────┘
          │  HTTPS (ảnh + nonce + device_id + JWT)
          └────────────┬──────────────┘
                       ▼
        ┌──────────────────────────────┐
        │   NEXT.JS 15  (App Router)   │
        │  ┌────────────────────────┐  │
        │  │ Route Handlers  /api   │  │  ← xác thực, phân quyền, nghiệp vụ
        │  ├────────────────────────┤  │
        │  │ Server Components      │  │  ← web quản lý
        │  └────────────────────────┘  │
        └───┬──────────┬───────────┬───┘
            │          │           │
            │          │           └──────────────┐
            ▼          ▼                          ▼
 ┌────────────────┐  ┌──────────────┐   ┌──────────────────┐
 │ FACE SERVICE   │  │  PostgreSQL  │   │  Redis + BullMQ  │
 │ Python FastAPI │  │  + pgvector  │   │  queue tính công │
 │ InsightFace    │  │              │   └────────┬─────────┘
 │ + Anti-spoof   │  │  Prisma ORM  │            │
 │ (container)    │  └──────────────┘            ▼
 └────────┬───────┘                    ┌──────────────────┐
          │                            │  WORKER          │
          ▼                            │  Engine tính công│
 ┌────────────────┐                    └──────────────────┘
 │  MinIO / S3    │
 │  ảnh bằng chứng│
 └────────────────┘
```

### 4.2. Vì sao tách Face Service ra Python riêng

Đây là quyết định kiến trúc quan trọng, và câu trả lời là **có, nên tách**:

1. **Hệ sinh thái.** InsightFace, ONNXRuntime, OpenCV, các model anti-spoofing — tất cả đều là Python. Bên Node.js, `face-api.js` đã ngừng bảo trì và độ chính xác kém xa.
2. **Scale độc lập.** Face service ngốn CPU/GPU; web app ngốn I/O. Tách ra thì mở rộng riêng phần cần thiết.
3. **Nạp model một lần.** Model chiếm ~300MB RAM và mất vài giây để nạp. Process Python sống dai giữ model trong RAM; serverless function thì nạp lại mỗi lần → không dùng được.
4. **Cô lập sự cố.** Model crash không kéo sập web quản lý.

Giao tiếp: HTTP nội bộ (không expose ra internet), có API key riêng.

```
POST http://face-service:8000/v1/recognize
Content-Type: multipart/form-data
X-Internal-Key: <secret>

  image: <binary>
  scope_ids: [12, 45, 78, ...]     # danh sách employee_id cần tìm trong đó
  require_liveness: true

→ 200 {
    "face_found": true,
    "quality": { "blur": 142.3, "brightness": 128, "yaw": -4.2, "face_px": 218 },
    "liveness": { "score": 0.91, "passed": true },
    "matches": [
      { "employee_id": 45, "score": 0.7213 },
      { "employee_id": 78, "score": 0.3104 }
    ],
    "margin": 0.4109,
    "processing_ms": 187
  }
```

Lưu ý: face service **không tự quyết định** chấm công cho ai. Nó trả về số liệu; **backend nghiệp vụ mới là nơi ra quyết định** dựa trên ngưỡng đã cấu hình. Tách bạch như vậy giúp đổi ngưỡng mà không phải deploy lại model.

### 4.3. Kiosk hay app điện thoại

Hai mô hình khác nhau hoàn toàn, ảnh hưởng tới toàn bộ thiết kế chống gian lận:

| | **Kiosk tablet ở cửa** | **App trên điện thoại nhân viên** |
|---|---|---|
| Chế độ so khớp | 1:N (phải tự tìm ra ai) | 1:1 (đã đăng nhập, biết là ai) |
| Độ khó kỹ thuật | Cao hơn (bẫy 1:N) | Thấp hơn nhiều |
| Chống gian lận | Dễ — camera cố định, có người qua lại chứng kiến | Khó — GPS giả, chấm công ở nhà |
| Chi phí phần cứng | 3–8 triệu/thiết bị/cửa | 0 đồng |
| Phù hợp với | Nhà máy, văn phòng cố định, công nhân không có smartphone | Sales đi thị trường, nhân viên đa điểm, WFH |
| Vấn đề lớn nhất | Xếp hàng giờ cao điểm | Mock GPS + chấm công hộ |

**Nhiều hệ thống thật dùng cả hai**: kiosk cho khối văn phòng/nhà máy, app cho khối di động. Nếu vậy, thiết kế `Device` ngay từ đầu để hỗ trợ cả hai loại.

### 4.4. Danh sách công nghệ cụ thể

| Thành phần | Lựa chọn | Ghi chú |
|---|---|---|
| Web + API | Next.js 15 (App Router), React 19 | Đúng stack agent bạn đang cấu hình |
| UI | Tailwind CSS + shadcn/ui | Bảng dữ liệu dùng TanStack Table |
| ORM | Prisma | Kèm singleton client an toàn hot-reload |
| CSDL | PostgreSQL 16 + pgvector | Bật extension `vector` |
| Face | Python 3.11 + FastAPI + InsightFace + ONNXRuntime | Đóng gói Docker |
| Anti-spoof | Silent-Face-Anti-Spoofing (MiniFASNet) | ONNX |
| Queue | Redis + BullMQ | Job tính công, gửi thông báo |
| Lưu ảnh | MinIO (self-host) hoặc S3 | Bật lifecycle tự xoá sau 90 ngày |
| Auth | Auth.js v5 hoặc Lucia | RBAC tự viết |
| Xử lý thời gian | Luxon hoặc date-fns-tz | **Bắt buộc** thư viện có timezone |
| Export Excel | ExcelJS | Kế toán sẽ đòi file Excel, không phải CSV |
| Mobile | Flutter + `camera` + `google_mlkit_face_detection` | Hoặc PWA nếu chỉ làm kiosk |
| Deploy | Docker Compose (on-prem) hoặc VPS | Xem mục 9 về on-prem |

---

<a name="phần-5"></a>
## Phần 5 — Luồng nghiệp vụ chi tiết

### 5.1. Luồng đăng ký khuôn mặt (Enrollment)

```
HR mở trang "Đăng ký khuôn mặt" cho nhân viên #45
  │
  ├─ 1. Chọn nhân viên, kiểm tra chưa có hồ sơ khuôn mặt active
  │
  ├─ 2. Hiển thị màn hình chụp, hướng dẫn từng bước:
  │      "Nhìn thẳng"  → chụp
  │      "Quay trái"   → chụp
  │      "Quay phải"   → chụp
  │      "Hơi ngẩng"   → chụp
  │      "Hơi cúi"     → chụp
  │
  ├─ 3. Mỗi ảnh: client kiểm tra sơ bộ (có mặt, đủ sáng, đủ nét)
  │      → nếu không đạt, yêu cầu chụp lại NGAY (đừng để đến cuối)
  │
  ├─ 4. Gửi cả 5 ảnh lên server
  │
  ├─ 5. Face service với TỪNG ảnh:
  │      detect → kiểm tra chất lượng → align → embed
  │      → nếu ảnh nào fail, báo rõ lý do ("ảnh 3 bị mờ")
  │
  ├─ 6. Kiểm tra tính nhất quán:
  │      similarity giữa các ảnh với nhau ≥ 0.5?
  │      → nếu không: có thể lẫn ảnh người khác → từ chối
  │
  ├─ 7. Kiểm tra trùng lặp toàn hệ thống:
  │      so với TẤT CẢ embedding đang có
  │      → nếu khớp > 0.6 với người khác: CẢNH BÁO HR xác minh
  │        (nhập trùng nhân viên? sinh đôi? gian lận?)
  │
  ├─ 8. Lưu: embedding (mã hoá) + ảnh gốc (S3, để audit)
  │      Ghi consent: ai đồng ý, lúc nào, phiên bản điều khoản nào
  │
  └─ 9. Ghi audit log: HR nào enroll cho ai, lúc mấy giờ
```

**Ai được enroll?** Chỉ HR/Admin, không bao giờ để nhân viên tự enroll không giám sát — nếu không họ sẽ enroll ảnh người khác.

### 5.2. Luồng chấm công (Check-in / Check-out)

Đây là luồng chạy hàng nghìn lần mỗi ngày, phải nhanh (< 2 giây) và chặt về bảo mật.

```
 CLIENT                          SERVER                      FACE SERVICE
   │                                │                              │
   │ 1. GET /api/attendance/challenge                              │
   │───────────────────────────────►│                              │
   │                                │ sinh nonce ngẫu nhiên,       │
   │                                │ lưu Redis TTL 30s            │
   │◄───────────────────────────────│                              │
   │   { nonce, server_time }       │                              │
   │                                │                              │
   │ 2. Mở camera, detect mặt local │                              │
   │    Kiểm tra: có mặt? đủ nét?   │                              │
   │    đủ sáng? mặt đủ to?         │                              │
   │    → chỉ khi ĐẠT mới chụp      │                              │
   │                                │                              │
   │ 3. Chụp burst 3 khung          │                              │
   │                                │                              │
   │ 4. POST /api/attendance/punch  │                              │
   │    { nonce, images[3],         │                              │
   │      device_id, lat, lng,      │                              │
   │      device_signature }        │                              │
   │───────────────────────────────►│                              │
   │                                │                              │
   │                       5. KIỂM TRA TRƯỚC KHI GỌI AI:           │
   │                          ├ nonce hợp lệ, chưa dùng, chưa hết hạn
   │                          ├ device_id đã đăng ký & đang active │
   │                          ├ chữ ký thiết bị đúng               │
   │                          ├ GPS trong geofence chi nhánh       │
   │                          ├ không phải mock location           │
   │                          └ không spam (rate limit)            │
   │                                │                              │
   │                       6. Xác định scope tìm kiếm:             │
   │                          nhân viên thuộc chi nhánh của device │
   │                          + có ca hôm nay + đang active        │
   │                          → thường N giảm từ 1000 xuống ~80    │
   │                                │                              │
   │                       7. Gọi face service ─────────────────► │
   │                                │    detect → quality →        │
   │                                │    liveness → embed →        │
   │                                │    search trong scope        │
   │                                │◄──────────────────────────── │
   │                                │  { liveness, matches[], ... }│
   │                                │                              │
   │                       8. RA QUYẾT ĐỊNH:                       │
   │                          ├ liveness.score < 0.4  → TỪ CHỐI + cảnh báo
   │                          ├ liveness 0.4-0.7      → yêu cầu challenge
   │                          ├ best.score < ngưỡng   → TỪ CHỐI, gợi ý PIN
   │                          ├ (best - second) < margin → TỪ CHỐI (phân vân)
   │                          └ ĐẠT → tiếp tục                     │
   │                                │                              │
   │                       9. Xác định IN hay OUT:                 │
   │                          (xem thuật toán 5.3 bên dưới)        │
   │                                │                              │
   │                      10. Ghi AttendanceLog                    │
   │                          - thời gian = GIỜ SERVER, không phải giờ client
   │                          - lưu score, liveness, GPS, device   │
   │                          - upload ảnh bằng chứng lên S3       │
   │                          - xoá nonce khỏi Redis (chống dùng lại)
   │                                │                              │
   │                      11. Đẩy job "recalc_daily" vào queue     │
   │                                │                              │
   │◄───────────────────────────────│                              │
   │  { ok: true,                   │                              │
   │    employee: "Nguyễn Văn An",  │                              │
   │    type: "CHECK_IN",           │                              │
   │    time: "07:58",              │                              │
   │    message: "Đúng giờ" }       │                              │
   │                                │                              │
   │ 12. Hiển thị tên + ảnh + giờ, phát tiếng "tinh"               │
```

**Chi tiết dễ bỏ sót:** bước 12 phải hiển thị **tên và ảnh đại diện** của người vừa được nhận. Nếu hệ thống nhận nhầm, chính nhân viên đứng đó sẽ phát hiện ngay và báo lại — đây là lớp kiểm soát rẻ tiền và hiệu quả nhất.

### 5.3. Thuật toán xác định IN hay OUT

Nghe đơn giản nhưng có nhiều bẫy. Ba cách tiếp cận:

**Cách A — Nhân viên tự chọn (đơn giản, ít lỗi nhất)**
Màn hình có 2 nút to: "VÀO" và "RA". Kiosk ở nhà máy hay dùng cách này.
Ưu: không bao giờ đoán sai. Nhược: nhân viên bấm nhầm.

**Cách B — Tự suy luận theo lịch sử trong ngày**

```typescript
function determinePunchType(
  todayLogs: AttendanceLog[],
  now: Date,
  shift: Shift | null
): PunchType {
  // Chống bấm trùng: trong 3 phút, coi như cùng một lần
  const last = todayLogs.at(-1)
  if (last && minutesBetween(last.punchedAt, now) < 3) {
    return 'DUPLICATE'          // bỏ qua, không ghi bản ghi mới
  }

  // Chưa có bản ghi nào hôm nay → chắc chắn là VÀO
  if (todayLogs.length === 0) return 'CHECK_IN'

  // Xen kẽ: lần cuối VÀO thì lần này RA và ngược lại
  return last!.type === 'CHECK_IN' ? 'CHECK_OUT' : 'CHECK_IN'
}
```

**Cách C — Suy luận theo khoảng cách tới mốc ca (thông minh nhất)**
Nếu thời điểm hiện tại gần giờ bắt đầu ca hơn giờ kết thúc → là VÀO, ngược lại là RA. Xử lý tốt trường hợp nhân viên quên chấm công buổi sáng và chấm lần đầu lúc 17h.

**Khuyến nghị:** dùng B làm mặc định, **hiển thị rõ kết quả suy luận trên màn hình** ("Bạn vừa CHECK-OUT lúc 17:32"), và cho phép nhân viên bấm nút sửa nếu sai. Kèm theo là quy trình gửi đơn giải trình cho trường hợp sai sót.

**Bẫy quan trọng nhất — "hôm nay" là ngày nào?**
Nhân viên ca đêm chấm vào lúc 22h ngày 15, chấm ra lúc 6h ngày 16. Nếu định nghĩa "hôm nay" theo lịch, bản ghi rơi vào 2 ngày khác nhau và engine tính công sẽ báo "ngày 15 thiếu giờ ra" + "ngày 16 thiếu giờ vào". Xem cách xử lý ở [Phần 7.3](#73--xử-lý-ca-qua-đêm).

### 5.4. Luồng duyệt đơn

```
Nhân viên tạo đơn (nghỉ phép / OT / giải trình quên chấm công)
  │
  ├─ Hệ thống kiểm tra hợp lệ:
  │    · Nghỉ phép: còn đủ số ngày phép không?
  │    · Có trùng với đơn đã duyệt khác không?
  │    · Có nằm trong kỳ công đã CHỐT không? → nếu có thì chặn
  │
  ├─ Sinh chuỗi bước duyệt theo cấu hình:
  │    Bước 1: Quản lý trực tiếp
  │    Bước 2: Trưởng phòng (nếu nghỉ > 3 ngày)
  │    Bước 3: HR (ghi nhận)
  │
  ├─ Gửi thông báo cho người duyệt bước 1
  │    (email + thông báo trong app; nếu người đó đang nghỉ
  │     → chuyển cho người được uỷ quyền)
  │
  ├─ Người duyệt: Duyệt / Từ chối / Yêu cầu bổ sung
  │
  ├─ Duyệt hết các bước → trạng thái APPROVED
  │
  └─ ⚠ QUAN TRỌNG: kích hoạt TÍNH LẠI CÔNG cho các ngày bị ảnh hưởng
       (đơn thường được duyệt SAU khi ngày đó đã trôi qua và đã tính công)
```

Điểm mấu chốt: **đơn từ được duyệt ngược về quá khứ là chuyện bình thường.** Nhân viên ốm đột xuất nghỉ ngày 10, đến ngày 14 mới nộp đơn, ngày 15 sếp mới duyệt. Engine tính công **bắt buộc phải hỗ trợ tính lại** một ngày bất kỳ trong quá khứ. Đây là lý do phải tách bản ghi thô và bản ghi đã tính.

---

<a name="phần-6"></a>
## Phần 6 — Thiết kế cơ sở dữ liệu

### 6.1. Nguyên tắc thiết kế quan trọng nhất

**Tách bản ghi THÔ và bản ghi ĐÃ TÍNH.**

```
AttendanceLog  (thô)              AttendanceDaily  (đã tính)
─────────────────────             ──────────────────────────
Sự kiện đã xảy ra                 Kết quả diễn giải sự kiện
BẤT BIẾN — không bao giờ sửa      Có thể tính lại bất cứ lúc nào
1 dòng = 1 lần quét mặt           1 dòng = 1 nhân viên × 1 ngày
Xoá = mất bằng chứng              Xoá = chỉ cần chạy lại job
```

Vì sao bắt buộc phải tách:
- Đơn nghỉ duyệt muộn → phải tính lại ngày cũ
- Sửa cấu hình ca (đổi giờ vào từ 8h00 sang 8h15) → tính lại cả tháng
- Sửa lỗi bug trong công thức OT → tính lại toàn bộ
- Kiểm toán yêu cầu: "chứng minh con số này ra từ đâu" → truy ngược về log thô

Nếu bạn tính công ngay lúc chấm và chỉ lưu kết quả, mọi thay đổi sau đó đều thành ác mộng.

### 6.2. Sơ đồ quan hệ

```
Company
  └─ Branch (chi nhánh, có toạ độ + bán kính geofence)
       ├─ Department
       │    └─ Employee ──┬── FaceProfile   (nhiều embedding / người)
       │                  ├── UserAccount   (tài khoản đăng nhập)
       │                  ├── DeviceBinding (thiết bị đã đăng ký)
       │                  ├── ShiftAssignment ── Shift
       │                  ├── AttendanceLog     (thô, bất biến)
       │                  ├── AttendanceDaily   (đã tính)
       │                  ├── LeaveRequest ── ApprovalStep
       │                  ├── OvertimeRequest
       │                  └── LeaveBalance      (số phép còn lại)
       └─ Device (kiosk)

Holiday          (lễ, theo công ty hoặc quốc gia)
PayrollPeriod    (kỳ công, có trạng thái mở/chốt)
AuditLog         (mọi thao tác nhạy cảm)
SystemConfig     (ngưỡng nhận diện, quy tắc làm tròn...)
```

### 6.3. Schema Prisma (rút gọn, tập trung phần cốt lõi)

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions"]
}

datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  extensions = [vector]
}

// ─────────────────────────── TỔ CHỨC ───────────────────────────

model Company {
  id        String   @id @default(cuid())
  name      String
  taxCode   String?
  timezone  String   @default("Asia/Ho_Chi_Minh")
  branches  Branch[]
  createdAt DateTime @default(now())
}

model Branch {
  id          String   @id @default(cuid())
  companyId   String
  company     Company  @relation(fields: [companyId], references: [id])
  name        String
  address     String?
  // Geofence — dùng để kiểm tra app điện thoại chấm công có đúng chỗ không
  latitude    Float?
  longitude   Float?
  radiusM     Int      @default(200)
  wifiBssids  String[] @default([])   // chống giả GPS: kiểm tra thêm Wi-Fi
  departments Department[]
  employees   Employee[]
  devices     Device[]
}

model Department {
  id        String     @id @default(cuid())
  branchId  String
  branch    Branch     @relation(fields: [branchId], references: [id])
  name      String
  managerId String?
  employees Employee[]
}

// ─────────────────────────── NHÂN SỰ ───────────────────────────

model Employee {
  id           String    @id @default(cuid())
  code         String    // mã nhân viên, dùng cho fallback 1:1
  fullName     String
  email        String?
  phone        String?
  branchId     String
  branch       Branch    @relation(fields: [branchId], references: [id])
  departmentId String?
  department   Department? @relation(fields: [departmentId], references: [id])
  managerId    String?     // để định tuyến duyệt đơn
  joinedAt     DateTime
  leftAt       DateTime?   // nghỉ việc → phải xoá dữ liệu sinh trắc
  status       EmployeeStatus @default(ACTIVE)

  faceProfiles      FaceProfile[]
  attendanceLogs    AttendanceLog[]
  attendanceDailies AttendanceDaily[]
  shiftAssignments  ShiftAssignment[]
  leaveRequests     LeaveRequest[]
  deviceBindings    DeviceBinding[]

  @@unique([branchId, code])
  @@index([branchId, status])
}

enum EmployeeStatus { ACTIVE INACTIVE ON_LEAVE TERMINATED }

// ────────────────────── DỮ LIỆU SINH TRẮC ──────────────────────

model FaceProfile {
  id          String   @id @default(cuid())
  employeeId  String
  employee    Employee @relation(fields: [employeeId], references: [id], onDelete: Cascade)

  // Vector 512 chiều. Prisma chưa hỗ trợ kiểu vector natively
  // → khai báo Unsupported, thao tác qua $queryRaw
  embedding   Unsupported("vector(512)")

  // Ảnh gốc để audit — KHÔNG dùng để nhận diện, chỉ để đối chiếu khi tranh chấp
  imageKey    String?   // key trên S3/MinIO
  pose        FacePose  @default(FRONTAL)
  quality     Float?    // điểm chất lượng lúc enroll
  isActive    Boolean   @default(true)

  enrolledBy  String    // ai enroll — bắt buộc, để truy trách nhiệm
  enrolledAt  DateTime  @default(now())
  expiresAt   DateTime? // buộc enroll lại định kỳ (vd 2 năm)

  @@index([employeeId, isActive])
}

enum FacePose { FRONTAL LEFT RIGHT UP DOWN GLASSES }

// Bản đồng ý xử lý dữ liệu sinh trắc — BẮT BUỘC theo Nghị định 13/2023
model BiometricConsent {
  id           String    @id @default(cuid())
  employeeId   String    @unique
  consentedAt  DateTime
  policyVersion String                 // phiên bản điều khoản đã ký
  signatureKey String?                 // ảnh chữ ký / file PDF đã ký
  method       String                  // "PAPER" | "E_SIGN" | "IN_APP"
  revokedAt    DateTime?               // rút lại đồng ý → phải xoá embedding
  ipAddress    String?
}

// ─────────────────────── THIẾT BỊ ───────────────────────

model Device {
  id           String     @id @default(cuid())
  branchId     String
  branch       Branch     @relation(fields: [branchId], references: [id])
  name         String                    // "Kiosk cổng chính"
  type         DeviceType
  serial       String     @unique
  apiKeyHash   String                    // thiết bị tự xác thực bằng key riêng
  isActive     Boolean    @default(true)
  lastSeenAt   DateTime?
  appVersion   String?
  logs         AttendanceLog[]
}

enum DeviceType { KIOSK MOBILE_APP WEB }

// Ràng buộc nhân viên ↔ điện thoại: chống chấm công hộ
model DeviceBinding {
  id           String   @id @default(cuid())
  employeeId   String
  employee     Employee @relation(fields: [employeeId], references: [id])
  deviceUuid   String                     // định danh phần cứng
  deviceModel  String?
  platform     String?                    // "android" | "ios"
  isApproved   Boolean  @default(false)   // đổi máy phải admin duyệt
  approvedBy   String?
  boundAt      DateTime @default(now())
  revokedAt    DateTime?

  @@unique([employeeId, deviceUuid])
}

// ─────────────────────── CA LÀM VIỆC ───────────────────────

model Shift {
  id             String  @id @default(cuid())
  companyId      String
  name           String                  // "Ca hành chính", "Ca đêm"
  code           String

  // Lưu dạng "HH:mm" theo giờ địa phương, KHÔNG lưu DateTime
  startTime      String                  // "08:00"
  endTime        String                  // "17:30"
  crossesMidnight Boolean @default(false) // ca đêm 22:00 → 06:00

  breakMinutes   Int     @default(60)    // nghỉ trưa, trừ tự động
  breakStartTime String?                 // "12:00" — nếu cần chấm cả giờ nghỉ

  // Quy tắc dung sai
  lateGraceMin      Int @default(5)      // muộn ≤ 5 phút thì bỏ qua
  earlyLeaveGraceMin Int @default(5)
  // Cửa sổ nhận chấm công quanh ca
  checkInBeforeMin  Int @default(120)    // cho phép vào sớm 2 tiếng
  checkOutAfterMin  Int @default(240)    // cho phép ra muộn 4 tiếng (OT)

  workdayValue   Decimal @default(1.0) @db.Decimal(4,2)  // quy đổi ra công

  assignments    ShiftAssignment[]
  @@unique([companyId, code])
}

model ShiftAssignment {
  id         String   @id @default(cuid())
  employeeId String
  employee   Employee @relation(fields: [employeeId], references: [id])
  shiftId    String
  shift      Shift    @relation(fields: [shiftId], references: [id])
  effectiveFrom DateTime @db.Date
  effectiveTo   DateTime? @db.Date
  // Mẫu lặp: bitmask thứ trong tuần, hoặc lịch cụ thể theo ngày
  weekdays   Int[]    @default([1,2,3,4,5])   // 1=T2 ... 7=CN

  @@index([employeeId, effectiveFrom])
}

// ──────────────── CHẤM CÔNG: THÔ và ĐÃ TÍNH ────────────────

/// BẤT BIẾN. Không bao giờ UPDATE hay DELETE bản ghi ở bảng này.
model AttendanceLog {
  id           String    @id @default(cuid())
  employeeId   String
  employee     Employee  @relation(fields: [employeeId], references: [id])
  deviceId     String?
  device       Device?   @relation(fields: [deviceId], references: [id])

  punchedAt    DateTime               // GIỜ SERVER (UTC), không tin giờ client
  /// Ngày công logic — với ca đêm KHÁC với ngày lịch của punchedAt
  workDate     DateTime  @db.Date
  type         PunchType

  // Bằng chứng nhận diện
  matchScore   Float?                 // cosine similarity
  matchMargin  Float?                 // khoảng cách với người xếp nhì
  livenessScore Float?
  imageKey     String?                // ảnh bằng chứng trên S3

  // Bằng chứng vị trí
  latitude     Float?
  longitude    Float?
  gpsAccuracyM Float?
  wifiBssid    String?
  isMockGps    Boolean   @default(false)

  source       PunchSource @default(FACE)
  isSuspicious Boolean   @default(false)   // gắn cờ cho admin xem lại
  note         String?

  createdAt    DateTime  @default(now())

  @@index([employeeId, workDate])
  @@index([workDate, deviceId])
}

enum PunchType   { CHECK_IN CHECK_OUT BREAK_START BREAK_END }
enum PunchSource { FACE PIN QR CARD MANUAL IMPORT }

/// Kết quả đã tính. CÓ THỂ xoá và tính lại bất cứ lúc nào.
model AttendanceDaily {
  id          String   @id @default(cuid())
  employeeId  String
  employee    Employee @relation(fields: [employeeId], references: [id])
  workDate    DateTime @db.Date
  shiftId     String?

  firstInAt   DateTime?
  lastOutAt   DateTime?

  workMinutes     Int @default(0)   // giờ làm thực tế (đã trừ nghỉ)
  lateMinutes     Int @default(0)
  earlyLeaveMinutes Int @default(0)
  otMinutes       Int @default(0)   // CHỈ tính phần OT đã được duyệt

  status      DailyStatus
  workdayValue Decimal @db.Decimal(4,2) @default(0)  // 1.0 / 0.5 / 0

  hasIssue    Boolean  @default(false)   // thiếu chấm công, bất thường
  issueNote   String?

  /// Phiên bản bộ quy tắc dùng để tính — khi đổi rule biết dòng nào cần tính lại
  ruleVersion String?
  calculatedAt DateTime @default(now())
  isLocked    Boolean  @default(false)   // kỳ công đã chốt → cấm sửa

  @@unique([employeeId, workDate])
  @@index([workDate, status])
}

enum DailyStatus {
  PRESENT          // đi làm đủ
  LATE             // đi muộn
  EARLY_LEAVE      // về sớm
  ABSENT           // vắng không phép
  ON_LEAVE         // nghỉ có phép
  HOLIDAY          // ngày lễ
  WEEKEND          // ngày nghỉ tuần
  MISSING_PUNCH    // thiếu giờ vào hoặc ra
  BUSINESS_TRIP    // công tác
  WFH              // làm việc tại nhà
}

// ─────────────────────── ĐƠN TỪ ───────────────────────

model LeaveRequest {
  id          String   @id @default(cuid())
  employeeId  String
  employee    Employee @relation(fields: [employeeId], references: [id])
  type        LeaveType
  startDate   DateTime @db.Date
  endDate     DateTime @db.Date
  isHalfDay   Boolean  @default(false)
  halfDayPart String?                 // "MORNING" | "AFTERNOON"
  totalDays   Decimal  @db.Decimal(4,2)
  reason      String
  attachmentKey String?               // giấy khám bệnh...
  status      RequestStatus @default(PENDING)
  steps       ApprovalStep[]
  createdAt   DateTime @default(now())

  @@index([employeeId, startDate])
}

enum LeaveType {
  ANNUAL         // phép năm
  SICK           // nghỉ ốm
  UNPAID         // không lương
  MATERNITY      // thai sản
  MARRIAGE       // cưới
  BEREAVEMENT    // tang
  BUSINESS_TRIP  // công tác
  WFH
  COMPENSATORY   // nghỉ bù
}

model ApprovalStep {
  id          String   @id @default(cuid())
  requestId   String
  request     LeaveRequest @relation(fields: [requestId], references: [id], onDelete: Cascade)
  stepOrder   Int
  approverId  String
  delegateId  String?                 // người được uỷ quyền khi sếp đi vắng
  status      RequestStatus @default(PENDING)
  comment     String?
  actedAt     DateTime?

  @@unique([requestId, stepOrder])
}

enum RequestStatus { PENDING APPROVED REJECTED CANCELLED NEED_INFO }

model LeaveBalance {
  id          String @id @default(cuid())
  employeeId  String
  year        Int
  type        LeaveType
  entitled    Decimal @db.Decimal(5,2)   // được cấp
  carriedOver Decimal @db.Decimal(5,2) @default(0)  // chuyển từ năm trước
  used        Decimal @db.Decimal(5,2) @default(0)
  pending     Decimal @db.Decimal(5,2) @default(0)  // đơn đang chờ duyệt

  @@unique([employeeId, year, type])
}

// ─────────────────── LỊCH & KỲ CÔNG ───────────────────

model Holiday {
  id        String   @id @default(cuid())
  companyId String
  date      DateTime @db.Date
  name      String                     // "Giỗ Tổ Hùng Vương"
  isPaid    Boolean  @default(true)
  /// Ngày đi làm bù cho ngày nghỉ này (đặc thù VN dịp lễ dài)
  makeUpDate DateTime? @db.Date

  @@unique([companyId, date])
}

model PayrollPeriod {
  id        String   @id @default(cuid())
  companyId String
  name      String                     // "Tháng 07/2026"
  startDate DateTime @db.Date
  endDate   DateTime @db.Date          // kỳ công có thể là 26/6 → 25/7
  status    PeriodStatus @default(OPEN)
  lockedAt  DateTime?
  lockedBy  String?

  @@unique([companyId, startDate])
}

enum PeriodStatus { OPEN CALCULATING REVIEWING LOCKED EXPORTED }

// ─────────────────────── AUDIT ───────────────────────

model AuditLog {
  id         String   @id @default(cuid())
  actorId    String?                    // ai làm
  actorRole  String?
  action     String                     // "ATTENDANCE_MANUAL_EDIT"
  entityType String
  entityId   String
  before     Json?
  after      Json?
  ipAddress  String?
  userAgent  String?
  createdAt  DateTime @default(now())

  @@index([entityType, entityId])
  @@index([actorId, createdAt])
}
```

### 6.4. Vài lưu ý kỹ thuật về schema

**Vì sao `startTime` là String `"08:00"` chứ không phải DateTime?**
Ca làm việc là một **giờ trong ngày**, không phải một thời điểm cụ thể. Lưu DateTime buộc bạn phải gắn nó với một ngày nào đó (vô nghĩa) và sẽ hỏng khi đổi múi giờ hoặc qua mốc DST. Lưu `"HH:mm"` rồi kết hợp với `workDate` lúc tính toán.

**Vì sao `punchedAt` là DateTime (UTC) còn `workDate` là Date riêng?**
`punchedAt` là thời điểm tuyệt đối — lưu UTC, hiển thị theo `Asia/Ho_Chi_Minh`.
`workDate` là **ngày công logic**, do engine gán. Ca đêm bắt đầu 22h ngày 15 và kết thúc 6h ngày 16 → cả hai bản ghi đều có `workDate = 15`. Đây là chìa khoá xử lý ca qua đêm.

**Prisma và pgvector.** Prisma chưa hỗ trợ kiểu `vector` natively. Khai báo `Unsupported("vector(512)")` để `prisma migrate` sinh cột đúng, còn đọc/ghi phải qua raw query:

```typescript
await prisma.$executeRaw`
  INSERT INTO "FaceProfile" (id, "employeeId", embedding, "enrolledBy", pose)
  VALUES (${id}, ${employeeId}, ${JSON.stringify(vec)}::vector, ${userId}, 'FRONTAL')
`
```

**Chỉ mục quan trọng nhất:** `AttendanceLog(employeeId, workDate)`. Mọi truy vấn tính công đều đi qua nó. Bảng này lớn nhanh nhất — 500 nhân viên × 4 lần chấm × 250 ngày = 500.000 dòng/năm. Cân nhắc phân vùng theo tháng khi vượt 10 triệu dòng.

---

<a name="phần-7"></a>
## Phần 7 — Engine tính công (phần tốn code nhất)

Đây là **trái tim của hệ thống** và cũng là nơi phát sinh nhiều bug nhất. Hãy dành thời gian xứng đáng cho nó.

### 7.1. Nguyên tắc thiết kế

Engine là một **hàm thuần (pure function)**:

```
tính_công(nhân_viên, ngày, [log thô], ca, [đơn từ], [lễ], bộ_quy_tắc)
      → bản_ghi_công_ngày
```

Bốn tính chất bắt buộc:

1. **Idempotent** — chạy 100 lần với cùng đầu vào ra cùng kết quả. Không cộng dồn, không phụ thuộc trạng thái cũ.
2. **Tính lại được** — có thể tính lại một ngày bất kỳ trong quá khứ (trừ khi kỳ đã chốt).
3. **Không đọc/ghi lung tung** — nhận đầu vào rõ ràng, trả kết quả rõ ràng. Điều này giúp **viết unit test dễ dàng** — và bạn sẽ cần rất nhiều test.
4. **Ghi rõ lý do** — mỗi con số phải giải thích được: "muộn 12 phút vì chấm vào 08:12 trong khi ca bắt đầu 08:00, dung sai 5 phút không áp dụng vì vượt quá".

### 7.2. Thuật toán từng bước

```
BƯỚC 1 — Xác định bối cảnh của ngày
  · Ngày này là lễ? → status = HOLIDAY, thoát (trừ khi có chấm công → OT lễ)
  · Là ngày nghỉ tuần theo lịch ca? → status = WEEKEND (vẫn kiểm tra OT)
  · Nhân viên có ca hôm nay không? → không có ca thì không tính vắng
  · Có đơn nghỉ ĐÃ DUYỆT phủ ngày này? → status = ON_LEAVE, thoát

BƯỚC 2 — Thu thập log thuộc ngày công này
  · Lấy tất cả AttendanceLog có workDate = ngày đang tính
  · Sắp xếp theo punchedAt tăng dần
  · Loại bỏ bản ghi trùng (cách nhau < 3 phút, cùng loại)

BƯỚC 3 — Ghép cặp VÀO / RA
  · Duyệt tuần tự, ghép IN với OUT kế tiếp
  · IN không có OUT → cặp dở dang
  · OUT không có IN trước đó → bản ghi mồ côi
  → Nếu có bất thường: hasIssue = true, MISSING_PUNCH, đợi đơn giải trình

BƯỚC 4 — Tính các chỉ số
  first_in   = thời điểm IN sớm nhất
  last_out   = thời điểm OUT muộn nhất

  late_min   = max(0, first_in − giờ_bắt_đầu_ca − dung_sai_muộn)
  early_min  = max(0, giờ_kết_thúc_ca − last_out − dung_sai_về_sớm)

  work_min   = tổng các khoảng (OUT − IN) của các cặp hợp lệ
  work_min  −= thời_gian_nghỉ_trưa   (nếu ca cấu hình trừ tự động
                                       VÀ khoảng làm việc có phủ giờ nghỉ)

BƯỚC 5 — Tính OT
  ⚠ CHỈ tính phần đã có OvertimeRequest ĐƯỢC DUYỆT
  Ở lại muộn tự phát KHÔNG phải OT — nếu không nhân viên sẽ
  cố tình ngồi lại để ăn thêm lương.

  ot_min = min(thời_gian_ở_lại_thực_tế, thời_gian_OT_được_duyệt)

  Hệ số theo Bộ luật Lao động 2019:
    Ngày thường          ×1.5
    Ngày nghỉ hằng tuần  ×2.0
    Ngày lễ, Tết         ×3.0
    Làm ban đêm (22h–6h) cộng thêm ×0.3

BƯỚC 6 — Làm tròn (theo cấu hình công ty)
  Ví dụ làm tròn 15 phút:
    · Đi muộn → làm tròn LÊN (bất lợi cho nhân viên)
    · OT      → làm tròn XUỐNG
  ⚠ Quy tắc này phải ghi rõ trong nội quy lao động, nếu không
    sẽ bị khiếu nại. Hãy để nó là CẤU HÌNH, đừng hard-code.

BƯỚC 7 — Kết luận trạng thái và giá trị công
  work_min = 0                       → ABSENT,      workday = 0
  thiếu giờ vào hoặc ra              → MISSING_PUNCH, cần xử lý
  work_min < 50% ca                  → workday = 0.5
  late_min > 0                       → LATE,        workday = 1.0
  đủ giờ                             → PRESENT,     workday = 1.0

BƯỚC 8 — Ghi kết quả
  · UPSERT vào AttendanceDaily theo khoá (employeeId, workDate)
  · Ghi kèm ruleVersion đang dùng
  · Nếu isLocked = true → KHÔNG ghi đè, ghi cảnh báo thay vào đó
```

### 7.3. Xử lý ca qua đêm

Đây là **bug kinh điển số 1** của mọi hệ thống chấm công. Hãy xử lý ngay từ đầu.

**Vấn đề:**
Ca đêm 22:00 → 06:00. Anh Nam chấm vào 21:55 ngày 15/07, chấm ra 06:10 ngày 16/07.

Nếu gán `workDate` theo ngày lịch của `punchedAt`:
- Ngày 15/07: có IN lúc 21:55, **không có OUT** → MISSING_PUNCH
- Ngày 16/07: có OUT lúc 06:10, **không có IN** → bản ghi mồ côi

Cả hai ngày đều sai. Bảng công của Nam đầy lỗi dù anh ấy đi làm đầy đủ.

**Giải pháp — khái niệm "ngày công logic" (`workDate`):**

Ngay tại thời điểm ghi log, engine xác định bản ghi này thuộc về ca nào, và gán `workDate` = **ngày bắt đầu của ca đó**, không phải ngày lịch.

```typescript
/**
 * Xác định ngày công logic cho một lần chấm công.
 * Với ca qua đêm, lần chấm lúc 06:10 ngày 16 thuộc về ngày công 15.
 */
function resolveWorkDate(
  punchedAt: DateTime,      // giờ địa phương
  shift: Shift
): DateTime {
  const calendarDate = punchedAt.startOf('day')

  if (!shift.crossesMidnight) {
    return calendarDate
  }

  // Ca đêm: dựng cửa sổ hợp lệ cho ngày công HÔM QUA
  const prevDay      = calendarDate.minus({ days: 1 })
  const prevShiftEnd = prevDay
    .plus({ days: 1 })                              // vì kết thúc rơi sang hôm sau
    .set(parseHHmm(shift.endTime))                  // 06:00
    .plus({ minutes: shift.checkOutAfterMin })      // + biên OT

  // Nếu thời điểm chấm vẫn nằm trong cửa sổ của ca hôm qua
  // → nó thuộc về NGÀY CÔNG HÔM QUA
  if (punchedAt <= prevShiftEnd) {
    return prevDay
  }

  return calendarDate
}
```

Sau đó **mọi truy vấn tính công đều dùng `workDate`, không bao giờ dùng `DATE(punchedAt)`**. Ca đêm trở nên hoàn toàn bình thường.

Với nhân viên xoay ca (hôm nay ca ngày, mai ca đêm), phải tra `ShiftAssignment` để biết ca nào đang áp dụng trước khi gọi hàm trên.

### 7.4. Múi giờ — quy tắc bất di bất dịch

```
LƯU vào CSDL          → luôn UTC (Prisma DateTime mặc định đã là UTC)
TÍNH TOÁN nghiệp vụ   → chuyển sang giờ địa phương của công ty
HIỂN THỊ              → giờ địa phương của người xem
SO SÁNH với giờ ca    → luôn ở giờ địa phương
```

**Không bao giờ dùng `new Date()` để làm việc với múi giờ.** Dùng Luxon:

```typescript
import { DateTime } from 'luxon'

const tz = company.timezone          // "Asia/Ho_Chi_Minh"

// UTC trong DB → giờ địa phương để so với ca
const local = DateTime.fromJSDate(log.punchedAt, { zone: 'utc' }).setZone(tz)

// "08:00" của ca → thời điểm cụ thể của ngày công đó
const shiftStart = DateTime.fromISO(
  `${workDate}T${shift.startTime}`, { zone: tz }
)

const lateMinutes = Math.max(
  0,
  local.diff(shiftStart, 'minutes').minutes - shift.lateGraceMin
)
```

Việt Nam không có DST nên đơn giản hơn nhiều nước, nhưng vẫn nên viết đúng ngay từ đầu — sau này mở rộng ra nước khác không phải viết lại.

### 7.5. Khi nào chạy engine

| Sự kiện kích hoạt | Phạm vi tính lại |
|---|---|
| Có lần chấm công mới | 1 nhân viên × 1 ngày (chạy async, độ trễ vài giây) |
| Đơn nghỉ/OT được duyệt | 1 nhân viên × khoảng ngày của đơn |
| Admin sửa công thủ công | 1 nhân viên × 1 ngày |
| Đổi phân ca | 1 nhân viên × khoảng hiệu lực |
| Đổi cấu hình ca / quy tắc | **tất cả nhân viên** dùng ca đó × kỳ đang mở |
| Cuối ngày (cron 01:00) | Toàn bộ nhân viên × ngày hôm trước — bắt các ca vắng mặt (không có log nào thì không có sự kiện nào kích hoạt) |
| Chốt kỳ công | Toàn bộ × cả kỳ, sau đó khoá |

Job cuối ngày rất quan trọng: nhân viên **vắng mặt** thì không tạo ra log nào, nên không có gì kích hoạt tính toán. Phải có cron quét toàn bộ để phát hiện họ.

### 7.6. Test — đừng bỏ qua phần này

Engine tính công là nơi **bắt buộc phải có unit test dày đặc**. Danh sách tình huống tối thiểu:

```
✓ Ngày bình thường, vào đúng giờ, ra đúng giờ
✓ Đi muộn 3 phút (trong dung sai 5 phút)  → KHÔNG tính muộn
✓ Đi muộn 12 phút                          → tính muộn 12 phút
✓ Về sớm
✓ Quên chấm ra                             → MISSING_PUNCH
✓ Quên chấm vào                            → MISSING_PUNCH
✓ Chấm 2 lần cách nhau 30 giây             → chỉ ghi nhận 1
✓ Chấm 6 lần trong ngày (ra ngoài ăn trưa) → ghép cặp đúng
✓ Ca đêm 22:00–06:00                       → gộp về 1 ngày công
✓ Ca đêm, chấm ra lúc 08:00 (OT 2 tiếng)   → vẫn thuộc ngày công hôm trước
✓ Ngày lễ, không đi làm                    → HOLIDAY, đủ công
✓ Ngày lễ, có đi làm, có đơn OT duyệt      → OT ×3.0
✓ Nghỉ phép nửa ngày sáng, chiều đi làm    → 0.5 công + 0.5 phép
✓ Đơn nghỉ duyệt SAU khi đã tính công      → tính lại đúng
✓ Nhân viên vào làm giữa tháng             → không tính vắng những ngày trước
✓ Nhân viên nghỉ việc giữa tháng           → không tính vắng những ngày sau
✓ Kỳ công đã chốt                          → từ chối mọi thay đổi
✓ Chạy engine 3 lần liên tiếp              → kết quả giống hệt (idempotent)
```

Nếu bạn chỉ viết test cho một phần của hệ thống, hãy chọn phần này.

---

<a name="phần-8"></a>
## Phần 8 — Chống gian lận

Chấm công gắn với tiền. Ở đâu có tiền, ở đó có người tìm cách lách. Đây là danh sách các kiểu gian lận thực tế và cách chặn.

### 8.1. Ma trận rủi ro

| Kiểu gian lận | Cách thực hiện | Biện pháp chặn |
|---|---|---|
| **Giơ ảnh/video** | Mở ảnh đồng nghiệp trên điện thoại | Liveness (Phần 3) |
| **Chấm công hộ trên app** | Đưa điện thoại cho đồng nghiệp | Device binding + liveness + so ảnh ngẫu nhiên |
| **Giả GPS** | App fake location, không cần root | Detect mock provider + kiểm tra Wi-Fi BSSID + kiểm tra tốc độ di chuyển bất khả thi |
| **Sửa giờ điện thoại** | Đổi đồng hồ hệ thống | **Luôn dùng giờ server** — client gửi giờ chỉ để tham khảo |
| **Gọi API trực tiếp** | Dịch ngược app, gửi HTTP thủ công | Nonce + device signature + certificate pinning + xác thực ở server |
| **Dùng lại request cũ** | Bắt gói tin rồi phát lại | Nonce dùng-một-lần, TTL 30 giây |
| **Chấm rồi về** | Chấm vào 8h, đi chơi, 17h về chấm ra | Chấm công giữa ca ngẫu nhiên / xác nhận vị trí định kỳ / camera giám sát |
| **Admin sửa công** | HR sửa số liệu cho người quen | Audit log bất biến + phân quyền tách bạch + báo cáo bất thường |
| **Enroll ảnh người khác** | Đăng ký khuôn mặt của người khác | Chỉ HR được enroll + lưu ảnh gốc + kiểm tra trùng lặp |

### 8.2. Kiến trúc bảo mật ở tầng request

**Nonce chống replay:**

```typescript
// Bước 1: client xin thử thách
export async function GET() {
  const nonce = crypto.randomUUID()
  await redis.set(`nonce:${nonce}`, '1', { EX: 30 })   // sống 30 giây
  return Response.json({ nonce, serverTime: new Date().toISOString() })
}

// Bước 2: khi chấm công, tiêu thụ nonce
const consumed = await redis.del(`nonce:${nonce}`)
if (consumed !== 1) {
  return Response.json({ error: 'NONCE_INVALID_OR_USED' }, { status: 400 })
}
```

`redis.del` trả về số key đã xoá — dùng nó làm phép kiểm tra nguyên tử. Hai request cùng nonce thì chỉ một request thắng.

**Chống mock GPS:**

```typescript
function validateLocation(punch: PunchInput, branch: Branch, lastPunch?: AttendanceLog) {
  const issues: string[] = []

  // 1. Client báo là mock (Android cung cấp cờ này)
  if (punch.isMockLocation) issues.push('MOCK_LOCATION_FLAG')

  // 2. Ngoài vùng geofence
  const distance = haversine(punch.lat, punch.lng, branch.latitude!, punch.lng)
  if (distance > branch.radiusM + punch.gpsAccuracyM) issues.push('OUTSIDE_GEOFENCE')

  // 3. Độ chính xác GPS quá tệ → nghi ngờ giả lập
  if (punch.gpsAccuracyM > 100) issues.push('LOW_GPS_ACCURACY')

  // 4. Tốc độ di chuyển bất khả thi ("teleport")
  if (lastPunch?.latitude) {
    const km = haversine(punch.lat, punch.lng, lastPunch.latitude, lastPunch.longitude!) / 1000
    const hours = (Date.now() - lastPunch.punchedAt.getTime()) / 3_600_000
    if (hours > 0 && km / hours > 900) issues.push('IMPOSSIBLE_TRAVEL')  // nhanh hơn máy bay
  }

  // 5. Wi-Fi văn phòng — bằng chứng mạnh hơn GPS, rất khó giả
  if (branch.wifiBssids.length && punch.wifiBssid) {
    if (!branch.wifiBssids.includes(punch.wifiBssid)) issues.push('UNKNOWN_WIFI')
  }

  return issues
}
```

**Nguyên tắc xử lý:** phát hiện bất thường thì **vẫn ghi nhận chấm công** nhưng gắn cờ `isSuspicious = true` và báo cho admin xem lại. Đừng chặn cứng — GPS trong nhà cao tầng sai lệch là chuyện thường, chặn cứng sẽ khiến nhân viên thật không chấm được và bạn sẽ phải gỡ tính năng.

### 8.3. Phân quyền (RBAC)

Tối thiểu 5 vai trò:

| Vai trò | Quyền |
|---|---|
| **EMPLOYEE** | Xem công của chính mình, tạo đơn, chấm công |
| **MANAGER** | + Xem công nhân viên dưới quyền, duyệt đơn bước 1 |
| **HR** | + Quản lý nhân sự, enroll khuôn mặt, cấu hình ca, sửa công (có audit) |
| **ADMIN** | + Cấu hình hệ thống, quản lý thiết bị, chốt kỳ công |
| **AUDITOR** | Chỉ đọc mọi thứ, kể cả audit log — không sửa được gì |

**Kiểm tra quyền phải ở server, ở tầng dữ liệu.** Ẩn nút trên UI không phải bảo mật. Mọi truy vấn phải kèm điều kiện phạm vi:

```typescript
// SAI — chỉ cần biết id là xem được công người khác
const daily = await prisma.attendanceDaily.findUnique({ where: { id } })

// ĐÚNG — ràng buộc theo phạm vi của người đang đăng nhập
const daily = await prisma.attendanceDaily.findFirst({
  where: {
    id,
    employee: buildScopeFilter(session),   // EMPLOYEE→chính mình, MANAGER→cấp dưới...
  },
})
```

---

<a name="phần-9"></a>
## Phần 9 — Bảo mật và pháp lý Việt Nam

### 9.1. Nghị định 13/2023/NĐ-CP — bắt buộc tuân thủ

Dữ liệu khuôn mặt được xếp là **dữ liệu cá nhân nhạy cảm** theo Điều 2 Nghị định 13/2023/NĐ-CP. Đây không phải chi tiết phụ — khi bán cho doanh nghiệp lớn, phòng pháp chế của họ sẽ hỏi đúng những mục dưới đây, và không có thì không ký hợp đồng.

**Nghĩa vụ chính:**

1. **Sự đồng ý rõ ràng, tách bạch.** Không được gộp điều khoản này vào hợp đồng lao động chung. Phải là văn bản riêng, nhân viên ký riêng, nêu rõ: thu thập gì, để làm gì, lưu bao lâu, ai được tiếp cận.

2. **Quyền rút lại đồng ý.** Nhân viên có quyền từ chối hoặc rút lại bất cứ lúc nào → hệ thống **bắt buộc phải có phương án thay thế** (PIN, thẻ từ, QR). Không được ép buộc dùng khuôn mặt.

3. **Hồ sơ đánh giá tác động xử lý dữ liệu cá nhân (DPIA).** Lập hồ sơ và gửi Cục An ninh mạng và phòng chống tội phạm sử dụng công nghệ cao (A05 – Bộ Công an) trong vòng 60 ngày kể từ khi bắt đầu xử lý.

4. **Quyền được xoá.** Nhân viên nghỉ việc hoặc yêu cầu xoá → phải xoá embedding và ảnh gốc thật sự, không phải soft-delete.

5. **Thông báo khi có sự cố** rò rỉ dữ liệu, trong 72 giờ.

**Cần triển khai trong hệ thống:**

```
□ Bảng BiometricConsent — lưu ai đồng ý, lúc nào, bản điều khoản nào
□ Màn hình hiển thị điều khoản trước khi enroll, có nút đồng ý rõ ràng
□ Chức năng "Xoá dữ liệu sinh trắc của tôi" cho nhân viên
□ Job tự động xoá embedding + ảnh sau N ngày kể từ ngày nghỉ việc
□ Phương án chấm công thay thế bằng PIN/thẻ, hoạt động đầy đủ
□ Trang xuất "dữ liệu cá nhân của tôi" (quyền truy cập dữ liệu)
□ Audit log ghi mọi lần truy cập dữ liệu sinh trắc
□ Tài liệu DPIA
```

### 9.2. Bảo vệ dữ liệu sinh trắc về mặt kỹ thuật

**Mã hoá embedding khi lưu.** Dù embedding không dễ tái tạo thành ảnh, nó vẫn là định danh sinh trắc duy nhất. Rò rỉ ra ngoài là rò rỉ vĩnh viễn — người ta đổi được mật khẩu chứ không đổi được khuôn mặt.

Hai mức bảo vệ:
- **Tối thiểu:** mã hoá toàn bộ ổ đĩa + hạn chế truy cập bảng ở tầng CSDL.
- **Tốt hơn:** mã hoá cột bằng khoá quản lý riêng (KMS / Vault), giải mã trong bộ nhớ của face service khi nạp.

Lưu ý đánh đổi: mã hoá cột thì không dùng được index pgvector (vì phải giải mã mới so sánh được). Với N nhỏ, nạp toàn bộ vào RAM của face service rồi giải mã một lần lúc khởi động là phương án cân bằng tốt.

**Ảnh bằng chứng:** đặt vòng đời tự xoá (90 ngày là hợp lý), lưu trên bucket private, chỉ truy cập qua presigned URL thời hạn ngắn.

**Không bao giờ log embedding hay ảnh base64** vào file log ứng dụng. Rất dễ vô tình để lộ khi debug.

### 9.3. On-premise hay cloud

Nhiều doanh nghiệp Việt Nam, đặc biệt là nhà máy và đơn vị nhà nước, **yêu cầu cài đặt tại chỗ** vì không muốn dữ liệu khuôn mặt nhân viên ra khỏi công ty.

Hệ quả thiết kế:
- **Không dùng được API nhận diện của bên thứ ba** (AWS Rekognition, Azure Face, FPT.AI). Đây là lý do quan trọng nhất để chọn model tự host như InsightFace ngay từ đầu.
- Phải đóng gói bằng Docker Compose để cài đặt được trên máy chủ khách hàng.
- Phải tính đến việc cập nhật phiên bản khi máy chủ không có internet.
- Cần cơ chế cấp phép (license) nếu bán nhiều nơi.

Nếu ngay từ đầu bạn xác định có thể phải on-prem, hãy tránh mọi dịch vụ đám mây bắt buộc trong luồng lõi.

---

<a name="phần-10"></a>
## Phần 10 — Vận hành thực tế

Những vấn đề chỉ xuất hiện khi hệ thống chạy thật với người thật.

### 10.1. Lắp đặt camera — quyết định 50% độ chính xác

Đây là điều ít người nghĩ tới nhưng ảnh hưởng lớn hơn cả việc chọn model.

| Yếu tố | Khuyến nghị |
|---|---|
| **Chiều cao** | Ngang tầm mắt, 150–165 cm |
| **Góc** | Chính diện, nghiêng tối đa 15° |
| **Ánh sáng** | Nguồn sáng **phía trước** mặt người dùng |
| **Tránh** | **Không đặt camera quay về phía cửa kính / cửa sổ** |
| **Bổ sung** | Đèn LED trắng dịu gắn quanh màn hình (như đèn ring light) |
| **Khoảng cách** | 40–80 cm, có vạch dán sàn đánh dấu chỗ đứng |
| **Nền phía sau** | Tường trơn, màu trung tính |

**Lỗi phổ biến nhất:** lắp kiosk ở sảnh, camera hướng ra cửa kính. Buổi sáng nắng chiếu vào → người đứng chấm công thành bóng đen ngược sáng → hệ thống không nhận được ai. Đây là nguyên nhân số 1 khiến dự án bị đánh giá "AI kém" trong khi model hoàn toàn ổn.

### 10.2. Giờ cao điểm

Bài toán: 200 nhân viên vào làm lúc 8h. Thực tế 80% đến trong khoảng 7h50–8h05, tức **160 người trong 15 phút**.

```
Thời gian mỗi lượt = thao tác người dùng (2–4s) + xử lý (0.3–1s)
                   ≈ 4 giây/người trong điều kiện tốt

160 người × 4 giây = 640 giây ≈ 11 phút cho MỘT kiosk
→ người cuối hàng đợi 11 phút → đi muộn oan
```

Giải pháp:
- **Nhiều kiosk song song** — quy tắc thô: 1 kiosk / 80–100 nhân viên
- **Cho phép chấm công sớm** 2 tiếng để giãn cách
- **Kết hợp app điện thoại** cho người ở gần văn phòng
- **Đo và tối ưu độ trễ AI**: mục tiêu p95 < 800 ms
- Thu hẹp scope tìm kiếm theo chi nhánh + ca (vừa nhanh vừa chính xác hơn)

Hãy **kiểm thử tải** (load test) trước khi triển khai, đừng phát hiện vấn đề vào buổi sáng đầu tiên.

### 10.3. Chế độ ngoại tuyến

Mất mạng là chuyện xảy ra. Nếu mất mạng mà không chấm công được thì cả công ty đứng ngoài cửa.

Thiết kế cho kiosk:

```
Bình thường: kiosk → server (đầy đủ chức năng)

Mất mạng:
  1. Kiosk dùng bản cache embedding cục bộ (đồng bộ mỗi giờ, đã mã hoá)
  2. Nhận diện tại chỗ, GHI vào hàng đợi cục bộ (SQLite)
  3. Màn hình hiển thị rõ "Chế độ ngoại tuyến — đã ghi nhận"
  4. Có mạng trở lại → đồng bộ lên server, giữ nguyên GIỜ GỐC lúc chấm
  5. Đánh dấu các bản ghi này là source = OFFLINE để có thể soát lại
```

Rủi ro: chế độ ngoại tuyến kém an toàn hơn (liveness chạy trên thiết bị có thể bị can thiệp). Nên:
- Giới hạn thời gian được phép ngoại tuyến (ví dụ tối đa 24 giờ)
- Gắn cờ mọi bản ghi ngoại tuyến để HR rà soát
- Mã hoá cache embedding, gắn với phần cứng thiết bị

### 10.4. Khi hệ thống không nhận ra người thật

**Bắt buộc phải có đường thoát.** Thứ tự ưu tiên:

```
1. Thử lại (điều chỉnh vị trí đứng, gỡ khẩu trang)   → 80% giải quyết
2. Nhập mã nhân viên → chuyển sang 1:1 (dễ hơn nhiều) → 15%
3. Nhập mã nhân viên + PIN cá nhân                    →  4%
4. Báo bảo vệ/HR chấm công thủ công (có audit)        →  1%
```

Không có bước 2–4 thì mỗi lần lỗi là một nhân viên bị mất công oan, và niềm tin vào hệ thống sụp đổ rất nhanh.

**Theo dõi tỉ lệ thất bại theo từng người.** Nếu một nhân viên bị từ chối > 20% số lần → tự động nhắc HR enroll lại. Thường là do người đó đã thay đổi ngoại hình (cắt tóc, tăng cân, để râu, đổi kính).

### 10.5. Bảo trì dữ liệu khuôn mặt

- **Enroll lại định kỳ** — 2 năm/lần, hoặc khi tỉ lệ nhận diện của người đó giảm.
- **Cập nhật tăng dần (adaptive enrollment)** — khi nhận diện thành công với điểm rất cao (> 0.8), có thể thêm embedding đó vào hồ sơ để hệ thống thích nghi dần với ngoại hình mới. **Cẩn thận:** chỉ làm khi điểm rất cao, nếu không sẽ "trôi" dần sang người khác.
- **Giới hạn số embedding/người** — tối đa 15, cũ nhất bị loại.
- **Xoá khi nghỉ việc** — job tự động, có thời gian chờ (ví dụ 30 ngày) phòng trường hợp quay lại.

### 10.6. Các chỉ số cần theo dõi

Dựng dashboard vận hành với các số này:

```
CHẤT LƯỢNG NHẬN DIỆN
  · Tỉ lệ nhận thành công / tổng lượt          (mục tiêu > 95%)
  · Phân bố điểm similarity                     (theo dõi độ trôi theo thời gian)
  · Tỉ lệ phải dùng phương án dự phòng          (mục tiêu < 5%)
  · Top 10 nhân viên hay bị từ chối nhất        → danh sách cần enroll lại

HIỆU NĂNG
  · Độ trễ p50 / p95 / p99 của API chấm công    (p95 < 800ms)
  · Lượt chấm công mỗi phút theo giờ trong ngày → xác định giờ cao điểm
  · Tỉ lệ lỗi 5xx

BẢO MẬT
  · Số lần liveness thất bại/ngày                → tăng đột biến = có người thử gian lận
  · Số bản ghi bị gắn cờ isSuspicious
  · Số lần sửa công thủ công theo từng HR       → phát hiện lạm quyền

VẬN HÀNH
  · Thiết bị offline > 15 phút                   → cảnh báo ngay
  · Số bản ghi MISSING_PUNCH chưa xử lý
  · Số đơn chờ duyệt quá 3 ngày
```

---

<a name="phần-11"></a>
## Phần 11 — Lộ trình học và lộ trình build

### 11.1. Cần học gì trước

Bạn không cần học machine learning để làm dự án này. Đây là những gì thực sự cần:

| Ưu tiên | Chủ đề | Mức độ cần | Thời gian |
|---|---|---|---|
| 1 | **Nghiệp vụ chấm công** — đọc Bộ luật Lao động 2019 chương về thời giờ làm việc, OT, nghỉ phép | Sâu | 1–2 ngày |
| 2 | **Xử lý thời gian và múi giờ** trong lập trình | Sâu | 1 ngày |
| 3 | **Khái niệm embedding + cosine similarity + FAR/FRR** | Đủ dùng (Phần 1–2 tài liệu này gần như đủ) | nửa ngày |
| 4 | **Python cơ bản + FastAPI** để viết face service | Cơ bản | 2 ngày |
| 5 | **Docker / Docker Compose** để chạy nhiều service | Cơ bản | 1 ngày |
| 6 | **PostgreSQL: index, transaction, pgvector** | Trung bình | 1 ngày |
| 7 | Toán học đằng sau mạng nơ-ron | **Không cần** | 0 |

Thứ tự này quan trọng: người mới thường dành 2 tuần đọc về CNN và ArcFace loss, rồi vỡ trận ở phần ca đêm và đơn nghỉ duyệt ngược.

**Việc nên làm đầu tiên, ngay hôm nay:** tìm một người làm HR/C&B thật, xin xem file Excel chấm công họ đang dùng, và hỏi họ khổ nhất ở khâu nào. Một buổi nói chuyện đó có giá trị hơn một tuần đọc tài liệu kỹ thuật.

### 11.2. Lộ trình xây dựng

#### Phase 0 — Thẩm định kỹ thuật (1 tuần) ⚠ Không được bỏ qua

Mục tiêu: **chứng minh phần AI khả thi với điều kiện thực tế của bạn**, trước khi viết bất kỳ dòng code nghiệp vụ nào.

```
□ Dựng face service tối giản: FastAPI + InsightFace, 1 endpoint /embed
□ Thu 30 người × 10 ảnh bằng ĐÚNG loại camera sẽ dùng, ĐÚNG chỗ sẽ lắp
□ Tính ma trận similarity, vẽ đường FAR/FRR, chọn ngưỡng
□ Tích hợp anti-spoofing, tự thử tấn công: in ảnh ra giấy, giơ điện thoại
□ Đo độ trễ trên cấu hình máy chủ dự kiến
□ Kết luận: ngưỡng bao nhiêu? FRR bao nhiêu? có cần thêm đèn không?
```

Nếu Phase 0 cho kết quả tệ (FRR > 15%), vấn đề gần như chắc chắn nằm ở **camera và ánh sáng**, không phải model. Sửa ở đây rẻ hơn sửa sau khi đã code 3 tháng.

#### Phase 1 — MVP chấm công (3–4 tuần)

```
□ Prisma schema + migration nền tảng
□ Auth + RBAC 5 vai trò
□ CRUD: công ty / chi nhánh / phòng ban / nhân viên
□ Màn hình enroll khuôn mặt (HR) + kiểm tra chất lượng
□ Kiosk PWA: camera, chụp, gửi, hiển thị kết quả
□ API chấm công đầy đủ: nonce → liveness → nhận diện → ghi log
□ Trang xem log chấm công thô, lọc theo ngày/nhân viên
□ Audit log
```

Kết thúc Phase 1: **người thật chấm công được và HR nhìn thấy dữ liệu.** Chưa có tính công.

#### Phase 2 — Engine tính công (3–4 tuần)

```
□ Quản lý ca + phân ca theo nhân viên
□ Engine tính công + bộ unit test đầy đủ (mục 7.6)
□ Xử lý ca qua đêm
□ Lịch lễ Việt Nam + ngày làm bù
□ Worker BullMQ + cron cuối ngày
□ Bảng công tháng (dạng lưới nhân viên × ngày)
□ Export Excel
```

Kết thúc Phase 2: **HR có thể dùng thay Excel.** Đây là mốc sản phẩm bắt đầu có giá trị thật.

#### Phase 3 — Đơn từ và quy trình (2–3 tuần)

```
□ Đơn nghỉ phép + quỹ phép + luồng duyệt nhiều cấp
□ Đơn OT (phải duyệt trước mới được tính)
□ Đơn giải trình quên chấm công
□ Thông báo (email + trong app)
□ Kỳ công + chốt kỳ + khoá dữ liệu
□ Tính lại công khi đơn được duyệt muộn
```

#### Phase 4 — App di động và mở rộng (3–4 tuần)

```
□ App Flutter: đăng nhập, chấm công 1:1, xem công, gửi đơn
□ Device binding + duyệt đổi thiết bị
□ GPS geofence + phát hiện mock location
□ Chế độ ngoại tuyến cho kiosk
□ Đa chi nhánh, đa múi giờ
□ Dashboard cho quản lý
```

#### Phase 5 — Hoàn thiện sản phẩm (liên tục)

```
□ Tích hợp bảng lương / xuất theo định dạng phần mềm kế toán
□ Báo cáo nâng cao, phân tích xu hướng đi muộn
□ SSO, đồng bộ từ hệ thống HRM có sẵn
□ Multi-tenant (nếu bán SaaS)
□ Hồ sơ tuân thủ Nghị định 13
```

### 11.3. Những sai lầm nên tránh

1. **Dành quá nhiều thời gian cho AI, quá ít cho nghiệp vụ.** Phần AI là thư viện có sẵn. Phần nghiệp vụ mới là sản phẩm.
2. **Bỏ qua liveness ở bản đầu, "để sau bổ sung".** Tuần đầu triển khai sẽ có người phát hiện và cả công ty biết trong một ngày.
3. **Không tách log thô và bản ghi đã tính.** Đến khi cần tính lại thì phải viết lại từ đầu.
4. **Xử lý ca đêm sau cùng.** Nó ảnh hưởng tới thiết kế bảng — phải có `workDate` ngay từ migration đầu tiên.
5. **Hard-code ngưỡng, quy tắc làm tròn, hệ số OT.** Mỗi công ty một khác. Đưa hết vào bảng cấu hình.
6. **Tin vào dữ liệu client gửi lên** — giờ, GPS, kết quả liveness. Tất cả phải xác thực ở server.
7. **Không làm phương án dự phòng khi nhận diện thất bại.** Hệ thống nào cũng có lúc sai.
8. **Bỏ qua phần pháp lý** cho đến khi khách hàng lớn hỏi.
9. **Không kiểm thử tải giờ cao điểm.** Vấn đề chỉ lộ ra vào 8h sáng ngày đi vào vận hành.
10. **Enroll bằng ảnh thẻ chụp cách đây 5 năm.** Phải chụp mới, bằng đúng camera sẽ dùng.

---

<a name="phần-12"></a>
## Phần 12 — Từ điển thuật ngữ

| Thuật ngữ | Giải thích |
|---|---|
| **Embedding / Face template** | Vector số (thường 512 chiều) đại diện cho một khuôn mặt |
| **Alignment** | Xoay, co giãn ảnh mặt về khuôn mẫu chuẩn dựa trên landmark |
| **Landmark** | Các điểm mốc trên mặt: 2 mắt, mũi, 2 khoé miệng |
| **Cosine similarity** | Độ giống giữa hai vector, từ −1 đến 1. Càng cao càng giống |
| **Cosine distance** | = 1 − similarity. Càng **thấp** càng giống. Dễ nhầm lẫn |
| **Threshold** | Ngưỡng similarity để coi là "cùng người" |
| **FAR** | False Acceptance Rate — tỉ lệ nhận nhầm người lạ |
| **FRR** | False Rejection Rate — tỉ lệ từ chối nhầm người thật |
| **EER** | Equal Error Rate — điểm FAR = FRR. Không nên dùng cho chấm công |
| **1:1 Verification** | Xác minh "có phải người này không" — 1 phép so sánh |
| **1:N Identification** | Nhận dạng "đây là ai" — N phép so sánh, khó hơn nhiều |
| **Enrollment** | Quá trình đăng ký khuôn mặt lần đầu |
| **Liveness / PAD** | Phát hiện mặt thật hay ảnh/video giả |
| **Presentation attack** | Tấn công bằng cách trình ảnh/video/mặt nạ trước camera |
| **Replay attack** | Phát lại ảnh/video/request cũ để giả mạo |
| **Nonce** | Chuỗi ngẫu nhiên dùng một lần, chống replay |
| **Geofence** | Vùng địa lý hợp lệ (tâm + bán kính) |
| **Mock location** | GPS giả do phần mềm tạo ra |
| **Device binding** | Ràng buộc tài khoản với một thiết bị cụ thể |
| **Punch** | Một lần chấm công (vào hoặc ra) |
| **workDate** | Ngày công logic, khác ngày lịch với ca đêm |
| **Grace period** | Dung sai, ví dụ muộn dưới 5 phút thì bỏ qua |
| **Idempotent** | Chạy nhiều lần cho cùng một kết quả |
| **HNSW** | Thuật toán index cho tìm kiếm vector nhanh |
| **pgvector** | Extension PostgreSQL để lưu và tìm kiếm vector |
| **ONNX** | Định dạng model AI dùng chung giữa các framework |

---

## Bước tiếp theo

Trước khi lập kế hoạch chi tiết, cần chốt 4 điều:

1. **Quy mô** — bao nhiêu nhân viên, bao nhiêu chi nhánh? (quyết định cách xử lý bài toán 1:N)
2. **Kiosk hay app điện thoại**, hay cả hai? (quyết định toàn bộ thiết kế chống gian lận)
3. **Cloud hay on-premise**? (quyết định có được dùng dịch vụ bên thứ ba không)
4. **Làm cho 1 công ty hay bán SaaS đa khách hàng**? (quyết định có cần multi-tenant từ đầu)

Có 4 câu trả lời này thì có thể chạy `skill-lap-ke-hoach smartface` để sinh `docs/smartface/solution.md` với kiến trúc chi tiết, schema đầy đủ và phân rã công việc.
