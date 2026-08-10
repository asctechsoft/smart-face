# 06 — Chống gian lận chấm công (Anti-Fraud)

> Chuẩn hoá từ Chương IV của tài liệu PA.
> **Đây là nghiệp vụ xuyên suốt** cả App, Backend và AI Server — không thuộc riêng phân hệ nào.
> Mọi biện pháp trong tài liệu này đều có mã `AF-xx` để truy vết sang task và test case.

---

## 0. Nguyên tắc nền tảng

> **Biện pháp quan trọng nhất trong toàn bộ hệ thống** (PA 4.3):
> *"Backend không được tin bất kỳ cờ trạng thái nào do App tự khai (VD `faceVerified: true`) — mọi kết quả xác thực khuôn mặt/vân tay phải được Backend tự kiểm chứng lại với AI Server hoặc secure enclave của thiết bị, không dựa vào dữ liệu client gửi lên."*

Nếu vi phạm nguyên tắc này, **mọi biện pháp khác trong tài liệu đều vô nghĩa** — chỉ cần một lệnh `curl` là chấm công được.

Và lời cảnh báo của PA ở cuối chương IV:

> *"Các biện pháp trên giúp giảm thiểu đáng kể rủi ro gian lận nhưng không thể đảm bảo tuyệt đối 100% — cần kết hợp thêm quy định quản lý nội bộ (chế tài xử lý vi phạm) và có thể bổ sung máy chấm công vật lý tại văn phòng cho các vị trí yêu cầu an ninh cao."*

Mục tiêu thiết kế: **nâng chi phí gian lận cao hơn lợi ích thu được**, và **để lại dấu vết** cho mọi hành vi gian lận.

---

## 1. Bảng tổng hợp biện pháp

| Mã | Biện pháp | Kịch bản chống | Thi công ở | Ưu tiên |
|---|---|---|---|---|
| `AF-01` | Phát hiện mock location (`isFromMockProvider`) | GPS giả | App + Backend | Must |
| `AF-02` | Xác thực lớp 2 tại chỗ: WiFi SSID/BSSID hoặc Bluetooth beacon | GPS giả | App + Backend | Should |
| `AF-03` | Phát hiện "di chuyển bất khả thi" (impossible travel) | GPS giả | Backend (job) | Must |
| `AF-04` | Yêu cầu độ chính xác GPS tối thiểu, từ chối nguồn không đáng tin | GPS giả | App + Backend | Must |
| `AF-05` | Liveness detection với **thao tác ngẫu nhiên mỗi lần** | Chấm hộ | AI Server + Backend | Must |
| `AF-06` | Anti-spoofing phân tích bề mặt 2D vs khuôn mặt thật | Chấm hộ | AI Server | Must |
| `AF-07` | Device binding — 1 tài khoản, 1 thiết bị hoạt động | Chấm hộ | Backend | Must |
| `AF-08` | Random audit — đối chiếu định kỳ ảnh chấm công vs ảnh hồ sơ | Chấm hộ | Backend (job) + AI | Should |
| `AF-09` | Cảnh báo một tài khoản chấm công trên 2 thiết bị trong thời gian ngắn | Chấm hộ | Backend | Must |
| `AF-10` | **Backend tự kiểm chứng, không tin cờ từ client** | Gọi thẳng API | Backend | **Must (cốt lõi)** |
| `AF-11` | SSL Pinning | Gọi thẳng API | App | Must |
| `AF-12` | Ký số request (HMAC) + timestamp + nonce dùng một lần | Gọi thẳng API | App + Backend | Must |
| `AF-13` | Rate limiting theo tài khoản/thiết bị/IP | Gọi thẳng API | Gateway + Backend | Must |
| `AF-14` | Phát hiện thiết bị root/jailbreak | Gọi thẳng API | App + Backend | Must |
| `AF-15` | App Attestation (Play Integrity / App Attest) | Gọi thẳng API | App + Backend | Should |
| `AF-16` | Access token gắn với phiên + thiết bị, thời hạn ngắn | Gọi thẳng API | Backend | Must |
| `AF-17` | Dùng giờ Server làm chuẩn (`BR-01`) | Chỉnh giờ máy | Backend | **Must (cốt lõi)** |
| `AF-18` | Đối chiếu lệch giờ thiết bị vs server, gắn cờ nếu vượt ngưỡng | Chỉnh giờ máy | Backend | Must |
| `AF-19` | Gắn cờ khi thời lượng giữa chấm vào/ra quá ngắn so với ca chuẩn | Ghé qua rồi đi | Backend (job) | Must |
| `AF-20` | Xác thực khuôn mặt ngẫu nhiên giữa ca (random check-in) | Ghé qua rồi đi | App + Backend | Could |
| `AF-21` | Dashboard cảnh báo gian lận cho Admin/Kế toán | Tổng thể | Web + Backend | Must |
| `AF-22` | Audit log chi tiết từng lượt chấm công | Tổng thể | Backend | Must |
| `AF-23` | Cho phép Kế toán/Admin quyết định huỷ/giữ công nghi vấn, có ghi lý do | Tổng thể | Web + Backend | Must |

---

## 2. Kịch bản 1 — Giả mạo vị trí (GPS Spoofing)

### 2.1. Kịch bản

Nhân viên dùng app giả lập định vị (fake GPS) trên điện thoại — thường cần root/jailbreak hoặc bật chế độ Developer — để hệ thống tưởng đang đứng gần văn phòng dù thực tế ở nơi khác, từ đó chấm công khống.

### 2.2. Biện pháp

#### `AF-01` — Phát hiện mock location

```
Android:  Location.isFromMockProvider()  (API < 31)
          Location.isMock()              (API ≥ 31)
          Kiểm tra thêm: có app nào được set làm "mock location app" trong Developer Options

iOS:      Không có API trực tiếp. Dùng dấu hiệu gián tiếp:
          - Phát hiện jailbreak (AF-14)
          - Kiểm tra tính nhất quán giữa GPS và các cảm biến khác
          - Phát hiện tốc độ/gia tốc bất thường

Xử lý:    Từ chối chấm công nếu phát hiện mock provider → FRAUD_MOCK_LOCATION
          Ghi log kèm thông tin đầy đủ để đối soát
```

**Quan trọng:** App gửi cờ `isMocked` lên nhưng Backend **không tin tuyệt đối** — kẻ tấn công có thể patch app để luôn gửi `false`. Cờ này chỉ là một tín hiệu; các biện pháp `AF-02`, `AF-03`, `AF-15` mới là lớp phòng thủ độc lập.

