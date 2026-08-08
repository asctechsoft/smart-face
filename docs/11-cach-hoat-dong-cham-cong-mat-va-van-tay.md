# 11 — Chấm công bằng khuôn mặt và vân tay hoạt động thế nào

> Tài liệu giải thích **cơ chế kỹ thuật** của hai phương thức chấm công trên điện thoại, dành cho người cần hình dung rõ trước khi thi công.
> Liên quan: [03 — Nghiệp vụ App Nhân viên](./03-nghiep-vu-app-nhan-vien.md) · [06 — Chống gian lận](./06-anti-fraud.md) · [08 — Hợp đồng API](./08-hop-dong-api.md)
>
> 👉 Muốn xem **đường đi thật của dữ liệu** qua từng chặng (payload cụ thể, thứ tự chốt kiểm, AI Server nhận và trả gì): [12 — Một lượt chấm công đi qua những đâu](./12-luong-cham-cong-chi-tiet.md)

---

## Mục lục

1. [Điểm mấu chốt: hai phương thức khác nhau về bản chất](#1-điểm-mấu-chốt-hai-phương-thức-khác-nhau-về-bản-chất)
2. [Chấm công bằng khuôn mặt](#2-chấm-công-bằng-khuôn-mặt)
3. [Chấm công bằng vân tay](#3-chấm-công-bằng-vân-tay)
4. [So sánh trực tiếp](#4-so-sánh-trực-tiếp-hai-phương-thức)
5. [Người dùng thấy gì trong thực tế](#5-trong-thực-tế-người-dùng-thấy-gì)
6. [Các tình huống thực tế](#6-các-tình-huống-thực-tế-và-cách-hệ-thống-xử-lý)
7. [Ba lỗi thường gặp khi thi công](#7-ba-lỗi-thường-gặp-khi-thi-công-phần-này)

---

## 1. Điểm mấu chốt: hai phương thức khác nhau về bản chất

Nhiều người nghĩ "khuôn mặt và vân tay đều là sinh trắc học, chắc làm giống nhau". **Không phải.**

```
KHUÔN MẶT                              VÂN TAY
─────────────────────────              ─────────────────────────────────
Camera của app tự chụp                 App KHÔNG được chạm vào cảm biến
                                       vân tay. Chỉ hệ điều hành được.

Ảnh được GỬI LÊN SERVER                Dữ liệu vân tay KHÔNG BAO GIỜ
                                       rời khỏi con chip bảo mật của máy

Server tự so khớp với hồ sơ            Server không có gì để so khớp cả

→ Server tự mình xác minh được          → Server phải xác minh GIÁN TIẾP
  "đúng là mặt của nhân viên A"            bằng chữ ký điện tử
```

**Lý do vân tay khác:** Apple và Google **không cho phép** bất kỳ app nào đọc dữ liệu vân tay. Vân tay nằm trong Secure Enclave (iPhone) / TEE (Android) — một con chip riêng biệt mà kể cả hệ điều hành cũng không đọc được. App chỉ được hỏi hệ điều hành: *"làm ơn xác thực người dùng giúp tôi"* và nhận về kết quả có/không.

Đây là ràng buộc của nền tảng, không phải lựa chọn thiết kế. Và nó dẫn tới hai cách triển khai hoàn toàn khác nhau.

---

## 2. Chấm công bằng khuôn mặt

### 2.1. Bước A — Đăng ký (làm 1 lần, lúc onboarding)

```
Nhân viên mở app → màn hình "Thiết lập bảo mật" → chọn "Đăng ký khuôn mặt"

┌─ TRÊN ĐIỆN THOẠI ─────────────────────────────────────┐
│                                                        │
│   1. App mở camera trước                               │
│   2. Server bảo: "chụp 4 lần"                          │
│        Lần 1: nhìn thẳng                               │
│        Lần 2: quay đầu sang trái                       │
│        Lần 3: quay đầu sang phải                       │
│        Lần 4: nhìn thẳng + CHỚP MẮT                    │
│   3. Mỗi lần chụp: app cắt vùng mặt, nén xuống ~500KB  │
│                                                        │
└────────────────────────┬───────────────────────────────┘
                         │  gửi 4 ảnh lên
                         ▼
┌─ BACKEND (NestJS) ─────────────────────────────────────┐
│   Nhận ảnh → chuyển tiếp sang AI Server                │
└────────────────────────┬───────────────────────────────┘
                         ▼
┌─ AI SERVER (Python) ───────────────────────────────────┐
│                                                        │
│   Ảnh vào                                              │
│     ↓ Có mặt người trong ảnh không? (RetinaFace)       │
│     ↓ Ảnh có mờ không? Có tối quá không? Mặt có to đủ? │
│     ↓ Là người thật hay ảnh in / màn hình? (liveness)  │
│     ↓ Biến khuôn mặt thành DÃY 512 CON SỐ (embedding)  │
│                                                        │
│   Trả về: [0.0123, -0.0456, 0.0891, ... 512 số]        │
│                                                        │
└────────────────────────┬───────────────────────────────┘
                         ▼
┌─ BACKEND lưu vào database ─────────────────────────────┐
│                                                        │
│   Bảng FaceProfile:                                    │
│   ┌──────────────┬─────────┬─────────────────────────┐ │
│   │ employeeId   │ angle   │ embedding (512 số)      │ │
│   ├──────────────┼─────────┼─────────────────────────┤ │
│   │ emp_ducnv    │ FRONT   │ [0.0123, -0.0456, ...] │ │
│   │ emp_ducnv    │ LEFT    │ [0.0201, -0.0388, ...] │ │
│   │ emp_ducnv    │ RIGHT   │ [0.0098, -0.0512, ...] │ │
│   │ emp_ducnv    │ FRONT   │ [0.0130, -0.0441, ...] │ │
│   └──────────────┴─────────┴─────────────────────────┘ │
│                                                        │
│   ⚠ Lưu DÃY SỐ, không lưu ảnh làm dữ liệu so khớp.     │
│     Từ dãy số này KHÔNG dựng lại được mặt người.       │
│     (Ảnh gốc vẫn lưu riêng trên S3 để HR đối chiếu)    │
└────────────────────────────────────────────────────────┘
```

**Vì sao chụp 4 góc?** Vì lúc chấm công, người ta không đứng y hệt tư thế lúc đăng ký. Có nhiều góc thì tỉ lệ nhận đúng cao hơn nhiều.

### 2.2. Bước B — Chấm công hằng ngày

```
07:58 sáng, Đức tới công ty, mở app, bấm "Chấm vào"

┌─ ĐIỆN THOẠI ───────────────────────────────────────────┐
│                                                        │
│  1. App hỏi server trước: "cho tôi mã chấm công"       │
│         ← server trả: nonce = "9f2a...", giờ server,   │
│                       hành động = "CHỚP MẮT"           │
│                       (hành động này NGẪU NHIÊN mỗi    │
│                        lần — lần sau có thể là         │
│                        "quay đầu trái")                │
│                                                        │
│  2. App lấy GPS: 21.0123, 105.7987, sai số 8m          │
│     App kiểm tra: có đang bật app fake GPS không?      │
│     App kiểm tra: máy có bị root/jailbreak không?      │
│                                                        │
│  3. App mở camera, hiện chữ "Vui lòng chớp mắt"        │
│     Đức chớp mắt → app chụp                            │
│                                                        │
│  4. App gói tất cả lại và KÝ bằng khoá bí mật của máy: │
│         ảnh + nonce + GPS + giờ máy + thông tin máy    │
│         → chữ ký HMAC                                  │
│                                                        │
└────────────────────────┬───────────────────────────────┘
                         │  gửi lên
                         ▼
┌─ BACKEND kiểm tra theo THỨ TỰ ─────────────────────────┐
│                                                        │
│  ①  Token đăng nhập hợp lệ? Có đúng máy này không?     │
│  ②  Chữ ký có khớp không? (chống sửa nội dung)         │
│  ③  Mã nonce này đã dùng chưa?                         │
│         → dùng rồi = có kẻ gửi lại request cũ → CHẶN   │
│  ④  Giờ máy gửi lên lệch giờ server bao nhiêu?         │
│         > 2 phút → gắn cờ nghi ngờ chỉnh giờ           │
│  ⑤  Tài khoản này gọi API bao nhiêu lần trong 1 giờ?   │
│         quá nhiều → chặn                               │
│                                                        │
│  ⑥  GỬI ẢNH SANG AI SERVER  ← đây mới là bước quyết định│
│                                                        │
└────────────────────────┬───────────────────────────────┘
                         ▼
┌─ AI SERVER ────────────────────────────────────────────┐
│                                                        │
│  Nhận: ảnh vừa chụp + 4 dãy số đã lưu của Đức          │
│                                                        │
│  → Biến ảnh mới thành dãy 512 số                       │
│  → So với 4 dãy đã lưu, lấy điểm cao nhất              │
│  → Kiểm tra liveness                                   │
│  → Kiểm tra có đúng đã "chớp mắt" không                │
│                                                        │
│  Trả về CON SỐ, KHÔNG trả quyết định:                  │
│  {                                                     │
│    "match": { "best_score": 0.7213 },                  │
│    "liveness": { "score": 0.88, "action_verified": true}│
│  }                                                     │
│                                                        │
└────────────────────────┬───────────────────────────────┘
                         ▼
┌─ BACKEND ra quyết định ────────────────────────────────┐
│                                                        │
│  Lấy ngưỡng của công ty AMOBI từ cấu hình:             │
│      match cần ≥ 0.45   → 0.7213 ✓ ĐẠT                 │
│      liveness cần ≥ 0.70 → 0.88  ✓ ĐẠT                 │
│                                                        │
│  Kiểm tra GPS: cách văn phòng 45m, cho phép 100m ✓     │
│                                                        │
│  → GHI BẢN GHI CHẤM CÔNG với GIỜ CỦA SERVER            │
│  → Đẩy job tính công vào hàng đợi                      │
│  → Trả về app: "Đã chấm vào lúc 07:58"                 │
│                                                        │
└────────────────────────────────────────────────────────┘
```

> **Điểm quan trọng nhất:** AI Server chỉ trả về **con số**, Backend mới **so ngưỡng và quyết định**. Nhờ vậy khi muốn siết chặt hơn cho một công ty hay nghi ngờ có gian lận, chỉ cần đổi con số trong cấu hình — không phải deploy lại model AI. Đây là nguyên tắc `P3` trong [02 — Kiến trúc hệ thống](./02-kien-truc-he-thong.md).

---

## 3. Chấm công bằng vân tay

### 3.1. Vì sao không thể làm kiểu đơn giản

Cách làm ngây thơ mà rất nhiều dự án mắc phải:

```
❌ App gọi hệ điều hành xác thực vân tay
❌ Hệ điều hành trả về: thành công
❌ App gửi lên server: { "employeeId": "emp_ducnv", "fingerprintOk": true }
❌ Server thấy true → cho chấm công
```

**Sai ở đâu?** Chỉ cần ai đó mở Charles Proxy xem app gửi gì lên, họ sẽ thấy dòng JSON đó. Sau đó mở terminal gõ:

```bash
curl -X POST https://api.smartface.vn/v1/attendance/check-in \
     -H "Authorization: Bearer <token của họ>" \
     -d '{"employeeId":"emp_ducnv","fingerprintOk":true}'
```

**Chấm công thành công từ nhà, không cần chạm vân tay.** Viết thêm một script chạy tự động lúc 7h55 mỗi sáng là xong — nằm nhà vẫn đủ công cả tháng.

Đây chính xác là điều tài liệu PA cảnh báo ở mục 4.3, và là lý do có nguyên tắc `BR-02`: *Backend không tin bất kỳ cờ trạng thái xác thực nào do client tự khai.*

### 3.2. Cách làm đúng: chữ ký điện tử từ "két sắt" trong máy

**Ví von cho dễ hình dung:**

> Hãy tưởng tượng trong điện thoại có một **két sắt** chỉ mở được bằng vân tay của bạn. Bên trong két có một **con dấu độc nhất** — không sao chép ra ngoài được, không ai lấy được kể cả khi mở máy ra.
>
> Lúc đăng ký, bạn gửi cho công ty **hình mẫu của con dấu** đó (con dấu vẫn nằm trong két).
>
> Mỗi lần chấm công, công ty gửi cho bạn **một tờ giấy có số ngẫu nhiên**, và yêu cầu: *"đóng dấu lên tờ này rồi gửi lại"*.
>
> Muốn đóng dấu → phải mở két → phải chạm vân tay. Không có cách nào khác.
>
> Công ty nhận tờ giấy về, đối chiếu với hình mẫu đã lưu. **Khớp = chắc chắn vân tay đã được chạm thật.**

Kỹ thuật thật đúng như vậy:

| Trong ví von | Kỹ thuật thật |
|---|---|
| Két sắt mở bằng vân tay | Secure Enclave / TEE với `setUserAuthenticationRequired(true)` |
| Con dấu trong két | Private key — không bao giờ rời khỏi chip |
| Hình mẫu con dấu gửi công ty | Public key — lưu trên server |
| Tờ giấy có số ngẫu nhiên | Nonce / challenge do server sinh |
| Đóng dấu lên tờ giấy | Ký challenge bằng private key |
| Công ty đối chiếu hình mẫu | Server verify chữ ký bằng public key |

### 3.3. Bước A — Đăng ký vân tay (1 lần)

```
┌─ TRÊN ĐIỆN THOẠI ──────────────────────────────────────────────┐
│                                                                │
│  1. App yêu cầu hệ điều hành:                                  │
│       "Tạo cho tôi một cặp khoá trong Secure Enclave,          │
│        và ĐẶT ĐIỀU KIỆN: chỉ được dùng khoá bí mật             │
│        SAU KHI người dùng xác thực vân tay thành công"         │
│                                                                │
│     Android:  KeyGenParameterSpec                              │
│                 .setUserAuthenticationRequired(true)           │
│                 .setInvalidatedByBiometricEnrollment(true)     │
│     iOS:      SecAccessControl                                 │
│                 .biometryCurrentSet + .privateKeyUsage         │
│                                                                │
│  2. Hệ điều hành tạo ra:                                       │
│       🔒 KHOÁ BÍ MẬT  → nằm trong Secure Enclave,              │
│                          KHÔNG BAO GIỜ ra ngoài,               │
│                          kể cả app cũng không đọc được         │
│       🔓 KHOÁ CÔNG KHAI → app đọc được, gửi đi được            │
│                                                                │
└──────────────────────────┬─────────────────────────────────────┘
                           │  gửi KHOÁ CÔNG KHAI lên
                           ▼
┌─ BACKEND lưu ──────────────────────────────────────────────────┐
│   Bảng BiometricKey:                                           │
│   ┌────────────┬───────────────┬──────────────────────────┐   │
│   │ employeeId │ deviceId      │ publicKey                │   │
│   ├────────────┼───────────────┼──────────────────────────┤   │
│   │ emp_ducnv  │ a3f9c2e1-...  │ -----BEGIN PUBLIC KEY... │   │
│   └────────────┴───────────────┴──────────────────────────┘   │
│                                                                │
│   ⚠ Server KHÔNG có bất kỳ dữ liệu vân tay nào.                │
│     Chỉ có khoá công khai — thứ này công khai cũng vô hại.     │
│     Đây chính là BR-05 trong tài liệu 01.                      │
└────────────────────────────────────────────────────────────────┘
```

### 3.4. Bước B — Chấm công bằng vân tay

```
┌─ 1. App xin thử thách ─────────────────────────────────────────┐
│    GET /v1/attendance/challenge                                │
│    ← Server trả: nonce = "9f2a7c3e..." (chuỗi ngẫu nhiên,      │
│                                          sống 60 giây)          │
└──────────────────────────┬─────────────────────────────────────┘
                           ▼
┌─ 2. App yêu cầu ký ────────────────────────────────────────────┐
│                                                                │
│    App gọi:  "Hệ điều hành ơi, ký chuỗi 9f2a7c3e...            │
│               bằng khoá bí mật của tôi"                        │
│                                                                │
│    Hệ điều hành:  "Khoá này có điều kiện. Xác thực đã."        │
│                    ↓                                           │
│         ┌──────────────────────────────┐                       │
│         │  🔓 Đặt ngón tay lên cảm biến │  ← hộp thoại của HỆ   │
│         │                              │     ĐIỀU HÀNH, không  │
│         │        [ Huỷ ]               │     phải của app.     │
│         └──────────────────────────────┘     App không thấy    │
│                    ↓                          gì bên trong.    │
│         Vân tay đúng → Secure Enclave mới chịu ký              │
│         Vân tay sai  → không ký, app nhận lỗi                  │
│                    ↓                                           │
│    App nhận được chữ ký:  "MEUCIQDx8k2..."                     │
│                                                                │
└──────────────────────────┬─────────────────────────────────────┘
                           ▼
┌─ 3. App gửi lên server ────────────────────────────────────────┐
│    POST /v1/attendance/check-in                                │
│    {                                                           │
│      "authMethod": "FINGERPRINT",                              │
│      "nonce": "9f2a7c3e...",                                   │
│      "signedChallenge": "MEUCIQDx8k2...",   ← CHỮ KÝ           │
│      "location": {...},                                        │
│      "deviceContext": {...}                                    │
│    }                                                           │
│                                                                │
│    ⚠ KHÔNG có trường nào kiểu "fingerprintOk": true            │
└──────────────────────────┬─────────────────────────────────────┘
                           ▼
┌─ 4. Backend xác minh ──────────────────────────────────────────┐
│                                                                │
│    Lấy publicKey của (Đức + máy này) từ database               │
│                                                                │
│    verify(nonce = "9f2a7c3e...",                               │
│           signature = "MEUCIQDx8k2...",                        │
│           publicKey)                                           │
│                                                                │
│    ✓ Khớp → CHỨNG MINH được rằng khoá bí mật đã được dùng      │
│              → mà khoá bí mật chỉ dùng được sau khi vân tay    │
│                xác thực thành công                             │
│              → VẬY LÀ VÂN TAY ĐÃ ĐƯỢC CHẠM THẬT                │
│                                                                │
│    ✗ Không khớp → 401, không cho chấm công                     │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### 3.5. Vì sao kẻ tấn công không giả được

| Kẻ tấn công thử | Kết quả |
|---|---|
| Bắt gói tin xem app gửi gì | Thấy chữ ký, nhưng chữ ký gắn với nonce đó, nonce chỉ dùng 1 lần |
| Gửi lại y nguyên request cũ | Nonce đã dùng → server chặn (`FRAUD_REPLAY_DETECTED`) |
| Tự tạo chữ ký giả | Không có khoá bí mật, không tạo được |
| Trích khoá bí mật ra khỏi máy | Không thể — nằm trong chip phần cứng |
| Dùng `curl` gửi request | Không ký được, thiếu chữ ký hợp lệ → 401 |
| Patch app để bỏ qua bước xác thực vân tay | Không giúp gì — chính **hệ điều hành** từ chối ký, không phải app |

---

## 4. So sánh trực tiếp hai phương thức

| | **Khuôn mặt** | **Vân tay** |
|---|---|---|
| Dữ liệu sinh trắc học có lên server không? | Có (ảnh + dãy số embedding) | **Không bao giờ** |
| Server so khớp cái gì? | Dãy số của ảnh mới vs dãy số đã lưu | Chữ ký điện tử vs khoá công khai |
| Có cần AI Server không? | **Có** — mỗi lần chấm công đều gọi | Không |
| Tốc độ | ~1–2 giây (upload ảnh + AI xử lý) | ~0.3 giây |
| Tốn băng thông | ~500KB mỗi lần | ~1KB |
| Chi phí hạ tầng | Cao (cần GPU) | Gần như bằng 0 |
| Chứng minh được điều gì? | **"Đúng khuôn mặt của nhân viên Đức"** | **"Người đã đăng ký vân tay trên máy này đang cầm máy"** |
| Chống chấm công hộ | **Mạnh** | Yếu hơn — xem 4.1 |
| Hoạt động khi trời tối / đeo khẩu trang | Kém | Bình thường |
| Yêu cầu pháp lý | Nặng (dữ liệu sinh trắc học nhạy cảm) | Nhẹ (không lưu dữ liệu sinh trắc học) |

### 4.1. Điểm yếu của vân tay cần hiểu rõ

Vân tay chứng minh **"chủ máy đang cầm máy"**, chứ không chứng minh **"đúng là nhân viên Đức"** theo nghĩa sinh trắc học mà hệ thống tự kiểm chứng được.

Kịch bản vẫn lọt: Đức đưa điện thoại cho đồng nghiệp, và trước đó Đức đã thêm vân tay của đồng nghiệp vào phần cài đặt của máy.

Có một cơ chế chặn được phần lớn kịch bản này:

```
setInvalidatedByBiometricEnrollment(true)   (Android)
kSecAccessControlBiometryCurrentSet         (iOS)
```

Cờ này khiến **khoá bí mật tự động bị huỷ ngay khi có vân tay mới được thêm vào máy**. Đức thêm vân tay của đồng nghiệp → khoá chết → phải đăng ký lại từ đầu → hệ thống ghi log và HR nhìn thấy.

> Đây là lý do tài liệu khuyến nghị: **vân tay là phương án dự phòng và tiện lợi, khuôn mặt mới là phương thức chống gian lận chính.**

---

## 5. Trong thực tế, người dùng thấy gì

Trên màn hình Home:

```
┌────────────────────────────────────────┐
│         [  CHẤM VÀO  ]                 │
│                                        │
│      🔒 Khuôn mặt    |    👆 Vân tay   │
└────────────────────────────────────────┘
```

Công ty cấu hình được chính sách:

| Cấu hình | Ý nghĩa | Phù hợp với |
|---|---|---|
| Bắt buộc khuôn mặt | Vân tay chỉ dùng để mở app, không chấm công được | Công ty siết chặt chống chấm hộ |
| Cho cả hai | Nhân viên tự chọn | Đa số trường hợp |
| Khuôn mặt lúc vào, vân tay lúc ra | Chấm vào là lúc dễ gian lận nhất | Cân bằng chặt chẽ và tiện lợi |
| Vân tay thường ngày, khuôn mặt ngẫu nhiên | Ví dụ 1 lần/tuần bắt xác thực bằng mặt | Cân bằng tốt, ít phiền |

Tài liệu PA yêu cầu nhân viên phải đăng ký **ít nhất một** phương thức (`BR-03`), và **khuyến khích đăng ký cả hai** để dự phòng — vì:

- Trời tối, đeo khẩu trang, camera hỏng → dùng vân tay
- Máy không có cảm biến vân tay, tay ướt/bẩn → dùng khuôn mặt
- AI Server gặp sự cố → vân tay vẫn chấm công được (chính là `NFR-REL-10` graceful degradation)

---

## 6. Các tình huống thực tế và cách hệ thống xử lý

| Tình huống | Khuôn mặt | Vân tay |
|---|---|---|
| **Đổi điện thoại mới** | Dữ liệu vẫn còn trên server, nhưng phải xác thực lại danh tính rồi liên kết máy mới | Khoá cũ ở máy cũ vô dụng, **bắt buộc tạo khoá mới** trên máy mới |
| **Cài lại app trên cùng máy** | Không ảnh hưởng, dữ liệu ở server | Khoá bị xoá cùng app → **phải đăng ký lại** |
| **Thêm vân tay mới ở Cài đặt máy** | Không ảnh hưởng | Khoá **tự động chết** → app báo `BIO_KEY_INVALIDATED`, yêu cầu đăng ký lại |
| **Chạm sai vân tay 5 lần** | — | Hệ điều hành tự khoá cảm biến vài phút. App bắt lỗi này và gợi ý dùng khuôn mặt |
| **Máy không có cảm biến vân tay** | Bình thường | Ẩn tuỳ chọn vân tay, chỉ cho đăng ký khuôn mặt |
| **Nhân viên để râu / cắt tóc / đeo kính mới** | Điểm tương đồng giảm. Nếu bị từ chối nhiều lần → HR cho đăng ký lại khuôn mặt | Không ảnh hưởng |
| **Mất mạng** | Không chấm được (cần gọi AI Server). Chế độ offline là tính năng giai đoạn 3, và bản ghi offline phải qua duyệt | Cũng không chấm được — vẫn cần xin nonce từ server |
| **Mất điện thoại** | HR/Admin reset sinh trắc học + thu hồi liên kết thiết bị, nhân viên đăng ký lại trên máy mới | Như trên, khoá cũ bị thu hồi |

---

## 7. Ba lỗi thường gặp khi thi công phần này

### Lỗi 1 — Gửi cờ boolean lên server

```jsonc
// ❌ Nếu thấy bất kỳ dòng nào như thế này trong code, dừng lại và sửa ngay
{ "faceVerified": true }
{ "biometricOk": true }
{ "authPassed": true }
```

Bất kể là khuôn mặt hay vân tay, **server phải tự có bằng chứng để tự kiểm chứng**: khuôn mặt thì là ảnh, vân tay thì là chữ ký. (`BR-02`, `AF-10`)

### Lỗi 2 — Để app tự chọn hành động liveness

Nếu app luôn yêu cầu "chớp mắt", kẻ gian quay sẵn một video chớp mắt rồi phát lại mỗi lần chấm công. Hành động phải do **server chọn ngẫu nhiên** mỗi lần, và AI Server phải kiểm tra đúng hành động đó đã được thực hiện. (`AF-05`)

### Lỗi 3 — Quên đặt cờ vô hiệu hoá khoá khi vân tay thay đổi

Nếu thiếu `setInvalidatedByBiometricEnrollment(true)` / `kSecAccessControlBiometryCurrentSet`, thì ai cũng có thể thêm vân tay của mình vào máy người khác và chấm công hộ mà hệ thống không hề biết. Chỉ là một dòng cấu hình, nhưng thiếu nó thì cả cơ chế vân tay mất phần lớn giá trị chống gian lận.

---

## 8. Tóm tắt trong một trang

```
KHUÔN MẶT
  Đăng ký:   chụp 4 góc → AI biến thành 512 số → lưu vào DB
  Chấm công: chụp ảnh → gửi lên → AI so với 512 số đã lưu
             → trả điểm số → Backend so ngưỡng → quyết định
  Bằng chứng server có: ẢNH (tự kiểm chứng được)

VÂN TAY
  Đăng ký:   tạo cặp khoá trong chip bảo mật (điều kiện: cần vân tay)
             → gửi KHOÁ CÔNG KHAI lên server
  Chấm công: server gửi chuỗi ngẫu nhiên → OS bắt chạm vân tay
             → chip ký chuỗi đó → gửi chữ ký lên
             → server verify bằng khoá công khai
  Bằng chứng server có: CHỮ KÝ (chỉ tạo được khi vân tay đã chạm)

CẢ HAI ĐỀU TUÂN THEO MỘT NGUYÊN TẮC:
  Server không tin lời khai của app.
  Server chỉ tin thứ mà server TỰ MÌNH KIỂM CHỨNG ĐƯỢC.
```

---

**Xem thêm:**
[03 — Nghiệp vụ App Nhân viên](./03-nghiep-vu-app-nhan-vien.md) (mục 2–5) ·
[06 — Chống gian lận](./06-anti-fraud.md) (`AF-05`, `AF-10`, `AF-12`) ·
[08 — Hợp đồng API](./08-hop-dong-api.md) (mục 3, 4, 8) ·
[00 — Kiến thức nền tảng](./00-kien-thuc-nen-tang.md) (Phần 1–3 về nhận diện khuôn mặt và liveness)
