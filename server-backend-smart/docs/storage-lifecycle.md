# Lifecycle rule trên bucket — lưới an toàn cho chính sách lưu trữ

> Đây là **lớp thứ hai**. Lớp thứ nhất là `RetentionProcessor` chạy hằng đêm.
> Liên quan: `NFR-LEGAL-04` · `NFR-SCALE-07` · `docs/09` mục 6

---

## Vì sao cần hai lớp

| Lớp | Ai chạy | Vai trò |
|---|---|---|
| **1. Job nền** | `RetentionProcessor`, 05:00 mỗi ngày | Xoá **chính xác theo chính sách từng công ty** |
| **2. Lifecycle rule** | Chính nhà cung cấp lưu trữ | **Trần cứng** — chạy kể cả khi ứng dụng chết |

Bucket không đọc được `CompanyPolicy` nên không biết công ty A giữ 30 ngày còn
công ty B giữ 365 ngày. Vì vậy lớp 1 lo phần chính xác.

Nhưng lớp 1 là code — nó hỏng được, và hỏng lặng lẽ. Worker không chạy, Redis
mất kết nối, job ném lỗi rồi retry hết lượt: không ai nhận ra trong nhiều tháng.
Lớp 2 chạy trong hạ tầng của nhà cung cấp, không phụ thuộc vào việc hệ thống của
bạn có khoẻ hay không.

> ⚠ **Trần cứng phải DÀI HƠN chính sách ứng dụng.** Đặt lifecycle 30 ngày trong
> khi một công ty cấu hình giữ 90 ngày thì bucket sẽ xoá mất ảnh mà ứng dụng
> vẫn tưởng còn — và đường `GET /v1/attendance/{id}` sẽ trả URL trỏ tới đối
> tượng không tồn tại.
>
> Trần cứng là **lưới hứng**, không phải chính sách. Đặt nó ở mức không khách
> hàng nào được phép vượt.

---

## Bốn tiền tố, bốn quy tắc

| Tiền tố | Chính sách ứng dụng | Trần cứng đề xuất |
|---|---|---|
| `attendance/` | `privacy.attendancePhotoRetentionDays` (90) | **400 ngày** |
| `face-profile/` | Xoá khi hồ sơ bị thu hồi + `deleteBiometricDelayDays` (90) | **Không đặt** — xem dưới |
| `exports/` | `privacy.exportFileRetentionDays` (7) | **30 ngày** |
| `requests/` | Chưa có | **Không đặt** — xem dưới |

### Vì sao `face-profile/` KHÔNG đặt lifecycle theo tuổi

Ảnh hồ sơ khuôn mặt của nhân viên đang làm việc phải sống **mãi mãi**. Nhân viên
vào công ty năm 2020 và vẫn đang làm thì hồ sơ đăng ký từ 2020 vẫn là thứ dùng
để so khớp mỗi ngày.

Đặt lifecycle theo tuổi ở đây sẽ **xoá hồ sơ đang dùng** và nhân viên đó không
chấm công được nữa. Việc dọn hồ sơ đã thu hồi do job xử lý, vì chỉ job mới biết
hồ sơ nào còn `ACTIVE`.

### Vì sao `requests/` chưa đặt

Giấy khám bệnh, đơn xin nghỉ có chữ ký là **hồ sơ lao động** theo `NFR-LEGAL-08`,
không phải dữ liệu sinh trắc học. Thời hạn lưu do quy định về lưu trữ chứng từ
quyết định, không phải Nghị định 13.

Đặt bừa một con số ở đây có thể xoá mất bằng chứng cho một vụ tranh chấp lao
động. **Cần bộ phận pháp chế chốt số năm trước khi đặt rule.**

---

## Đặt rule trên bucket Firebase

Bucket của Cloud Storage for Firebase là bucket Google Cloud Storage bình thường,
nên dùng `gcloud storage` (hoặc `gsutil`) của chính dự án Firebase:

```bash
gcloud auth activate-service-account --key-file=<service-account.json>
gcloud config set project <FIREBASE_PROJECT_ID>

export BUCKET=<FIREBASE_PROJECT_ID>.firebasestorage.app   # dự án cũ: .appspot.com
```