#### `AF-02` — Xác thực lớp 2 tại chỗ

```
Cách 1: WiFi nội bộ
  - Cấu hình danh sách SSID/BSSID của WiFi văn phòng
  - App quét WiFi đang kết nối / trong tầm phủ
  - GPS báo "trong vùng" nhưng KHÔNG thấy WiFi văn phòng → gắn cờ nghi vấn
  - Lưu ý: cần quyền truy cập WiFi (Android 10+ cần quyền vị trí chính xác)

Cách 2: Bluetooth Beacon
  - Đặt beacon (BLE) tại văn phòng, đăng ký UUID vào hệ thống
  - App quét beacon, gửi kèm UUID + RSSI (cường độ tín hiệu)
  - Không phát hiện beacon dù GPS báo trong vùng → gắn cờ
  - Ưu điểm: khó giả mạo hơn WiFi, phạm vi chính xác hơn GPS
  - Nhược điểm: chi phí phần cứng, cần bảo trì pin
```

Đây là biện pháp **mạnh nhất** chống GPS giả vì cần hiện diện vật lý thật, nhưng cần đầu tư (cấu hình WiFi hoặc mua beacon).

---

**Đã nâng từ "gắn cờ" lên "CHẶN".** Không bắt được WiFi công ty thì **không ghi
nhận lượt chấm công** — chặn hẳn, không tạo bản ghi nào.

Chính sách `attendance.wifi.requirement`, mặc định `BLOCK`:

| Giá trị | Không khớp BSSID thì |
|---|---|
| `BLOCK` *(mặc định)* | Từ chối, không ghi nhận |
| `FLAG` | Vẫn ghi nhận nhưng nâng `decision` lên `FLAGGED` |
| `OFF` | Bỏ qua, chỉ dùng làm tín hiệu chấm điểm |

**Đối chiếu bằng BSSID, KHÔNG bằng SSID.** SSID là *tên* mạng — ai cũng đặt điểm
phát sóng cá nhân tên `AMOBI-WiFi` được trong ba giây. BSSID là địa chỉ MAC của
chính bộ phát, gắn với thiết bị phần cứng cụ thể trong văn phòng.

**Yêu cầu vận hành bắt buộc:** mỗi chi nhánh phải khai BSSID trước khi nhân viên
chấm công. Chưa khai thì mọi lượt đều bị từ chối với `ATT_WIFI_NOT_CONFIGURED`.
Chọn chặn thay vì cho qua khi thiếu cấu hình là có chủ đích — cho qua nghĩa là
một chi nhánh bị quên cấu hình sẽ âm thầm mất lớp phòng thủ này, và không ai
biết cho tới khi có sự cố.

Đơn công tác đã duyệt được **miễn** (`BR-ATT-06`).

> ⚠ **`AF-02` mạnh tới đâu.** `wifiBssid` do **App tự khai**. Máy đã root hoặc
> bản app bị sửa khai được bất kỳ BSSID nào — đây đúng là loại dữ liệu mà
> `BR-02` cảnh báo không được tin, và khác với ảnh khuôn mặt, Backend không có
> cách nào tự kiểm chứng.
>
> Tác dụng thật: nâng chi phí tấn công từ "ngồi nhà bấm nút" lên "phải biết
> BSSID của văn phòng **và** phải sửa được app". Cần đi kèm `AF-14` (phát hiện
> root) và `AF-15` (App Attestation) mới đủ. Một mình nó thì không.
>
> Ràng buộc mạng thật sự phải kiểm ở tầng khác: chỉ cho gọi API chấm công từ
> dải IP của văn phòng, hoặc chứng chỉ thiết bị cấp qua mạng nội bộ. **Chưa làm.**
>
> Beacon BLE (Cách 2) cũng chịu đúng giới hạn này — UUID cũng do App khai.

#### `AF-02b` — Chỉ chấm công được từ dải IP mạng văn phòng

```
Cấu hình: Branch.allowedIpCidrs = ["203.0.113.0/24", "198.51.100.7/32"]

Backend đối chiếu ĐỊA CHỈ NGUỒN của kết nối TCP với danh sách trên.
Không khớp → từ chối, KHÔNG ghi nhận lượt chấm công.
```

**Đây là chốt mạnh nhất trong nhóm xác thực vị trí.** Khác với GPS và BSSID —
những thứ App tự khai và sửa được — địa chỉ IP nguồn do **server quan sát** từ
kết nối TCP. Client không có cách nào tự đặt.

Ba mức như `AF-02` (`attendance.ipRestriction.requirement`), mặc định `BLOCK`.

**Hai chốt bổ trợ nhau, không thay thế nhau:**

| | `AF-02b` (IP) | `AF-02` (BSSID) |
|---|---|---|
| Ai cung cấp dữ liệu | **Server tự quan sát** | App tự khai |
| Sửa app có qua được không | Không | **Có** |
| Cắm VPN về văn phòng | **Qua được** | Không qua được |
| Chứng minh điều gì | Gói tin đi ra từ mạng văn phòng | Thiết bị trong tầm sóng văn phòng |

Bật cả hai mới kín.

> ⚠ **`trust proxy` — cấu hình dễ làm sai nhất trong toàn hệ thống.**
>
> | Cấu hình | Hậu quả |
> |---|---|
> | Không khai | `request.ip` là IP của Nginx → danh sách không bao giờ khớp → **cả công ty không chấm công được** |
> | Khai `true` | Ai cũng gửi `X-Forwarded-For: <IP văn phòng>` là qua → **chốt mất sạch tác dụng**, mà log vẫn hiển thị đúng IP văn phòng |
>
> Cách đúng: khai **chính xác số proxy** đứng trước Backend qua
> `TRUSTED_PROXY_HOPS`. Backend **từ chối khởi động ở production** nếu chưa
> khai — kể cả khi giá trị đúng là `0`.

> ⚠ **Phải khai IP CÔNG CỘNG.** Nhầm lẫn phổ biến nhất là khai `192.168.1.0/24`.
> Server không bao giờ nhìn thấy địa chỉ đó — nó đã bị NAT che đi trước khi gói
> tin ra internet.

**Giới hạn còn lại:** người cắm VPN về văn phòng có IP nguồn hợp lệ dù đang ngồi
ở nhà. Chốt `AF-02` (BSSID) bắt được trường hợp này, nên đừng tắt nó đi.

