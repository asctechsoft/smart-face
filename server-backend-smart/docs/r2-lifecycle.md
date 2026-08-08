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

## Đặt rule trên Cloudflare R2

R2 hỗ trợ lifecycle qua S3 API. Dùng `aws` CLI trỏ vào endpoint R2:

```bash
aws configure set aws_access_key_id     <R2_ACCESS_KEY_ID>
aws configure set aws_secret_access_key <R2_SECRET_ACCESS_KEY>

export R2=https://<account-id>.r2.cloudflarestorage.com
```

Tạo file `lifecycle.json`:

```json
{
  "Rules": [
    {
      "ID": "attendance-photos-hard-ceiling",
      "Status": "Enabled",
      "Filter": { "Prefix": "attendance/" },
      "Expiration": { "Days": 400 }
    },
    {
      "ID": "export-files",
      "Status": "Enabled",
      "Filter": { "Prefix": "exports/" },
      "Expiration": { "Days": 30 }
    },
    {
      "ID": "abort-incomplete-uploads",
      "Status": "Enabled",
      "Filter": { "Prefix": "" },
      "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 7 }
    }
  ]
}
```

```bash
aws s3api put-bucket-lifecycle-configuration \
  --endpoint-url "$R2" \
  --bucket smartface \
  --lifecycle-configuration file://lifecycle.json

# Kiểm lại
aws s3api get-bucket-lifecycle-configuration --endpoint-url "$R2" --bucket smartface
```

### Rule thứ ba làm gì

`AbortIncompleteMultipartUpload` dọn các lượt tải lên dở dang. Upload ảnh 400 KB
không dùng multipart nên hiếm khi phát sinh, nhưng job xuất Excel file lớn thì
có. Tải lên hỏng giữa chừng để lại phần đã ghi mà **không hiện ra trong danh
sách đối tượng** — bạn bị tính tiền cho thứ không nhìn thấy.

---

## Với AWS S3 và Google Cloud Storage

Lệnh giống hệt, chỉ đổi `--endpoint-url`:

```bash
# AWS S3 — bỏ hẳn --endpoint-url
aws s3api put-bucket-lifecycle-configuration --bucket smartface --lifecycle-configuration file://lifecycle.json

# GCS qua chế độ tương thích S3
export GCS=https://storage.googleapis.com
aws s3api put-bucket-lifecycle-configuration --endpoint-url "$GCS" --bucket smartface --lifecycle-configuration file://lifecycle.json
```

---

## Kiểm chứng sau khi đặt

1. **Đọc lại rule** bằng `get-bucket-lifecycle-configuration` — xác nhận đúng
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
   aws s3 ls --endpoint-url "$R2" s3://smartface/attendance/ --recursive --summarize | tail -3
   ```
   Lifecycle của R2/S3 chạy bất đồng bộ, có thể mất tới 24–48 giờ mới thấy tác
   dụng. Không thấy ngay không có nghĩa là rule sai.

---

## Khi khách hàng yêu cầu xoá dữ liệu (`NFR-LEGAL-03`)

Lifecycle rule **không thay thế** được quyền được quên. Người lao động yêu cầu
xoá dữ liệu sinh trắc học thì phải xoá ngay, không chờ hết hạn lưu.

Đường đó đi qua `StorageService.deleteMany` từ tầng ứng dụng, không phải qua
lifecycle. Xem `BiometricService.resetForEmployee`.
