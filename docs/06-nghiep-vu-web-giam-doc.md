# 06 — Nghiệp vụ Web Giám đốc / Owner công ty

> **Nguồn chuẩn:** Tài liệu nghiệp vụ SmartFace **v2.1**, Chương VI.
> Nền tảng: **ReactJS (TypeScript) + Vite + Ant Design** — dùng chung monorepo/components
> với [Web Kế toán](./05-nghiep-vu-web-ke-toan.md) nhưng **route và permission tách rõ** (`ADR-03`).
> Actor: `ACT-DIR` (Giám đốc / Tổng Giám đốc / Owner công ty).
>
> ⚠ **Trạng thái thi công: TÁCH DỞ.** Hiện tại `web-smart` gộp chung Kế toán và
> Giám đốc, phân quyền theo role. Cần tách route/permission theo tài liệu này.
> Xem [01 §13](./01-tong-quan-he-thong.md#13-khác-biệt-giữa-chuẩn-v21-và-hiện-trạng-thi-công).

---

Web Giám đốc là kênh **quản trị và cấu hình sâu** của một công ty.
[App Giám đốc](./04-nghiep-vu-app-giam-doc.md) phục vụ điều hành nhanh và phê
duyệt trên mobile; **Web là nơi xác lập "SmartFace hoạt động như thế nào" trong
tenant**: bộ máy tổ chức, giờ làm, ca, phân ca, quy tắc công, luồng duyệt và
người được uỷ quyền quản lý từng phân hệ.

| Ranh giới | App Giám đốc | Web Giám đốc |
|---|---|---|
| Mục đích | Ra quyết định nhanh | Xác lập luật chơi |
| Phê duyệt | ✓ (cấp cao, có step-up) | ✓ (kèm lịch sử quyết định) |
| Xem số liệu | KPI + drill-down | Đầy đủ + export |
| Cấu hình chính sách/ca/workflow | ✗ | ✓ |
| Phân quyền chi tiết | Chỉ role template + uỷ quyền tạm | ✓ đầy đủ |
| Cấp/thu hồi Owner | ✓ (nếu có `owner.assign`) | ✓ |

---

## Mục lục

1. [Cấu trúc menu](#1-cấu-trúc-menu-fr-gdw-nav)
2. [Dashboard điều hành](#2-dashboard-điều-hành-fr-gdw-dash)
3. [Trung tâm phê duyệt cấp Giám đốc](#3-trung-tâm-phê-duyệt-cấp-giám-đốc-fr-gdw-appr)
4. [Thiết lập bộ máy phân cấp công ty](#4-thiết-lập-bộ-máy-phân-cấp-công-ty-fr-gdw-org)
5. [Setup thời gian làm việc](#5-setup-thời-gian-làm-việc-fr-gdw-time)
6. [Thiết lập ca làm việc & chính sách công](#6-thiết-lập-ca-làm-việc--chính-sách-công-fr-gdw-pol)
7. [Thiết lập phân ca](#7-thiết-lập-phân-ca-fr-gdw-shift)
8. [Văn phòng, geofence & thiết bị](#8-văn-phòng-geofence--thiết-bị-fr-gdw-geo)
9. [Cấu hình luồng duyệt](#9-cấu-hình-luồng-duyệt-fr-gdw-flow)
10. [Phân quyền theo module & phạm vi](#10-phân-quyền-theo-module--phạm-vi-fr-gdw-role)
11. [Quyền Owner công ty](#11-quyền-owner-công-ty-fr-gdw-owner)
12. [Nhật ký cấu hình & kiểm soát thay đổi](#12-nhật-ký-cấu-hình--kiểm-soát-thay-đổi-fr-gdw-log)

---

## 1. Cấu trúc menu (`FR-GDW-NAV`)

| Menu | Mục con |
|---|---|
| **Dashboard** | KPI chuyên cần, đơn chờ duyệt, kỳ công chờ phê duyệt, cảnh báo |
| **Phê duyệt** | Đơn của Quản lý/Kế toán, mở lại kỳ, override nhạy cảm, lịch sử quyết định |
| **Tổ chức** | Chi nhánh, phòng ban, chức vụ, cây quản lý, người phụ trách |
| **Thời gian làm việc** | Ngày làm việc, giờ chuẩn, nghỉ trưa, grace period, ca linh hoạt |
| **Ca & phân ca** | Mẫu ca, chu kỳ ca, phân ca theo người/đội nhóm, lịch sử thay đổi |
| **Chính sách** | Phép, OT, công bù, ngày lễ, geofence, quy tắc chấm công |
| **Luồng duyệt** | Cấu hình người/cấp duyệt theo loại đơn và phạm vi |
| **Phân quyền** | Vai trò, permission theo module, scope dữ liệu, Owner, uỷ quyền tạm thời |
| **Văn phòng** | Địa điểm, GPS, bán kính, Wi-Fi/Bluetooth tham chiếu nếu dùng |
| **Nhật ký** | Thay đổi cấu hình, quyền, ca, chính sách, quyết định phê duyệt |

---

## 2. Dashboard điều hành (`FR-GDW-DASH`)

| Mã | Yêu cầu |
|---|---|
| `FR-GDW-DASH-01` | Tình hình đi làm hôm nay theo toàn công ty / chi nhánh / phòng ban |
| `FR-GDW-DASH-02` | Tỷ lệ đi muộn, thiếu công, OT, nghỉ phép và biến động so với kỳ trước |
| `FR-GDW-DASH-03` | Danh sách đơn cấp cao đang chờ: đơn cá nhân của Quản lý, yêu cầu Kế toán, mở lại kỳ công |
| `FR-GDW-DASH-04` | Cảnh báo vận hành nội bộ: phòng ban thiếu người, quá nhiều OT, tỷ lệ nghi vấn chấm công tăng, kỳ công sắp đến hạn chốt |

> **Không hiển thị chỉ số hạ tầng platform** (CPU/GPU, log hệ thống sâu, incident
> Sev1/Sev2). Phần đó thuộc [Web Quản trị nền tảng](./07-nghiep-vu-web-platform-admin.md).
> Giám đốc công ty không cần và không được thấy sức khoẻ hạ tầng SaaS.

---

## 3. Trung tâm phê duyệt cấp Giám đốc (`FR-GDW-APPR`)

| Loại cần duyệt | Nguồn gửi | Kết quả |
|---|---|---|
| Đơn cá nhân của Quản lý | App Quản lý | Duyệt / từ chối / yêu cầu bổ sung |
| Đơn cá nhân của Kế toán | App tài khoản Kế toán | Theo workflow cấp cao |
| Mở lại kỳ công | Web Kế toán | Cho phép mở lại trong thời hạn/phạm vi xác định |
| Override công/phép đặc biệt | Web Kế toán | Chấp nhận hoặc từ chối thay đổi nhạy cảm |
| Đề nghị thay đổi cấu hình có kiểm soát | Người được uỷ quyền | Nếu tenant bật cơ chế 2 bước cho cấu hình quan trọng |

| Mã | Quy tắc |
|---|---|
| `FR-GDW-APPR-01` | Lọc theo mức độ khẩn cấp, ngày hiệu lực, loại yêu cầu, người gửi |
| `FR-GDW-APPR-02` | Mọi quyết định có lý do; **từ chối bắt buộc lý do** |
| `FR-GDW-APPR-03` | Cấu hình được SLA duyệt và nhắc nhở, **nhưng không tự động duyệt yêu cầu nhạy cảm khi quá hạn** |
| `FR-GDW-APPR-04` | Mobile và Web thao tác trên cùng hàng chờ; xử lý ở một kênh phải phản ánh ngay ở kênh kia (`BR-16`) |

---

## 4. Thiết lập bộ máy phân cấp công ty (`FR-GDW-ORG`)

Cấu trúc tổ chức là **nền để xác định scope dữ liệu và người duyệt**. Hỗ trợ cây
nhiều cấp thay vì cố định "Phòng ban → Nhân viên".

| Đối tượng | Thuộc tính chính | Quy tắc |
|---|---|---|
| **Công ty/Tenant** | Tên, mã, múi giờ, trạng thái | Một tenant có nhiều chi nhánh |
| **Chi nhánh** | Tên, mã, địa chỉ, timezone nếu cần | Gắn văn phòng/geofence và ngày lễ địa phương |
| **Đơn vị/Phòng ban** | Tên, mã, cấp cha | Cây nhiều cấp; **không cho vòng lặp cha–con** |
| **Chức vụ** | Tên, cấp bậc, nhóm vai trò tham chiếu | **Không tự sinh quyền** — quyền phải gán riêng |
| **Quan hệ quản lý** | Nhân viên → quản lý trực tiếp | Có hiệu lực theo ngày; dùng cho workflow đơn |

| Mã | Quy tắc thi công |
|---|---|
| `FR-GDW-ORG-01` | Chuyển nhân viên sang phòng ban mới phải chọn **ngày hiệu lực**; dữ liệu lịch sử vẫn thuộc đơn vị cũ tại thời điểm phát sinh (`BR-17`) |
| `FR-GDW-ORG-02` | Một quản lý có thể phụ trách nhiều đơn vị hoặc nhóm dự án qua **scope bổ sung** |
| `FR-GDW-ORG-03` | **Không gắn quyền dựa vào "chức vụ = trưởng phòng".** Quyền thực tế phải đi qua role/permission để linh hoạt |

---

## 5. Setup thời gian làm việc (`FR-GDW-TIME`)

| Cấu hình | Ví dụ |
|---|---|
| **Tuần làm việc** | Thứ 2 – Thứ 6, hoặc lịch 6 ngày/tuần |
| **Giờ chuẩn** | 08:00 – 17:30, nghỉ 12:00 – 13:30 |
| **Grace period** | Cho phép đi muộn 5 phút; về sớm 5 phút |
| **Ca linh hoạt** | Đủ 8 giờ trong khung 07:00 – 20:00 |
| **Ngưỡng thiếu công** | Dưới X giờ thì thiếu nửa công / không đủ công theo rule |
| **Ngày nghỉ lễ** | Danh mục theo năm, theo chi nhánh/vùng; hệ số OT nếu áp dụng |

> ### Version chính sách
>
> Thay đổi giờ làm giữa kỳ **phải có ngày hiệu lực**. Không sửa ngược cấu hình cũ
> làm thay đổi kết quả các kỳ đã chốt (`BR-12`). Engine tính công áp dụng phiên
> bản chính sách theo ngày hiệu lực — xem
> [05 mục 5](./05-nghiep-vu-web-ke-toan.md).

---

## 6. Thiết lập ca làm việc & chính sách công (`FR-GDW-POL`)

> Khối này chuyển nguyên văn từ tài liệu 04 (Web Quản lý) bản v1.0 — theo v2.1
> cấu hình ca và chính sách thuộc **Web Giám đốc**, không phải Kế toán.

### 6.1. Danh mục Ca làm việc — Thiết lập ca (`FR-GDW-POL-12`…`FR-GDW-POL-17`)

Danh mục dùng chung toàn công ty: mỗi dòng là một ca làm việc, được tái sử dụng khi phân ca cho phòng ban/nhân viên ở mục 7. Sửa một ca ở đây ảnh hưởng tới mọi bảng phân ca đang dùng ca đó (theo `effectiveFrom`/`effectiveTo`, xem bẫy ở 6.5).

| Trường | Mô tả | Bắt buộc | Ví dụ |
|---|---|---|---|
| **Mã ca** | Định danh duy nhất trong công ty, bất biến sau khi tạo | Có | `CA_HC`, `CA_S`, `CA_C`, `CA_D` |
| **Tên ca** | Tên hiển thị | Có | "Ca hành chính", "Ca sáng" |
| **Ký hiệu chấm công** | Ký hiệu ngắn (1–3 ký tự) hiển thị trên bảng công và bảng phân ca | Có | `HC`, `S`, `C`, `Đ` |
| **Giờ bắt đầu làm việc** | Giờ vào chính thức của ca | Có | 08:00 |
| **Giờ kết thúc làm việc** | Giờ ra chính thức của ca | Có | 17:30 |
| **Giờ bắt đầu được chấm vào** | Mốc sớm nhất trong ngày hệ thống bắt đầu chấp nhận chấm công vào cho ca này | Có | 06:30 |
| **Giờ bắt đầu được chấm ra** | Mốc sớm nhất trong ngày hệ thống bắt đầu chấp nhận chấm công ra cho ca này | Có | 16:30 |
| **Giờ nghỉ trưa — bắt đầu / kết thúc** | Khung giờ nghỉ trưa, bị trừ khỏi tổng giờ công dù nhân viên có mặt tại văn phòng | Không (chỉ ca có nghỉ trưa) | 12:00 → 13:00 |
| **Hệ số công theo loại ngày** | Hệ số nhân "công chuẩn" khi ca rơi vào từng loại ngày | Có | Ngày thường `×1` · Ngày nghỉ `×2` · Ngày lễ `×3` |
| **Trạng thái** | Đang dùng / Ngừng dùng — không xoá cứng vì đã có lịch sử phân ca | Có | Đang dùng |

**Màn hình thiết lập ca:**

```
┌─────────────────────────────────────────────────────────────────┐
│  THIẾT LẬP CA LÀM VIỆC                              [+ Thêm ca]  │
├─────────────────────────────────────────────────────────────────┤
│  Mã ca *              [ CA_HC______________ ]                    │
│  Tên ca *             [ Ca hành chính_______ ]                    │
│  Ký hiệu chấm công *  [ HC__ ]                                    │
│                                                                    │
│  Giờ bắt đầu làm việc *   [ 08:00 ]                                │
│  Giờ kết thúc làm việc *  [ 17:30 ]                                │
│                                                                    │
│  Khung giờ được phép chấm công                                    │
│    Giờ bắt đầu được chấm vào *  [ 06:30 ]                          │
│    Giờ bắt đầu được chấm ra  *  [ 16:30 ]                          │
│                                                                    │
│  Giờ nghỉ trưa            ☑ Có áp dụng nghỉ trưa                  │
│    Bắt đầu nghỉ  [ 12:00 ]      Kết thúc nghỉ  [ 13:00 ]           │
│                                                                    │
│  Hệ số công theo loại ngày                                        │
│    Ngày thường  [ 1 ]    Ngày nghỉ  [ 2 ]    Ngày lễ  [ 3 ]        │
│                                        [ Thiết lập nghỉ lễ ▸ ]     │
│                                                                    │
│                                     [ Huỷ ]     [ Lưu ca làm việc ]│
└─────────────────────────────────────────────────────────────────┘
```

> **Thiết lập nghỉ lễ** không khai báo lại ở từng ca — bấm mở ra chính là **danh mục ngày nghỉ lễ dùng chung của công ty** (`FR-GDW-POL-06`, xem 6.4). Ca chỉ khai báo **hệ số áp dụng** khi ngày rơi vào ngày lễ; danh sách "ngày nào là lễ" được quản lý tập trung một chỗ để tránh mỗi ca định nghĩa lễ khác nhau.
>
> **Phân biệt với `FR-GDW-POL-05`:** hệ số ở đây (`×1`/`×2`/`×3`) là hệ số quy đổi **công chuẩn** (một ngày làm lễ tính bằng 3 ngày công thường khi trả lương theo ngày công), khác với hệ số OT (150%/200%/300%) ở mục 6.3 vốn áp cho **số giờ làm ngoài giờ**. Hai hệ số cùng tồn tại và có thể cộng dồn — cần thống nhất công thức trả lương với kế toán trước khi thi công `FR-ACC-PAY-03`.

**Ràng buộc khi lưu:**

- `Giờ bắt đầu được chấm vào` phải **trước** `Giờ bắt đầu làm việc`.
- `Giờ bắt đầu được chấm ra` phải **trước hoặc bằng** `Giờ kết thúc làm việc`; chấm ra trước giờ kết thúc vẫn được nhưng tính "về sớm" theo `FR-GDW-POL-04`.
- Nếu bật nghỉ trưa: khung giờ nghỉ phải nằm trong `[Giờ bắt đầu làm việc, Giờ kết thúc làm việc]`.
- Ca đêm (giờ kết thúc < giờ bắt đầu, VD 22:00 → 06:00) áp dụng nguyên tắc `workDate` ở mục 6.6.

### 6.2. Loại ca làm việc

| Thành phần | Nội dung | Yêu cầu thi công |
|---|---|---|
| **Ca hành chính** | Giờ vào – giờ ra cố định (VD 08:00 – 17:30), có nghỉ trưa | Trường hợp cơ bản nhất, làm trước |
| **Ca xoay / Ca kíp** | Nhiều ca trong ngày (sáng/chiều/đêm), lịch phân ca theo tuần | **Ca đêm vắt qua nửa đêm** là bẫy lớn — xem 6.5 |
| **Ca linh hoạt (flexible)** | Chấm công theo tổng số giờ/ngày, không cố định giờ vào ra | Không tính "đi muộn", chỉ tính đủ/thiếu giờ |
| **Cấu hình trễ cho phép** | Số phút được trễ trước khi tính lỗi (VD 5–15 phút) | Áp dụng cho ca hành chính và ca kíp |
| **Cấu hình tăng ca (OT)** | Hệ số OT theo ngày thường/cuối tuần/lễ, duyệt trước hoặc sau | Hệ số theo luật LĐ VN: 150% / 200% / 300% |

### 6.3. Danh sách yêu cầu

| Mã | Yêu cầu | Ưu tiên |
|---|---|---|
| `FR-GDW-POL-01` | Cấu hình ca hành chính (giờ vào/ra, nghỉ trưa) | Must |
| `FR-GDW-POL-02` | Cấu hình ca xoay/ca kíp và lịch phân ca theo tuần | Should (GĐ 2) |
| `FR-GDW-POL-03` | Cấu hình ca linh hoạt theo tổng giờ | Should (GĐ 2) |
| `FR-GDW-POL-04` | Cấu hình số phút trễ cho phép | Must |
| `FR-GDW-POL-05` | Cấu hình hệ số OT theo ngày thường/cuối tuần/lễ | Must |
| `FR-GDW-POL-06` | Danh mục ngày nghỉ lễ theo năm, áp dụng chung hoặc theo chi nhánh/vùng | Must |
| `FR-GDW-POL-07` | Số ngày phép năm mặc định theo thâm niên/loại hợp đồng | Must |
| `FR-GDW-POL-08` | Quy tắc cộng dồn / hết hạn phép năm | Must |
| `FR-GDW-POL-09` | Cấu hình bán kính geofencing cho từng văn phòng/chi nhánh | Must |
| `FR-GDW-POL-10` | Cấu hình ngưỡng nhận diện khuôn mặt và liveness theo công ty | Should |
| `FR-GDW-POL-11` | Cấu hình chính sách chấm công ngoài vùng: chặn / cảnh báo / cho chấm và chờ duyệt | Must |
| `FR-GDW-POL-12` | Quản lý danh mục ca làm việc: mã ca, tên ca, ký hiệu chấm công, trạng thái đang dùng/ngừng dùng | Must |
| `FR-GDW-POL-13` | Thiết lập khung giờ được phép chấm vào/chấm ra riêng biệt với giờ vào/ra chính thức của ca | Must |
| `FR-GDW-POL-14` | Thiết lập giờ nghỉ trưa (bắt đầu/kết thúc) theo từng ca, trừ khỏi tổng giờ công | Must |
| `FR-GDW-POL-15` | Thiết lập hệ số công theo loại ngày (ngày thường/ngày nghỉ/ngày lễ) cho từng ca | Must |
| `FR-GDW-POL-16` | Liên kết hệ số ngày lễ của ca với danh mục ngày nghỉ lễ dùng chung (`FR-GDW-POL-06`) | Must |
| `FR-GDW-POL-17` | Không cho xoá cứng ca đã có lịch sử phân ca — chỉ chuyển trạng thái "Ngừng dùng" | Must |

### 6.4. Quy tắc phép năm

```
Số phép năm = phép cơ bản theo loại hợp đồng
            + phép thâm niên (VD: +1 ngày mỗi 5 năm làm việc)
            + phép cộng dồn từ năm trước (nếu chính sách cho phép)

Cấu hình cần có:
  - Phép cơ bản: 12 ngày/năm (theo Bộ luật LĐ VN cho điều kiện bình thường)
  - Cộng dồn: có/không, tối đa bao nhiêu ngày
  - Hạn dùng phép cộng dồn: đến hết Q1 năm sau / đến hết năm / không hạn
  - Cấp phát: một lần đầu năm / cộng dần theo tháng làm việc
  - Nhân viên vào giữa năm: tính theo tỷ lệ tháng làm việc
```

### 6.5. Bẫy cần xử lý khi thi công

> Đây là những trường hợp gây sai lệch lương nếu bỏ sót. Chi tiết kỹ thuật xem `00-kien-thuc-nen-tang.md` Phần 7.

| Bẫy | Mô tả | Hướng xử lý |
|---|---|---|
| **Ca đêm vắt qua nửa đêm** | Ca 22:00 → 06:00 hôm sau. Chấm vào ngày 03, chấm ra ngày 04. | Bảng công gắn với **ngày bắt đầu ca**, không phải ngày của timestamp. Cần cột `workDate` riêng biệt với `checkInAt`. |
| **Ca gãy** | Sáng 08:00–12:00, chiều 14:00–18:00, nghỉ giữa 2 tiếng. | Một ca gồm nhiều đoạn (`ShiftSegment`), không phải một cặp vào/ra. |
| **Đổi cấu hình ca giữa tháng** | Đổi giờ vào từ 08:00 sang 08:15 vào ngày 15. | Cấu hình ca phải có **hiệu lực theo thời gian** (`effectiveFrom`, `effectiveTo`), không ghi đè. |
| **Đơn nghỉ duyệt ngược quá khứ** | Duyệt đơn nghỉ ngày 01 vào ngày 20. | Tính lại `AttendanceDaily` từ ngày 01 (`ADR-08`). |
| **Múi giờ** | Server chạy UTC, công ty ở Asia/Ho_Chi_Minh. | Lưu UTC trong DB, mọi phép tính "ngày làm việc" đều quy đổi theo timezone của công ty. **Bắt buộc dùng thư viện có timezone** (Luxon / date-fns-tz), không tự cộng trừ giờ. |
| **Ngày lễ trùng cuối tuần** | 30/04 rơi vào Chủ nhật → nghỉ bù thứ Hai. | Danh mục ngày lễ hỗ trợ ngày nghỉ bù, hệ số áp dụng theo ngày gốc hay ngày bù cần cấu hình. |
| **Phân ca chồng chéo** | Một nhân viên bị gán 2 ca trùng khung giờ trong cùng ngày (VD vừa Ca hành chính vừa Ca đêm ngày 05). | Khi "Thiết lập ca áp dụng" (8.2) ghi đè, phải chặn hoặc cảnh báo nếu khung giờ hai ca giao nhau trong cùng `workDate`. |
| **Xoá nhân viên khỏi phân ca giữa tháng** | Xoá ngày 20, nhưng công đã chấm ngày 01–19 vẫn phải giữ nguyên. | Xoá khỏi bảng phân ca chỉ dừng áp lịch **từ thời điểm xoá trở đi**, không xoá `AttendanceDaily` đã phát sinh. |

### 6.6. Danh mục ca (`FR-GDW-POL-12`)

Màn **Ca làm & Phân ca → tab "Danh mục Ca làm việc"** (`/shifts?tab=catalog`).

> **Đã chuyển chỗ.** Trước đây danh mục ca là một tab của trang **Thiết lập**, tách khỏi màn Phân ca. Khai ca và xếp ca là một mạch việc — mở bảng phân ca ra mới phát hiện thiếu ca đêm — nên hai nửa nay nằm cạnh nhau trong cùng một màn hai tab. Đường dẫn cũ `/policy?tab=shifts` được chuyển hướng sang màn mới. Quyền không đổi: đọc danh mục cần `shift_template.view` (hoặc `policy.view`), sửa cần `shift_template.update` (hoặc `policy.update`), còn xếp lịch vẫn là `shift.assign`.

Một bản ghi ca gồm ba nhóm thông tin:

**Nhận dạng**

| Trường | Ghi chú |
|---|---|
| Tên ca | "Hành chính", "Ca đêm" |
| **Mã ca** | Duy nhất trong công ty, tự chuẩn hoá về chữ HOA |
| Ký hiệu chấm công | Ký tự in trên bảng công (`X`, `Đ`). **Không** cần duy nhất — nhiều ca vẫn có thể cùng ký hiệu |
| Phòng ban áp dụng | Rỗng = mọi phòng ban. **Chỉ lọc gợi ý ở màn Phân ca, không chặn** |

**Giờ giấc và chấm công**

| Trường | Ghi chú |
|---|---|
| Giờ bắt đầu / kết thúc ca | `HH:mm` theo timezone công ty |
| Nghỉ giữa ca | Bật/tắt. Bật thì khai giờ bắt đầu và kết thúc nghỉ; khoảng nghỉ phải **nằm trong** giờ ca |
| **Số giờ công** | **Chỉ đọc** — bằng giờ ca trừ giờ nghỉ. Không lưu trong database, luôn tính lại từ giờ ca |
| Yêu cầu chấm vào | **Luôn bắt buộc** (BR-ATT-02). Kèm khung giờ chấm vào hợp lệ |
| Yêu cầu chấm ra | Tắt được — cho ca chỉ điểm danh đầu giờ (đào tạo, họp). Kèm khung giờ chấm ra |

> **Vì sao chấm vào không tắt được.** Không có giờ vào thì không có gì để tính giờ công, và ngày đó rơi vào nhóm "thiếu bản ghi" trên bảng công chứ không phải "đi làm đủ". Một ca cho phép tắt chấm vào là một ca luôn sinh ra ngày công sai. Chấm **ra** thì khác: ca điểm danh đầu giờ là nhu cầu có thật.

**Ngày công và hệ số**

| Trường | Ghi chú |
|---|---|
| Số ngày công | Ca này được tính bao nhiêu ngày công. Nửa buổi = `0.5` |
| Hệ số ngày thường / nghỉ tuần / ngày lễ | Nhân vào số ngày công theo tính chất của ngày |
| Hệ số riêng từng ngày lễ | Ngoại lệ cho một ngày lễ cụ thể. Không khai = dùng hệ số ngày lễ chung |

> ⚠ **Hệ số ngày công hiện CHƯA được máy tính công đọc tới.** Chúng được lưu, hiển thị và kiểm tra hợp lệ, nhưng bảng công và kỳ lương chưa dùng — sửa hệ số không làm đổi bất kỳ số liệu nào. Giao diện có ghi rõ điều này ngay tại chỗ nhập. Khi nối vào engine cần rà quan hệ với **hệ số OT 150/200/300%** (`FR-GDW-POL-05`) để một ngày lễ không bị nhân hệ số hai lần.

> **Hệ số riêng từng ngày lễ gắn với `holidayId`, không gắn với ngày.** Ngày lễ có thể được dời khi trùng cuối tuần; gắn theo ngày thì ngoại lệ ở lại ô lịch cũ còn ngày lễ đã đi chỗ khác.

**Mã ca và phiên bản hoá.** Ràng buộc duy nhất của mã ca chỉ tính trên các bản **còn mở** (`effectiveTo` rỗng). Phải vậy vì bẫy "đổi cấu hình ca giữa tháng" ở 6.4: đổi giờ một ca đã phân sẽ đóng bản hiện tại rồi mở bản kế nhiệm mang **cùng mã**. Ca xoá mềm vẫn giữ mã của nó — mã đó đã nằm trên bảng công đã in ra, cho dùng lại là để hai kỳ lương mang cùng một mã với hai ý nghĩa khác nhau.

---


---

## 7. Thiết lập phân ca (`FR-GDW-SHIFT`)

| Mã | Yêu cầu |
|---|---|
| `FR-GDW-SHIFT-01` | Phân ca theo cá nhân, phòng ban, nhóm; theo ngày, tuần, tháng hoặc chu kỳ lặp |
| `FR-GDW-SHIFT-02` | Copy lịch tuần trước, import Excel, phân ca hàng loạt |
| `FR-GDW-SHIFT-03` | Kiểm tra xung đột ca, **thời gian nghỉ tối thiểu giữa hai ca**, lịch nghỉ đã duyệt, nhân viên nghỉ việc/tạm khoá |
| `FR-GDW-SHIFT-04` | Phân ca sau khi nhân viên đã chấm công phải **cảnh báo** vì có thể đổi kết quả timesheet. Đổi hồi tố bắt buộc lý do + audit |
| `FR-GDW-SHIFT-05` | Quản lý có thể được **uỷ quyền phân ca trong scope** nhưng không sửa mẫu ca — xem [03 mục 7](./03-nghiep-vu-app-quan-ly.md#7-phân-ca-được-uỷ-quyền-fr-mgr-shift--tuỳ-chọn) |

---

## 8. Văn phòng, geofence & thiết bị (`FR-GDW-GEO`)

| Mã | Yêu cầu | Ưu tiên |
|---|---|---|
| `FR-GDW-GEO-01` | Quản lý danh sách văn phòng/chi nhánh và toạ độ geofencing | Must |
| `FR-GDW-GEO-02` | Cấu hình bán kính cho phép và GPS accuracy tối đa theo từng văn phòng | Must |
| `FR-GDW-GEO-03` | Chính sách ngoài vùng: chặn / cảnh báo / cho chấm và chờ duyệt | Must |
| `FR-GDW-GEO-04` | Ngoại lệ geofence cho đơn công tác đã duyệt | Must |
| `FR-GDW-GEO-05` | Xem danh sách thiết bị đã liên kết với từng nhân viên, thu hồi liên kết | Must |
| `FR-GDW-GEO-06` | Chính sách thiết bị: số thiết bị/tài khoản, có bắt buộc device binding, xử lý root/jailbreak | Must |
| `FR-GDW-GEO-07` | Wi-Fi BSSID / Bluetooth beacon tham chiếu nếu tenant cần xác thực tại chỗ nhiều lớp | Could (GĐ 3) |
| `FR-GDW-GEO-08` | Quản lý thiết bị chấm công vật lý tại văn phòng | Could (GĐ 3) |

> **Mã mời đã bỏ.** Các yêu cầu `FR-WEB-INV-01`…`03` (tạo/thu hồi/giới hạn mã
> mời) trong bản v1.0 không còn hiệu lực — nhân viên được Kế toán cấp tài khoản
> trực tiếp. Xem [01 mục 11](./01-tong-quan-he-thong.md#11-cấp-tài-khoản-và-gia-nhập-công-ty).

### 8.1. Quản lý geofence

```
Chi nhánh: Văn phòng Hà Nội
  ├─ Địa chỉ: 123 Trần Duy Hưng, Cầu Giấy
  ├─ Toạ độ:  21.0123, 105.7987   [Chọn trên bản đồ]
  ├─ Bán kính cho phép: 100m       [Slider 50–500m]
  ├─ GPS accuracy tối đa: 50m      [Vượt ngưỡng → từ chối lượt chấm]
  └─ Chính sách ngoài vùng: [Chặn ▾] / Cảnh báo / Cho chấm & chờ duyệt
```

> **Lưu ý thực tế:** GPS trong nhà/toà nhà cao tầng có sai số 20–50m. Bán kính
> quá nhỏ (< 50m) gây nhiều báo động giả. Khuyến nghị khởi điểm **100m** và điều
> chỉnh theo dữ liệu thực tế.

### 8.2. Quản lý thiết bị liên kết

```
Nhân viên: Nguyễn Văn Đức (ducnv.amobi)

┌──────────────────┬─────────────┬─────────────────┬──────────┬─────────────┐
│ Thiết bị         │ Hệ điều hành│ Liên kết lúc    │ Lần cuối │ Hành động   │
├──────────────────┼─────────────┼─────────────────┼──────────┼─────────────┤
│ iPhone 14        │ iOS 17.5    │ 01/08/2026 09:12│ Hôm nay  │ [Thu hồi]   │
└──────────────────┴─────────────┴─────────────────┴──────────┴─────────────┘

⚠ Chính sách: mỗi tài khoản chỉ 1 thiết bị hoạt động tại 1 thời điểm (BR-11)
   Đổi thiết bị cần: xác thực lại + [☑ Yêu cầu Kế toán duyệt]
```

---

## 9. Cấu hình luồng duyệt (`FR-GDW-FLOW`)

Workflow phải cấu hình được theo **loại đơn, người gửi, phòng ban và cấp bậc**.
Không hard-code duy nhất "Quản lý → HR".

| Ví dụ | Luồng đề xuất |
|---|---|
| Nhân viên nghỉ phép | Quản lý trực tiếp → *(tuỳ chọn)* Giám đốc nếu số ngày vượt ngưỡng |
| Nhân viên bổ sung công | Quản lý → Kế toán xác nhận số liệu, hoặc theo chính sách ngược lại |
| Quản lý nghỉ phép | Giám đốc/Owner |
| Kế toán mở lại kỳ | Giám đốc/Owner |
| OT chi phí cao | Quản lý → Giám đốc nếu vượt số giờ/ngưỡng tiền |

| Mã | Quy tắc |
|---|---|
| `FR-GDW-FLOW-01` | **Workflow lưu phiên bản.** Đơn đã gửi dùng snapshot workflow tại thời điểm gửi (`BR-16`) |
| `FR-GDW-FLOW-02` | Hỗ trợ **fallback approver** khi người duyệt nghỉ việc/vắng mặt |
| `FR-GDW-FLOW-03` | Uỷ quyền duyệt tạm thời theo thời gian, ghi rõ **người uỷ quyền / người nhận / hiệu lực** |
| `FR-GDW-FLOW-04` | Mọi luồng phải thoả `BR-14` — không có nhánh nào dẫn tới người duyệt là chính người gửi |

Chi tiết trạng thái đơn: [08 — Luồng xuyên phân hệ](./08-luong-xuyen-phan-he-va-ma-tran-quyen.md).

---

## 10. Phân quyền theo module & phạm vi (`FR-GDW-ROLE`)

| Module | Quyền ví dụ | Scope ví dụ |
|---|---|---|
| **Nhân sự** | `view` / `create` / `update` / `terminate` | `DEPARTMENT` · `COMPANY` |
| **Chấm công** | `view` / `adjust` / `review_suspicious` | `TEAM` · `COMPANY` |
| **Đơn từ** | `view` / `approve` / `configure_flow` | `TEAM` · `COMPANY` |
| **Tính công** | `calculate` / `adjust` / `submit_lock` / `reopen` | `COMPANY` |
| **Ca** | `view` / `template_manage` / `assign` | `TEAM` · `COMPANY` |
| **Chính sách** | `view` / `update` | `COMPANY` |
| **Báo cáo** | `view` / `export` | `DEPARTMENT` · `COMPANY` |
| **Phân quyền** | `role_view` / `role_assign` / `owner_assign` | `COMPANY` |

| Mã | Quy tắc |
|---|---|
| `FR-GDW-ROLE-01` | Giám đốc tạo được vai trò tuỳ biến: "Trưởng chi nhánh", "HR Viewer", "Kế toán công", "Quản lý ca" |
| `FR-GDW-ROLE-02` | Khi cấp role cho nhân viên **phải chọn scope dữ liệu**. Cùng role "Quản lý": người A chỉ xem Phòng Kinh doanh, người B xem toàn Chi nhánh HN |
| `FR-GDW-ROLE-03` | Quyền có **ngày bắt đầu/kết thúc** để hỗ trợ uỷ quyền tạm thời; hết hạn tự thu hồi |
| `FR-GDW-ROLE-04` | Người cấp quyền phải có quyền **cao hơn hoặc đủ quyền grant** — kiểm tra ở Backend (`BR-13`) |
| `FR-GDW-ROLE-05` | Mọi thay đổi phân quyền ghi audit log kèm before/after (`BR-08`) |

---

## 11. Quyền Owner công ty (`FR-GDW-OWNER`)

Owner là quyền cao nhất **trong tenant**. Có thể cấp cho một tài khoản nhân viên
theo yêu cầu quản trị doanh nghiệp, nhưng cần kiểm soát chặt để tránh mất quyền
quản trị.

| Quy tắc Owner | Đề xuất |
|---|---|
| **Cấp Owner** | Chỉ Owner hiện tại hoặc tài khoản được platform xác nhận mới cấp được; yêu cầu xác thực mạnh (`BR-18`) |
| **Nhiều Owner** | Cho phép nhiều Owner để dự phòng |
| **Owner cuối cùng** | **Không cho tự thu hồi/xoá** nếu sẽ làm tenant không còn Owner (`BR-15`) |
| **Chuyển Owner** | Quy trình transfer: chọn người nhận → xác nhận → log → thông báo cho các Owner khác |
| **Phạm vi quyền Owner** | Toàn bộ cấu hình tenant, phân quyền, kỳ công, dữ liệu doanh nghiệp. **Không có quyền platform** |

> **Owner ≠ Platform Admin.** Đây là lỗi thiết kế dễ mắc nhất khi thi công RBAC.
> Owner là đỉnh của một tenant; Platform Admin ở tầng SaaS và không có quyền
> nghiệp vụ trong tenant trừ Support Access Mode có kiểm soát. Xem
> [07 mục 12](./07-nghiep-vu-web-platform-admin.md).

---

## 12. Nhật ký cấu hình & kiểm soát thay đổi (`FR-GDW-LOG`)

| Mã | Yêu cầu |
|---|---|
| `FR-GDW-LOG-01` | Log **before/after** với các thay đổi: chính sách, ca, phân ca hồi tố, geofence, workflow, role, Owner |
| `FR-GDW-LOG-02` | Lọc theo người thao tác, module, thời gian, đối tượng bị thay đổi |
| `FR-GDW-LOG-03` | **Không cho xoá audit log từ Web Giám đốc.** Thời gian lưu theo chính sách platform/gói dịch vụ |
| `FR-GDW-LOG-04` | Xuất nhật ký cho kiểm toán nội bộ |

---

## 13. Tiêu chí nghiệm thu

| Nhóm | Tiêu chí |
|---|---|
| Hiệu lực theo thời gian | Thay policy/ca/quyền đều có ngày hiệu lực và audit; kỳ đã chốt không đổi số khi sửa cấu hình hiện tại |
| Scope | Cấp scope chính xác; cùng một role với hai scope khác nhau cho ra hai tập dữ liệu khác nhau |
| Owner | Không thao tác nào làm tenant mất Owner cuối cùng |
| Workflow | Đơn đang chờ không đổi người duyệt khi workflow được sửa |
| Tách phân hệ | Tài khoản Kế toán không truy cập được route cấu hình chính sách, kể cả gọi thẳng API |
| Đồng bộ App/Web | Cùng một item phê duyệt cho cùng trạng thái ở cả hai kênh |

---

**Tiếp theo:** [07 — Nghiệp vụ Web Quản trị nền tảng](./07-nghiep-vu-web-platform-admin.md)