#### `AF-03` — Phát hiện di chuyển bất khả thi

```
Job chạy nền mỗi 15 phút (queue `fraud-scan`):

Với mỗi cặp lượt chấm công liên tiếp của một nhân viên:
    khoảngCách = haversine(vịTrí1, vịTrí2)          // mét
    khoảngThờiGian = |thờiGian2 - thờiGian1|         // giây
    tốcĐộ = khoảngCách / khoảngThờiGian              // m/s

    NGƯỠNG (cấu hình được):
      > 60 m/s  (~216 km/h)  → gắn cờ IMPOSSIBLE_TRAVEL  (mức cao)
      > 33 m/s  (~120 km/h)  → gắn cờ SUSPICIOUS_TRAVEL  (mức trung bình)

    Ngoại lệ cần loại trừ:
      - Nhân viên có đơn công tác đã duyệt (đi máy bay)
      - Sai số GPS lớn (accuracy > 100m) ở một trong hai điểm
      - Khoảng thời gian quá ngắn (< 60 giây) → nhiễu GPS, bỏ qua
```

#### `AF-04` — Yêu cầu độ chính xác GPS tối thiểu

```
Kiểm tra khi nhận request chấm công:
  ├─ accuracy > 100m           → FRAUD_LOW_GPS_ACCURACY (từ chối hoặc gắn cờ)
  ├─ provider != "gps"          → gắn cờ (vị trí từ mạng/WiFi kém tin cậy hơn)
  ├─ altitude/speed bất thường  → gắn cờ
  └─ toạ độ trùng KHÍT tuyệt đối với lần trước (đến 6 chữ số thập phân)
                                → dấu hiệu toạ độ được set cứng, gắn cờ

Cấu hình theo công ty: ngưỡng accuracy chấp nhận (mặc định 50m)
```

#### `AF-05` (log) — Lưu log đầy đủ

Mỗi lượt chấm công **bắt buộc lưu**: toạ độ (lat/lng), độ chính xác, nguồn cấp vị trí (GPS/network/mock/fused), altitude, speed, thời điểm lấy vị trí. Đây là bằng chứng khi Kế toán/Admin đối chiếu khiếu nại.

### 2.3. Tiêu chí chấp nhận

- [ ] Bật app Fake GPS trên Android → chấm công bị từ chối với `FRAUD_MOCK_LOCATION`.
- [ ] Chấm công ở Hà Nội lúc 08:00 rồi chấm công ở TP.HCM lúc 08:30 → gắn cờ `IMPOSSIBLE_TRAVEL`, hiển thị trên dashboard.
- [ ] Chấm công với `accuracy = 500m` → từ chối hoặc gắn cờ theo cấu hình.
- [ ] Nhân viên có đơn công tác đã duyệt không bị gắn cờ impossible travel.

---

## 3. Kịch bản 2 — Chấm công hộ (Buddy Punching)

### 3.1. Kịch bản

- Dùng **ảnh in**, **ảnh/video phát lại trên màn hình điện thoại**, hoặc **mặt nạ** (silicon, in 3D) để đánh lừa camera.
- Nhờ đồng nghiệp **cầm máy đã đăng nhập sẵn** tới gần văn phòng chấm hộ.

### 3.2. Biện pháp

#### `AF-05` — Liveness detection với thao tác ngẫu nhiên

```
SAI (dễ bị phá):
  App luôn yêu cầu "chớp mắt"
  → Kẻ gian quay sẵn 1 video có chớp mắt, phát lại mỗi lần chấm công

ĐÚNG:
  1. Backend sinh challenge NGẪU NHIÊN: TURN_LEFT | TURN_RIGHT | SMILE | NOD
  2. Gửi kèm nonce, TTL ngắn (30 giây)
  3. App hiển thị yêu cầu, quay video ngắn
  4. AI Server xác minh ĐÚNG hành động được yêu cầu đã được thực hiện
  5. Kết hợp: passive liveness (phân tích texture) + active liveness (hành động)

Lưu ý: challenge do SERVER chọn, App không tự quyết (nếu App tự chọn thì
       kẻ tấn công patch app để luôn chọn hành động đã quay sẵn)
```

> **`BLINK` tạm thời KHÔNG nằm trong danh sách.** Hợp đồng API hiện gửi lên một ảnh
> tĩnh, mà chớp mắt về bản chất là chuyển động — từ một khung hình chỉ trả lời được
> "hai mắt có đang nhắm không", không trả lời được "có vừa chớp không". Giữ nó lại
> thì người dùng bình thường (mắt mở lúc chụp) bị từ chối oan, còn kẻ giơ ảnh in
> người đang nhắm mắt lại qua được. Bốn hành động còn lại xác minh được từ tư thế
> đầu và tỷ lệ miệng.
>
> `BLINK` quay lại khi App gửi chuỗi khung hình — `verify_action_sequence` phía AI
> Server đã viết sẵn và có test, chỉ chờ hợp đồng API mở rộng.

#### `AF-06` — Anti-spoofing phân tích ảnh

```
Model Silent-Face-Anti-Spoofing (MiniFASNet) phát hiện:
  - Bề mặt phẳng 2D (ảnh in, màn hình) vs khuôn mặt 3D thật
  - Phản chiếu ánh sáng bất thường (màn hình phát sáng)
  - Moiré pattern (chụp lại màn hình)
  - Texture da không tự nhiên (ảnh in, mặt nạ)
  - Viền/khung ảnh trong khung hình

Đầu ra: liveness_score (0.0 – 1.0)
Backend so với ngưỡng cấu hình theo công ty (mặc định 0.70)
```

> Xem chi tiết kỹ thuật liveness trong `00-kien-thuc-nen-tang.md` Phần 3.

#### `AF-07` — Device binding

```
Quy tắc (BR-11):
  Mỗi tài khoản chỉ kích hoạt sinh trắc học trên 1 THIẾT BỊ tại 1 THỜI ĐIỂM

Khi đăng nhập trên thiết bị mới:
  1. Xác thực OTP  ✓
  2. Hệ thống phát hiện thiết bị khác với thiết bị đã liên kết
  3. Yêu cầu XÁC THỰC LẠI danh tính (khuôn mặt trên thiết bị mới)
  4. Tuỳ chính sách công ty: cần HR/Admin PHÊ DUYỆT
  5. Thu hồi liên kết thiết bị cũ, vô hiệu hoá token cũ
  6. Ghi audit log + thông báo cho HR
```