Tạo file `lifecycle.json`:

```json
{
  "lifecycle": {
    "rule": [
      {
        "action": { "type": "Delete" },
        "condition": {
          "age": 400,
          "matchesPrefix": ["attendance/"]
        }
      },
      {
        "action": { "type": "Delete" },
        "condition": {
          "age": 30,
          "matchesPrefix": ["exports/"]
        }
      },
      {
        "action": { "type": "AbortIncompleteMultipartUpload" },
        "condition": { "age": 7 }
      }
    ]
  }
}
```

```bash
gcloud storage buckets update "gs://$BUCKET" --lifecycle-file=lifecycle.json

# Kiểm lại
gcloud storage buckets describe "gs://$BUCKET" --format="json(lifecycle_config)"
```

### Rule thứ ba làm gì

`AbortIncompleteMultipartUpload` dọn các lượt tải lên dở dang. `StorageService`
đặt `resumable: false` nên ảnh chấm công không sinh ra loại rác này, nhưng file
export lớn hoặc một client khác ghi vào cùng bucket thì có. Tải lên hỏng giữa
chừng để lại phần đã ghi mà **không hiện ra trong danh sách đối tượng** — bạn bị
tính tiền cho thứ không nhìn thấy.

---

## ⚠ Bucket phải để riêng tư

Lifecycle chỉ lo chuyện xoá đúng hạn. Thứ dễ quên hơn là quyền đọc: `NFR-SEC-12`
đòi ảnh **không** có URL công khai.

Hai chốt phải kiểm cùng lúc:

| Chốt | Kiểm ở đâu | Giá trị đúng |
|---|---|---|
| Security Rules (client Firebase SDK) | Firebase Console → Storage → Rules | `allow read, write: if false;` |
| IAM công khai (truy cập trực tiếp GCS) | `gcloud storage buckets get-iam-policy "gs://$BUCKET"` | Không có `allUsers` / `allAuthenticatedUsers` |

Backend truy cập bằng service account nên **không** đi qua Security Rules —
khoá sạch Rules không làm hỏng luồng nào của hệ thống.

Ngoài ra không được gọi `file.makePublic()` hay `getDownloadURL()` ở bất kỳ đâu:
download token của Firebase là link **vĩnh viễn**, đúng thứ mà `NFR-SEC-12` cấm.
Chỉ dùng `StorageService.getPresignedUrl` (signed URL V4, TTL ≤ 5 phút).

---

## Kiểm chứng sau khi đặt

1. **Đọc lại rule** bằng `gcloud storage buckets describe` — xác nhận đúng
   những gì vừa gửi.

2. **Đối chiếu trần cứng với chính sách công ty lớn nhất:**
   ```sql
   SELECT c.name, cp.value
   FROM company_policy cp
   JOIN company c ON c.id = cp.company_id
   WHERE cp.key = 'privacy.attendancePhotoRetentionDays'
   ORDER BY (cp.value)::int DESC
   LIMIT 5;
   ```
   Giá trị lớn nhất **phải nhỏ hơn** 400. Nếu có công ty cấu hình 500 ngày thì
   trần cứng đang xoá mất ảnh của họ.

3. **Chờ một chu kỳ** rồi kiểm số đối tượng theo tiền tố:
   ```bash
   gcloud storage ls --recursive "gs://$BUCKET/attendance/**" | wc -l
   ```
   Lifecycle của GCS chạy bất đồng bộ, có thể mất tới 24 giờ mới thấy tác dụng.
   Không thấy ngay không có nghĩa là rule sai.

---

## Khi khách hàng yêu cầu xoá dữ liệu (`NFR-LEGAL-03`)

Lifecycle rule **không thay thế** được quyền được quên. Người lao động yêu cầu
xoá dữ liệu sinh trắc học thì phải xoá ngay, không chờ hết hạn lưu.

Đường đó đi qua `StorageService.deleteMany` từ tầng ứng dụng, không phải qua
lifecycle. Xem `BiometricService.resetForEmployee`.
