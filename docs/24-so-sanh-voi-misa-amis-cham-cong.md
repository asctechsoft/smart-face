# 24 — So sánh SmartFace với MISA AMIS Chấm công

> **Nguồn đối chiếu:** bộ 26 video hướng dẫn và giới thiệu MISA AMIS Chấm công
> (kênh *MISA AMIS HRM*, đăng 10/2023 – 05/2024), đã chép lời và trích khung hình
> vào `E:\WebApp\tool_doc_video\output\noi_dung_video_20260914_125215_a6d7.pdf`.
>
> **Hiện trạng SmartFace:** đọc từ mã nguồn tại commit `6e1346e` (14/09/2026), không
> dựa vào bộ tài liệu `01`–`23`. Tài liệu `01`–`23` mô tả chuẩn đích; tài liệu này
> mô tả cái **đang chạy thật**.
>
> Tài liệu gồm ba phần: [so sánh luồng nghiệp vụ](#3-so-sánh-luồng-nghiệp-vụ),
> [so sánh UI/UX](#4-so-sánh-uiux) và [hướng thay đổi](#5-hướng-thay-đổi).

---

## 0. Tóm tắt

1. **Hai sản phẩm đi hai hướng khác nhau.** AMIS là một mắt xích trong bộ nhân sự
   (Thông tin nhân sự → Chấm công → Tiền lương → BHXH → Thuế), mạnh ở quy trình
   HR hằng ngày: nhiều cách chấm công, phân ca, đơn từ, gửi nhân viên xác nhận
   công, chuyển tính lương. SmartFace đứng một mình, dừng ở *tính công* rồi xuất
   Excel, và lấy **chống gian lận + kiểm soát dữ liệu** làm điểm khác biệt.
2. **Khoảng trống lớn nhất của SmartFace không nằm ở tính năng mà ở kênh sử dụng:**
   App mobile (`app-smart`) mới là giao diện mẫu, chưa gọi API. Backend đã có API
   chấm công, gửi đơn, xem bảng công — nhưng nhân viên chưa có ứng dụng để dùng.
3. **Có hai lỗi nghiệp vụ âm thầm** cần sửa trước mọi tính năng mới: phép năm luôn
   được cấp 0 ngày, và giới hạn làm thêm 40 giờ/tháng – 200 giờ/năm đã khai cấu hình
   nhưng không nơi nào đọc.
4. **Về UI/UX:** AMIS thiên về *làm việc với dữ liệu* (bảng dày, thanh công cụ đồng
   nhất, tuỳ chỉnh cột, xuất file ở mọi nơi). SmartFace thiên về *dẫn dắt* (giải
   thích ngữ cảnh, cảnh báo trước khi chốt, đi thẳng tới việc cần xử lý). SmartFace
   dễ cho người mới hơn nhưng chậm hơn cho HR dùng hằng ngày.
5. **Không nên sao chép AMIS nguyên xi.** Một số thứ AMIS làm (QR tĩnh, GPS "không
   cố định", HR sửa đè giờ vào–ra) đi ngược nguyên tắc chống gian lận và bất biến dữ
   liệu của SmartFace — cần làm theo cách riêng (xem [§5.1](#51-nguyên-tắc-khi-học-từ-amis)).

---

## 1. Nguồn và giới hạn của phép so sánh

| Phía | Nguồn | Giới hạn |
|---|---|---|
| **AMIS** | Lời thoại do AI chép từ âm thanh video + khoảng 180 khung hình (phần lớn 640×360) | Là video **quảng cáo và hướng dẫn**, không phải đặc tả. Lời chép sai chính tả nhiều. Video 6, 24, 26 không chép được lời, chỉ có ảnh. Giao diện có thể đã đổi sau 2024. **"Video không nhắc" không có nghĩa là AMIS không có.** |
| **SmartFace — nghiệp vụ** | Đọc mã nguồn `server-backend-smart`, `web-smart`, `server-ai-smart`, `app-smart` | Mô tả cái mã làm được, chưa kiểm bằng chạy thử end-to-end |
| **SmartFace — UI** | Ảnh chụp thật ngày 09–10/09/2026 (Bảng công, Chi tiết công, Danh sách bảng, Danh mục ca, Form ca, Chốt bảng, Đăng nhập, Đổi mật khẩu). Các màn còn lại mô tả theo mã | Chưa chụp lại được bản mới nhất: máy phát triển hiện thiếu `node.exe`, và `server-backend-smart/.env` đang trỏ tới DB từ xa nên không bật backend để tránh job định kỳ ghi vào DB đó. `web-smart/src` không đổi sau commit 11/09 nên ảnh vẫn sát hiện trạng. |

---

## 2. Định vị sản phẩm

| Tiêu chí | AMIS Chấm công | SmartFace |
|---|---|---|
| Vị trí | Một ứng dụng trong bộ AMIS HRM | Sản phẩm độc lập, SaaS đa công ty |
| Dữ liệu nhân viên | **Đồng bộ từ AMIS HRM** — trong ứng dụng chấm công không thêm mới được nhân viên | Kế toán tạo hồ sơ, cấp tài khoản, nhập hàng loạt |
| Đầu ra | Chuyển bảng tổng hợp sang AMIS Tiền lương | Xuất Excel/CSV |
| Điểm bán chính | Đủ hình thức chấm công, quy trình HR khép kín, 17.000+ doanh nghiệp | Nhận diện khuôn mặt có liveness, chấm điểm gian lận, dữ liệu bất biến, kỳ công hai chữ ký |
| Kênh | Web + app mobile nhân viên (MISA AMIS) + app máy tính bảng + công cụ desktop kết nối máy chấm công | Web quản lý (đang chạy) + app mobile (chưa nối API) + AI server |

---

## 3. So sánh luồng nghiệp vụ

### 3.1. Luồng tổng thể

**AMIS** — theo sơ đồ "Quy trình nghiệp vụ" ngay trên màn Tổng quan:

```
Khai báo danh mục ca
   ↓
Phân ca làm việc ── Phân ca chi tiết (theo quy tắc lặp)
   │             └─ Bảng phân ca tổng hợp (sửa tay, sao chép, nhập khẩu)
   ↓
Lập bảng chấm công chi tiết (theo ngày / theo ca / theo giờ)
   ↑                    ↑
Ghi nhận thời gian      Tiếp nhận đơn xin nghỉ, làm thêm, ...
chấm công               (HR bấm "Cập nhật" để đưa vào bảng)
   ↓
Tổng hợp công (chọn nhiều bảng chi tiết cùng hình thức)
   ↓
Xác nhận công (gửi nhân viên, có hạn phản hồi)
   ↓
Chuyển tính lương (sang AMIS Tiền lương)
```

**SmartFace** — theo mã đang chạy:

```
Kế toán cấp tài khoản (email + mật khẩu tạm)
   ↓
Nhân viên đổi mật khẩu bắt buộc → đăng ký khuôn mặt / vân tay thiết bị
   ↓
Chấm công: ảnh khuôn mặt + liveness + GPS + BSSID + IP + thiết bị
   → chấm điểm gian lận → ALLOW / FLAG / PENDING_REVIEW / REJECT
   ↓
Engine tính công ngày (AttendanceDaily) — chạy lại 02:00 mỗi đêm và khi có thay đổi
   ↑
Đơn từ qua luồng duyệt (snapshot tại lúc gửi) → duyệt xong tự tính lại công
   ↓
Bảng chấm công tháng (thành viên + lịch lấy từ bảng phân ca) → đối soát → chốt bảng
   ↓
Kỳ công: Kế toán gửi đề nghị chốt → Giám đốc duyệt khoá (không ai làm cả hai bước)
   ↓
Xuất Excel
```

**Khác biệt về luồng:**

| # | Điểm | AMIS | SmartFace | Nhận xét |
|---|---|---|---|---|
| L1 | Đưa đơn đã duyệt vào bảng công | HR phải **bấm "Cập nhật"** bảng chấm công | **Tự động** tính lại khoảng ngày liên quan | SmartFace tốt hơn |
| L2 | Cập nhật dữ liệu chấm công mới | HR bấm cập nhật hằng ngày | Tính lại mỗi đêm + nút "Cập nhật bảng công" | SmartFace tốt hơn |
| L3 | Bước xác nhận với nhân viên | Có: gửi xác nhận → nhân viên xác nhận/phản hồi → trạng thái về cho HR | **Không có** | SmartFace thiếu |
| L4 | Bước khoá | Khoá bảng chi tiết (một người) | Chốt bảng + kỳ công hai chữ ký, có phiên bản và luồng mở lại | SmartFace chặt hơn |
| L5 | Sửa công | HR **sửa trực tiếp** giờ vào–ra trong ô | Tạo **bản ghi điều chỉnh riêng** (thêm / sửa giờ / huỷ), bản ghi gốc giữ nguyên | SmartFace đúng nguyên tắc kiểm toán hơn, nhưng cần thao tác nhanh ngang AMIS |
| L6 | Bảng tổng hợp | Tách riêng: một bảng tổng hợp gom nhiều bảng chi tiết cùng hình thức | Tổng hợp theo tháng là màn chính; bảng chấm công là đơn vị tổ chức | Mô hình SmartFace gọn hơn cho doanh nghiệp một hình thức công |
| L7 | Kết thúc | Chuyển sang phần mềm lương | Xuất Excel | Phụ thuộc chiến lược tích hợp |

### 3.2. Khởi tạo và dữ liệu nhân viên

| Tính năng | AMIS | SmartFace |
|---|---|---|
| Nguồn nhân viên | Đồng bộ tự động từ AMIS HRM (vào mới, nghỉ việc) | Kế toán nhập tay hoặc nhập file |
| Nhập hàng loạt | Nhập khẩu Excel cho mã chấm công, số ngày phép | Nhập **CSV** (nút ghi "Import Excel") — kiểm từng dòng, sinh mã, báo lỗi theo dòng |
| Mã chấm công riêng để khớp máy chấm công | Có | Không cần (không có máy chấm công) |
| Danh sách nhân viên **không cần chấm công** (ban lãnh đạo) | Có thiết lập riêng | Không có thiết lập tương ứng |
| Kích hoạt tài khoản | Qua hệ sinh thái MISA | Mật khẩu tạm → đổi bắt buộc → đăng ký sinh trắc học (chặn ở server) |

### 3.3. Hình thức chấm công

| Hình thức | AMIS | SmartFace | Ghi chú |
|---|---|---|---|
| Máy chấm công vân tay/thẻ | Công cụ desktop kết nối qua TCP/IP (loại máy, IP, cổng, mã kết nối, đơn vị, địa điểm), lấy dữ liệu theo khoảng ngày | **Không có** | Ngoài phạm vi MVP theo tài liệu `01` |
| Khuôn mặt trên **máy tính bảng** đặt tại quầy | App riêng trên CH Play/App Store, lấy mẫu 4 góc | **Một phần** — AI server có nhận diện 1:N (`/identify`), chưa có endpoint kiosk và giao diện | |
| Khuôn mặt trên **điện thoại** | Lấy mẫu 4 góc (thẳng, nghiêng trái/phải ≤ 25°, ngước lên), cho chấm thử | Có ở backend + AI: so khớp 1:1, liveness MiniFASNet, **yêu cầu hành động ngẫu nhiên** (chớp mắt, quay đầu, gật, cười) | SmartFace mạnh hơn về chống giả mạo; nhưng **chưa có app** |
| Vân tay/Face ID của thiết bị | Không nhắc | Có: khoá công khai + chữ ký thử thách | |
| WiFi (BSSID) | Có, kèm công cụ tra BSSID; gán WiFi theo đơn vị | Có: so BSSID của chi nhánh, chính sách chặn/cảnh báo/tắt | Tương đương; SmartFace thiếu công cụ tra BSSID |
| Dải IP văn phòng | Không nhắc | Có (CIDR, dùng IP server nhìn thấy) | SmartFace hơn |
| QR code | **QR tĩnh** (in giấy) và **QR động** đổi mỗi 3–5 giây | **Không có** | |
| GPS địa điểm cố định | Bán kính cho phép, khuyến nghị 300–500 m | Có, bán kính mặc định 100 m, kiểm độ chính xác GPS và cờ vị trí giả | |
| GPS địa điểm **không cố định** | Chỉ ghi lại vị trí + lịch sử để quản lý kiểm tra (sale, giao hàng, lái xe) | **Không có** — luôn so với chi nhánh gần nhất | |
| Xác thực thêm theo thứ tự | WiFi/GPS → khuôn mặt → đính kèm tài liệu → quản lý xác nhận; bật theo đơn vị/nhân viên | Mọi lớp chạy cùng lúc theo chính sách công ty; không có "đính kèm tài liệu" hay "quản lý xác nhận lượt chấm" | Mô hình AMIS linh hoạt theo đối tượng hơn |
| Chấm offline | Không nhắc | Có API đồng bộ offline, mặc định tắt, lượt đồng bộ vào hàng chờ duyệt | |

### 3.4. Khai báo ca làm việc

| Thuộc tính ca | AMIS | SmartFace |
|---|---|---|
| Mã ca không trùng, tên ca | Có | Có (+ ký hiệu chấm công) |
| Giờ bắt đầu / kết thúc / nghỉ giữa ca | Có | Có |
| **Khung giờ được chấm vào / ra** | Có — **chấm ngoài khung thì không ghi nhận** | Có trường, có kiểm tra ở form, nhưng **lúc chấm công không áp dụng** |
| Cho phép đi muộn / về sớm (phút) | Có | Có |
| Giờ công → ngày công (8h = 1 công, 4h = 0,5 công) | Có | Có (`workDayCredit`, phút chuẩn/ngày) |
| Hệ số ngày thường / nghỉ / lễ | Có | Có — engine đã dùng |
| Hệ số riêng từng ngày lễ, cố định giữa các năm | Có | Có hệ số theo từng ngày lễ; không có "cố định giữa các năm" |
| Quy định trừ công khi thiếu giờ vào/ra | Có | Không có quy tắc riêng (thiếu lượt → trạng thái thiếu check-in/out) |
| Phạt đi muộn về sớm theo bậc | Có bảng bậc phạt trong ca | Có quy tắc phạt ở cấp chính sách công ty |
| Làm thêm gắn với ca (trước ca / sau ca) | Có | OT chỉ tính sau giờ kết thúc ca |
| **Công ăn ca** (phụ cấp theo ca) | Có | Không có |
| **Công điều động** (làm ở địa điểm khác) | Có | Không có |
| Ca qua đêm | Có (ví dụ khung 21:30 – 06:00) | Có, quy về ngày bắt đầu ca |
| Ca linh hoạt (chỉ tính tổng giờ) | Không nhắc | Có |
| Ca chia nhiều đoạn | Không nhắc | Lưu được, engine chưa dùng |
| **Nhập khẩu ca từ Excel** (ghép cột, kiểm hợp lệ) | Có | Không có |
| Nhân bản ca | Không nhắc | Có |

### 3.5. Phân ca

| Tính năng | AMIS | SmartFace |
|---|---|---|
| Phân ca theo **quy tắc lặp** (tuần/tháng/ngày, chu kỳ N) | Có. Ví dụ "thứ 7 cách tuần" = 2 bảng: T2–T6 lặp mỗi tuần + T7 lặp 2 tuần | Chỉ chọn các thứ trong tuần khi phân hàng loạt; **không có chu kỳ lặp** |
| Đối tượng: danh sách nhân viên **hoặc** cơ cấu tổ chức | Có | Phòng ban (khi lập bảng) + chọn người |
| Xem trước lịch trước khi áp dụng | Có, lịch tháng bên phải form | Không có |
| Bảng phân ca tổng hợp — góc xem | Theo **nhân viên / đơn vị / ca làm việc**, lọc đã phân / chưa phân | Lưới người × ngày của một bảng phân ca |
| Sửa nhanh một ô | Có | Có (popover bật/tắt ca) |
| **Sao chép ca** sang người/đơn vị khác | Có | Không có |
| **Nhập khẩu phân ca** từ Excel | Có | Không có |
| **Xoá phân ca hàng loạt** | Có | Có (trong khoảng ngày của drawer phân ca hàng loạt) |
| Nghỉ bù lễ / làm bù (xoá ca ngày nghỉ, thêm ca ngày làm bù) | Làm thủ công bằng xoá/phân ca | Ngày lễ có "ngày nghỉ bù"; có theo dõi nợ công làm bù |
| Nhiều ca trong một ngày | Có | Cho phân, nhưng engine chỉ tính **ca sớm nhất** ([policy.repository.ts:286](../server-backend-smart/src/modules/policy/policy.repository.ts#L286)) |
| Người chưa được xếp ca | Không nhắc | Tính theo ca mặc định của công ty |
| Phân ca theo **địa điểm làm việc** | Có | Không có |

### 3.6. Ghi nhận và tính công

| Tính năng | AMIS | SmartFace |
|---|---|---|
| Hình thức bảng công | **Theo ngày**, **theo ca** (tổng công tách theo từng ca), **theo giờ** | **Chỉ theo ngày** |
| Trạng thái ô | Đủ công (xanh) / nửa công (vàng) / nghỉ (xám) | 11 trạng thái: đúng giờ, muộn, về sớm, OT, thiếu giờ, nghỉ đơn, lễ, vắng, thiếu lượt, cuối tuần… |
| Quy tắc giờ vào/ra | Vào = lượt sớm nhất trong khung; ra = lượt muộn nhất trong khung | Ghép cặp lượt trong ngày |
| Ngày lễ không chấm | Tự hiểu là đủ công | Trạng thái ngày lễ |
| Thêm / bớt nhân viên khỏi bảng | Có (chỉ người thuộc cơ cấu của bảng) | Có |
| Sửa giờ vào/ra | Sửa trực tiếp trong ô | Bản ghi điều chỉnh có lý do, lượt gốc không đổi |
| **Nhập khẩu dữ liệu chấm công** từ Excel/máy chấm công | Có | Không có |
| Khoá bảng | Có — chặn cập nhật từ phân ca và đơn lập bù sau | Chốt bảng + khoá kỳ; chấm công vào kỳ đã khoá bị từ chối |
| Xuất bảng | Excel **và PDF** | Excel/CSV |
| Xoá bảng | Chỉ khi chưa dùng để tổng hợp | Có |
| Nhật ký hoạt động trên bảng | Có | Có nhật ký toàn công ty + lịch sử điều chỉnh từng người |
| Ngày nghỉ tuần | Cấu hình được | **Cố định thứ 7, chủ nhật** |

### 3.7. Đơn từ và luồng duyệt

| Tính năng | AMIS | SmartFace |
|---|---|---|
| Loại đơn | Xin nghỉ · Đăng ký đi muộn về sớm · Đăng ký làm thêm · Đề nghị công tác · Đề nghị cập nhật công · **Đề nghị đổi ca** | Cấu hình được; seed 9 loại: phép năm, ra ngoài, về sớm, làm bù, nghỉ không lương, công tác, nghỉ ốm, bổ sung công, đăng ký OT. **Không có đổi ca, không có đăng ký đi muộn** |
| Đổi ca giữa hai người | Một người lập, duyệt xong **tự hoán đổi** trên bảng phân ca | Không có |
| Đơn cho nhóm (làm thêm, công tác) | Có | Mỗi đơn một người |
| Đi muộn/về sớm theo chế độ nuôi con < 12 tháng (60 phút/ngày) | Nhắc rõ | Không có loại đơn/chế độ riêng |
| HR lập hộ | Từng đơn · **nhập khẩu** · **hàng loạt** (một loại đơn cho nhiều người) | Từng đơn ("Tạo đơn hộ"), có xem trước luồng duyệt |
| Tuỳ chỉnh trường của đơn (ẩn, thứ tự, bắt buộc) | Có | Không có |
| Thông tin phép hiện ngay khi chọn người | Số ngày phép được dùng / đã nghỉ / còn lại, tỷ lệ hưởng lương | Không hiện số dư trong form tạo đơn hộ |
| Người duyệt / người thay thế / người liên quan | Có cả ba | Người duyệt theo vai trò + người duyệt dự phòng + uỷ quyền có thời hạn |
| Quy trình nhiều cấp có điều kiện | Điều kiện theo đơn vị, số ngày nghỉ, loại nghỉ, tỷ lệ hưởng lương; xem sơ đồ | Điều kiện theo số ngày (min/max); snapshot luồng khi gửi |
| Hành động của người duyệt | Duyệt / từ chối | Duyệt / từ chối / **yêu cầu bổ sung thông tin**; duyệt hàng loạt |
| Theo dõi bước duyệt | Web và mobile | Web; mobile có API, chưa có app |
| **Phép năm** | Tính phép thử việc, ứng phép, tăng theo thâm niên, chuyển phép tồn | Có bảng chính sách, nhưng **không bao giờ cấp phép** — số dư tạo với `entitledDays: 0` ([request.repository.ts:523](../server-backend-smart/src/modules/request/request.repository.ts#L523), [:538](../server-backend-smart/src/modules/request/request.repository.ts#L538)) |
| **Nghỉ bù từ giờ làm thêm** | Có quỹ giờ nghỉ bù (bảng tổng hợp nghỉ bù) | Không có; chỉ có nợ công phải làm bù |

### 3.8. Làm thêm giờ

| Tính năng | AMIS | SmartFace |
|---|---|---|
| Bộ phận làm thêm không cần lập đơn (tính theo giờ chấm thực tế) | Có | Mặc định cần đơn OT đã duyệt |
| Số phút làm thêm tối thiểu | Có | Không có |
| Thời gian làm thêm hưởng lương tối đa | Có | Trần theo ngày (240 phút) |
| Thời điểm bắt đầu tính làm thêm | Có | Ngay sau giờ kết thúc ca |
| **Khung giờ làm thêm** (trước 22h / sau 22h, hệ số riêng) | Có | Không có |
| Hệ số ngày thường / nghỉ / lễ | Có | Có (1,5 / 2,0 / 3,0) |
| **Cảnh báo 40 giờ/tháng – 200 giờ/năm** | Nhắc HR khi đăng nhập (tự động hoặc chủ động), nhãn cam = chạm ngưỡng, đỏ = vượt; nhắc nhân viên và quản lý khi lập/duyệt đơn | Đã có khoá cấu hình `payroll.ot.maxMinutesPerMonth` và `…PerYear` ([policy.constants.ts:288](../server-backend-smart/src/modules/policy/policy.constants.ts#L288)) nhưng **không nơi nào đọc**; không có cảnh báo |

### 3.9. Tổng hợp công, xác nhận, chuyển lương

| Tính năng | AMIS | SmartFace |
|---|---|---|
| Công chuẩn | **Cố định** (24/26 công) hoặc biến thiên theo tháng | Chỉ biến thiên: bằng số ngày có ca |
| Công thức công hưởng lương | Cố định: công chuẩn − nghỉ không lương. Biến thiên: công ngày thường + ngày nghỉ + ngày lễ + công tác + nghỉ có lương | Tổng công ngày; `unpaidLeaveDays` đang gán cứng 0 ([payroll.service.ts:777](../server-backend-smart/src/modules/payroll/payroll.service.ts#L777)) |
| Tổng hợp theo đơn vị **và vị trí công việc** | Có | Theo phòng ban/chi nhánh |
| Bảng tổng hợp theo ca (ca sáng 10 công, ca chiều 12 công) | Có | Không có |
| Cập nhật lại một phần nhân viên | Có | Tính lại theo bảng / kỳ / khoảng ngày |
| **Gửi xác nhận công** (hạn phản hồi, trạng thái chưa gửi → đang xác nhận → đã xác nhận) | Có | **Không có** |
| Chuyển tính lương | Sang AMIS Tiền lương | Xuất file tổng hợp có phiên bản |
| Tiền lương, BHXH, thuế TNCN | Có trong bộ sản phẩm | Ngoài phạm vi |

### 3.10. Phân quyền

| Tính năng | AMIS | SmartFace |
|---|---|---|
| Quản lý người dùng | Danh sách người dùng: vai trò, phạm vi dữ liệu, trạng thái tài khoản | Gán vai trò có sẵn cho nhân viên |
| Vai trò mặc định | Quản trị ứng dụng, Nhân sự | 6 vai trò: Owner, Admin công ty, Kế toán/HR, Quản lý, Nhân viên, Admin nền tảng |
| **Tạo vai trò mới** | Có — ví dụ "HR chỉ quản lý đơn" | **Không có API tạo/sửa vai trò** (`access.controller.ts` chỉ có `me`, `catalog`, `roles`, `catalog/sync`) |
| Ma trận quyền | Theo chức năng × hành động (Xem, Thêm, Sửa, Xoá, Cập nhật, Xuất khẩu, Khoá/Mở khoá) | Khoảng 50 permission trong mã, xem được, không sửa được |
| Phạm vi dữ liệu | Theo đơn vị được cấp | Thực tế chỉ có Quản lý → danh sách phòng ban; TEAM/BRANCH có trong schema nhưng chưa cưỡng chế |
| Tách nhiệm vụ (một người không tự gửi và tự duyệt) | Không nhắc | Có ở chốt kỳ và duyệt đơn |

### 3.11. Nhiều chi nhánh và điều động

| Tính năng | AMIS | SmartFace |
|---|---|---|
| Chấm công theo địa điểm | Bật thiết lập "chấm công theo địa điểm" | Chi nhánh gần nhất theo GPS/WiFi/IP |
| Phân ca kèm địa điểm làm việc từng ngày | Có | Không có |
| Máy chấm công gắn địa điểm; chỉ ghi nhận nếu khớp nơi được phân ca | Có | Không áp dụng |
| Bảng công tách theo từng chi nhánh cho một người được điều động | Có | Không có — đổi chi nhánh là ghi đè hồ sơ |
| Lịch sử điều chuyển | Không nhắc | Có bảng `EmployeeAssignmentHistory` nhưng **không nơi nào ghi vào** |

### 3.12. Báo cáo và cảnh báo

| Tính năng | AMIS | SmartFace |
|---|---|---|
| Tổng quan | Muộn/sớm, thực tế đã nghỉ, kế hoạch nghỉ, tình hình nghỉ theo thời gian/phòng ban, phân tích loại nghỉ, danh sách và tần suất đi muộn | Tiến độ tổng hợp công, việc cần xử lý hôm nay, tình trạng kỳ công, người cần đối soát, lịch chốt lương, OT & phép |
| Đếm nhanh muộn/sớm, nghỉ, quên chấm **ngay trên bảng chấm công** | Có, bấm số liệu → danh sách → gửi email / xuất Excel | Thẻ đếm trên bảng chấm công + màn "Theo dõi công việc" |
| Theo dõi thời gian thực trong ngày | Không nhắc | **Có**: dòng thời gian theo giờ từng người, tự làm mới mỗi phút, nhắc chấm công qua thông báo đẩy |
| Báo cáo | Nhiều báo cáo chuyên cần, tổng hợp làm thêm có nhãn vượt ngưỡng | 4 báo cáo: chuyên cần, vi phạm, tăng ca, phép năm |
| Gửi email | Có | Không có kênh email |
| Hoạt động nghi vấn gian lận | Không nhắc | Cờ gian lận, hàng chờ duyệt, kiểm tra ngẫu nhiên ảnh chấm công ban đêm |

### 3.13. Trải nghiệm nhân viên trên mobile

| Tính năng | AMIS | SmartFace |
|---|---|---|
| Chấm công | Có (khuôn mặt, WiFi, GPS, QR) | **Chỉ có API** |
| Tổng quan công cá nhân: lần chấm gần nhất, tổng công, giờ làm thêm, số lần muộn, số ngày nghỉ | Có | Có API `/me/stats` |
| Bảng công dạng **lịch** và **danh sách**, tuỳ chọn hiện giờ vào/ra | Có | Có API `/attendance/history`; app là giao diện mẫu |
| Đề nghị cập nhật công ngay từ ngày bị sai | Có | Có API loại đơn bổ sung công |
| Lập và theo dõi đơn, xác nhận công | Có | Lập đơn có API; xác nhận công chưa có |
| Quản lý duyệt đơn trên mobile | Có | Có API; chưa có app |

`app-smart/pubspec.yaml` chỉ khai `cupertino_icons` — không có thư viện HTTP, camera, GPS, WiFi hay sinh trắc học. Chín màn hình dùng dữ liệu cứng.

### 3.14. Những gì SmartFace có mà video AMIS không nhắc

- **Chống gian lận nhiều lớp:** liveness chủ động với hành động ngẫu nhiên do server chọn, model chống ảnh giả, chấm điểm từ 15 tín hiệu (vị trí giả, máy root, lệch giờ thiết bị, thiết bị lạ, di chuyển bất khả thi, nhiều thiết bị, điểm so khớp sát ngưỡng…), chữ ký HMAC + nonce chống gửi lại, kiểm tra IP văn phòng, kiểm tra ngẫu nhiên ảnh chấm công mỗi đêm.
- **Dữ liệu bất biến và truy vết:** lượt chấm gốc không sửa được; mọi điều chỉnh là bản ghi riêng có lý do; nhật ký lưu trước/sau; xác thực lại trước thao tác nhạy cảm.
- **Kỳ công chặt:** trạng thái mở → đang tính → chờ duyệt → khoá → mở lại; mỗi lần tính lại là một phiên bản; hai người hai bước.
- **Luồng duyệt:** snapshot khi gửi, uỷ quyền có hạn, yêu cầu bổ sung thông tin.
- **Vận hành SaaS:** tách dữ liệu theo công ty, gói dịch vụ, phiên hỗ trợ có mục đích và thời hạn, quản lý phiên bản model AI, tự xoá ảnh/sinh trắc học theo thời hạn lưu.
- **Theo dõi trong ngày theo giờ** và **so sánh "hệ thống đang ghi" với "đơn đề nghị"** khi duyệt đơn (xem [§4](#4-so-sánh-uiux)).

---

## 4. So sánh UI/UX

### 4.1. Nguyên tắc thiết kế

| | AMIS | SmartFace |
|---|---|---|
| Triết lý | **Công cụ dữ liệu cho HR chuyên nghiệp**: nhiều thông tin trên một màn, thao tác chuẩn hoá, ít chữ giải thích | **Dẫn dắt theo việc cần làm**: mỗi màn nói rõ ngữ cảnh, hậu quả và bước tiếp theo |
| Người dùng mục tiêu | HR dùng hằng ngày, đã quen phần mềm MISA | Kế toán/HR, quản lý, giám đốc — kể cả người mới |
| Rủi ro | Người mới khó biết bắt đầu từ đâu (AMIS bù bằng sơ đồ quy trình) | Người dùng lâu năm thấy chậm, nhiều chữ, thiếu phím tắt và tiện ích bảng |

### 4.2. Điều hướng và kiến trúc thông tin

| | AMIS | SmartFace |
|---|---|---|
| Menu chính | **Ngang** trên cùng, có menu con: Tổng quan · Chấm công ▾ (Bảng chấm công chi tiết, Bảng chấm công tổng hợp, Dữ liệu máy chấm công) · Ca làm việc ▾ · Quản lý đơn ▾ · Báo cáo ▾ · Thiết lập | **Dọc** bên trái nền navy, 9 mục phẳng: Tổng quan · Nhân sự · Chấm công · Ca làm & Phân ca · Bảng công · Yêu cầu · Tiền lương · Báo cáo · Thiết lập |
| Thiết lập | Menu con bên trái: Nhân viên, Quy định chấm công, Quy định làm thêm, Quy định nghỉ, Tuỳ chỉnh, Người dùng, Vai trò, Hệ thống | Một trang 8 tab: Quy tắc tính công, Ngày nghỉ lễ, Phép năm, Chi nhánh & Geofence, Phòng ban, Loại đơn & luồng duyệt, Phân quyền, Nhật ký hoạt động |
| Thanh trên | Chuyển ứng dụng trong bộ AMIS, thông báo, trợ giúp, avatar | Tên trang + ngày, **tìm nhanh nhân viên toàn cục**, thông báo |
| Lối vào cho người mới | Tab **"Quy trình nghiệp vụ"** trên Tổng quan: sơ đồ các bước, bấm vào từng bước; hàng lối tắt tới các thiết lập | Wizard "Thiết lập ban đầu" — **biến mất** sau khi hoàn tất |
| Liên kết sâu | Không quan sát được | Nhiều màn lưu tab/bộ lọc/trang lên URL; tổng quan dẫn thẳng vào danh sách đã lọc |
| Tên gọi | "Quản lý đơn", "Bảng chấm công chi tiết/tổng hợp" | "Yêu cầu" trên menu nhưng tiêu đề trang là "Đơn từ"; "Chấm công" trên menu nhưng tiêu đề là "Theo dõi công việc"; "Tiền lương" trên menu nhưng tiêu đề là "Kỳ công" |

### 4.3. Ngôn ngữ hình ảnh

| | AMIS | SmartFace |
|---|---|---|
| Màu chủ đạo | Cam, nền trắng/xám rất nhạt | Xanh dương `#1D4ED8`, menu navy `#0B1B3A`, nút xác nhận xanh lá `#15803D`, nền `#F5F7FA` |
| Kiểu chữ | Nhỏ, đồng đều, tiêu đề trang cỡ vừa | Tiêu đề trang cỡ lớn màu xanh, có breadcrumb và đoạn mô tả |
| Mật độ | Cao: bảng dòng thấp, gần như toàn bộ màn là dữ liệu | Thấp hơn: nhiều thẻ KPI, banner, khoảng trắng |
| Trạng thái | Chấm tròn màu (xanh/vàng/xám), chữ đỏ khi muộn | Nhãn màu (badge), tô nền cả ô, biểu tượng |
| Khả năng tiếp cận | Không đánh giá được qua video | Tương phản đã kiểm WCAG AA bằng script; dialog/drawer giữ focus, đóng bằng Esc |
| Dark mode | Không quan sát được | Có token và script áp theo hệ điều hành, **không có nút bật/tắt** |
| Responsive | Không quan sát được | Dưới 768px menu thành drawer + hamburger; bảng rộng cuộn ngang |

### 4.4. Theo từng màn hình

#### Tổng quan

| AMIS | SmartFace |
|---|---|
| Lưới widget; mỗi widget tự chọn khoảng thời gian ("Tuần này", "Ngày mai"); nút **Tuỳ chỉnh** để chọn widget; chọn công ty | Bố cục cố định, bộ lọc Kỳ công / Văn phòng / Phòng ban (không lưu URL) |
| Biểu đồ đường, cột, donut; danh sách người đi muộn nhiều nhất; tần suất đi muộn theo nhóm lần | 5 thẻ KPI (2 thẻ bấm được), biểu đồ tiến độ tổng hợp, **"Cần xử lý hôm nay"** dẫn thẳng vào danh sách, donut tình trạng kỳ công, bảng người cần đối soát, **dòng thời gian chốt lương**, thanh OT & phép |
| Tab "Quy trình nghiệp vụ" | Không có |

**Nhận xét:** Tổng quan của SmartFace hướng hành động tốt hơn; AMIS linh hoạt hơn (tuỳ chỉnh widget) và có sơ đồ quy trình cho người mới.

#### Bảng chấm công dạng lưới (người × ngày)

| AMIS | SmartFace |
|---|---|
| Hàng thẻ đếm trên đầu: Đi làm · Nghỉ · Đi công tác · Đi muộn về sớm · Làm thêm · Chưa chấm công — **bấm vào mở danh sách**, có Gửi email / Xuất khẩu | Hàng thẻ đếm "Không chấm công · Thiếu công · Đủ công · Nghỉ không tính công · Ngày lễ · Cuối tuần", đồng thời là chú thích màu nền ô |
| Ô chứa: **mã ca + giờ vào–ra + chấm màu trạng thái**, giờ muộn tô đỏ, tên ngày lễ ("Quốc khánh"), "Làm thêm giờ: 1,0" | Ô chứa: chip mã ca ("HC"), màu nền theo trạng thái, chữ "ĐƠN"; **giờ vào–ra hầu như không hiện** |
| Chú thích đủ công / nửa công / nghỉ ở góc phải; nhãn "Chưa khoá"; nút Cập nhật | Banner cảnh báo "38 ngày có ca nhưng chưa có lượt chấm công nào"; cột "Tổng kỳ" |
| Thanh công cụ gọn: tìm, chọn đơn vị, xuất, tuỳ chỉnh | **6 nút trên một hàng**: Danh sách bảng · Tổng hợp công · Cập nhật bảng công · Xuất Excel · Thêm CBNV · Bỏ khỏi bảng · Chốt bảng |
| Bấm ô → panel bên phải xem/sửa công ngày | Bấm ô → drawer chi tiết lượt chấm và điều chỉnh |

**Nhận xét:** AMIS cho HR đọc được tình hình cả tháng mà không cần mở ô. SmartFace cảnh báo tốt hơn nhưng mỗi ô ít thông tin.

#### Tổng hợp công

| AMIS | SmartFace |
|---|---|
| Bảng rộng, **tiêu đề nhóm nhiều tầng** (Nghỉ không lương: có đơn / không đơn / tổng…, Làm thêm theo khung giờ và hệ số) | 5 thẻ KPI + banner "2 nhân viên cần đối soát trước khi chốt kỳ" + bảng 12 cột có nhãn trạng thái từng người |
| **Rê chuột vào tiêu đề cột thấy chú thích cách tính** | Không giải thích công thức tại cột |
| Nhãn trạng thái bảng "Chưa gửi xác nhận"; nút **Chuyển tính lương**, **Gửi xác nhận** | Nút Đối soát tự động · Xuất Excel · **Chốt bảng công** |
| Chọn cột hiển thị (bánh răng), lọc | Không tuỳ chỉnh cột |

Trang chi tiết một người của SmartFace (thẻ KPI, bảng theo ngày, chú thích, "Tổng hợp bất thường", tab Lịch sử điều chỉnh, nút "Gửi yêu cầu bổ sung") **không có tương đương rõ ràng trong video AMIS** — đây là điểm mạnh.

#### Chốt / khoá

| AMIS | SmartFace |
|---|---|
| Nút khoá bảng | Hộp thoại giải thích hậu quả, chọn bảng cần chốt, nhãn "2 cần đối soát" |
| — | Kỳ công: Kế toán "Gửi duyệt chốt" có lý do → Giám đốc "Duyệt chốt kỳ" **chạy ngay, không xác nhận** ([PeriodsPage.tsx:159-175](../web-smart/src/features/exec/PeriodsPage.tsx#L159-L175)) |

#### Khai báo ca

| AMIS | SmartFace |
|---|---|
| **Trang riêng** 2 cột: trái là thông tin chung + tính công; phải là "Tuỳ chỉnh nâng cao" dạng khối gập/mở có checkbox (đi muộn về sớm, làm thêm giờ, công ăn ca…) | **Drawer** bên phải: mã, tên, ký hiệu, giờ, khung chấm, nghỉ trưa, hệ số, áp dụng ngày lễ |
| Nhập khẩu ca (tải mẫu → ghép cột → kiểm hợp lệ → nhập) | Không có nhập khẩu |
| — | Tự tính "Giờ công: 8h30 (đã trừ 60 phút nghỉ)"; gợi ý dưới từng trường; nhân bản ca |

#### Phân ca

| AMIS | SmartFace |
|---|---|
| Form phân ca chi tiết **bên trái**, **lịch tháng xem trước bên phải** cập nhật theo lựa chọn | Drawer "Phân ca hàng loạt": phòng ban, ca, từ–đến ngày, chọn thứ, áp dụng toàn bảng hoặc từng người — **không xem trước** |
| Bảng phân ca tổng hợp: nút chuyển góc xem **Nhân viên / Đơn vị / Ca làm việc**, nút **Hôm nay**, lọc trạng thái phân ca, khoảng ngày có ◀▶, nút Phân ca, menu thêm (sao chép, nhập khẩu, xoá phân ca) | Danh sách bảng phân ca theo tháng → mở lưới một bảng; bấm ô mở popover bật/tắt ca; **không kéo thả, không sao chép/dán, không chọn nhiều ô** |

#### Đơn từ

| AMIS | SmartFace |
|---|---|
| Danh sách theo loại đơn, lọc trạng thái (Tất cả / Đã duyệt / Chờ duyệt / Từ chối) | Tab "Chờ tôi duyệt (N)" / "Tất cả đơn", lọc trạng thái, loại, phòng ban, khoảng ngày (lưu URL) |
| Thêm đơn: **modal 2 cột**, chọn người là tự điền đơn vị, tỷ lệ hưởng lương, số phép được dùng / đã nghỉ / còn lại | Tạo đơn hộ: modal có **xem trước luồng duyệt** và chọn người duyệt từng bước; bắt ghi "Vì sao bạn nhập hộ" |
| Lập đơn hàng loạt: **trang chọn nhân viên** có sẵn cột số phép | Không có |
| Chi tiết đơn: không quan sát rõ | **Trang chi tiết**: so sánh "Hệ thống đang ghi" (check-in/out, giờ công) với "Đơn đề nghị"; minh chứng đính kèm; luồng duyệt dạng bước; Phê duyệt / Yêu cầu bổ sung / Từ chối |
| — | Duyệt hàng loạt có; **từ chối hàng loạt không có** |

**Nhận xét:** Màn chi tiết đơn của SmartFace giúp người duyệt quyết định tốt hơn AMIS. AMIS tiện hơn khi HR nhập nhiều đơn.

#### Luồng duyệt

| AMIS | SmartFace |
|---|---|
| Trình dựng **3 cột**: Các bước thực hiện · Sự kiện (Đồng ý / Từ chối) · Điều kiện và hành động; nút **Xem sơ đồ** | Soạn trong drawer "Luồng duyệt" từ danh sách loại đơn |

#### Phân quyền

| AMIS | SmartFace |
|---|---|
| Danh sách người dùng: mã, tên, email, vai trò, **được quyền truy cập dữ liệu** (đơn vị), trạng thái tài khoản | Bảng người có quyền quản trị: vai trò, phạm vi phòng ban; modal "Đổi quyền" |
| Sửa vai trò: ma trận chức năng × **ô chọn nhiều hành động** | Bảng quyền chỉ để đọc ("Vai trò làm được những gì") |

#### Báo cáo

| AMIS | SmartFace |
|---|---|
| Nhiều báo cáo; báo cáo làm thêm **tô ô vượt ngưỡng** (cam/đỏ) có tooltip; nút chọn tham số, gửi email, xuất | 4 tab: Chuyên cần (biểu đồ đường), Vi phạm (ngưỡng số lần), Tăng ca (thẻ + biểu đồ cột + bảng), Phép năm |
| — | **Không xuất file, không lọc phòng ban, không bấm vào xem chi tiết**; bộ lọc không lưu URL |

#### Theo dõi trong ngày

| AMIS | SmartFace |
|---|---|
| Danh sách "Dữ liệu chấm công": mã NV, họ tên, vị trí, đơn vị, ngày, giờ chấm, tài liệu đính kèm, **nguồn dữ liệu**, toạ độ; nút Nhập khẩu | **Theo dõi công việc**: thẻ trạng thái bấm để lọc (Chưa đến quá giờ, Vắng, Quên chấm ra, Đang ra ngoài, Đang làm, Đã về…); mỗi người một **dòng thời gian theo giờ** (khung ca, nghỉ, đơn, lượt chấm, vạch "bây giờ"); duyệt/từ chối đơn ngay trên dòng; chọn nhiều → "Nhắc chấm công"; tự làm mới mỗi phút |

**Nhận xét:** Đây là màn mạnh nhất của SmartFace so với AMIS. Tuy nhiên SmartFace **không có màn danh sách lượt chấm thô** kiểu AMIS (nguồn dữ liệu, toạ độ) để tra cứu nhanh.

#### Nhân sự

| AMIS | SmartFace |
|---|---|
| Nằm trong Thiết lập, dữ liệu đồng bộ từ HRM; sửa mã chấm công, số phép; nhập khẩu | Menu riêng: 4 thẻ KPI (không bấm được), lọc lưu URL, menu ⋯ (xem, sửa, gửi lại lời mời, tạm ngưng, kích hoạt lại, chấm dứt); form drawer; import 3 bước (chỉ CSV) |
| — | Chi tiết: tab Hồ sơ / Thiết bị / Lịch sử thay đổi; nút "Đặt lại sinh trắc học". **Không có tab công, số dư phép, ảnh** |

### 4.5. Mẫu tương tác chung

| Mẫu | AMIS | SmartFace |
|---|---|---|
| Thanh công cụ bảng | **Đồng nhất**: tìm kiếm · khoảng ngày ◀▶ · chọn đơn vị · làm mới · xuất khẩu · lọc · **bánh răng tuỳ chỉnh cột** | Thanh lọc có nhãn, "Xoá lọc (N)"; không có ◀▶, không tuỳ chỉnh cột |
| Sắp xếp | Không quan sát rõ | Chỉ **1 cột** sắp xếp được trong toàn ứng dụng |
| Phân trang | "Tổng số bản ghi", chọn 15/25/50/100 | "a–b trên N dòng", 20/50/100, phân trang ở server |
| Xuất khẩu | Gần như mọi danh sách; Excel và PDF | Theo dõi công việc, bảng công, chi tiết công |
| Form tạo/sửa | Modal cho đơn; **trang riêng** cho ca, phân ca, quy trình, vai trò | 17 modal, 6 drawer, 3 trang đầy đủ |
| Xác nhận thao tác nguy hiểm | Hộp cảnh báo đơn giản | `ReasonDialog` bắt nhập lý do ≥ 10 ký tự; `ConfirmDialog` có mô tả hậu quả |
| Trạng thái đang tải | Chữ "Đang tải dữ liệu" + spinner | Khung xương (skeleton); riêng Kỳ công và Đơn cần duyệt dùng spinner |
| Trạng thái rỗng / lỗi | Không quan sát rõ | Có biểu tượng, mô tả, nút hành động; lỗi có "Thử lại" |
| Mở một bản ghi | Bấm dòng / bấm tên | Bấm tên hoặc nút "Chi tiết"/"Mở bảng"; riêng danh mục ca bấm dòng |
| Thông báo | Chuông; nhắc OT tự bật khi đăng nhập | Popover gom theo ngày; **bấm chỉ đánh dấu đã đọc, không mở màn liên quan** |
| Phím tắt | Không quan sát được | Không có |
| Chữ giải thích | Rất ít | Nhiều: mô tả dưới tiêu đề, alert trong form, gợi ý dưới trường |

### 4.6. SmartFace làm tốt hơn AMIS

1. **Theo dõi công việc trong ngày** theo trục giờ, lọc bằng thẻ trạng thái, duyệt và nhắc ngay trên dòng.
2. **Dẫn tới việc cần làm:** banner cần đối soát, "Cần xử lý hôm nay", số liệu bấm vào là tới danh sách đã lọc.
3. **Chi tiết đơn so sánh dữ liệu thật với đề nghị** và liên kết sang ngày công tương ứng.
4. **Thao tác nhạy cảm có chặn và truy vết:** lý do bắt buộc, cảnh báo hậu quả, lưu chính sách thành phiên bản.
5. **Trạng thái tải/rỗng/lỗi và liên kết sâu** làm kỹ, chia sẻ đường dẫn mở đúng tab và bộ lọc.
6. **Nền tảng giao diện:** token màu đạt WCAG AA, focus trap, responsive dưới 768px.

### 4.7. Lỗi UX cụ thể tìm được trong SmartFace

| # | Vị trí | Lỗi | Hậu quả |
|---|---|---|---|
| UX-01 | [ShiftFormDrawer.tsx:341](../web-smart/src/features/policy/ShiftFormDrawer.tsx#L341) | Gợi ý ghi *"Hệ số được lưu và hiển thị, nhưng máy tính công chưa đọc tới"* — engine **đã** dùng hệ số ([payroll-engine.service.ts:622](../server-backend-smart/src/modules/payroll/payroll-engine.service.ts#L622)) | Người cấu hình tưởng hệ số vô tác dụng, bỏ qua hoặc nhập sai |
| UX-02 | [PeriodsPage.tsx:159-175](../web-smart/src/features/exec/PeriodsPage.tsx#L159-L175) | "Duyệt chốt kỳ" chạy ngay, không hỏi | Thao tác nặng nhất lại dễ bấm nhầm nhất |
| UX-03 | [ExecApprovalsPage.tsx:102](../web-smart/src/features/exec/ExecApprovalsPage.tsx#L102) | Cột Trạng thái hiện mã thô (`row.status`) | Giám đốc đọc thấy mã kỹ thuật |
| UX-04 | `ExecApprovalsPage.tsx` | Không có liên kết sang chi tiết đơn | Giám đốc duyệt mà không xem được bằng chứng |
| UX-05 | `RequestDetailPage.tsx` | "Ca làm việc" hiện ID ca, "Trạng thái hiện tại" hiện mã; đơn nhiều ngày thì đánh số mục bắt đầu từ ② | Khó đọc, trông như lỗi |
| UX-06 | [ImportEmployeesModal.tsx:143](../web-smart/src/features/employees/ImportEmployeesModal.tsx#L143) | Nút "Import Excel" nhưng chỉ nhận `.csv` | Người dùng chọn file .xlsx không được, không hiểu vì sao |
| UX-07 | [NotificationBell.tsx:145](../web-smart/src/features/notifications/NotificationBell.tsx#L145) | Bấm thông báo chỉ đánh dấu đã đọc | Phải tự đi tìm đơn/job liên quan |
| UX-08 | Thiết lập › Ngày nghỉ lễ | Chỉ thêm/xoá, không sửa | Sai một chữ phải xoá tạo lại |
| UX-09 | Thiết lập › Chi nhánh | Nhập vĩ độ/kinh độ bằng tay, không có bản đồ | Dễ nhập sai toạ độ → geofence chặn nhầm cả chi nhánh |
| UX-10 | Thiết lập › Phòng ban | Bảng phẳng dù dữ liệu là cây | Không nhìn ra cơ cấu |
| UX-11 | Menu | Nhãn menu khác tiêu đề trang (Yêu cầu/Đơn từ, Chấm công/Theo dõi công việc, Tiền lương/Kỳ công) | Người dùng không chắc mình đang ở đâu |
| UX-12 | Toàn ứng dụng | Có hạ tầng dark mode nhưng không có nút bật/tắt | Máy để chế độ tối thì tự chuyển, người dùng không tắt được |
| UX-13 | Bảng chấm công dạng lưới | Hàng 6 nút cùng cấp trên đầu trang | Không rõ nút chính, dễ bấm nhầm "Bỏ khỏi bảng" |

---

## 5. Hướng thay đổi

### 5.1. Nguyên tắc khi học từ AMIS

Không sao chép máy móc. Mỗi tính năng lấy từ AMIS phải qua bốn câu hỏi:

1. Có phá vỡ **dữ liệu chấm công gốc bất biến** (`BR-06`) không?
2. Có mở đường **gian lận** mà SmartFace đang chặn (`09-anti-fraud`) không?
3. Có cần **ngày hiệu lực** để không làm đổi kết quả kỳ đã chốt (`BR-12`, `BR-17`) không?
4. Có kiểm quyền và phạm vi ở **backend** (`BR-13`) không?

| Tính năng AMIS | Làm theo cách SmartFace |
|---|---|
| **QR tĩnh** in giấy | Không làm QR tĩnh (chụp ảnh gửi nhau là chấm hộ được). Nếu cần QR thì chỉ **QR động** ký bằng server, hết hạn sau vài giây, và vẫn đi kèm khuôn mặt hoặc sinh trắc học thiết bị |
| **GPS không cố định** (chỉ ghi vị trí) | Làm như một chính sách riêng cho nhóm nhân viên di động: ghi vị trí, **vẫn chạy chấm điểm gian lận**, lượt nghi vấn vào hàng chờ duyệt; không bao giờ coi là "đã xác thực vị trí" |
| **HR sửa trực tiếp giờ vào–ra** trong ô | Giữ bản ghi điều chỉnh riêng, nhưng làm **thao tác ngay trong ô** nhanh ngang AMIS (sửa giờ tại chỗ → hệ thống tự tạo điều chỉnh, hỏi lý do một lần) |
| **Máy chấm công vân tay** | Chỉ làm khi có khách hàng cần; nhập dữ liệu máy vào như một nguồn riêng, gắn nhãn nguồn, không hưởng mức tin cậy của khuôn mặt + liveness |
| **Đồng bộ nhân viên từ HRM** | Không áp dụng; thay bằng nhập Excel thật + API công khai ở giai đoạn sau |
| **Menu ngang** | Giữ menu dọc; chỉ sửa nhãn cho khớp tiêu đề trang |

### 5.2. P0 — Sửa ngay (sai nghiệp vụ hoặc sai thông tin hiển thị)

| # | Việc | Nơi sửa | Lý do ưu tiên |
|---|---|---|---|
| P0-01 | **Nối app mobile với API**: đăng nhập, chấm công (camera + GPS + WiFi + ký request), lịch sử, bảng công cá nhân, gửi đơn, thông báo | `app-smart` | Không có bước này thì toàn bộ luồng chấm công chưa dùng được |
| P0-02 | **Cấp phép năm**: job cấp phép theo chính sách (cơ bản + thâm niên + chuyển phép tồn, cấp theo năm hoặc tháng); không tạo số dư với `entitledDays: 0` | `request.repository.ts`, `LeavePolicy`, hàng đợi job | Hiện mọi đơn phép năm đều trừ vào quỹ 0 ngày |
| P0-03 | **Áp dụng trần OT tháng/năm**: engine đọc `payroll.ot.maxMinutesPerMonth` / `…PerYear`; cảnh báo khi tạo/duyệt đơn OT; nhãn cam/đỏ trong báo cáo tăng ca | `payroll-engine.service.ts`, `request.service.ts`, `ReportsPage.tsx` | Cấu hình đang "có mà không chạy" — rủi ro vi phạm Bộ luật Lao động |
| P0-04 | **Tính `unpaidLeaveDays`** thật thay vì gán 0 | `payroll.service.ts:777` | Số liệu xuất cho lương đang sai khi có nghỉ không lương |
| P0-05 | Sửa gợi ý sai về hệ số ca (UX-01) | `ShiftFormDrawer.tsx:341` | Đang báo sai cho người cấu hình |
| P0-06 | Thêm xác nhận cho "Duyệt chốt kỳ" (UX-02) | `PeriodsPage.tsx` | Thao tác không đảo ngược dễ dàng |
| P0-07 | Hiện nhãn trạng thái thay mã thô; thêm liên kết chi tiết đơn (UX-03, UX-04, UX-05) | `ExecApprovalsPage.tsx`, `RequestDetailPage.tsx` | Giám đốc duyệt thiếu thông tin |
| P0-08 | Đổi nhãn "Import Excel" thành "Nhập file CSV" **hoặc** nhận `.xlsx` thật (UX-06) | `ImportEmployeesModal.tsx` | Nhãn sai chức năng |

### 5.3. P1 — Nghiệp vụ còn thiếu so với AMIS

| # | Việc | Ghi chú thiết kế |
|---|---|---|
| P1-01 | **Áp dụng khung giờ được chấm vào/ra** khi chấm công | Chính sách: chặn / ghi nhận nhưng không tính / cảnh báo. Không xoá lượt chấm gốc |
| P1-02 | **Gửi xác nhận công cho nhân viên** | Bước mới giữa đang tính và chờ duyệt: gửi kèm hạn phản hồi → nhân viên xác nhận hoặc phản hồi (tạo đơn bổ sung công) → trạng thái về cho Kế toán; nhân viên không phản hồi quá hạn thì coi là đồng ý (cấu hình được) |
| P1-03 | **Đơn đổi ca** (kể cả hoán đổi giữa hai người) | Duyệt xong tạo phân ca mới có lịch sử, không sửa đè; cả hai người đều phải đồng ý nếu hoán đổi |
| P1-04 | **Đơn đăng ký đi muộn** và **chế độ nuôi con dưới 12 tháng** (60 phút/ngày) | Loại đơn cấu hình được; chế độ có ngày hiệu lực |
| P1-05 | **Phân ca theo chu kỳ lặp** (mỗi N tuần, theo ngày trong tháng) | Kèm lịch xem trước trước khi áp dụng |
| P1-06 | **Sao chép phân ca** giữa người/phòng ban/tuần; **nhập phân ca và ca từ Excel** | Kiểm hợp lệ từng dòng như import nhân viên |
| P1-07 | **Nhiều ca trong ngày** được tính đủ, không chỉ ca sớm nhất | `policy.repository.ts:286`, `AttendanceDaily` theo ca |
| P1-08 | **Ngày nghỉ tuần cấu hình được** theo công ty/chi nhánh, có ngày hiệu lực | Thay hằng số thứ 7/chủ nhật |
| P1-09 | **Công chuẩn cố định** (24/26) bên cạnh công chuẩn theo lịch ca | Chính sách công ty, có ngày hiệu lực |
| P1-10 | **Vai trò tuỳ biến**: API tạo/sửa vai trò, ma trận chức năng × hành động | Bảng `Role`/`RolePermission` đã có; bổ sung API + màn sửa; audit mọi thay đổi |
| P1-11 | **Phạm vi dữ liệu BRANCH/TEAM** được cưỡng chế ở guard | `scope.guard.ts` |
| P1-12 | **Quy định làm thêm**: phút tối thiểu, khung giờ trước/sau 22h có hệ số riêng, nhóm không cần đơn | Chính sách có ngày hiệu lực |
| P1-13 | **Nghỉ bù từ giờ làm thêm**: quỹ giờ nghỉ bù, trừ khi duyệt đơn nghỉ bù | Chọn quy đổi OT thành tiền hay thành giờ nghỉ bù ngay khi duyệt OT |
| P1-14 | **Danh sách nhân viên không cần chấm công** | Không tính vắng, không cảnh báo, vẫn tính công chuẩn |
| P1-15 | **Ghi lịch sử điều chuyển** vào `EmployeeAssignmentHistory` khi đổi phòng ban/chi nhánh | Nền cho bảng công theo cơ cấu tại thời điểm (`BR-17`) |
| P1-16 | **Kênh email** cho thông báo và gửi danh sách | Dùng cho nhắc xác nhận công, nhắc OT, gửi báo cáo |

### 5.4. P1 — UI/UX

| # | Việc | Học từ AMIS | Giữ gì của SmartFace |
|---|---|---|---|
| UI-01 | **Bộ công cụ bảng chuẩn** cho mọi danh sách: ẩn/hiện cột, sắp xếp nhiều cột, xuất Excel, khoảng ngày có ◀▶ | Thanh công cụ đồng nhất | Bộ lọc lưu URL, skeleton, trạng thái rỗng/lỗi |
| UI-02 | **Ô bảng chấm công chứa giờ vào–ra**, tô đỏ giờ muộn, hiện tên ngày lễ; chế độ gọn/đủ | Ô nhiều thông tin | Màu nền trạng thái, cột Tổng kỳ, banner cần đối soát |
| UI-03 | **Thẻ đếm trên bảng chấm công bấm được** → danh sách → xuất/gửi | Popup danh sách từ thẻ đếm | Thẻ đồng thời là chú thích |
| UI-04 | **Gom hàng nút** trên bảng chấm công: 1 nút chính (Chốt bảng) + 2 nút phụ + menu "Thêm" (UX-13) | Thanh gọn | — |
| UI-05 | **Phân ca có lịch xem trước**; lưới cho chọn nhiều ô, sao chép/dán, kéo để điền; nút "Hôm nay"; chuyển góc xem theo phòng ban / theo ca | Form + preview; nhiều góc xem | Popover bật/tắt ca, cảnh báo trùng ca |
| UI-06 | **Chú thích công thức tại tiêu đề cột** bảng tổng hợp công | Tooltip giải thích cách tính | Trang chi tiết một người, "Tổng hợp bất thường" |
| UI-07 | **Sơ đồ quy trình nghiệp vụ** giữ lại sau wizard, bấm vào từng bước, hiện bước nào đang dang dở | Tab "Quy trình nghiệp vụ" | Wizard thiết lập ban đầu |
| UI-08 | **Thông báo bấm vào mở đúng màn** (đơn, job xuất file, kỳ công) (UX-07) | — | Gom theo ngày |
| UI-09 | **Bản đồ chọn toạ độ và bán kính** chi nhánh (UX-09); **cây phòng ban** (UX-10); **sửa ngày lễ** (UX-08) | — | — |
| UI-10 | **Form tạo đơn hộ hiện số dư phép**; **lập đơn hàng loạt** qua trang chọn nhân viên có cột số dư; **từ chối hàng loạt** | Modal tự điền số phép; trang chọn nhiều người | Xem trước luồng duyệt, lý do nhập hộ |
| UI-11 | **Trình dựng luồng duyệt dạng sơ đồ** với điều kiện theo phòng ban, loại nghỉ, số ngày | Trình dựng 3 cột + "Xem sơ đồ" | Snapshot luồng khi gửi |
| UI-12 | **Màn danh sách lượt chấm thô**: nguồn dữ liệu, toạ độ, thiết bị, điểm gian lận, ảnh | Màn "Dữ liệu chấm công" | Cờ nghi vấn và hàng chờ duyệt |
| UI-13 | **Báo cáo xuất được, lọc phòng ban, bấm vào xem chi tiết**; tô ô vượt ngưỡng | Nhãn cam/đỏ có tooltip | Biểu đồ hiện có |
| UI-14 | **Tổng quan tuỳ chỉnh được** (ẩn/hiện, thứ tự widget, khoảng thời gian từng widget) | Nút "Tuỳ chỉnh" | Khối "Cần xử lý hôm nay" luôn cố định ở đầu |
| UI-15 | **Đồng bộ nhãn menu và tiêu đề trang** (UX-11); **nút bật/tắt dark mode** (UX-12) | — | — |
| UI-16 | **Giảm mật độ chữ giải thích cho người dùng lâu năm**: gập đoạn mô tả, nhớ trạng thái đã gập | — | Giữ cảnh báo hậu quả ở thao tác nhạy cảm |
| UI-17 | **Chi tiết nhân viên có tab Công và Phép** (công tháng này, số dư phép, đơn gần đây) | — | Tab Thiết bị, Lịch sử thay đổi |

### 5.5. P2 — Mở rộng hình thức chấm công và tích hợp

| # | Việc | Điều kiện |
|---|---|---|
| P2-01 | **Kiosk máy tính bảng** nhận diện 1:N | AI server đã có `/identify`; cần endpoint kiosk, đăng ký thiết bị kiosk, liveness tại kiosk, giới hạn theo chi nhánh |
| P2-02 | **QR động** ký bởi server (xem [§5.1](#51-nguyên-tắc-khi-học-từ-amis)) | Chỉ khi có nhu cầu; luôn kèm lớp xác thực thứ hai |
| P2-03 | **Chính sách GPS cho nhân viên di động** | Ghi vị trí + chấm điểm gian lận + hàng chờ duyệt |
| P2-04 | **Xác thực thêm theo đối tượng**: bật từng lớp (khuôn mặt, đính kèm tài liệu, quản lý xác nhận) theo phòng ban/nhân viên | Mở rộng chính sách chấm công theo phạm vi |
| P2-05 | **Công cụ tra BSSID** cho người cấu hình WiFi | Có thể nằm trong app mobile của quản lý |
| P2-06 | **Nhập dữ liệu máy chấm công** (file hoặc kết nối) | Nguồn riêng, gắn nhãn, không thay thế khuôn mặt |
| P2-07 | **Bảng công theo ca và theo giờ** | Cho khách hàng trả lương theo ca/giờ |
| P2-08 | **Điều động theo chi nhánh**: phân ca kèm địa điểm, bảng công tách theo chi nhánh | Cần P1-15 trước |
| P2-09 | **Công ăn ca, công điều động** | Phụ cấp theo ca và theo số công thực tế |
| P2-10 | **Xuất PDF**, **API công khai / webhook** sang phần mềm lương | Thay dần bước xuất Excel |

### 5.6. Giữ nguyên — đừng đánh đổi khi thêm tính năng

- Bản ghi chấm công gốc bất biến; mọi sửa đổi là điều chỉnh có lý do (`BR-06`).
- Giờ server là giờ chính thức (`BR-01`); backend tự kiểm chứng khuôn mặt, không tin cờ từ client (`BR-02`).
- Kỳ công hai người hai bước, có phiên bản, mở lại có duyệt (`BR-07`).
- Snapshot luồng duyệt khi gửi (`BR-16`); không ai tự duyệt đơn của mình (`BR-14`).
- Màn Theo dõi công việc, trang chi tiết đơn so sánh dữ liệu, banner cần đối soát.
- Trạng thái tải/rỗng/lỗi, liên kết sâu, tương phản màu đạt WCAG AA.

### 5.7. Thứ tự đề xuất

```
Đợt 1 (P0)       App mobile nối API ─┬─ Phép năm ─ Trần OT ─ unpaidLeaveDays
                                     └─ Sửa UX-01..UX-06
Đợt 2 (P1 lõi)   Khung giờ chấm ─ Gửi xác nhận công ─ Đổi ca ─ Nhiều ca/ngày
                 Bộ công cụ bảng (UI-01) ─ Ô bảng công đủ thông tin (UI-02..UI-04)
Đợt 3 (P1 cấu hình)  Phân ca chu kỳ + preview + sao chép + import (P1-05, P1-06, UI-05)
                     Vai trò tuỳ biến + scope (P1-10, P1-11) ─ Quy định OT, nghỉ bù, nghỉ tuần
Đợt 4 (P2)       Kiosk ─ QR động ─ GPS di động ─ bảng công theo ca/giờ ─ tích hợp lương
```

Đợt 1 là điều kiện để mọi đợt sau có người dùng thật kiểm chứng.

---

## 6. Việc cần chốt trước khi làm

| # | Câu hỏi | Ảnh hưởng |
|---|---|---|
| C1 | Trần OT: dùng cố định 40 giờ/tháng – 200 giờ/năm hay cho cấu hình ngưỡng theo trường hợp đặc biệt của pháp luật? Chạm trần thì **chặn** duyệt hay chỉ **cảnh báo**? | P0-03 |
| C2 | Xác nhận công: nhân viên không phản hồi quá hạn thì coi là đồng ý hay chặn chốt kỳ? | P1-02, state machine kỳ công |
| C3 | Chấm ngoài khung giờ: chặn, ghi nhận không tính, hay cảnh báo? | P1-01 |
| C4 | Có khách hàng thật cần máy chấm công vân tay / kiosk / QR không? | Thứ tự P2 |
| C5 | Có tích hợp phần mềm lương cụ thể nào (MISA, FAST) trong 6 tháng tới không? | P2-10 |
| C6 | DB `76.13.16.235` trong `server-backend-smart/.env` là môi trường nào? | Điều kiện để chạy backend cục bộ và chụp lại giao diện mới nhất |

---

## Phụ lục A — Đối chiếu 26 video với SmartFace

| # | Video AMIS | Có ở SmartFace |
|---|---|---|
| 1 | Giới thiệu chung | — |
| 2 | Bắt đầu sử dụng (nhân viên, quy định, máy chấm công, ca, bảng công) | Một phần — không có máy chấm công, quy định nghỉ/OT thiếu nhiều mục |
| 3 | Khai báo danh mục ca | Có — thiếu nhập khẩu, công ăn ca, công điều động, trừ công |
| 4 | Phân ca chi tiết | Một phần — thiếu chu kỳ lặp, xem trước |
| 5 | Bảng phân ca tổng hợp | Một phần — thiếu góc xem, sao chép, nhập khẩu |
| 6 | Lập bảng chấm công chi tiết | Có (chỉ theo ngày) |
| 7 | Ghi nhận, theo dõi dữ liệu chấm công | Có — thiếu nhập khẩu, PDF, bảng theo ca/giờ |
| 8 | Tổng hợp công | Có — thiếu công chuẩn cố định, bảng theo ca, chú thích công thức |
| 9 | Gửi xác nhận công | **Không** |
| 10 | Chuyển tính lương | Không (xuất Excel) |
| 11 | Kết nối máy chấm công | **Không** |
| 12 | Khuôn mặt trên máy tính bảng | Một phần (AI server 1:N) |
| 13 | Khuôn mặt trên điện thoại | Backend có; **app chưa có** |
| 14 | Chấm công qua WiFi | Backend có; app chưa có |
| 15 | QR code | **Không** |
| 16 | GPS | Có (cố định); không có "không cố định" |
| 17 | Nhắc giới hạn làm thêm | **Không** (cấu hình có, không chạy) |
| 18 | Bảng công trên mobile | API có; app chưa có |
| 19 | Phân ca, tính công khi điều động nhiều chi nhánh | **Không** |
| 20 | Theo dõi nhanh muộn/sớm, nghỉ, quên chấm | Có (Theo dõi công việc — mạnh hơn) |
| 21 | Lập duyệt đơn | Có |
| 22 | Quy trình duyệt nhiều cấp | Có — điều kiện chỉ theo số ngày |
| 23 | HR tiếp nhận các loại đơn | Một phần — thiếu đổi ca, đi muộn, nhập khẩu, hàng loạt, tuỳ chỉnh trường |
| 24 | Bộ sản phẩm AMIS HRM | Ngoài phạm vi |
| 25 | Người dùng và vai trò | Một phần — không tạo được vai trò |
| 26 | Tra cứu BSSID | Không |

## Phụ lục B — Ảnh dùng để so sánh

| Phía | Vị trí |
|---|---|
| AMIS | Khung hình trích từ PDF nguồn (trang 2–72); các khung chính: Tổng quan (tr. 57), Quy trình nghiệp vụ (tr. 10), Dữ liệu chấm công (tr. 55), Bảng chấm công chi tiết (tr. 23), Bảng phân ca tổng hợp (tr. 17), Phân ca chi tiết (tr. 14, 67), Ca làm việc (tr. 11), Tổng hợp công (tr. 26–27), Đơn xin nghỉ (tr. 58, 63), Quy trình duyệt (tr. 61), Báo cáo làm thêm (tr. 49), Vai trò (tr. 24), Người dùng (tr. 69) |
| SmartFace | Ảnh chụp từ ứng dụng thật ngày 09–10/09/2026 (Bảng công, Bảng chấm công, Chi tiết công, Danh sách bảng, Chốt bảng, Danh mục ca, Form ca, Đăng nhập, Đổi mật khẩu); các màn còn lại đọc từ `web-smart/src/features` |

---

**Trước:** [23 — Deploy cho người mới](./23-huong-dan-deploy-cho-nguoi-moi.md)