Điều này ngăn kịch bản "đưa máy cho đồng nghiệp cầm đi chấm hộ" chỉ ở mức hạn chế — vì thiết bị vẫn là của người đó. Nhưng `AF-05`/`AF-06` mới là lớp chặn chính (người cầm máy là người khác thì khuôn mặt không khớp).

#### `AF-08` — Random audit định kỳ

```
Job chạy hằng đêm (queue `ai-batch`):

1. Chọn NGẪU NHIÊN X% lượt chấm công trong ngày (VD 5%)
2. Gửi ảnh chấm công + ảnh hồ sơ gốc lên AI Server đối chiếu lại
3. Phân tích:
     - Điểm tương đồng THẤP BẤT THƯỜNG so với trung bình lịch sử của người đó
     - Xu hướng giảm dần confidence score trong một khoảng thời gian
4. Gắn cờ và đưa lên dashboard cảnh báo

Mục đích: phát hiện trường hợp lọt qua ngưỡng nhưng thực chất không phải người đó,
          hoặc phát hiện model bị suy giảm chất lượng theo thời gian
```

#### `AF-09` — Cảnh báo chấm công trên nhiều thiết bị

```
Nếu một tài khoản chấm công thành công trên 2 device_id khác nhau
trong khoảng thời gian < N phút (cấu hình, mặc định 30 phút)
  → Gắn cờ MULTI_DEVICE_ANOMALY (mức CAO)
  → Cảnh báo ngay tới Admin/HR (không đợi job nền)
```

Đây là dấu hiệu mạnh của việc chia sẻ tài khoản/thiết bị.

### 3.3. Tiêu chí chấp nhận

- [ ] Giơ ảnh in khuôn mặt trước camera → từ chối với `FACE_LIVENESS_FAILED`.
- [ ] Phát video khuôn mặt trên màn hình điện thoại khác → từ chối.
- [ ] Quay sẵn video có chớp mắt rồi phát lại → thất bại vì challenge yêu cầu hành động khác.
- [ ] Đăng nhập trên thiết bị mới yêu cầu xác thực lại và thu hồi thiết bị cũ.
- [ ] Random audit chạy hằng đêm, kết quả hiển thị trên dashboard cảnh báo.

---

## 4. Kịch bản 3 — Lộ API / can thiệp kỹ thuật

### 4.1. Kịch bản

Dùng công cụ bắt gói tin (Charles, Fiddler, mitmproxy) hoặc reverse-engineer/decompile app để xem cấu trúc API, sau đó:

- Gọi thẳng API chấm công, bỏ qua bước xác thực khuôn mặt/vân tay trên App.
- **Replay** một request chấm công từng thành công trước đó.
- Viết **bot tự động** chấm công theo giờ cố định.

### 4.2. Biện pháp

#### `AF-10` — Backend tự kiểm chứng (BIỆN PHÁP CỐT LÕI)

```
❌ THIẾT KẾ SAI — hệ thống sụp đổ hoàn toàn:

POST /attendance/check-in
{
  "employeeId": "emp_123",
  "faceVerified": true,        ← client tự khai!
  "location": {...}
}
→ Chỉ cần curl là chấm công được. Mọi biện pháp khác vô nghĩa.


✅ THIẾT KẾ ĐÚNG:

POST /attendance/check-in   (multipart/form-data)
  image:      <binary>       ← BẰNG CHỨNG THÔ
  nonce:      "a3f9c2..."
  timestamp:  1754198712
  location:   {lat, lng, accuracy, provider, isMocked}
  deviceInfo: {...}
  X-Signature: HMAC-SHA256(...)

Backend BẮT BUỘC:
  → Gửi ảnh lên AI Server
  → Nhận về liveness_score, match_score, quality
  → TỰ SO NGƯỠNG và tự ra quyết định
  → Không có đường tắt nào để bỏ qua bước này
```

Với vân tay, cơ chế tương đương là **challenge–response có chữ ký từ secure enclave** (xem `03-nghiep-vu-app-nhan-vien.md` mục 4.2) — Backend verify chữ ký bằng public key đã lưu, không nhận cờ boolean.

#### `AF-11` — SSL Pinning

```
App ghim (pin) certificate hoặc public key của server.
Nếu certificate không khớp → từ chối kết nối.

→ Chặn được proxy MITM (Charles/Fiddler) đọc và sửa traffic.

Lưu ý thi công:
  - Pin PUBLIC KEY thay vì certificate (certificate hết hạn phải đổi, public key thì không)
  - Ghim ít nhất 2 khoá (khoá hiện tại + khoá dự phòng) để tránh app chết khi đổi cert
  - Có cơ chế cập nhật pin từ xa (nhưng phải ký để không bị giả mạo)
```

#### `AF-12` — Ký số request + timestamp + nonce

```
App tính chữ ký:
  signature = HMAC-SHA256(
      method + path + bodyHash + nonce + timestamp,
      deviceSecret            ← cấp riêng cho từng thiết bị lúc liên kết
  )

Backend kiểm tra theo thứ tự:
  1. |serverTime - timestamp| ≤ 120s        → ngoài ngưỡng: 400 + cờ AF-18
  2. nonce chưa từng dùng                   → Redis SETNX nonce:<value> EX 300
                                               đã tồn tại → 409 FRAUD_REPLAY_DETECTED
  3. Chữ ký khớp                            → sai: 401

→ Request chỉ hợp lệ trong khoảng thời gian ngắn
→ Không thể gửi lại lần hai (chống replay attack)
```

**Lưu ý:** `deviceSecret` phải lưu trong secure enclave/keystore, không lưu trong SharedPreferences/UserDefaults thường.

> **`AF-12` là lớp DUY NHẤT chặn được kẻ đã đánh cắp access token.**
>
> Token bị lộ thì mọi chốt khác đều qua được: JWT hợp lệ, `X-Device-Id` đọc ngay
> từ payload token. Chỉ chữ ký mới cản, vì nó cần `deviceSecret` — thứ nằm trong
> secure enclave và **không** đi kèm token.
>
> Điều này cũng có nghĩa: **mã hoá payload token không thay thế được `AF-12`**.
> Kẻ tấn công không cần *đọc* token, hắn chỉ *gửi lại* nguyên xi và server tự
> giải mã. Mã hoá giải quyết bài toán đọc; replay là bài toán dùng.
>
> Vì vậy `ATTENDANCE_SIGNATURE_REQUIRED=false` ở production bị **chặn ngay lúc
> khởi động**, không phải chỉ cảnh báo trong log. Cờ này chỉ tắt được ở môi
> trường phát triển, giai đoạn App chưa triển khai ký.

