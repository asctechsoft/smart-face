# 12 — Một lượt chấm công đi qua những đâu

> Thuật lại **đúng những gì code đang chạy**, không phải thiết kế dự kiến. Mọi
> payload trong tài liệu này đối chiếu từ DTO và schema thật.
>
> Liên quan: [03 — Nghiệp vụ App](./03-nghiep-vu-app-nhan-vien.md) ·
> [08 — Hợp đồng API](./08-hop-dong-api.md) ·
> [11 — Cơ chế mặt và vân tay](./11-cach-hoat-dong-cham-cong-mat-va-van-tay.md) ·
> [AiServer/README.md](../AiServer/README.md)
>
> 👉 Tài liệu này giả định nhân viên **đã có hồ sơ khuôn mặt** trong DB. Luồng
> chạy trước đó một lần duy nhất — từ lúc được cấp tài khoản tới lúc đăng ký
> xong khuôn mặt — ở
> [13 — Từ lúc được cấp tài khoản tới lúc chấm công được](./13-luong-onboarding-va-dang-ky-khuon-mat.md).

Tài liệu `08` mô tả *hợp đồng* giữa từng cặp thành phần. Tài liệu `11` mô tả *cơ
chế* ở mức khái niệm. Tài liệu này trả lời câu hỏi còn lại: **nhân viên bấm nút
chấm công thì cái gì đi từ đâu tới đâu, theo thứ tự nào, mang theo gì.**

---

## Mục lục