**Endpoint đang yêu cầu chữ ký:**

| Endpoint | Vì sao |
|---|---|
| `POST /attendance/check-in` · `check-out` | Bản ghi chấm công |
| `POST /biometric/fingerprint/register` | Đăng ký khoá = tạo phương thức chấm công mới |
| `POST /biometric/face/enroll/start` | Mở phiên ghi đè hồ sơ khuôn mặt |
| `POST /biometric/face/enroll/submit` | Ảnh đăng ký quyết định danh tính về sau |
| `DELETE /biometric/face` · `fingerprint` | Thu hồi phương thức xác thực |

**Ràng buộc nội dung với request `multipart/form-data`:**

Server không giữ được body thô của multipart (thư viện parse đọc thẳng từ luồng;
buffer thêm bản sao chỉ để băm thì mỗi ảnh 5 MB chiếm 10 MB RAM). Nên App khai
hash qua `X-Body-Sha256` và server tính lại độc lập sau khi parse để đối chiếu.

```
SignatureGuard      → client có deviceSecret và đã CAM KẾT body băm ra H
   (chạy trước, chưa parse được body)
        ↓
FileInterceptor     → multer parse xong
        ↓
VerifyBodyHash…     → body THẬT đúng là băm ra H
   (chạy sau)
⇒ nội dung ảnh và mọi trường form đều xác thực
```

**Cần CẢ HAI mắt xích.** Thiếu mắt xích sau thì client tự khai một hash bừa rồi
ký lên chính cái hash bừa đó — chữ ký vẫn hợp lệ mà chẳng ràng buộc gì.