1. [Toàn cảnh](#1-toàn-cảnh--ba-lượt-gọi-mạng)
2. [Chặng ① — App xin đề bài](#2-chặng--app-xin-đề-bài)
3. [Chặng ② — App chụp ảnh](#3-chặng--app-chụp-ảnh-không-gọi-mạng)
4. [Chặng ③ — App gửi bằng chứng](#4-chặng--app-gửi-bằng-chứng-thô)
5. [Chặng ④ — Mười chốt kiểm của Backend](#5-chặng--mười-chốt-kiểm-trước-khi-động-tới-ai)
6. [Chặng ⑤ — Backend gọi AI Server](#6-chặng--backend-gọi-ai-server)
7. [Chặng ⑥ — Pipeline AI Server](#7-chặng--pipeline-của-ai-server)
8. [Chặng ⑦ — Backend tự so ngưỡng](#8-chặng--backend-tự-so-ngưỡng)
9. [Chặng ⑧ — Chấm điểm, ghi sổ, trả về](#9-chặng--chấm-điểm-gian-lận-ghi-sổ-trả-về)
10. [Câu hỏi thường gặp](#10-câu-hỏi-thường-gặp)
11. [Đối chiếu với luồng vân tay](#11-đối-chiếu-với-luồng-vân-tay)

---

## 1. Toàn cảnh — ba lượt gọi mạng

```
NHÂN VIÊN          APP                 BACKEND              AI SERVER
    │               │                     │                     │
    │ mở màn hình   │                     │                     │
    ├──────────────►│  ① GET /challenge   │                     │
    │               ├────────────────────►│                     │
    │               │◄────────────────────┤  nonce + "CHỚP MẮT" │
    │               │                     │  + giờ server       │
    │               │                     │                     │
    │ ◄─────────────┤ hiện "Hãy chớp mắt" │                     │
    │   chớp mắt    │                     │                     │
    ├──────────────►│  ② chụp ảnh (cục bộ)│                     │
    │               │                     │                     │
    │               │  ③ POST /check-in   │                     │
    │               ├────────────────────►│                     │
    │               │   ảnh + GPS + nonce │ ④ 10 chốt kiểm ────┐│
    │               │                     │                    ││
    │               │                     │  ⑤ POST /v1/verify ││
    │               │                     ├───────────────────►││
    │               │                     │  ảnh + embedding   ││ ⑥ pipeline
    │               │                     │◄───────────────────┤│
    │               │                     │  0.7213 · 0.88     ││
    │               │                     │                     │
    │               │                     │ ⑦ TỰ so ngưỡng      │
    │               │◄────────────────────┤ ⑧ ghi sổ, trả về    │
    │◄──────────────┤ "Chấm vào 08:02"    │                     │
```

Ba lượt gọi mạng chứ không phải một. Đây là quyết định có chủ đích — lý do ở
[mục 10](#10-câu-hỏi-thường-gặp).

---

## 2. Chặng ① — App xin đề bài

```
GET /v1/attendance/challenge
Authorization: Bearer <accessToken>
```

App **không gửi gì** ngoài token. Backend trả về
([attendance.service.ts:85-111](../BackEnd/src/modules/attendance/attendance.service.ts#L85-L111)):

```jsonc
{
  "nonce": "cm3x9k2-lz8f4a-9f2ad1b3c7",
  "serverTime": "2026-08-05T01:02:11.431Z",
  "expiresIn": 60,
  "livenessAction": "BLINK",
  "expectedType": "CHECK_IN",
  "requiresPhoto": true,
  "workDate": "2026-08-05"
}
```

| Trường | Vì sao có mặt |
|---|---|
| `nonce` | Vé vào cửa, **dùng một lần**, sống 60 giây trong Redis. Chặn replay |
| `serverTime` | App đối chiếu với đồng hồ máy để phát hiện chỉnh giờ (`AF-18`) |
| `livenessAction` | **Server chọn ngẫu nhiên** trong 5 hành động (`AF-05`) |
| `expectedType` | Server tra trạng thái hiện tại để biết cần chấm VÀO hay RA |
| `workDate` | Ngày công, đã xử lý ca đêm vắt qua nửa đêm |

### Vì sao `livenessAction` phải do server chọn

Nếu App tự chọn hành động, kẻ tấn công chỉ cần sửa app để **luôn chọn hành động
đã quay sẵn video**. Toàn bộ cơ chế chống video phát lại sụp đổ chỉ bằng một
dòng patch.

Server chọn ngẫu nhiên nghĩa là kẻ tấn công phải quay sẵn cả 5 video và vẫn
không biết trước sẽ bị hỏi cái nào — trong 60 giây.

### Vì sao `expectedType` do server tính

App **không được** giả định "lần chấm đầu tiên trong ngày là chấm vào". Một ngày
có thể có nhiều cặp vào/ra: ca gãy, ra ngoài gặp khách rồi quay lại. Backend tra
bản ghi hiện có mới biết chắc (`BR-ATT-01/02/03`).

---

## 3. Chặng ② — App chụp ảnh (không gọi mạng)

```
App hiện: "Hãy nhìn thẳng và CHỚP MẮT"
   ↓ mở camera trước
   ↓ nhân viên chớp mắt
   ↓ App cắt vùng mặt, nén JPEG xuống ~300–500 KB
   ↓ đọc GPS, WiFi BSSID, device ID
   ↓ (Android) xin Play Integrity token · (iOS) App Attest
```

**App không chứa model AI nào.** Nó không phát hiện khuôn mặt, không chấm điểm
liveness, không so khớp gì cả. Về mặt vai trò, App là một cái máy ảnh có kèm cảm
biến vị trí.

Đây không phải giới hạn kỹ thuật mà là lựa chọn bảo mật: bất cứ thứ gì chạy trên
máy người dùng đều có thể bị sửa. Kết luận do thiết bị của người được kiểm tra
đưa ra thì không có giá trị kiểm tra.

Giới hạn kích thước ảnh: **5 MB**, cưỡng chế ở tầng interceptor
([attendance.controller.ts:29](../BackEnd/src/modules/attendance/attendance.controller.ts#L29)).

---

## 4. Chặng ③ — App gửi bằng chứng thô

```
POST /v1/attendance/check-in
Content-Type: multipart/form-data
Authorization: Bearer <accessToken>
X-Device-Id: a3f9c2e1-...
X-Signature: <HMAC-SHA256(method+path+bodyHash+nonce+timestamp, deviceSecret)>
X-Nonce: <chuỗi ngẫu nhiên dùng một lần>
X-Timestamp: <unix giây>
X-Body-Sha256: <băm nội dung ảnh + các trường form>
```

| Field | Kiểu | Giá trị thật |
|---|---|---|
| `image` | binary | `<JPEG 412 KB>` |
| `nonce` | string | `cm3x9k2-lz8f4a-9f2ad1b3c7` |
| `clientTime` | ISO8601 | `2026-08-05T01:02:19.882Z` |
| `authMethod` | enum | `FACE` |
| `location` | JSON | `{"latitude":21.012345,"longitude":105.798765,"accuracy":8.2,"provider":"gps","isMocked":false}` |
| `deviceContext` | JSON | `{"deviceId":"a3f9c2e1-...","model":"iPhone 14","osVersion":"17.5","appVersion":"1.0.0","isRooted":false,"attestationToken":"eyJ...","wifiBssid":"a4:2b:8c:11:9d:0e"}` |
| `branchId` | string | *(tuỳ chọn, bỏ trống = tự chọn chi nhánh gần nhất)* |

Định nghĩa đầy đủ:
[dto/attendance.dto.ts:110-158](../BackEnd/src/modules/attendance/dto/attendance.dto.ts#L110-L158).

### Ba header không phải tuỳ chọn

| Header | Thiếu thì | Chống được gì |
|---|---|---|
| `X-Device-Id` | 401 `AUTH_DEVICE_MISMATCH` | Bảo đảm `deviceId` trong ngữ cảnh request luôn có thật, để rate limit theo thiết bị và điểm gian lận "thiết bị lạ" không bị qua mặt bằng cách bỏ trống (`AF-16`) |
| `X-Signature` | 401 `AUTH_SIGNATURE_INVALID` | Ràng buộc thiết bị **thật** — ký bằng `deviceSecret` nằm trong secure enclave, không có trong token (`AF-12`) |
| `X-Body-Sha256` | 401 `AUTH_SIGNATURE_INVALID` | Ràng buộc **nội dung ảnh và toạ độ GPS**. Không có nó thì kẻ chặn được request đã ký giữa đường tráo được ảnh sang người khác — xem [08 mục 1.2.1](./08-hop-dong-api.md#121-x-body-sha256--ràng-buộc-nội-dung-của-request-multipart) |

`X-Device-Id` một mình **không** chống được token bị đánh cắp: payload JWT chỉ
được *ký* chứ không *mã hoá*, ai cầm được token đều giải base64 ra đọc `deviceId`
rồi tự đặt header cho khớp. Chốt thật là chữ ký HMAC. Chi tiết ở
[08 mục 1.2](./08-hop-dong-api.md#12-header-chuẩn).

### Những trường KHÔNG có trong payload

Đây là điểm quan trọng nhất của cả tài liệu này.

```
KHÔNG có:  faceVerified      livenessPassed
           biometricOk       matchScore
```

App gửi **bằng chứng thô**, không gửi kết luận (`BR-02`, `AF-10`). Nếu payload
chứa `faceVerified: true` thì kẻ tấn công chỉ cần gửi thẳng cờ đó lên là chấm
công được mà không cần khuôn mặt nào.

Có **hai lớp** bảo vệ điều này:

1. `CheckInDto` không khai báo các trường đó.
2. `ValidationPipe({ whitelist: true })` **vứt bỏ** mọi trường không khai báo
   trong DTO trước khi request tới service. Client cố nhét vào cũng không tới nơi.

> Thấy trường như vậy xuất hiện trong DTO ⇒ lỗi nghiêm trọng, sửa ngay.
> Cảnh báo này được ghi thẳng vào code tại
> [dto/attendance.dto.ts:110-116](../BackEnd/src/modules/attendance/dto/attendance.dto.ts#L110-L116).

---

## 5. Chặng ④ — Mười chốt kiểm trước khi động tới AI

Theo đúng thứ tự trong
[attendance.service.ts:117-274](../BackEnd/src/modules/attendance/attendance.service.ts#L117-L274):

| # | Chốt | Kiểm gì | Trượt → mã lỗi |
|:--:|---|---|---|
| **0** | **Đóng dấu giờ** | `recordedAt = new Date()` — dòng đầu tiên của hàm | — |
| 1 | Nhân viên | Còn hoạt động, đúng công ty, không bị đình chỉ | `AUTH_ACCOUNT_SUSPENDED` |
| 2 | **Nonce** | Có trong Redis không, đã dùng chưa → xoá ngay | `ATT_INVALID_NONCE` · `FRAUD_REPLAY_DETECTED` |
| 3 | **Lệch giờ** | So `clientTime` với `recordedAt` | *(ghi lại làm tín hiệu, không chặn)* |
| 4 | Vị trí | GPS giả (`AF-01`), sai số quá lớn (`AF-04`), nguồn không tin cậy | `FRAUD_MOCK_LOCATION` · `FRAUD_LOW_GPS_ACCURACY` |
| 5 | Thiết bị | Root / jailbreak (`AF-14`) | `FRAUD_ROOTED_DEVICE` |
| 6 | **Ngày công** | Tính `workDate`, xử lý ca đêm vắt qua nửa đêm | — |
| 7 | Kỳ lương | Kỳ chứa ngày này đã chốt chưa (`BR-07`) | `ATT_PERIOD_LOCKED` |
| 8 | Ca làm việc | Hôm nay có ca không (`BR-ATT-04`) | `ATT_NO_SHIFT_TODAY` |
| 9 | Loại chấm | VÀO/RA có hợp lệ với trạng thái hiện tại không | `ATT_ALREADY_CHECKED_IN` · `ATT_NOT_CHECKED_IN` |
| 10 | **Geofence** | Tính khoảng cách tới chi nhánh, WiFi/beacon nội bộ | *(chỉ TÍNH, chưa chặn — xem dưới)* |
| **10b** | **WiFi công ty** | BSSID báo lên có nằm trong danh sách của chi nhánh không (`AF-02`) | `ATT_WIFI_REQUIRED` · `ATT_WIFI_NOT_CONFIGURED` |
| **10c** | **Mạng văn phòng** | IP nguồn có nằm trong dải CIDR của chi nhánh không (`AF-02b`) | `ATT_IP_NOT_ALLOWED` · `ATT_IP_NOT_CONFIGURED` |
| **11** | **→ GỌI AI SERVER** | | |
| 12 | Chấm điểm gian lận | Gom mọi tín hiệu, gồm cả `matchScore` vừa nhận | — |
| 13 | Cưỡng chế geofence | Ngoài vùng + chính sách `BLOCK` | `ATT_OUT_OF_GEOFENCE` |
| 14 | Cưỡng chế điểm rủi ro | Điểm ≥ 80 | `FRAUD_RISK_TOO_HIGH` |

### Vì sao lời gọi AI nằm ở chốt thứ 11

Có chủ đích. Mười chốt trước đều rẻ: vài truy vấn Redis và Postgres, tính khoảng
cách bằng công thức Haversine. Chốt thứ 11 là lời gọi mạng sang một service khác
để chạy suy luận trên GPU — đắt nhất trong toàn bộ chuỗi.

Nonce sai, GPS giả, chưa tới ca làm — tất cả đều phát hiện được bằng những chốt
rẻ tiền. Gọi AI trước là đốt tài nguyên GPU cho những request **chắc chắn sẽ bị
từ chối**, và ở giờ cao điểm 8h sáng đó là tài nguyên lấy đi từ người đang chấm
công hợp lệ.

### Vì sao `recordedAt` đóng dấu ở dòng đầu tiên

```ts
const recordedAt = new Date();   // BR-01: giờ CHÍNH THỨC là giờ server
```

Giờ ghi nhận được đóng dấu **ngay khi request tới**, không phải sau khi AI xử lý
xong. Nếu đóng dấu sau, người có mạng chậm hoặc chấm công lúc AI đang tải nặng
sẽ bị tính đi muộn oan — 176 ms xử lý AI cộng thêm 2 giây mạng 3G có thể đẩy một
người từ 07:59:59 sang 08:00:02.

Giờ máy (`clientTime`) **chỉ để đối chiếu**, không bao giờ dùng tính công.

### Chốt 10b — bắt buộc kết nối WiFi công ty (`AF-02`)

**Không bắt được WiFi văn phòng thì KHÔNG ghi nhận lượt chấm công.** Chặn hẳn,
không tạo bản ghi nào.

| Chính sách `attendance.wifi.requirement` | Không khớp BSSID thì |
|---|---|
| `BLOCK` *(mặc định)* | **Từ chối, không ghi nhận** |
| `FLAG` | Vẫn ghi nhận nhưng nâng `decision` lên `FLAGGED` cho quản lý xem |
| `OFF` | Bỏ qua, chỉ dùng làm tín hiệu chấm điểm gian lận |

Đặt **trước** lời gọi AI Server có chủ đích: đây là phép so chuỗi trong bộ nhớ,
còn bên dưới là suy luận trên GPU. Kiểm sau nghĩa là đốt tài nguyên GPU cho
những request chắc chắn bị từ chối.

**Đối chiếu bằng BSSID, không bằng SSID.** SSID là *tên* mạng — ai cũng đặt điểm
phát sóng cá nhân tên `AMOBI-WiFi` được trong ba giây. BSSID là địa chỉ MAC của
chính bộ phát. `Branch.wifiSsids` vẫn giữ nhưng chỉ để HR biết mình đang khai bộ
phát nào; nó không tham gia vào quyết định.

Cách viết BSSID được chuẩn hoá trước khi so: `a4:2b:8c:11:9d:0e`,
`A4-2B-8C-11-9D-0E` và `a42b8c119d0e` là cùng một bộ phát. Không chuẩn hoá thì
nhân viên bị từ chối chỉ vì HR gõ chữ hoa — nhìn bằng mắt hai chuỗi giống hệt
nhau nên cực khó lần ra.

Giá trị `02:00:00:00:00:00` **không** được coi là bắt được WiFi. Android trả giá
trị giữ chỗ này khi app thiếu quyền vị trí; chấp nhận nó nghĩa là chỉ cần từ
chối cấp quyền vị trí là qua được chốt.

**Hai mã lỗi tách riêng:**

| Mã | Lỗi của ai | App hiển thị |
|---|---|---|
| `ATT_WIFI_REQUIRED` | Nhân viên — đang dùng 4G hoặc WiFi khác | "Bật WiFi và kết nối vào mạng văn phòng" |
| `ATT_WIFI_NOT_CONFIGURED` | Cấu hình — chi nhánh chưa khai BSSID | "Liên hệ bộ phận nhân sự" |

Bảo nhân viên "liên hệ HR" khi thật ra chỉ cần bật WiFi là gây phiền vô ích, và
ngược lại.

**Đơn công tác đã duyệt được miễn** (`BR-ATT-06`). Người đang ở nhà khách hàng
không thể bắt WiFi văn phòng — miễn geofence mà không miễn WiFi thì đơn công tác
vẫn vô dụng.

> ⚠ **Giới hạn — đọc trước khi tin vào chốt này.**
>
> `wifiBssid` do **App tự khai**. Máy đã root, hoặc bản app bị sửa, khai được
> bất kỳ BSSID nào. Đây đúng là loại dữ liệu mà `BR-02` cảnh báo không được tin
> — khác với ảnh khuôn mặt, Backend không có cách nào tự kiểm chứng.
>
> Tác dụng thật của nó: nâng chi phí tấn công từ "ngồi nhà bấm nút" lên "phải
> biết BSSID của văn phòng **và** phải sửa được app". Kết hợp với phát hiện root
> (`AF-14`) và App Attestation (`AF-15`) thì đủ chặn phần lớn trường hợp. Một
> mình nó thì không.
>
> Muốn ràng buộc mạng thật sự thì phải kiểm ở tầng khác: chỉ cho gọi API chấm
> công từ dải IP của văn phòng, hoặc dùng chứng chỉ thiết bị cấp qua mạng nội
> bộ. **Chưa làm.**

### Chốt 10c — bắt buộc gọi từ dải IP mạng văn phòng (`AF-02b`)

**Đây là chốt mạnh nhất trong nhóm xác thực vị trí.** Khác với BSSID và GPS —
những thứ App tự khai — địa chỉ IP nguồn do **server quan sát** từ kết nối TCP.
Client không có cách nào tự đặt.

Cấu hình ở `Branch.allowedIpCidrs`, dạng CIDR: `["203.0.113.0/24", "198.51.100.7/32"]`.

Ba mức giống chốt WiFi (`attendance.ipRestriction.requirement`), mặc định `BLOCK`.

#### ⚠ `trust proxy` — cấu hình dễ làm sai nhất trong toàn hệ thống

Chốt này phụ thuộc hoàn toàn vào việc `request.ip` là địa chỉ nào. Sai theo cả
hai hướng đều hỏng:

| Cấu hình | Hậu quả |
|---|---|
| Không khai (mặc định) | `request.ip` là IP của **Nginx**, không phải nhân viên → danh sách không bao giờ khớp → **cả công ty không chấm công được** |
| Khai `true` (tin mọi thứ) | Ai cũng tự gửi `X-Forwarded-For: <IP văn phòng>` là qua → **chốt mất sạch tác dụng**, mà log vẫn hiển thị đúng IP văn phòng |

Cách đúng: khai **chính xác số proxy** đứng trước Backend qua `TRUSTED_PROXY_HOPS`.
Express bỏ qua đúng ngần ấy mục tính từ phải sang trong `X-Forwarded-For` — phần
kẻ tấn công tự thêm nằm bên trái nên không với tới được.

```
Chạy thẳng, không proxy   → TRUSTED_PROXY_HOPS=0
Sau một Nginx             → 1
Sau Cloudflare rồi Nginx  → 2
```

Backend **từ chối khởi động ở production** nếu chưa khai — kể cả khi giá trị
đúng là `0`, vẫn phải khai tường minh. Không khai nghĩa là một trong hai: thật
sự không có proxy, hoặc có mà quên; và hai trường hợp đó không phân biệt được
từ phía code.

#### Phải khai IP CÔNG CỘNG, không phải dải nội bộ

Nhầm lẫn phổ biến nhất là khai `192.168.1.0/24`. Server **không bao giờ** nhìn
thấy địa chỉ đó — nó là địa chỉ máy nhân viên trong mạng LAN, đã bị NAT che đi
trước khi gói tin ra internet.

Thứ cần khai là dải IP công cộng mà nhà mạng cấp cho văn phòng. Kiểm tra bằng
cách truy cập một trang xem IP từ máy trong văn phòng.

#### Hai chốt bổ trợ nhau, không thay thế nhau

| | Chốt IP (`AF-02b`) | Chốt BSSID (`AF-02`) |
|---|---|---|
| Ai cung cấp dữ liệu | **Server tự quan sát** | App tự khai |
| Sửa app có qua được không | Không | **Có** |
| Cắm VPN về văn phòng | **Qua được** | Không qua được |
| Chứng minh điều gì | Gói tin đi ra từ mạng văn phòng | Thiết bị trong tầm sóng văn phòng |

Người cắm VPN về văn phòng có IP nguồn hợp lệ dù đang ngồi ở nhà — chỉ chốt
BSSID bắt được. Ngược lại, app bị sửa khai BSSID giả thì chỉ chốt IP bắt được.
**Bật cả hai mới kín.**

### Geofence: tính ở chốt 10, chặn ở chốt 13

Chú ý sự tách rời này. Chốt 10 chỉ **tính** khoảng cách; việc **chặn** xảy ra
sau khi đã gọi AI Server
([attendance.service.ts:195-200](../BackEnd/src/modules/attendance/attendance.service.ts#L195-L200)).

| Chính sách công ty | Ngoài vùng thì |
|---|---|
| `ALLOW` | Cho qua, chỉ ghi khoảng cách |
| `PENDING_REVIEW` | Ghi nhận nhưng **chưa tính công** cho tới khi quản lý duyệt |
| `BLOCK` | Chặn, trả `ATT_OUT_OF_GEOFENCE` |

Lý do đặt sau: điểm rủi ro cần `matchScore` để chấm cho đầy đủ, mà `matchScore`
chỉ có sau khi gọi AI. Kết quả là **một request chắc chắn bị chặn vì ngoài vùng
vẫn tốn một lượt suy luận GPU**.

> 📌 **Điểm có thể tối ưu.** Trường hợp `insideGeofence === false` và chính sách
> là `BLOCK` thì kết quả đã định đoạt bất kể AI trả về gì — có thể chặn ngay ở
> chốt 10 để tiết kiệm một lượt suy luận. Đánh đổi: mất `matchScore` trong hồ sơ
> gian lận của lượt bị chặn đó. Chưa làm vì chưa rõ bên nào quan trọng hơn; ghi
> lại đây để cân nhắc khi đo tải thật.

---

## 6. Chặng ⑤ — Backend gọi AI Server

Trước khi gọi, Backend lấy embedding đã đăng ký của **chính nhân viên này**
([attendance.service.ts:369-387](../BackEnd/src/modules/attendance/attendance.service.ts#L369-L387)):

```sql
SELECT embedding_raw FROM face_profile
WHERE company_id = ? AND employee_id = ? AND status = 'ACTIVE'
```

Được 4 vector — thẳng, trái, phải, thẳng + chớp mắt — mỗi vector 512 số.

```jsonc
POST http://ai-server:8000/v1/verify
X-Internal-Key: <khoá nội bộ>

{
  "image_base64": "/9j/4AAQSkZJRgABA...",
  "embeddings": [[0.0123, -0.0456, ...], [...], [...], [...]],
  "require_liveness": true,
  "liveness_action": "BLINK"
}
```

### Đây là bài toán 1:1, không phải 1:N

Người dùng **đã đăng nhập**, Backend biết chắc đây là ai. Câu hỏi gửi sang AI
Server là *"có phải đúng người này không?"* — không phải *"đây là ai trong 500
nhân viên?"*.

Khác biệt này quan trọng: bài 1:N khó hơn nhiều vì với N người, xác suất có ít
nhất một người lạ vượt ngưỡng tăng gần như tuyến tính theo N. Ngưỡng của 1:1 đem
sang 1:N sẽ cho kết quả sai hàng loạt. Bài 1:N chỉ dùng cho kiosk và cho việc
kiểm tra trùng danh tính lúc đăng ký (`BR-10`).

### Backend không gửi ngưỡng sang

AI Server **không biết** con số `0.45` tồn tại trên đời. Xem
[mục 8](#8-chặng--backend-tự-so-ngưỡng).

---

## 7. Chặng ⑥ — Pipeline của AI Server

[AiServer/app/core/engine.py](../AiServer/app/core/engine.py), theo đúng pipeline
`docs/02` mục 6.3:

```
Ảnh JPEG 412 KB
  │
  ├─1─ Giải mã, thu nhỏ nếu cạnh dài > 1920px        [imageio.py]
  │      Chặn kích thước TRƯỚC khi giải mã base64
  │
  ├─2─ TÌM KHUÔN MẶT (SCRFD/RetinaFace)              [insightface]
  │      0 mặt   → FACE_NOT_FOUND
  │      >1 mặt  → MULTIPLE_FACES   ← từ chối, KHÔNG đoán mặt to nhất
  │      1 mặt   → bbox + 68 điểm mốc + tư thế (pitch/yaw/roll)
  │
  ├─3─ ĐO CHẤT LƯỢNG trên VÙNG MẶT                   [quality.py]
  │      nhoè 142.3 · sáng 128 · mặt 218px · yaw −4.2°
  │      → chặn nếu dưới SÀN KỸ THUẬT
  │
  ├─4─ CĂN CHỈNH về 112×112 theo 5 điểm mốc          [insightface]
  │      ← bước khó nhất, lý do chính khiến phần này viết bằng Python
  │
  ├─5─ CHỐNG GIẢ MẠO (MiniFASNet)                    [liveness.py]
  │      cắt rộng gấp 2.7 lần khung mặt
  │      → score = 0.88
  │      + xác minh hành động BLINK từ điểm mốc mắt
  │      → action_verified = true
  │
  ├─6─ TRÍCH EMBEDDING (ArcFace) → 512 số, đã L2-normalize
  │
  └─7─ SO KHỚP với 4 embedding nhận được             [matcher.py]
         [0.7213, 0.6891, 0.6544, 0.7012] → lấy CAO NHẤT = 0.7213
```

### Ba chi tiết dễ làm sai

**Bước 2 — nhiều mặt thì từ chối, không đoán.** Với chấm công không có cách nào
biết chắc mặt nào là người đang chấm. Đoán mặt to nhất và đoán sai nghĩa là chấm
công cho nhầm người.

**Bước 3 — đo trên vùng mặt, không phải toàn ảnh.** Người đứng trước cửa sổ sáng
chói có độ sáng trung bình toàn ảnh rất đẹp trong khi mặt tối đen. `quality.py`
còn so tương quan nền với mặt để bắt ngược sáng.

**Bước 7 — lấy điểm cao nhất, không lấy trung bình.** Người dùng đăng ký 4 góc
nhưng mỗi lần chấm công chỉ chụp được **một** góc. Lấy trung bình sẽ luôn bị 3
góc không khớp kéo xuống, khiến đúng người cũng bị từ chối.

### Sàn kỹ thuật ≠ ngưỡng nghiệp vụ

| | Ai giữ | Ví dụ | Đổi được không |
|---|---|---|---|
| **Sàn kỹ thuật** | AI Server (`config.py`) | tối < 35, nhoè < 25, mặt < 48px | Hiếm khi cần |
| **Ngưỡng nghiệp vụ** | Backend, theo từng công ty | `0.45`, `0.70`, `112px` | Bất cứ lúc nào |

Sàn kỹ thuật trả lời *"ảnh này có dùng được không"*. Ngưỡng nghiệp vụ trả lời
*"có cho chấm công không"*. Mặt 60px vượt sàn kỹ thuật nên AI Server trả số liệu
bình thường, rồi Backend từ chối vì chính sách công ty đòi tối thiểu 112px.

### AI Server trả về

```jsonc
{
  "face_found": true,
  "quality": { "blur": 142.3, "brightness": 128, "yaw": -4.2, "face_px": 218 },
  "liveness": { "score": 0.88, "action_verified": true },
  "match": { "best_score": 0.7213, "scores": [0.7213, 0.6891, 0.6544, 0.7012] },
  "model_version": "buffalo_l@2.1",
  "processing_ms": 176
}
```

**Không có trường nào mang nghĩa "đạt" hay "không đạt".** Chỉ có số liệu. Nếu
thấy `accepted: true` trong phản hồi thì ranh giới kiến trúc đã bị phá — có một
test canh giữ điều này
(`AiServer/tests/test_contract.py::test_khong_endpoint_nao_tra_ve_quyet_dinh_nghiep_vu`).

### `action_verified` có ba giá trị, không phải hai

| Giá trị | Nghĩa | Backend xử lý |
|---|---|---|
| `true` | Đo được, làm đúng hành động | Cho qua |
| `false` | Đo được, **không** làm đúng | Từ chối |
| `null` | **Không đo được** từ ảnh tĩnh | Coi như chưa xác minh |

Trả `true` cho thứ không đo được chính là tự tay mở lỗ hổng chấm công hộ ở đúng
chỗ đáng lẽ phải đóng nó lại.

---

## 8. Chặng ⑦ — Backend tự so ngưỡng

Đây là chỗ **ra quyết định thật sự**
([attendance.service.ts:393-428](../BackEnd/src/modules/attendance/attendance.service.ts#L393-L428)):

```ts
// Lấy ngưỡng CỦA CÔNG TY NÀY từ DB
const [matchThreshold, livenessThreshold, minFacePixels] = await Promise.all([
  this.policy.getNumber(companyId, PolicyKeys.FACE_MATCH_THRESHOLD),      // 0.45
  this.policy.getNumber(companyId, PolicyKeys.FACE_LIVENESS_THRESHOLD),   // 0.70
  this.policy.getNumber(companyId, PolicyKeys.FACE_MIN_PIXELS),           // 112
]);

if (result.quality.face_px < minFacePixels)       → FACE_TOO_SMALL
if (livenessScore < livenessThreshold)            → FACE_LIVENESS_FAILED
if (result.liveness?.action_verified === false)   → FACE_LIVENESS_FAILED
if (bestScore < matchThreshold)                   → FACE_NOT_MATCHED
```

Áp vào số liệu vừa nhận được:

```
mặt      218px  ≥ 112   ✓
liveness 0.88   ≥ 0.70  ✓
chớp mắt true           ✓
giống    0.7213 ≥ 0.45  ✓   →  QUA
```

Giá trị mặc định ở
[policy.constants.ts:131-133](../BackEnd/src/modules/policy/policy.constants.ts#L131-L133).
Công ty B có thể đặt `0.55` thay vì `0.45`:

```
Công ty A (ngưỡng 0.45):  0.7213 ≥ 0.45  →  CHO CHẤM CÔNG
Công ty B (ngưỡng 0.55):  0.5100 < 0.55  →  TỪ CHỐI
```

**Cùng một AI Server, cùng một model, hai kết quả khác nhau.** Đó chính là lợi
ích của việc để ngưỡng ở Backend: siết chặt sau một vụ gian lận là đổi một dòng
cấu hình, làm được trong ngày, không phải deploy lại model.

> ⚠ Ngưỡng mặc định `0.45` / `0.70` **chưa hiệu chỉnh**. `docs/02` mục 6.4 yêu
> cầu đo FAR/FRR trên dữ liệu thật của khách hàng trước khi go-live.

Sai ngưỡng thì `FACE_NOT_MATCHED` còn kèm theo việc **đếm số lần thất bại** —
vượt ngưỡng thì tạm khoá chấm công bằng mặt (`FR-APP-FACE-05`).

---

## 9. Chặng ⑧ — Chấm điểm gian lận, ghi sổ, trả về

### Chấm điểm

Sau khi qua sinh trắc học, Backend gom **tất cả tín hiệu** lại chấm một điểm rủi
ro duy nhất — GPS, thiết bị lạ, lệch giờ, ngoài vùng, tốc độ di chuyển bất khả
thi, và cả `matchScore` vừa nhận:

| Điểm | Quyết định | Nghĩa |
|---|---|---|
| 0 – 29 | `ACCEPTED` | Bình thường |
| 30 – 59 | `FLAGGED` | **Vẫn tính công**, gắn cờ cho HR xem |
| 60 – 79 | `PENDING_REVIEW` | Chưa tính công, chờ quản lý duyệt |
| 80+ | `REJECTED` | Chặn, trả `FRAUD_RISK_TOO_HIGH` |

Ngưỡng ở
[policy.constants.ts:160-162](../BackEnd/src/modules/policy/policy.constants.ts#L160-L162),
đổi được theo từng công ty. Cả bốn mức đều **ghi cờ lại** — kể cả trường hợp
`REJECTED` không tạo bản ghi chấm công, cờ vẫn được lưu để lại dấu vết.

### Ghi sổ

Ảnh lên S3 (mã hoá at-rest, có lifecycle tự xoá), rồi **một dòng** vào
`attendance_log` — bản ghi **thô, bất biến, không bao giờ UPDATE/DELETE**
(`BR-06`, `ADR-08`). Có rule chặn ở tầng database, không chỉ ở tầng ứng dụng.

Dòng đó lưu đầy đủ dấu vết AI:

```
matchScore        0.7213
livenessScore     0.88
livenessChallenge BLINK
imageQuality      {"blur":142.3,"brightness":128,"yaw":-4.2,"face_px":218}
aiModelVersion    buffalo_l@2.1
aiProcessingMs    176
photoHash         <sha256 của ảnh>
```

Sáu tháng sau có tranh chấp vẫn tra được **lúc đó AI chấm bao nhiêu điểm, bằng
model version nào, ảnh có bị thay không**. Không có những trường này thì mọi
khiếu nại đều thành lời khai đối lời khai.

Mọi hiệu chỉnh về sau tạo bản ghi `AttendanceAdjustment` riêng; engine tính công
đọc và áp lên kết quả mà **không đụng** bản ghi gốc.

### Trả về App

```jsonc
{
  "attendanceId": "att_01J...",
  "type": "CHECK_IN",
  "recordedAt": "2026-08-05T01:02:19.431Z",   // ← GIỜ SERVER
  "workDate": "2026-08-05",
  "decision": "ACCEPTED",
  "shift": { "name": "Hành chính", "startTime": "08:00", "endTime": "17:30" },
  "lateMinutes": 2,
  "distanceToBranchM": 45.2,
  "insideGeofence": true,
  "photoUrl": "https://s3.../presigned?...",   // hết hạn sau 5 phút
  "fraudScore": 0,
  "flags": []
}
```

App hiển thị **giờ trong `recordedAt`**, không hiển thị giờ máy. Nếu hai giờ
lệch nhau, giờ server là giờ đúng.

Song song đó Backend còn đẩy sự kiện `attendance.recorded` qua WebSocket cho Web
Quản lý (dashboard cập nhật realtime) và đưa việc tính lại bảng công vào hàng
đợi — chạy nền, idempotent (`NFR-REL-06`).

---

## 10. Câu hỏi thường gặp

### Sao phải ba lượt gọi mạng? Gộp lại một lượt được không?

Không. `livenessAction` phải do server chọn **trước khi** App chụp ảnh. Gộp lại
thành một lượt đồng nghĩa App tự chọn hành động — và toàn bộ cơ chế chống video
quay sẵn sụp đổ (xem [mục 2](#2-chặng--app-xin-đề-bài)).

Nonce cũng vậy: phải phát trước mới chống được replay.

### AI Server chết thì sao?

`AiGatewayService` có **circuit breaker**
([ai-gateway.service.ts](../BackEnd/src/modules/ai-gateway/ai-gateway.service.ts)):

```
5 lỗi liên tiếp  →  mở mạch 30 giây
                    trả ngay SYS_AI_UNAVAILABLE
                    KHÔNG để request treo chờ timeout
30 giây sau      →  thử một request thăm dò
     thành công  →  đóng mạch lại
```

Trả lỗi ngay quan trọng hơn nghe có vẻ: nếu để 200 request cùng treo chờ timeout
2 giây, connection pool cạn và **cả những chức năng không liên quan tới AI cũng
chết theo** — duyệt đơn, xem bảng công, đăng nhập.

App nhận `SYS_AI_UNAVAILABLE` thì gợi ý nhân viên **chuyển sang chấm bằng vân
tay**. Mã lỗi này có sẵn `hint` trong error catalog: *"Nếu đã đăng ký vân tay,
bạn có thể chấm công bằng vân tay."*

### Ảnh đi qua những đâu? Có bị ghi log không?

Ảnh đi **hai chặng**: App → Backend (multipart binary), Backend → AI Server
(base64, phình khoảng 33%).

Ảnh **không được ghi log ở bất kỳ đâu** (`NFR-OBS-08`). AI Server có bộ lọc
`SensitivePayloadFilter` chặn chuỗi base64 dài và dãy số dạng embedding trước
khi ghi ra stdout — đây là **lưới an toàn cuối cùng**, không phải giấy phép để
viết log ẩu.

Ảnh lưu trên S3 được mã hoá at-rest và chỉ truy cập qua presigned URL hết hạn
sau 5 phút (`NFR-SEC-12`).

### Toàn bộ mất bao lâu?

> ⚠ Bảng dưới là **ước lượng kỹ thuật, chưa đo trên hệ thống thật**. Dùng để
> hình dung tỷ lệ giữa các chặng, không dùng làm cam kết SLA.

| Chặng | Thời gian |
|---|---|
| ① `GET /challenge` | 20–50 ms |
| ② App chụp + nén | 200–800 ms *(chờ người dùng chớp mắt)* |
| ③ Upload ảnh 412 KB | 300 ms (4G) – 2 s (3G) |
| ④ 10 chốt kiểm | 30–80 ms |
| ⑤⑥ AI Server | 20–50 ms (GPU) · 200–600 ms (CPU) |
| ⑦⑧ So ngưỡng, S3, ghi DB | 100–250 ms |

`NFR-PERF-01` yêu cầu **dưới 2 giây**. Chạy CPU vẫn kịp nhưng hết dư địa cho giờ
cao điểm 8h sáng.

---

## 11. Đối chiếu với luồng vân tay

Vân tay **không đụng tới AI Server chút nào**. Lý do ở
[docs/11](./11-cach-hoat-dong-cham-cong-mat-va-van-tay.md): Apple và Google không
cho phép bất kỳ app nào đọc dữ liệu vân tay — nó nằm trong Secure Enclave / TEE
mà kể cả hệ điều hành cũng không đọc được.

| | Khuôn mặt | Vân tay |
|---|---|---|
| App gửi lên | Ảnh JPEG | Chữ ký số của `nonce` |
| Server lưu gì | Embedding 512 chiều | **Chỉ public key** |
| Ai xác minh | AI Server đo, Backend quyết | Backend tự verify chữ ký |
| Gọi AI Server | Có | **Không** |
| Hoạt động khi AI Server chết | Không | **Có** |

Backend verify bằng `crypto.createVerify('SHA256')` với public key đã đăng ký
([attendance.service.ts:446-480](../BackEnd/src/modules/attendance/attendance.service.ts#L446-L480)).

Nguyên tắc `BR-02` vẫn giữ nguyên: server **không nhận** `{fingerprintVerified:
true}`. Nó nhận chữ ký và tự kiểm chứng. Ký được nghĩa là vân tay **đã** được
xác thực thật ở tầng OS, vì secure enclave chỉ cho dùng private key sau khi xác
thực sinh trắc học thành công.

Chín chốt kiểm còn lại (nonce, GPS, geofence, ca làm việc, kỳ lương, chấm điểm
gian lận, ghi sổ) **giống hệt** luồng khuôn mặt. Chỉ khác đúng chốt thứ 11.