Công thức hash: xem [08 mục 1.2.1](./08-hop-dong-api.md#121-x-body-sha256--ràng-buộc-nội-dung-của-request-multipart).

Chặn được: kẻ chặn được request đã ký giữa đường không tạo được request mới (vì
không có `deviceSecret`) nhưng trước đây **sửa được request đang bay** — tráo
ảnh khuôn mặt sang người khác, hoặc đổi toạ độ GPS.

#### `AF-13` — Rate limiting

```
Tầng API Gateway (Kong/Nginx):
  - Theo IP:          100 req/phút
  - Toàn cục endpoint chấm công: theo capacity

Tầng ứng dụng (Backend):
  - Theo tài khoản:   10 lần chấm công/giờ  (bình thường 2-4 lần/ngày)
  - Theo thiết bị:    10 lần/giờ
  - OTP:              5 lần gửi/giờ, 5 lần nhập sai → khoá 15 phút

Phát hiện hành vi bất thường:
  - Request đều đặn chính xác theo giây (dấu hiệu bot)
  - Thiếu các request phụ mà App thật luôn gọi (VD không gọi /challenge trước /check-in)
  - User-Agent lạ, thiếu header đặc trưng của app
  → Gắn cờ và cảnh báo, có thể chặn tạm thời
```

#### `AF-14` — Phát hiện root/jailbreak

```
Android: kiểm tra su binary, Magisk, build tags "test-keys", quyền ghi /system
iOS:     kiểm tra Cydia, đường dẫn hệ thống ghi được, fork() thành công

Xử lý (cấu hình theo công ty):
  ☐ Cảnh báo nhưng vẫn cho chấm công (gắn cờ)
  ☑ Từ chối chấm công trên thiết bị không an toàn  ← khuyến nghị

Hạn chế: mọi thư viện phát hiện root đều có thể bị bypass (Magisk Hide, Shamiko).
         Đây là biện pháp NÂNG CHI PHÍ tấn công, không phải rào chắn tuyệt đối.
         Cần kết hợp AF-15 (App Attestation) mới đủ mạnh.
```

#### `AF-15` — App Attestation

```
Android: Play Integrity API
   → Google xác nhận: app đúng bản gốc từ Play Store, thiết bị đạt chuẩn Play Protect,
     không bị root, không chạy trên emulator

iOS:     App Attest / DeviceCheck
   → Apple xác nhận: request đến từ bản app hợp lệ trên thiết bị thật

Luồng:
  1. App xin attestation token từ OS
  2. Gửi kèm request lên Backend
  3. Backend XÁC MINH TOKEN VỚI SERVER CỦA GOOGLE/APPLE (không tự parse!)
  4. Token không hợp lệ → từ chối

→ Đây là biện pháp MẠNH NHẤT chống app bị patch, vì việc xác minh nằm ngoài
  tầm kiểm soát của kẻ tấn công.
```

#### `AF-16` — Token gắn với phiên + thiết bị

```
Access token của App có deviceId trong payload.
Backend kiểm tra: deviceId trong token == X-Device-Id trong request header
  → THIẾU header: 401      ← quan trọng, xem bẫy bên dưới
  → Không khớp:   401

Token của Web quản lý KHÔNG có deviceId → bỏ qua kiểm tra.
Hai web quản lý không có chức năng chấm công nên không cần ràng buộc thiết bị.

Thời hạn:
  - Access token:  15 phút (ngắn)
  - Refresh token: 30 ngày, XOAY VÒNG mỗi lần dùng (rotation)
                   phát hiện dùng lại refresh token cũ → thu hồi toàn bộ phiên

KHÔNG dùng API key/token tĩnh dùng chung.
```

> **Bẫy đã từng mắc.** Điều kiện ban đầu viết là
> `if (token.deviceId && header.deviceId && header.deviceId !== token.deviceId)`.
> Đọc qua thì hợp lý, nhưng nó có nghĩa: **không gửi header thì không bị kiểm**.
> Kẻ tấn công chỉ cần bỏ một dòng header là qua.
>
> Quy tắc đúng: token **có** `deviceId` thì header **bắt buộc** phải có và phải
> khớp. Ràng buộc mà client tự chọn có áp dụng hay không thì không phải ràng buộc.

> **`AF-16` mạnh tới đâu.** Payload JWT chỉ được *ký*, không *mã hoá*. Ai cầm
> được token đều đọc được `deviceId` rồi tự đặt header cho khớp — nên biện pháp
> này **không** chống được token bị đánh cắp.
>
> Giá trị thật của nó: bảo đảm `deviceId` trong ngữ cảnh request luôn có thật,
> để `AF-13` (rate limit theo thiết bị) và điểm gian lận "thiết bị lạ" không bị
> qua mặt bằng cách bỏ trống.
>
> Chống token đánh cắp là việc của `AF-12` (HMAC bằng `deviceSecret`) — khoá đó
> chỉ cấp một lần lúc đăng nhập, nằm trong secure enclave, **không** có trong
> token. Hai biện pháp bổ trợ nhau, không thay thế nhau.

### 4.3. Tiêu chí chấp nhận

- [ ] Gửi request chấm công bằng `curl` với token hợp lệ nhưng **bỏ hẳn header `X-Device-Id`** → bị từ chối 401 (`AF-16`).
- [ ] Gửi request chấm công bằng `curl` với token hợp lệ nhưng **không ký** (`ATTENDANCE_SIGNATURE_REQUIRED=true`) → bị từ chối 401 (`AF-12`).
- [ ] Khởi động Backend với `NODE_ENV=production` và `ATTENDANCE_SIGNATURE_REQUIRED=false` → **không khởi động được**.
- [ ] Đăng ký vân tay cho `deviceId` khác thiết bị trong token, không kèm `reauthToken` → bị từ chối 401.
- [ ] Chấm công khi đang dùng 4G (không kết nối WiFi văn phòng) → bị từ chối 403 `ATT_WIFI_REQUIRED`, **không có bản ghi nào được tạo** (`AF-02`).
- [ ] Chấm công ở chi nhánh chưa khai BSSID → bị từ chối 403 `ATT_WIFI_NOT_CONFIGURED`.
- [ ] Nhân viên có đơn công tác đã duyệt vẫn chấm công được khi không có WiFi văn phòng.
- [ ] Chấm công từ mạng ngoài văn phòng (4G, WiFi nhà) → bị từ chối 403 `ATT_IP_NOT_ALLOWED` (`AF-02b`).
- [ ] Chấm công ở chi nhánh chưa khai `allowedIpCidrs` → bị từ chối 403 `ATT_IP_NOT_CONFIGURED`.
- [ ] **Gửi `X-Forwarded-For: <IP văn phòng>` từ mạng ngoài → VẪN bị từ chối.** Qua được nghĩa là `TRUSTED_PROXY_HOPS` khai thừa và chốt IP vô tác dụng.
- [ ] Khởi động Backend với `NODE_ENV=production` mà không khai `TRUSTED_PROXY_HOPS` → **không khởi động được**.
- [ ] Kiểm giá trị `request.ip` trong audit log sau khi deploy: phải là IP của nhân viên, KHÔNG phải IP của Nginx.
- [ ] Gửi request chấm công bằng `curl` với token hợp lệ nhưng ảnh là ảnh trắng → bị từ chối.
- [ ] Gửi lại y nguyên một request đã thành công → `FRAUD_REPLAY_DETECTED`.
- [ ] Gửi request với timestamp lệch 10 phút → bị từ chối.
- [ ] Chạy app qua proxy Charles → không kết nối được (SSL pinning).
- [ ] Chấm công trên thiết bị đã root → bị từ chối (nếu chính sách bật).
- [ ] Dùng access token của thiết bị A trên thiết bị B → 401.

---

## 5. Kịch bản 4 — Can thiệp đồng hồ hệ thống

### 5.1. Kịch bản

Chỉnh giờ điện thoại lùi lại hoặc tiến lên để "chấm công đúng giờ" dù thực tế đã đi muộn hoặc về sớm.

### 5.2. Biện pháp

#### `AF-17` — Giờ Server là chuẩn duy nhất (CỐT LÕI)

```
Thời gian ghi nhận chấm công CHÍNH THỨC = thời điểm Backend nhận request.

Giờ hiển thị trên máy → chỉ để người dùng tham khảo, KHÔNG dùng tính công.

Thi công:
  - Cột `recordedAt` trong AttendanceLog = server timestamp, KHÔNG NHẬN từ client
  - Cột `clientReportedAt` = giờ client gửi lên, CHỈ để đối chiếu (AF-18)
  - App lấy giờ hiển thị từ server qua endpoint /time hoặc header response,
    không dùng DateTime.now() của máy cho các hiển thị liên quan tới chấm công
```

Đây là `BR-01` và `ADR-06`. Với thiết kế này, chỉnh giờ máy **không có tác dụng gì** với việc tính công.

#### `AF-18` — Đối chiếu lệch giờ

```
delta = |serverTime - clientReportedAt|

  delta ≤ 120 giây   → bình thường (chênh lệch mạng + đồng hồ máy)
  delta > 120 giây   → gắn cờ CLOCK_SKEW (mức trung bình)
  delta > 1 giờ      → gắn cờ CLOCK_TAMPERING (mức cao) + cảnh báo Admin

Ngưỡng cấu hình được. Lưu cả giá trị delta vào log để đối soát.
```

Việc chỉnh giờ máy tuy không ảnh hưởng tính công nhưng **là dấu hiệu ý đồ gian lận** — đáng gắn cờ để quản lý theo dõi.

### 5.3. Tiêu chí chấp nhận

- [ ] Chỉnh giờ điện thoại lùi 2 giờ rồi chấm công → hệ thống ghi nhận đúng giờ thực tế, đồng thời gắn cờ `CLOCK_TAMPERING`.
- [ ] Đổi múi giờ điện thoại không làm sai lệch giờ chấm công ghi nhận.
- [ ] Giá trị `delta` được lưu và hiển thị được trong màn hình chi tiết lượt chấm công.

---

## 6. Kịch bản 5 — "Chấm công rồi rời đi ngay"

### 6.1. Kịch bản

Nhân viên chỉ đến gần văn phòng đủ để lọt vào bán kính geofencing, chấm vào rồi rời đi ngay, không thực sự làm việc trong ca.

### 6.2. Biện pháp

#### `AF-19` — Gắn cờ thời lượng bất thường

```
Job chạy nền cuối ngày / mỗi giờ:

Với mỗi cặp chấm vào – chấm ra:
    thờiLượng = checkOut - checkIn
    thờiLượngCa = thời lượng ca chuẩn của nhân viên hôm đó

    thờiLượng < 30% × thờiLượngCa   → gắn cờ SHORT_ATTENDANCE (mức cao)
    thờiLượng < 60% × thờiLượngCa   → gắn cờ (mức trung bình), trừ khi có đơn hợp lệ

    Loại trừ:
      - Có đơn "Về sớm" / "Xin ra ngoài" / "Nghỉ nửa ngày" đã duyệt
      - Ca bán thời gian đã cấu hình
      - Ngày có sự kiện đặc biệt của công ty

Ngưỡng cấu hình được theo công ty.
```

Cũng cần cờ ngược lại: **chấm vào mà không chấm ra** — dấu hiệu chấm vào rồi bỏ về.

#### `AF-20` — Xác thực khuôn mặt ngẫu nhiên giữa ca

```
Tuỳ chọn theo chính sách công ty, áp dụng cho vị trí yêu cầu giám sát chặt:

  1. Hệ thống chọn thời điểm ngẫu nhiên trong ca (VD 1-2 lần/ca)
  2. Gửi push notification: "Vui lòng xác thực khuôn mặt trong 10 phút"
  3. Nhân viên mở app, xác thực khuôn mặt + GPS
  4. Không xác thực trong thời hạn → gắn cờ ABSENT_DURING_SHIFT

Cân nhắc:
  ⚠ Ảnh hưởng trải nghiệm và cảm giác bị giám sát của người lao động
  ⚠ Cần thông báo minh bạch và có sự đồng ý — liên quan quyền riêng tư
  ⚠ Không phù hợp với văn hoá công ty linh hoạt
  → Đây là tính năng OPT-IN theo từng công ty/từng phòng ban, mặc định TẮT
```

### 6.3. Tiêu chí chấp nhận

- [ ] Chấm vào 08:00, chấm ra 08:15 với ca 8 tiếng → gắn cờ `SHORT_ATTENDANCE`.
- [ ] Có đơn "Xin ra ngoài" đã duyệt cho khoảng đó → không gắn cờ.
- [ ] Chấm vào mà cuối ngày không có chấm ra → gắn cờ `MISSING_CHECKOUT`.

---

## 7. Fraud Scoring — mô hình đánh giá tổng hợp

Thay vì chặn/không chặn nhị phân, hệ thống tính **điểm rủi ro** cho mỗi lượt chấm công.

### 7.1. Bảng trọng số (cấu hình được)

| Tín hiệu | Điểm | Mức |
|---|---:|---|
| Mock location phát hiện được | +50 | Cao |
| Thiết bị root/jailbreak | +40 | Cao |
| App attestation thất bại | +50 | Cao |
| Lệch giờ > 1 giờ | +40 | Cao |
| Chấm công trên thiết bị lạ | +35 | Cao |
| Impossible travel | +45 | Cao |
| Hai thiết bị trong 30 phút | +45 | Cao |
| Liveness score dưới ngưỡng nhưng gần ngưỡng (0.60–0.70) | +25 | TB |
| Match score gần ngưỡng (0.45–0.50) | +20 | TB |
| Ngoài vùng geofence | +30 | TB |
| GPS accuracy > 100m | +15 | Thấp |
| Không phát hiện WiFi/beacon văn phòng dù GPS báo trong vùng | +25 | TB |
| Lệch giờ 2 phút – 1 giờ | +15 | Thấp |
| Thời lượng ca quá ngắn | +20 | TB |
| Toạ độ trùng khít tuyệt đối với lần trước | +20 | TB |

### 7.2. Ngưỡng xử lý

```
score = 0  – 29   →  ✓ Chấp nhận bình thường
score = 30 – 59   →  ⚠ Chấp nhận nhưng GẮN CỜ, hiện trên dashboard cảnh báo
score = 60 – 79   →  ⚠ Chấp nhận nhưng CHỜ DUYỆT — công không tính cho tới khi Kế toán xác nhận
score ≥ 80        →  ✗ TỪ CHỐI chấm công, thông báo lý do + cảnh báo Admin ngay
```

Ngưỡng cấu hình theo công ty. Công ty muốn chặt thì hạ ngưỡng, muốn linh hoạt thì nâng.

> **Nguyên tắc thiết kế:** ưu tiên **gắn cờ để con người xem xét** hơn là chặn cứng. Chặn nhầm một nhân viên thật gây bức xúc lớn và tạo gánh nặng hỗ trợ; gắn cờ cho phép xử lý sau mà không cản trở công việc.

---

## 8. Giám sát & xử lý gian lận tổng thể

### 8.1. `AF-21` — Dashboard cảnh báo gian lận

```
┌──────────────────────────────────────────────────────────────────────┐
│  CẢNH BÁO GIAN LẬN · Công ty AMOBI          [Hôm nay ▾] [Tất cả ▾]  │
├──────────────┬──────────────┬──────────────┬─────────────────────────┤
│ Tổng cờ      │  Mức cao     │  Chờ xử lý   │  Đã xử lý               │
│     23       │      4       │     12       │      11                 │
├──────────────┴──────────────┴──────────────┴─────────────────────────┤
│ ┌──────────┬────────────┬───────┬──────────────────┬──────┬────────┐ │
│ │Nhân viên │ Thời gian  │ Điểm  │ Cờ               │ Mức  │ T.thái │ │
│ ├──────────┼────────────┼───────┼──────────────────┼──────┼────────┤ │
│ │Phạm T.A  │03/08 08:05 │  75   │ MOCK_LOCATION    │ Cao  │ Chờ    │ │
│ │          │            │       │ ROOTED_DEVICE    │      │        │ │
│ │Lê V.H    │03/08 07:58 │  45   │ OUT_OF_GEOFENCE  │ TB   │ Chờ    │ │
│ │          │            │       │ LOW_GPS_ACCURACY │      │        │ │
│ │Trần T.M  │02/08 17:30 │  20   │ SHORT_ATTENDANCE │ Thấp │ Đã bỏ  │ │
│ └──────────┴────────────┴───────┴──────────────────┴──────┴────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

**Bộ lọc cần có:** theo mức độ, theo loại cờ, theo phòng ban, theo nhân viên, theo trạng thái xử lý, theo khoảng thời gian.

### 8.2. `AF-22` — Audit log chi tiết từng lượt chấm công

Mỗi lượt chấm công lưu đầy đủ:

| Nhóm | Trường |
|---|---|
| Thời gian | `recordedAt` (server), `clientReportedAt`, `clockSkewSeconds` |
| Vị trí | `latitude`, `longitude`, `accuracy`, `provider`, `isMocked`, `altitude`, `speed`, `distanceToBranch` |
| Thiết bị | `deviceId`, `deviceModel`, `osVersion`, `appVersion`, `isRooted`, `attestationResult` |
| Mạng | `ipAddress`, `wifiSsid` / `wifiBssid` (nếu có), `beaconUuid` (nếu có) |
| AI | `matchScore`, `livenessScore`, `imageQuality`, `modelVersion`, `processingMs`, `livenessChallenge` |
| Bằng chứng | `photoUrl` (S3 key), `photoHash` |
| Rủi ro | `fraudScore`, `flags[]`, `decision` |
| Xử lý | `reviewedBy`, `reviewedAt`, `reviewDecision`, `reviewReason` |

### 8.3. `AF-23` — Quy trình xử lý cờ nghi vấn

```
Cờ được tạo
  ▼
Hiển thị trên dashboard cảnh báo (Kế toán / Admin công ty)
  ▼
Người xử lý mở CHI TIẾT: ảnh chấm công vs ảnh hồ sơ, bản đồ vị trí,
                          thông tin thiết bị, điểm AI, lịch sử nhân viên
  ▼
Quyết định (BẮT BUỘC nhập lý do):
   ├─ [ Giữ nguyên công ]  → công vẫn tính, cờ đánh dấu "đã xem xét, chấp nhận"
   ├─ [ Huỷ công này ]     → không tính công, tạo bản ghi điều chỉnh (BR-ADJ-01)
   └─ [ Chuyển lên Admin ] → trường hợp phức tạp cần Admin hệ thống can thiệp
  ▼
Ghi audit log (BR-08) + thông báo nhân viên nếu công bị huỷ
```

> **Quan trọng về mặt pháp lý và quan hệ lao động:** nhân viên phải **được thông báo** khi công của mình bị huỷ, và **xem được lý do**. Huỷ công âm thầm là nguồn tranh chấp lao động.

---

## 9. Ma trận biện pháp × kịch bản

| Biện pháp \ Kịch bản | GPS giả | Chấm hộ | Gọi API | Đổi giờ | Ghé rồi đi |
|---|:---:|:---:|:---:|:---:|:---:|
| Mock location detection (`AF-01`) | ●●● | | ● | | |
| WiFi/Beacon (`AF-02`) | ●●● | ●● | | | ●● |
| Impossible travel (`AF-03`) | ●●● | ●● | | | |
| GPS accuracy (`AF-04`) | ●● | | | | |
| Liveness ngẫu nhiên (`AF-05`) | | ●●● | ●● | | |
| Anti-spoofing (`AF-06`) | | ●●● | | | |
| Device binding (`AF-07`) | ● | ●● | ●● | | |
| Random audit (`AF-08`) | | ●● | | | |
| Multi-device alert (`AF-09`) | | ●●● | ● | | |
| **Backend tự kiểm chứng (`AF-10`)** | ● | ●●● | ●●● | | |
| SSL Pinning (`AF-11`) | | | ●●● | | |
| HMAC + nonce (`AF-12`) | | | ●●● | ●● | |
| Rate limiting (`AF-13`) | | | ●●● | | |
| Root detection (`AF-14`) | ●● | | ●● | ● | |
| App Attestation (`AF-15`) | ●● | | ●●● | ● | |
| Token gắn thiết bị (`AF-16`) | | ●● | ●●● | | |
| **Giờ server (`AF-17`)** | | | | ●●● | |
| Đối chiếu lệch giờ (`AF-18`) | | | ● | ●●● | |
| Thời lượng ca (`AF-19`) | ● | ● | | | ●●● |
| Random check-in giữa ca (`AF-20`) | ●● | ●● | | | ●●● |

`●●●` hiệu quả cao · `●●` trung bình · `●` hỗ trợ gián tiếp

---

## 10. Thứ tự ưu tiên thi công

Không thể làm hết ngay. Thứ tự dưới đây tối ưu tỷ lệ **giá trị bảo vệ / công sức**:

### Giai đoạn 1 (MVP) — bắt buộc phải có

| Biện pháp | Lý do |
|---|---|
| `AF-10` Backend tự kiểm chứng | Không có nó thì mọi thứ khác vô nghĩa |
| `AF-17` Giờ server | Rẻ, hiệu quả tuyệt đối với kịch bản đổi giờ |
| `AF-12` HMAC + nonce | Chặn replay attack, chi phí thấp |
| `AF-16` Token gắn thiết bị | Nằm sẵn trong thiết kế auth |
| `AF-13` Rate limiting | Cấu hình ở Gateway, gần như miễn phí |
| `AF-01` Mock location | Vài dòng code trong `geolocator` |
| `AF-04` GPS accuracy | Kiểm tra đơn giản ở Backend |
| `AF-06` Anti-spoofing cơ bản | Model có sẵn, tích hợp vào pipeline AI |
| `AF-22` Audit log chi tiết | Nền tảng cho mọi phân tích về sau |
| `AF-18` Đối chiếu lệch giờ | Đi kèm `AF-17`, gần như miễn phí |

### Giai đoạn 2

`AF-05` liveness ngẫu nhiên · `AF-07` device binding · `AF-09` multi-device alert · `AF-11` SSL pinning · `AF-14` root detection · `AF-03` impossible travel · `AF-19` thời lượng ca · `AF-21` dashboard cảnh báo · `AF-23` quy trình xử lý cờ · Fraud scoring

### Giai đoạn 3

`AF-15` App Attestation · `AF-02` WiFi/Beacon · `AF-08` random audit · `AF-20` random check-in giữa ca

---

## 11. Giới hạn và bổ sung ngoài kỹ thuật

PA nhấn mạnh rõ: **kỹ thuật không giải quyết được 100%**. Cần bổ sung:

| Biện pháp phi kỹ thuật | Nội dung |
|---|---|
| **Quy định nội bộ** | Nội quy lao động ghi rõ chấm công hộ / gian lận chấm công là vi phạm kỷ luật, kèm chế tài cụ thể |
| **Minh bạch với người lao động** | Thông báo rõ hệ thống thu thập dữ liệu gì, dùng làm gì — vừa tuân thủ pháp luật, vừa tạo tính răn đe |
| **Quy trình khiếu nại** | Nhân viên bị huỷ công phải có kênh khiếu nại rõ ràng, có thời hạn phản hồi |
| **Máy chấm công vật lý** | Cho vị trí yêu cầu an ninh cao (nhà máy, kho) — camera cố định, có người chứng kiến, khó gian lận hơn app cá nhân |
| **Quản lý trực tiếp** | Không hệ thống nào thay được việc quản lý biết nhân viên có mặt hay không |

---

**Tiếp theo:** [07 — Mô hình dữ liệu](./07-mo-hinh-du-lieu.md)
