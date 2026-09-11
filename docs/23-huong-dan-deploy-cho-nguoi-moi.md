# 23 — Hướng dẫn deploy SmartFace lên VPS cho người mới

> Tài liệu này dẫn bạn từng bước — **vào đâu, bấm gì, gõ lệnh gì, thấy gì là đúng** —
> để đưa toàn bộ SmartFace (giao diện web, backend, AI nhận diện khuôn mặt, cơ sở
> dữ liệu) lên một máy chủ ảo (VPS). Không cần biết Docker hay Linux từ trước.
>
> Muốn hiểu **vì sao** hệ thống được dựng như vậy: [22-huong-dan-deploy-vps.md](./22-huong-dan-deploy-vps.md).

---

## Trước khi bắt đầu

### Ký hiệu trong tài liệu

| Ký hiệu | Nghĩa |
|---|---|
| 🌐 | Làm trên **trình duyệt web** (Chrome, Edge…) |
| 💻 | Gõ lệnh trong **PowerShell trên máy Windows của bạn** |
| 🖥️ | Gõ lệnh **trên VPS** (sau khi đã đăng nhập bằng `ssh`, dấu nhắc có dạng `root@...:~#`) |
| `<ten-mien>` | Tên miền bạn dùng, ví dụ `smartface.congty.vn`. **Thay cả dấu `<` `>`** — gõ `smartface.congty.vn`, không gõ `<smartface.congty.vn>` |
| ✅ Đúng khi | Kết quả bạn phải thấy. Không thấy → dừng lại, tra [Phần I](#phần-i--lỗi-thường-gặp) |

Cách **dán** trong cửa sổ PowerShell / terminal: **bấm chuột phải** (không phải Ctrl+V).

### Thông tin của hệ thống này

| Thông tin | Giá trị |
|---|---|
| IP của VPS | `76.13.16.235` — nếu dùng VPS khác, thay số này ở **mọi** lệnh bên dưới |
| Tài khoản VPS | `root` |
| Thư mục cài đặt trên VPS | `/opt/smartface` |
| Mã nguồn | `https://github.com/asctechsoft/smart-face` — nhánh `main` |

### Bạn cần có sẵn

- [ ] **Mật khẩu `root` của VPS** — nhà cung cấp VPS gửi qua email khi mua.
- [ ] **Một tên miền** và quyền vào trang quản lý tên miền (nơi đã mua).
- [ ] **Tài khoản Cloudflare** (miễn phí) — tạo ở `https://dash.cloudflare.com/sign-up`.

> **Chưa có tên miền hoặc Cloudflare?** Vẫn chạy được **backend trước** trên IP của VPS — làm theo [Phụ lục 4](#phụ-lục-4--chưa-có-tên-miền-chạy-backend-trước), có tên miền rồi chuyển sang chế độ đầy đủ bằng một lệnh.
- [ ] **Quyền Owner/Editor trên dự án Firebase** của SmartFace.
- [ ] **Quyền Admin trên repo GitHub** (chỉ cần cho [Phần G](#phần-g--bật-deploy-tự-động)).
- [ ] **Thư mục model AI** `server-ai-smart/models` — hỏi lập trình viên, nó không có trong GitHub vì nặng khoảng 600 MB.
- [ ] Khoảng **2–3 giờ** cho lần đầu. Phần lớn là chờ.

### Bức tranh tổng thể — đọc 2 phút

```
 Người dùng (web + app mobile)
        │  https://<ten-mien>
        ▼
   Cloudflare  ── cấp HTTPS miễn phí, giấu IP thật của VPS, chặn tấn công
        │
        ▼
 ┌────────────── VPS 76.13.16.235 ──────────────────────────────┐
 │  web (nginx)   ← thứ DUY NHẤT nhận kết nối từ internet        │
 │   ├─ /        → giao diện web (React)                         │
 │   └─ /v1/     → api (backend NestJS)                          │
 │                   ├─ postgres  (cơ sở dữ liệu)                │
 │                   ├─ redis     (hàng đợi, bộ nhớ tạm)         │
 │                   └─ ai-server (nhận diện khuôn mặt)          │
 │                 worker (việc chạy nền: tính công ban đêm…)    │
 └───────────────────────────────────────────────────────────────┘
        Firebase (bên ngoài): giữ mật khẩu đăng nhập + lưu ảnh
```

Ba điều cần nhớ suốt quá trình:

1. **VPS lấy code từ GitHub, không phải từ máy bạn.** Code sửa trên máy mà chưa `git push` thì VPS không thấy.
2. **Chỉ 3 thứ phải mang lên VPS bằng tay**, vì chúng không được (hoặc không thể) nằm trong GitHub: file cấu hình bí mật `.env`, chứng chỉ HTTPS, và model AI.
3. **Mọi thứ chạy trong Docker.** Bạn không cài Node, Python hay Postgres lên VPS — Docker tự tải và dựng từng phần theo file `docker-compose.prod.yml` có sẵn trong code.

### Lộ trình

| Phần | Làm gì | Ở đâu | Thời gian |
|---|---|---|---|
| [A](#phần-a--cloudflare-tên-miền-và-https) | Tên miền, Cloudflare, chứng chỉ HTTPS | 🌐 | 20–40 phút + chờ DNS |
| [B](#phần-b--firebase) | Lấy khoá Firebase, cấu hình đăng nhập và lưu ảnh | 🌐 | 15 phút |
| [C](#phần-c--kết-nối-vào-vps-lần-đầu) | Tạo SSH key, đăng nhập VPS | 💻 | 10 phút |
| [D](#phần-d--chuẩn-bị-vps) | Cài Docker, tường lửa, tải code | 🖥️ | 15 phút |
| [E](#phần-e--đưa-cấu-hình-bí-mật-lên-vps) | Tạo `.env`, chứng chỉ, model AI | 💻 🖥️ | 20 phút |
| [F](#phần-f--chạy-lần-đầu) | Build, chạy, tạo quản trị viên, mở web | 🖥️ | 30–40 phút (chủ yếu chờ) |
| [G](#phần-g--bật-deploy-tự-động) | Deploy tự động mỗi lần push code | 🌐 🖥️ | 10 phút |
| [H](#phần-h--vận-hành-hằng-ngày) | Cập nhật, xem log, sao lưu | 🖥️ | — |

---

## Phần A — Cloudflare, tên miền và HTTPS

### A1. Tên miền là gì, record A là gì

Máy tính chỉ biết kết nối tới **địa chỉ IP** (`76.13.16.235`), còn người dùng gõ **tên miền**. **DNS** là danh bạ ghi *"tên nào ở IP nào"*. **Record A** là một dòng trong danh bạ đó: *"`smartface.congty.vn` → `76.13.16.235`"*.

Cần tên miền vì: HTTPS (ổ khoá trên trình duyệt) chỉ cấp cho tên miền, Firebase chỉ cho đăng nhập từ tên miền đã khai, và khi đổi VPS bạn chỉ sửa IP trong record A — người dùng không phải biết gì.

- **Công ty đã có tên miền** (ví dụ `congty.vn`): dùng tên miền con như `smartface.congty.vn`, không phải mua thêm.
- **Chưa có:** mua ở nhà cung cấp tên miền (Mắt Bão, PA Việt Nam, Tenten, Namecheap…). Bước này ngoài phạm vi tài liệu.

### A2. Đưa tên miền vào Cloudflare

> Làm **một lần cho mỗi tên miền**. Nếu tên miền đã nằm trong Cloudflare (thấy nó trong danh sách khi đăng nhập), **bỏ qua, sang A3**.
>
> Tên nút trên giao diện Cloudflare có thể hơi khác theo thời gian; ý nghĩa thì giữ nguyên.

1. 🌐 Vào `https://dash.cloudflare.com` → đăng nhập.
2. Bấm **Add a domain** (hoặc **Onboard a domain**).
3. Ô tên miền: gõ tên miền **gốc**, ví dụ `congty.vn` (không có `smartface.`, không có `https://`). Chọn **Quick scan for DNS records** → **Continue**.
4. Chọn gói **Free** → **Continue**.
5. Cloudflare hiện danh sách record DNS nó quét được từ nhà cung cấp cũ.
   > ⚠ Nếu tên miền đang chạy website hoặc **email công ty**, kiểm tra danh sách có đủ các record cũ, đặc biệt record loại **MX** (dùng cho email). Thiếu record nào thì dịch vụ đó ngừng chạy sau bước 7.

   Bấm **Continue**.
6. Cloudflare đưa ra **2 nameserver**, dạng `xxx.ns.cloudflare.com` và `yyy.ns.cloudflare.com`. Giữ tab này.
7. Mở tab mới → vào trang quản lý tên miền ở **nơi bạn đã mua** → tìm mục **Nameserver** / **DNS server** / **Máy chủ tên miền** → chọn dùng nameserver **tùy chỉnh** → xoá các nameserver cũ, điền 2 nameserver của Cloudflare → Lưu.
8. Quay lại tab Cloudflare → bấm **Check nameservers now** (hoặc **Done, check nameservers**).

✅ **Đúng khi:** Cloudflare gửi email *"… is now active on Cloudflare"*, hoặc trang tổng quan của tên miền ghi **Active**. Thường mất vài phút đến vài giờ, lâu nhất 24 giờ. **Trong lúc chờ, làm tiếp [Phần B](#phần-b--firebase) và [Phần C](#phần-c--kết-nối-vào-vps-lần-đầu).**

### A3. Tạo record A trỏ về VPS

1. 🌐 Cloudflare → bấm vào tên miền → menu trái **DNS** → **Records** → **Add record**.
2. Điền:

   | Ô | Điền | Giải thích |
   |---|---|---|
   | **Type** | `A` | Loại record trỏ tên miền về một địa chỉ IPv4 |
   | **Name** | `smartface` | Tạo ra `smartface.congty.vn`. Muốn dùng chính `congty.vn` thì điền `@` |
   | **IPv4 address** | `76.13.16.235` | IP của VPS |
   | **Proxy status** | Bật — **đám mây màu cam** (Proxied) | Người dùng đi qua Cloudflare rồi mới tới VPS. **Bắt buộc** — xem ghi chú dưới |
   | **TTL** | `Auto` | Để mặc định |

3. Bấm **Save**.

> **Vì sao bắt buộc mây cam:** hệ thống được cấu hình để **chỉ nhận kết nối đi qua Cloudflare** (file `nginx/cloudflare-only.conf`). Để mây xám thì người dùng đi thẳng tới VPS và bị chặn với lỗi **403**. Đây là chủ đích: chốt "chỉ chấm công từ mạng văn phòng" chỉ chính xác khi mọi request đều đi qua Cloudflare.

✅ **Đúng khi:** 💻 mở PowerShell, gõ `nslookup smartface.congty.vn` (thay bằng tên miền của bạn) → trả về IP dạng `104.x.x.x` hoặc `172.67.x.x`.
Đó là IP của Cloudflare, **không phải** `76.13.16.235` — đúng như mong đợi, vì mây cam giấu IP thật. Báo `Non-existent domain` thì nameserver chưa có hiệu lực, chờ thêm.

### A4. Bật HTTPS ở chế độ an toàn nhất

1. 🌐 Cloudflare → tên miền → **SSL/TLS** → **Overview** → bấm **Configure** (hoặc chọn thẳng) → chọn **Full (strict)** → **Save**.
   > **Vì sao không chọn Flexible:** Flexible chỉ mã hoá đoạn *người dùng → Cloudflare*. Đoạn *Cloudflare → VPS* vẫn là HTTP trần — mật khẩu và ảnh khuôn mặt đi không mã hoá trên đoạn đó.
2. **SSL/TLS** → **Edge Certificates** → kéo xuống **Always Use HTTPS** → bật **On**.
3. **Network** → **WebSockets** → đảm bảo đang **On** (thông báo realtime cần nó).

### A5. Tạo chứng chỉ Origin cho VPS

Chứng chỉ này để Cloudflare và VPS nói chuyện bằng HTTPS. Nó miễn phí, hạn 15 năm, và chỉ Cloudflare tin nó (trình duyệt thì không — cũng không cần, vì trình duyệt chỉ nói chuyện với Cloudflare).

1. 🌐 **SSL/TLS** → **Origin Server** → **Create Certificate**.
2. Giữ nguyên các lựa chọn mặc định:
   - **Generate private key and CSR with Cloudflare**
   - Key type: **RSA (2048)**
   - Hostnames: `congty.vn` và `*.congty.vn` (dấu `*` phủ mọi tên miền con, gồm cả `smartface.congty.vn`)
   - Certificate Validity: **15 years**
3. Bấm **Create**.
4. Trang kết quả có **hai ô chữ**. Mở **Notepad**, dán lần lượt:
   - Ô **Origin Certificate** (bắt đầu `-----BEGIN CERTIFICATE-----`) → lưu thành `origin.pem`
   - Ô **Private Key** (bắt đầu `-----BEGIN PRIVATE KEY-----`) → lưu thành `origin.key`

   Chép **toàn bộ**, kể cả dòng `-----BEGIN…-----` và `-----END…-----`.

> ⚠ **Private Key chỉ hiện đúng một lần.** Đóng trang mà chưa lưu thì phải tạo lại chứng chỉ khác.
> ⚠ `origin.key` là bí mật. Không gửi qua chat, không đưa vào GitHub. Sau [bước E4](#e4-đặt-chứng-chỉ-https) thì xoá bản trên máy bạn.

---

## Phần B — Firebase

Firebase giữ **email + mật khẩu** của mọi người dùng và **lưu ảnh chấm công**. Backend không lưu mật khẩu.

🌐 Vào `https://console.firebase.google.com` → chọn dự án SmartFace.

### B1. Tải khoá quản trị (cho backend)

1. Bấm biểu tượng **⚙ bánh răng** cạnh chữ **Project Overview** (góc trên bên trái) → **Project settings**.
2. Chọn tab **Service accounts**.
3. Bấm **Generate new private key** → hộp thoại hỏi lại → **Generate key**.
4. Trình duyệt tải về một file tên dạng `smart-face-xxxxx-firebase-adminsdk-yyyyy-zzzzzzzzzz.json` (thường vào thư mục **Downloads**).

> ⚠ File này có **toàn quyền** với tài khoản người dùng và kho ảnh khuôn mặt. Không gửi qua chat/email, **tuyệt đối không đưa vào GitHub**. Sau [bước E2](#e2-tạo-file-env) thì xoá nó khỏi máy bạn.

### B2. Lấy cấu hình web app (cho giao diện web)

1. Vẫn ở **Project settings** → tab **General** → kéo xuống mục **Your apps**.
2. - **Đã có app loại Web** (biểu tượng `</>`): bấm vào nó.
   - **Chưa có:** bấm biểu tượng **`</>`** → ô *App nickname* gõ `SmartFace Web` → **không** tích *Firebase Hosting* → **Register app** → **Continue to console** → bấm lại vào app vừa tạo.
3. Ở mục **SDK setup and configuration**, chọn **Config**. Bạn thấy đoạn:

   ```js
   const firebaseConfig = {
     apiKey: "AIzaSy...",
     authDomain: "smart-face-xxxxx.firebaseapp.com",
     projectId: "smart-face-xxxxx",
     storageBucket: "smart-face-xxxxx.firebasestorage.app",
     messagingSenderId: "...",
     appId: "1:1234567890:web:abcdef..."
   };
   ```

4. Chép **3 giá trị** vào Notepad (chỉ phần trong dấu nháy): `apiKey`, `appId`, `storageBucket`. Chúng dùng ở [bước E3](#e3-điền-3-giá-trị-còn-thiếu).

> `apiKey` của Firebase **không phải bí mật** — nó chỉ định danh dự án, mọi quyền vẫn do backend quyết định.

### B3. Bật đăng nhập bằng email

1. Menu trái → **Build** → **Authentication** → tab **Sign-in method**.
2. Nếu **Email/Password** chưa ở trạng thái **Enabled**: bấm vào nó → bật công tắc **Email/Password** đầu tiên (không cần *Email link*) → **Save**.

### B4. Cho phép tên miền đăng nhập

1. **Authentication** → tab **Settings** → mục **Authorized domains** → **Add domain**.
2. Gõ `smartface.congty.vn` (tên miền của bạn, không có `https://`) → **Add**.

✅ **Đúng khi:** tên miền hiện trong danh sách cạnh `localhost`.
Thiếu bước này, trang đăng nhập báo lỗi `auth/unauthorized-domain`.

### B5. Khoá kho ảnh

1. Menu trái → **Build** → **Storage**.
   - Nếu thấy nút **Get started**: Storage chưa bật. Bấm và làm theo (chọn vị trí `asia-southeast1` cho gần Việt Nam). Firebase có thể yêu cầu nâng lên gói **Blaze** (trả theo mức dùng, có hạn mức miễn phí) — dự án tạo sau 10/2024 bắt buộc như vậy.
2. Tab **Files**: dòng phía trên danh sách file có dạng `gs://smart-face-xxxxx.firebasestorage.app`. Đối chiếu với `storageBucket` đã chép ở B2 — phải giống nhau (bỏ phần `gs://`).
3. Tab **Rules** → xoá hết nội dung trong khung → dán:

   ```
   rules_version = '2';
   service firebase.storage {
     match /b/{bucket}/o {
       match /{allPaths=**} { allow read, write: if false; }
     }
   }
   ```

4. Bấm **Publish**.

> **Vì sao khoá hết mà hệ thống vẫn lưu được ảnh:** backend dùng khoá quản trị (B1), đi vòng qua Rules. Rules chỉ chặn truy cập trực tiếp từ bên ngoài. Để mở là **ảnh khuôn mặt nhân viên ai cũng tải được**.

---

## Phần C — Kết nối vào VPS lần đầu

### C1. Mở PowerShell

💻 Bấm phím **Windows** → gõ `PowerShell` → bấm **Windows PowerShell**. Cửa sổ màu xanh/đen hiện ra với dấu nhắc `PS C:\Users\<tên>>`.

Kiểm tra máy đã có công cụ SSH:

```powershell
ssh -V
```

✅ **Đúng khi:** in ra `OpenSSH_for_Windows_...`.
Báo `not recognized`: vào **Settings** → **Apps** → **Optional features** → **Add a feature** → tìm **OpenSSH Client** → **Install**, rồi mở lại PowerShell.

### C2. Tạo SSH key — "chìa khoá" để vào VPS không cần mật khẩu

💻

```powershell
ssh-keygen -t ed25519 -C "smartface-deploy"
```

Máy hỏi 3 câu — **bấm Enter cả 3 lần**, không gõ gì:

| Câu hỏi | Bấm | Vì sao |
|---|---|---|
| `Enter file in which to save the key` | Enter | Dùng vị trí mặc định |
| `Enter passphrase (empty for no passphrase)` | Enter | Để trống — script deploy cần chạy tự động, không ai ngồi gõ mật khẩu |
| `Enter same passphrase again` | Enter | |

> Nếu máy báo `... already exists. Overwrite (y/n)?` → gõ **`n`** rồi Enter. Bạn đã có key, dùng luôn key đó.

✅ **Đúng khi:** in ra một hình vuông ký tự lạ (`+---[ED25519 256]---+`). Key nằm ở `C:\Users\<tên>\.ssh\`: file `id_ed25519` là **khoá riêng** (bí mật, không đưa ai), `id_ed25519.pub` là **khoá công khai** (sẽ đặt lên VPS).

### C3. Đăng nhập VPS lần đầu bằng mật khẩu

💻

```powershell
ssh root@76.13.16.235
```

1. Lần đầu máy hỏi `Are you sure you want to continue connecting (yes/no/[fingerprint])?` → gõ **`yes`** → Enter.
2. Hỏi `root@76.13.16.235's password:` → **dán mật khẩu root** (chuột phải) → Enter.
   > Khi gõ/dán mật khẩu, màn hình **không hiện gì cả** — không có dấu `*`. Đó là bình thường.

✅ **Đúng khi:** dấu nhắc đổi thành `root@<tên-máy>:~#`. Bạn đang ở **trên VPS**.

Gõ `exit` → Enter để quay về máy bạn.

### C4. Đặt khoá công khai lên VPS

💻 (dấu nhắc phải là `PS C:\...>`, không phải `root@...`)

```powershell
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh root@76.13.16.235 "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

Nhập mật khẩu root **lần cuối cùng**.

Kiểm tra:

```powershell
ssh root@76.13.16.235 "echo KET NOI OK"
```

✅ **Đúng khi:** in `KET NOI OK` **mà không hỏi mật khẩu**.

---

## Phần D — Chuẩn bị VPS

Từ đây, mở một cửa sổ PowerShell riêng và giữ nó đăng nhập VPS:

💻

```powershell
ssh root@76.13.16.235
```

Các lệnh đánh dấu 🖥️ gõ trong cửa sổ này.

### D1. Kiểm tra cấu hình VPS

🖥️

```bash
lsb_release -ds; nproc; free -h; df -h /
```

| Dòng | Cần | Nếu không đạt |
|---|---|---|
| Hệ điều hành | `Ubuntu 22.04` hoặc `Ubuntu 24.04` | Tài liệu viết cho Ubuntu; bản khác cần người có kinh nghiệm |
| `nproc` (số nhân CPU) | ≥ 2, nên 4 | Chạy được nhưng nhận diện khuôn mặt chậm |
| `free -h` → cột `total` dòng `Mem` | **≥ 8 GB** | 4–8 GB: làm bước D2. Dưới 4 GB: không đủ để chạy AI server |
| `df -h /` → cột `Avail` | ≥ 30 GB | Dọn hoặc nâng ổ đĩa |

### D2. (Chỉ khi RAM dưới 8 GB) Thêm bộ nhớ ảo

Lúc build, giao diện web và AI server ăn nhiều RAM. Thiếu RAM là build chết giữa chừng với lỗi `Killed`. Swap là phần ổ cứng dùng làm RAM dự phòng.

🖥️

```bash
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
free -h
```

✅ **Đúng khi:** dòng `Swap` có `total` là `4.0Gi`.

### D3. Cập nhật hệ điều hành và cài công cụ cơ bản

🖥️

```bash
apt update && apt upgrade -y
apt install -y ca-certificates curl gnupg git python3 openssl nano ufw
```

> Nếu hiện màn hình tím hỏi về cấu hình dịch vụ (*Which services should be restarted?*): bấm **Tab** tới **Ok** → Enter.

### D4. Cài Docker

Dùng bản chính thức của Docker. **Không** dùng `apt install docker.io` của Ubuntu — bản đó cũ và thiếu lệnh `docker compose` mà hệ thống cần.

🖥️ Dán **cả khối** một lần:

```bash
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Giới hạn dung lượng log (mặc định Docker để log phình vô hạn, vài tháng là đầy ổ đĩa):

```bash
cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "50m", "max-file": "5" }
}
EOF
systemctl restart docker
```

Kiểm tra:

```bash
docker --version && docker compose version
```

✅ **Đúng khi:** in ra 2 dòng `Docker version 2x.x…` và `Docker Compose version v2.x…` (hoặc cao hơn).

### D5. Bật tường lửa

Chỉ mở 3 cổng: **22** (SSH — để bạn vào được), **80** và **443** (web).

🖥️ Gõ **đúng thứ tự** — mở cổng 22 **trước** khi bật:

```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status
```

✅ **Đúng khi:** `Status: active` và 3 dòng `22/tcp`, `80/tcp`, `443/tcp` đều `ALLOW`.

> ⚠ **Nếu VPS có cài sẵn Postgres (không phải Docker) mà máy lập trình viên đang kết nối tới qua cổng 5432:** bật ufw sẽ chặn luôn kết nối đó. Đây là điều **nên** xảy ra — database không bao giờ được mở ra toàn internet. Nếu vẫn cần cho văn phòng dùng, chỉ mở cho đúng IP văn phòng: `ufw allow from <IP-văn-phòng> to any port 5432`.
>
> Postgres **của SmartFace** chạy trong Docker và **không** mở cổng nào ra ngoài — không bị ảnh hưởng.

### D6. Tải mã nguồn

🖥️ Kiểm tra VPS đã từng cài SmartFace chưa:

```bash
ls /opt/smartface 2>/dev/null && echo "DA CO" || echo "CHUA CO"
```

**Trường hợp `CHUA CO`** (VPS mới):

```bash
git clone https://github.com/asctechsoft/smart-face.git /opt/smartface
```

**Trường hợp `DA CO`:** xem [Phụ lục 1 — VPS đã từng deploy](#phụ-lục-1--vps-đã-từng-deploy-bản-cũ) trước khi làm tiếp.

✅ **Đúng khi:** 🖥️ `ls /opt/smartface` thấy các thư mục `server-backend-smart`, `web-smart`, `server-ai-smart`, `docs`.

---

## Phần E — Đưa cấu hình bí mật lên VPS

### E1. Chép file khoá Firebase lên VPS

💻 Mở **thêm một cửa sổ PowerShell mới** (cửa sổ đang `ssh` giữ nguyên). Gõ `scp` rồi **kéo thả** file JSON đã tải ở [B1](#b1-tải-khoá-quản-trị-cho-backend) từ thư mục Downloads vào cửa sổ để PowerShell tự điền đường dẫn, rồi gõ tiếp phần đích. Lệnh hoàn chỉnh có dạng:

```powershell
scp "C:\Users\<tên>\Downloads\smart-face-xxxxx-firebase-adminsdk-yyyyy.json" root@76.13.16.235:/root/firebase-admin.json
```

✅ **Đúng khi:** hiện dòng tên file kèm `100%`.

### E2. Tạo file .env

File `.env` chứa **mọi mật khẩu và khoá** của hệ thống. Script có sẵn tự sinh mật khẩu ngẫu nhiên, tự tạo khoá đăng nhập, và tự chép thông tin Firebase — bạn không phải dán khoá dài bằng tay (đó là chỗ người deploy sai nhiều nhất).

🖥️ Thay `smartface.congty.vn` bằng tên miền của bạn:

```bash
cd /opt/smartface/server-backend-smart
bash scripts/init-prod-env.sh smartface.congty.vn /root/firebase-admin.json
```

✅ **Đúng khi:** in ra

```
Dự án Firebase: smart-face-xxxxx

Đã tạo /opt/smartface/server-backend-smart/.env (quyền 600).
  Tên miền:            https://smartface.congty.vn
  Đã tự sinh:          mật khẩu Postgres, Redis, khoá AI Server, cặp khoá JWT
...
```

Xoá file JSON khỏi VPS (nội dung của nó đã nằm trong `.env`):

```bash
shred -u /root/firebase-admin.json
```

💻 Xoá luôn file JSON trong thư mục Downloads trên máy bạn (Shift+Delete để không vào Thùng rác).

> ⚠ **Script không bao giờ ghi đè `.env` đã có.** Lý do: mật khẩu Postgres chỉ được đặt **một lần** khi database tạo lần đầu. Sinh mật khẩu mới đè lên là backend mất kết nối với database của chính nó.

### E3. Điền 3 giá trị còn thiếu

🖥️

```bash
nano .env
```

`nano` là trình soạn thảo chữ trong terminal. Cách dùng:

| Muốn | Bấm |
|---|---|
| Di chuyển | Các phím mũi tên |
| Tìm một dòng | **Ctrl+W**, gõ chữ cần tìm, Enter |
| Dán | Chuột phải |
| Lưu | **Ctrl+O**, rồi **Enter** |
| Thoát | **Ctrl+X** |

Tìm và điền (chép từ Notepad ở [B2](#b2-lấy-cấu-hình-web-app-cho-giao-diện-web), **không** có dấu nháy, **không** có dấu cách quanh `=`):

| Dòng | Điền | Ví dụ |
|---|---|---|
| `FIREBASE_STORAGE_BUCKET=` | `storageBucket` | `FIREBASE_STORAGE_BUCKET=smart-face-xxxxx.firebasestorage.app` |
| `VITE_FIREBASE_API_KEY=` | `apiKey` | `VITE_FIREBASE_API_KEY=AIzaSyAbc123...` |
| `VITE_FIREBASE_APP_ID=` | `appId` | `VITE_FIREBASE_APP_ID=1:1234567890:web:abcdef` |

Lưu (**Ctrl+O**, **Enter**) và thoát (**Ctrl+X**).

> **Những dòng KHÔNG được sửa** nếu chưa hiểu rõ: `POSTGRES_PASSWORD`, `TRUSTED_PROXY_HOPS=2`, `ATTENDANCE_SIGNATURE_REQUIRED=true`, `OTP_DEBUG_RETURN=false`, `REDIS_ENABLED=true`. Backend được thiết kế để **từ chối khởi động** khi các giá trị bảo mật bị hạ xuống — sửa sai là hệ thống không chạy.
>
> **SMS:** mặc định `SMS_PROVIDER=console` — mã OTP chỉ in ra log, người dùng **không** nhận được tin nhắn. Khi có hợp đồng với nhà cung cấp SMS (hiện hỗ trợ eSMS), điền các dòng `SMS_*` rồi làm [H1](#h1-cập-nhật-khi-có-code-mới).

### E4. Đặt chứng chỉ HTTPS

🖥️

```bash
mkdir -p /opt/smartface/server-backend-smart/certs
nano /opt/smartface/server-backend-smart/certs/origin.pem
```

Mở file `origin.pem` trong Notepad ([A5](#a5-tạo-chứng-chỉ-origin-cho-vps)) → **Ctrl+A**, **Ctrl+C** → quay lại cửa sổ `nano` → **chuột phải** để dán → **Ctrl+O**, **Enter**, **Ctrl+X**.

Làm tương tự với khoá riêng:

```bash
nano /opt/smartface/server-backend-smart/certs/origin.key
```

Dán nội dung `origin.key` → lưu → thoát. Rồi khoá quyền đọc:

```bash
chmod 600 /opt/smartface/server-backend-smart/certs/origin.key
head -1 /opt/smartface/server-backend-smart/certs/origin.pem /opt/smartface/server-backend-smart/certs/origin.key
```

✅ **Đúng khi:**

```
==> .../origin.pem <==
-----BEGIN CERTIFICATE-----

==> .../origin.key <==
-----BEGIN PRIVATE KEY-----
```

💻 Xoá `origin.pem` và `origin.key` trên máy bạn.

### E5. Chép model AI lên VPS

Model nhận diện khuôn mặt nặng khoảng 600 MB nên không có trong GitHub. Lấy từ máy đã có sẵn (máy lập trình viên), trong thư mục `server-ai-smart\models` của repo. Bên trong phải có:

```
models\
├─ anti_spoof\MiniFASNetV2.onnx        ← chống giả mạo (ảnh in, màn hình)
└─ models\buffalo_l\*.onnx             ← nhận diện khuôn mặt (5 file)
```

💻 Chạy **trên máy có model**, thay `E:\WebApp\smart-face` bằng đường dẫn repo trên máy đó. Lệnh đầu tạo sẵn thư mục đích — thiếu nó `scp` báo `No such file or directory`:

```powershell
ssh root@76.13.16.235 "mkdir -p /opt/smartface/server-ai-smart/models"
scp -r E:\WebApp\smart-face\server-ai-smart\models\anti_spoof root@76.13.16.235:/opt/smartface/server-ai-smart/models/
scp -r E:\WebApp\smart-face\server-ai-smart\models\models root@76.13.16.235:/opt/smartface/server-ai-smart/models/
```

Mất vài phút tuỳ tốc độ mạng. **Không** cần chép file `buffalo_l.zip` nếu có — đó là bản nén, đã giải nén sẵn rồi.

🖥️ Kiểm tra:

```bash
ls -la /opt/smartface/server-ai-smart/models/anti_spoof /opt/smartface/server-ai-smart/models/models/buffalo_l
```

✅ **Đúng khi:** thấy `MiniFASNetV2.onnx` và 5 file: `1k3d68.onnx`, `2d106det.onnx`, `det_10g.onnx`, `genderage.onnx`, `w600k_r50.onnx`.

---

## Phần F — Chạy lần đầu

Mọi lệnh Docker đều chạy trong thư mục `server-backend-smart` và luôn có `-f docker-compose.prod.yml` (chỉ định file cấu hình production). Để gõ ngắn hơn, tạo lối tắt `dc`:

🖥️

```bash
cd /opt/smartface/server-backend-smart
echo "alias dc='docker compose -f /opt/smartface/server-backend-smart/docker-compose.prod.yml'" >> ~/.bashrc
source ~/.bashrc
```

Từ giờ `dc ps` nghĩa là `docker compose -f …/docker-compose.prod.yml ps`.

### F1. Kiểm tra cấu hình

🖥️

```bash
dc config --quiet && echo "CAU HINH OK"
```

✅ **Đúng khi:** in `CAU HINH OK`.
Báo `required variable ... is missing a value` / `bắt buộc trong .env` → dòng đó trong `.env` đang trống, quay lại [E3](#e3-điền-3-giá-trị-còn-thiếu).

### F2. Build và chạy mọi thứ — TRỪ giao diện web

Chưa bật `web` ở bước này là **có chủ đích**: `web` là cửa duy nhất từ internet vào. Giữ nó đóng cho tới khi đã tạo xong tài khoản quản trị ở F4, người lạ không có cơ hội chiếm tài khoản đó trước.

🖥️

```bash
dc up -d --build postgres redis ai-server api worker
```

Lần đầu mất **10–25 phút**: Docker tải các image nền, cài thư viện Node, và **biên dịch** thư viện nhận diện khuôn mặt. Màn hình chạy liên tục nhiều dòng chữ — cứ để yên.

✅ **Đúng khi:** kết thúc bằng các dòng `Container ... Started` / `Healthy`, không có chữ `ERROR` màu đỏ ở cuối.

### F3. Theo dõi khởi động

🖥️

```bash
dc ps
```

| Cột `SERVICE` | Cột `STATUS` phải là |
|---|---|
| `postgres`, `redis` | `Up … (healthy)` |
| `api` | `Up … (healthy)` — trong 1 phút đầu có thể là `(health: starting)` |
| `ai-server` | `Up … (healthy)` — trong 90 giây đầu là `(health: starting)` vì đang nạp model |
| `worker` | `Up …` |

Có dòng `Restarting` → dịch vụ đó đang chết rồi khởi động lại liên tục. Xem nguyên nhân:

```bash
dc logs --tail=50 api
```

(thay `api` bằng tên dịch vụ đang lỗi) rồi tra [Phần I](#phần-i--lỗi-thường-gặp).

Xem api khởi động:

```bash
dc logs api | grep -E "Đã đồng bộ|Backend chạy tại"
```

✅ **Đúng khi:** thấy hai dòng

```
... Đã đồng bộ 51 quyền · 6 vai trò hệ thống · tạo 3 gói dịch vụ · tạo bản ghi model AI mặc định
... SmartFace Backend chạy tại http://localhost:3000/v1
```

(Số quyền/vai trò có thể khác theo phiên bản. Từ lần khởi động thứ hai, dòng đầu ghi `gói dịch vụ đã có · model AI đã có` — cũng là đúng.) Mỗi lần khởi động, api tự làm 3 việc trước khi nhận request: áp thay đổi cấu trúc database, áp ràng buộc bảo vệ dữ liệu chấm công, đồng bộ danh mục quyền và gói dịch vụ. Bạn không phải chạy tay gì.

Kiểm tra sức khoẻ:

```bash
curl -s http://127.0.0.1:3000/health; echo
```

✅ **Đúng khi:** có `"status":"healthy"` và `"database":true,"redis":true`.

### F4. Tạo tài khoản Quản trị nền tảng đầu tiên

Đây là tài khoản cao nhất của hệ thống: tạo công ty khách hàng, quản lý gói dịch vụ, giám sát hệ thống. Chỉ tạo được **một lần** theo cách này — sau đó hệ thống tự khoá cửa tạo.

🖥️

```bash
bash scripts/bootstrap-admin.sh
```

Script hỏi lần lượt — gõ rồi Enter:

| Câu hỏi | Gõ |
|---|---|
| `Họ và tên:` | Tên người quản trị |
| `Email đăng nhập:` | Email **thật** của người đó |
| `Số điện thoại:` | 9–15 chữ số, ví dụ `0901234567` |
| `Mật khẩu:` | Tối thiểu 8 ký tự, có cả **chữ HOA** lẫn chữ thường, có ít nhất một chữ số hoặc ký tự đặc biệt, không chứa phần đầu email. Nên dùng một câu dài dễ nhớ. **Màn hình không hiện gì khi gõ — bình thường** |
| `Nhập lại mật khẩu:` | Gõ lại y hệt |

✅ **Đúng khi:** `ĐÃ TẠO quản trị viên: <tên> <email>`.

Báo `KHÔNG TẠO ĐƯỢC — AUTH_PASSWORD_TOO_WEAK` → mật khẩu chưa đủ mạnh, chạy lại script. Báo `PLATFORM_ALREADY_BOOTSTRAPPED` → đã có quản trị viên từ trước; dùng tài khoản đó.

> Ghi mật khẩu vào trình quản lý mật khẩu của công ty. Nút *Quên mật khẩu?* trên trang đăng nhập **không** tự gửi email đặt lại (nó chỉ nhắc nhờ HR đặt lại hộ — mà Quản trị nền tảng thì không có HR). Mất mật khẩu tài khoản này: 🌐 Firebase Console → **Authentication** → tab **Users** → tìm email → dấu **⋮** cuối dòng → **Reset password** — Firebase gửi thư đặt lại tới email đó.

### F5. Mở giao diện web

🖥️

```bash
dc up -d --build web
```

Mất 3–8 phút (build giao diện React).

✅ **Đúng khi:** `dc ps` có thêm dòng `web` với `Up`.

### F6. Kiểm tra toàn bộ

**1. Mở web** 🌐 — vào `https://smartface.congty.vn` (tên miền của bạn).

✅ Có ổ khoá trên thanh địa chỉ, hiện trang đăng nhập SmartFace.

**2. Đăng nhập** bằng email + mật khẩu vừa tạo ở F4.

✅ Vào được trang **Tổng quan** của Quản trị nền tảng. Menu trái có **Công ty**, **Gói dịch vụ**, **Giám sát hệ thống**…

**3. Bấm F5** khi đang ở một trang con (ví dụ **Gói dịch vụ**).

✅ Trang tải lại bình thường, không ra `404 Not Found`.

**4. Kiểm tra gói dịch vụ** — menu **Gói dịch vụ**.

✅ Thấy 3 gói **Free**, **Plus**, **Max**.

**5. Cửa sau phải đóng kín** — 💻 PowerShell trên máy bạn:

```powershell
foreach ($p in 3000, 5432, 6379, 8000) { "$p : " + (Test-NetConnection 76.13.16.235 -Port $p -WarningAction SilentlyContinue).TcpTestSucceeded }
curl.exe -k -s -o NUL -w "Vao thang IP: HTTP %{http_code}`n" https://76.13.16.235
```

✅ **Đúng khi:** cả 4 cổng là `False`, và dòng cuối là `HTTP 403` (gọi thẳng IP mà không qua Cloudflare bị chặn — đúng như thiết kế).

> Cổng `5432` là `True`: VPS có Postgres cài sẵn ngoài Docker đang mở ra internet — xem ghi chú ở [D5](#d5-bật-tường-lửa).

**6. Việc chạy nền đã được lên lịch** — 🖥️

```bash
dc logs worker | grep -i "job định kỳ"
```

✅ Thấy dòng *Đã đăng ký các job định kỳ*. Thấy *Không đăng ký được job định kỳ* → chạy `dc restart worker` rồi kiểm tra lại.

### F7. Việc tiếp theo trên web

Hệ thống đã chạy. Theo thứ tự nghiệp vụ:

1. **Công ty** → **Tạo công ty**: nhập thông tin công ty khách hàng và tài khoản **Tổng giám đốc**. Hệ thống hiện **mật khẩu tạm đúng một lần** — chép lại gửi cho Tổng giám đốc.
2. Tổng giám đốc đăng nhập, làm **Thiết lập ban đầu** (phòng ban, ca làm, tài khoản Kế toán).
3. **App mobile:** đội app đặt địa chỉ API là `https://smartface.congty.vn/v1`.
   > ⚠ Production **bắt buộc** chữ ký chấm công (`ATTENDANCE_SIGNATURE_REQUIRED=true`). Bản app chưa ký HMAC sẽ bị từ chối mọi lượt chấm công — kiểm tra với đội app trước khi phát hành.

---

## Phần G — Bật deploy tự động

Sau phần này, mỗi lần lập trình viên `git push` lên nhánh `main`, GitHub tự đăng nhập VPS, lấy code mới, build lại và kiểm tra — không ai phải SSH vào.

### G1. Tạo khoá riêng cho GitHub

Dùng một khoá **riêng** cho GitHub, không dùng khoá cá nhân của bạn: sau này muốn thu hồi quyền của GitHub thì xoá đúng khoá này mà không ảnh hưởng ai.

🖥️

```bash
ssh-keygen -t ed25519 -N "" -C "github-actions" -f ~/.ssh/github-actions
cat ~/.ssh/github-actions.pub >> ~/.ssh/authorized_keys
cat ~/.ssh/github-actions
```

Lệnh cuối in ra một khối chữ bắt đầu `-----BEGIN OPENSSH PRIVATE KEY-----`, kết thúc `-----END OPENSSH PRIVATE KEY-----`. **Bôi đen toàn bộ khối** (kể cả 2 dòng BEGIN/END) — trong PowerShell, bôi đen xong là đã chép.

### G2. Khai báo trên GitHub

1. 🌐 Vào `https://github.com/asctechsoft/smart-face` → tab **Settings** (cần quyền Admin; không thấy tab này thì nhờ người có quyền).
2. Menu trái → **Secrets and variables** → **Actions** → nút xanh **New repository secret**.
3. Tạo **3 secret**, mỗi cái bấm **Add secret** xong lại bấm **New repository secret**:

   | Name (gõ đúng chữ hoa) | Secret |
   |---|---|
   | `VPS_HOST` | `76.13.16.235` |
   | `VPS_USER` | `root` |
   | `VPS_SSH_KEY` | Dán khối khoá đã chép ở G1 |

4. 🖥️ Xoá khoá riêng khỏi VPS (GitHub đã giữ bản của nó; khoá công khai vẫn nằm trong `authorized_keys`):

   ```bash
   rm ~/.ssh/github-actions ~/.ssh/github-actions.pub
   ```

### G3. Chạy thử

1. 🌐 Repo → tab **Actions** → danh sách bên trái chọn **Deploy SmartFace (VPS)**.
2. Bấm **Run workflow** (bên phải) → Branch: `main` → nút xanh **Run workflow**.
3. Bấm vào lượt chạy vừa xuất hiện → bấm **deploy** để xem từng bước.

✅ **Đúng khi:** sau vài phút có dấu ✅ xanh, bước *Deploy over SSH* kết thúc bằng `api OK sau … giay`.

Từ giờ, push lên `main` có đụng tới `server-backend-smart/`, `web-smart/` hoặc `server-ai-smart/` là tự deploy.

---

## Phần H — Vận hành hằng ngày

### H1. Cập nhật khi có code mới

Không phải làm gì — [Phần G](#phần-g--bật-deploy-tự-động) tự lo. Muốn deploy ngay không chờ GitHub, 💻 từ thư mục repo trên máy:

```powershell
cd server-backend-smart
.\deploy.ps1
```

Sửa `.env` trên VPS (ví dụ thêm nhà cung cấp SMS) → phải tạo lại container thì giá trị mới mới có hiệu lực:

🖥️

```bash
cd /opt/smartface/server-backend-smart && nano .env
dc up -d --build
```

(`--build` cần thiết khi sửa dòng `VITE_*`: các giá trị đó được **nhúng vào giao diện lúc build**, khởi động lại thôi không đủ.)

### H2. Xem log, khởi động lại

🖥️

| Muốn | Lệnh |
|---|---|
| Xem trạng thái | `dc ps` |
| Xem log đang chạy (Ctrl+C để thoát) | `dc logs -f --tail=100 api` |
| Tìm lỗi trong 1 giờ qua | `dc logs --since 1h api \| grep -i error` |
| Khởi động lại một dịch vụ | `dc restart api` |
| Xem mã OTP (khi `SMS_PROVIDER=console`) | `dc logs --since 10m api \| grep -i otp` |

### H3. Sao lưu database

Ảnh nằm trên Firebase (Google tự nhân bản), nhưng **database nằm trên VPS** — VPS hỏng là mất sạch nếu không sao lưu.

🖥️ Tạo lịch sao lưu tự động lúc 01:30 hằng đêm (giờ của VPS), giữ 14 bản gần nhất:

```bash
mkdir -p /opt/backups
cat > /opt/backups/backup-db.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
cd /opt/smartface/server-backend-smart
docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U smartface -Fc smartface > "/opt/backups/db-$(date +%F).dump"
find /opt/backups -name 'db-*.dump' -mtime +14 -delete
EOF
chmod +x /opt/backups/backup-db.sh
(crontab -l 2>/dev/null; echo "30 1 * * * /opt/backups/backup-db.sh >> /var/log/smartface-backup.log 2>&1") | crontab -
/opt/backups/backup-db.sh && ls -lh /opt/backups
```

✅ **Đúng khi:** thấy file `db-YYYY-MM-DD.dump` dung lượng lớn hơn 0.

> ⚠ **Bản sao lưu nằm cùng VPS thì mất cùng VPS.** Ít nhất mỗi tuần, 💻 tải một bản về nơi khác:
>
> ```powershell
> scp root@76.13.16.235:/opt/backups/db-2026-09-11.dump D:\SaoLuu\
> ```
>
> (đổi ngày theo tên file mới nhất.) Sao lưu chưa từng khôi phục thử thì chưa chắc dùng được — nhờ lập trình viên khôi phục thử một lần.

### H4. Kiểm tra danh sách IP của Cloudflare (3 tháng một lần)

nginx chỉ nhận kết nối từ các dải IP của Cloudflare, ghi trong `server-backend-smart/nginx/cloudflare-only.conf`. Cloudflare rất ít khi đổi, nhưng nếu đổi mà file chưa cập nhật thì một phần người dùng bị lỗi 403.

💻

```powershell
curl.exe -s https://www.cloudflare.com/ips-v4; curl.exe -s https://www.cloudflare.com/ips-v6
```

So với các dòng `allow` trong file. Khác → nhờ lập trình viên sửa file trong repo và push.

### H5. Những việc KHÔNG được làm

| Đừng | Vì |
|---|---|
| Sửa code trực tiếp trên VPS | Mỗi lần deploy chạy `git reset --hard` — mọi thay đổi trên VPS bị xoá. Sửa trong repo rồi push |
| `docker system prune --volumes` | Xoá **database**. Dọn đĩa an toàn: `docker image prune -f` và `docker builder prune -f` |
| `dc down -v` | Cờ `-v` cũng xoá database |
| Đổi `POSTGRES_PASSWORD` trong `.env` | Database vẫn giữ mật khẩu cũ → api mất kết nối |
| Chạy `npm run seed` trên production | Tạo tài khoản mẫu với mật khẩu nằm công khai trong mã nguồn |
| Đưa `.env`, file JSON Firebase, `origin.key` lên GitHub, chat, email | Lộ là phải thu hồi và làm lại toàn bộ khoá |
| Tắt mây cam trên Cloudflare | Người dùng bị 403 (xem [A3](#a3-tạo-record-a-trỏ-về-vps)) |

---

## Phần I — Lỗi thường gặp

| Triệu chứng | Nguyên nhân | Cách sửa |
|---|---|---|
| `ssh` báo `Permission denied (publickey)` | Khoá công khai chưa lên VPS | Làm lại [C4](#c4-đặt-khoá-công-khai-lên-vps) |
| `ssh` báo `Connection timed out` | Sai IP, hoặc tường lửa của nhà cung cấp VPS chặn cổng 22 | Kiểm tra IP; vào trang quản lý VPS xem firewall |
| `init-prod-env.sh` báo `Đã có file .env` | `.env` đã tạo từ trước | Dùng `nano .env` để sửa. **Không** xoá `.env` nếu database đã chạy — xem [Phụ lục 1](#phụ-lục-1--vps-đã-từng-deploy-bản-cũ) |
| `init-prod-env.sh` báo `File JSON không phải khoá service account` | Chép nhầm file (ví dụ `google-services.json` của app) | Tải lại đúng file ở [B1](#b1-tải-khoá-quản-trị-cho-backend) |
| `dc config` báo `... bắt buộc trong .env` | Dòng tương ứng trong `.env` trống | Điền theo [E3](#e3-điền-3-giá-trị-còn-thiếu) |
| Build dừng với `Killed` hoặc `exit code: 137` | Hết RAM | Làm [D2](#d2-chỉ-khi-ram-dưới-8-gb-thêm-bộ-nhớ-ảo) rồi chạy lại lệnh build |
| Build báo `no space left on device` | Hết ổ đĩa | `docker builder prune -f && docker image prune -f` |
| `api` ở trạng thái `Restarting`, log có `Thiếu biến môi trường bắt buộc` | Thiếu dòng trong `.env` | Đọc tên biến trong log, điền vào `.env`, `dc up -d` |
| Log `api` có `NFR-SEC-03`, `AF-12`, `AF-02b`, `OTP_DEBUG_RETURN`, `REDIS_ENABLED` | Một giá trị bảo mật bị sửa sai trong `.env` | Đối chiếu với `.env.production.example`, trả về giá trị gốc |
| Log `api` có `Authentication failed against database server` | `POSTGRES_PASSWORD` trong `.env` khác mật khẩu lúc database tạo lần đầu | Trả lại mật khẩu cũ. Không nhớ → nhờ lập trình viên |
| Log `api` có `Failed to parse private key` | `FIREBASE_PRIVATE_KEY` bị sửa hỏng | Xoá `.env` **chỉ khi database chưa có dữ liệu**, rồi chạy lại [E2](#e2-tạo-file-env) |
| `bootstrap-admin.sh` (hoặc đăng nhập) báo `SYS_INTERNAL_ERROR`, log `api` có `invalid_grant` / `account not found` | Khoá Firebase trong `.env` đã bị thu hồi, hoặc thuộc dự án khác | [Phụ lục 2 — Thay khoá Firebase](#phụ-lục-2--thay-khoá-firebase) |
| `ai-server` `Restarting`, log có `LIVENESS_MODEL_PATH` hoặc `No such file` | Chưa chép model | Làm [E5](#e5-chép-model-ai-lên-vps), rồi `dc restart ai-server` |
| `ai-server` log có `AI_SERVER_INTERNAL_KEY ... ít nhất 32 ký tự` | Khoá bị sửa ngắn đi | Tạo khoá mới: `openssl rand -hex 32`, dán vào `.env`, `dc up -d` |
| `web` `Restarting`, log có `cannot load certificate` | Thiếu hoặc dán sai chứng chỉ | Làm lại [E4](#e4-đặt-chứng-chỉ-https) — kiểm tra dòng đầu mỗi file |
| Trình duyệt báo **Error 526 Invalid SSL certificate** | Cloudflare không tin chứng chỉ trên VPS | Chứng chỉ phải là **Origin Certificate** tạo ở [A5](#a5-tạo-chứng-chỉ-origin-cho-vps), tên miền phải nằm trong danh sách Hostnames |
| Trình duyệt báo **Error 521** hoặc **522** | `web` chưa chạy, hoặc tường lửa chặn 443 | `dc ps`; `ufw status` phải có `443/tcp ALLOW` |
| Trình duyệt báo **403 Forbidden** (trang trắng của nginx) | Record DNS đang **mây xám** | Bật mây cam ở [A3](#a3-tạo-record-a-trỏ-về-vps) |
| Trang web báo **Thiếu cấu hình Firebase** | `VITE_FIREBASE_API_KEY` trống lúc build | Điền vào `.env`, rồi `dc up -d --build web` |
| Đăng nhập báo `auth/unauthorized-domain` | Chưa khai tên miền trong Firebase | [B4](#b4-cho-phép-tên-miền-đăng-nhập) |
| Đăng nhập báo `auth/operation-not-allowed` | Chưa bật đăng nhập email | [B3](#b3-bật-đăng-nhập-bằng-email) |
| Đăng nhập báo sai mật khẩu dù chắc chắn đúng | Web và backend dùng hai dự án Firebase khác nhau | `FIREBASE_PROJECT_ID` trong `.env` phải đúng dự án có `apiKey` đã điền |
| Ảnh chấm công không hiện | Sai tên bucket | `FIREBASE_STORAGE_BUCKET` phải trùng dòng `gs://…` ở [B5](#b5-khoá-kho-ảnh); log `api` có `Không tạo được signed URL` |
| **Cả công ty báo "ngoài mạng văn phòng"** | `TRUSTED_PROXY_HOPS` bị sửa khác `2`, hoặc đã tắt Cloudflare | Trả về `2`, bật lại mây cam |
| Không nhận được tin nhắn OTP | `SMS_PROVIDER=console` | Cấu hình nhà cung cấp SMS; tạm thời xem mã trong log ([H2](#h2-xem-log-khởi-động-lại)) |
| Deploy xong vẫn thấy giao diện cũ | Trình duyệt/Cloudflare giữ bản cũ | Ctrl+F5; hoặc Cloudflare → **Caching** → **Configuration** → **Purge Everything** |
| GitHub Actions báo `Permission denied (publickey)` | Secret `VPS_SSH_KEY` sai hoặc thiếu dòng BEGIN/END | Làm lại [G1–G2](#g1-tạo-khoá-riêng-cho-github) |
| GitHub Actions báo `api KHONG san sang sau 120 giay` | api chết sau khi deploy | Log in ngay bên dưới trong trang Actions; tra các dòng trên của bảng này |

Vẫn không giải quyết được: gửi cho lập trình viên kết quả của 🖥️ `dc ps` và `dc logs --tail=100 <tên-dịch-vụ-lỗi>`.
**Đừng gửi nội dung file `.env`.**

---

## Phụ lục 1 — VPS đã từng deploy bản cũ

Nếu ở [D6](#d6-tải-mã-nguồn) thấy `DA CO`:

🖥️

```bash
cd /opt/smartface && git status --short | head; ls server-backend-smart/.env 2>/dev/null; docker ps --format '{{.Names}}'
```

1. **Lấy code mới** (xoá mọi thay đổi đã sửa tay trên VPS — `.env` không bị ảnh hưởng vì không nằm trong git):

   ```bash
   git fetch origin main && git reset --hard origin/main
   ```

2. Kiểm tra VPS **có** file `.env` cũ không:

   ```bash
   ls -la /opt/smartface/server-backend-smart/.env
   ```

   - Báo `No such file or directory` → **không có** `.env` cũ. Bỏ qua phần còn lại của mục này, làm [E1](#e1-chép-file-khoá-firebase-lên-vps) → [E2](#e2-tạo-file-env) như VPS mới. (Chạy lệnh `diff` bên dưới khi không có `.env` sẽ liệt kê **mọi** biến với dấu `>` — trông như "thiếu hết" nhưng thật ra là file không tồn tại.)
   - Hiện ra một dòng thông tin file → **có** `.env` cũ. Làm tiếp bên dưới.

   **Đã có `server-backend-smart/.env`:** **đừng** chạy `init-prod-env.sh` và **đừng** xoá file này — nó giữ mật khẩu của database đang có dữ liệu. Thay vào đó, mở song song hai file để đối chiếu:

   ```bash
   cd /opt/smartface/server-backend-smart
   diff <(grep -oE '^[A-Z_]+=' .env | sort) <(grep -oE '^[A-Z_]+=' .env.production.example | sort)
   ```

   Các dòng có dấu `>` là biến **còn thiếu** trong `.env` cũ — thêm chúng bằng `nano .env`, giá trị lấy theo `.env.production.example` và [E3](#e3-điền-3-giá-trị-còn-thiếu). Đặc biệt: `TRUSTED_PROXY_HOPS=2`, `WEB_BASE_URL`, `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`. Xoá các dòng `S3_*` cũ (bản cũ lưu ảnh bằng MinIO, bản mới dùng Firebase).

3. **Thấy container `smartface-minio`** trong `docker ps`: ảnh chấm công của bản cũ nằm trong đó. Lần deploy tới sẽ gỡ container MinIO (dữ liệu vẫn còn trong volume `server-backend-smart_minio-data`, chỉ là hệ thống không đọc nữa). Cần giữ ảnh cũ thì nhờ lập trình viên chuyển sang Firebase **trước**.

4. Làm tiếp từ [E4](#e4-đặt-chứng-chỉ-https). Ở [F4](#f4-tạo-tài-khoản-quản-trị-nền-tảng-đầu-tiên), nếu báo `PLATFORM_ALREADY_BOOTSTRAPPED` thì hệ thống đã có quản trị viên — dùng tài khoản đó.

## Phụ lục 2 — Thay khoá Firebase

Làm khi khoá Firebase bị lộ (đưa nhầm lên GitHub, gửi qua chat…) hoặc bị thu hồi.

1. 🌐 **Thu hồi khoá cũ** — `https://console.cloud.google.com` → chọn đúng dự án (ô chọn dự án trên cùng) → menu **IAM & Admin** → **Service accounts** → bấm vào tài khoản `firebase-adminsdk-…` → tab **Keys** → khoá cũ → biểu tượng **🗑 Delete**.
   > Xoá file khỏi GitHub **không** đủ — lịch sử git vẫn giữ nó, và bot quét GitHub tìm ra khoá trong vài phút. Chỉ thu hồi mới làm bản bị lộ vô dụng.
2. 🌐 **Tạo khoá mới** — làm lại [B1](#b1-tải-khoá-quản-trị-cho-backend).
3. 💻 Chép lên VPS như [E1](#e1-chép-file-khoá-firebase-lên-vps).
4. 🖥️ Thay 3 dòng `FIREBASE_*` trong `.env` — dán **cả khối** (các dòng khác giữ nguyên):

   ```bash
   cd /opt/smartface/server-backend-smart
   python3 - /root/firebase-admin.json <<'PY'
   import json, sys
   d = json.load(open(sys.argv[1], encoding='utf-8'))
   new = {
       'FIREBASE_PROJECT_ID': d['project_id'],
       'FIREBASE_CLIENT_EMAIL': d['client_email'],
       'FIREBASE_PRIVATE_KEY': '"' + d['private_key'].strip().replace('\n', '\\n') + '\\n"',
   }
   lines = open('.env', encoding='utf-8').read().splitlines()
   out = [f'{l.split("=", 1)[0]}={new[l.split("=", 1)[0]]}' if l.split('=', 1)[0] in new else l for l in lines]
   open('.env', 'w', encoding='utf-8').write('\n'.join(out) + '\n')
   print('Đã thay khoá Firebase — dự án:', d['project_id'])
   PY
   shred -u /root/firebase-admin.json
   dc up -d
   ```

   Nếu khoá mới thuộc **dự án Firebase khác** dự án cũ: sửa thêm `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_AUTH_DOMAIN`, `FIREBASE_STORAGE_BUCKET` rồi chạy `dc up -d --build` (có `--build` vì giao diện web phải build lại).

✅ **Đúng khi:** `dc ps` có `api` ở `(healthy)` và đăng nhập web được.

## Phụ lục 3 — Trên VPS có những gì

| Đường dẫn | Là gì | Trong git? |
|---|---|---|
| `/opt/smartface/` | Toàn bộ mã nguồn | Có |
| `…/server-backend-smart/docker-compose.prod.yml` | Bản mô tả 6 dịch vụ và cách chúng nối nhau | Có |
| `…/server-backend-smart/.env` | **Mọi mật khẩu và khoá** — quyền 600 | **Không** |
| `…/server-backend-smart/certs/` | Chứng chỉ HTTPS của Cloudflare | **Không** |
| `…/server-backend-smart/nginx/` | Cấu hình cổng vào: định tuyến, HTTPS, chỉ nhận Cloudflare | Có |
| `…/server-backend-smart/scripts/init-prod-env.sh` | Tạo `.env` lần đầu | Có |
| `…/server-backend-smart/scripts/bootstrap-admin.sh` | Tạo quản trị viên đầu tiên | Có |
| `…/server-backend-smart/scripts/enable-domain.sh` | Chuyển từ "backend trước" sang chế độ đầy đủ ([Phụ lục 4](#phụ-lục-4--chưa-có-tên-miền-chạy-backend-trước)) | Có |
| `…/server-ai-smart/models/` | Model nhận diện khuôn mặt | **Không** |
| `/opt/backups/` | Bản sao lưu database | **Không** |
| Docker volume `server-backend-smart_postgres-data` | **Dữ liệu database** | **Không** |

---

## Phụ lục 4 — Chưa có tên miền: chạy backend trước

Dùng khi **chưa có tên miền hoặc chưa có tài khoản Cloudflare** mà cần backend chạy ngay — để đội app mobile test, hoặc để lập trình viên chạy giao diện web trên máy mình nối vào backend thật.

| Có | Chưa có |
|---|---|
| api, worker, AI nhận diện, database, Redis — đầy đủ như chế độ chính | Giao diện web production |
| API tại `http://76.13.16.235:3000/v1` | HTTPS — mọi thứ đi HTTP thuần |

> ⚠ **HTTP thuần nghĩa là token đăng nhập và ảnh khuôn mặt đi trên mạng không mã hoá.** Ai nghe lén được đường truyền (Wi-Fi quán cà phê, mạng công cộng) là đọc được. Giai đoạn này **chỉ dùng tài khoản và dữ liệu thử**. Không cho nhân viên thật đăng ký khuôn mặt cho tới khi chuyển sang chế độ đầy đủ ở P4.8.

### P4.1. Làm những phần giống chế độ chính

| Phần | Làm | Bỏ qua |
|---|---|---|
| A — Cloudflare | — | **Toàn bộ** |
| B — Firebase | B1, B3, B5 | B4 (chưa có tên miền để khai). B2 chỉ cần chép `storageBucket` |
| C, D | Toàn bộ | — |
| E | E1, E5 | E4 (chưa có chứng chỉ). E2 và E3 làm theo P4.2 bên dưới |

### P4.2. Tạo .env ở chế độ backend trước

🖥️

```bash
cd /opt/smartface/server-backend-smart
bash scripts/init-prod-env.sh --backend-truoc /root/firebase-admin.json
shred -u /root/firebase-admin.json
nano .env      # chỉ cần điền FIREBASE_STORAGE_BUCKET
```

✅ **Đúng khi:** in ra `Chế độ: BACKEND TRƯỚC — api mở HTTP ở cổng 3000, chưa có web`.

Script đặt sẵn 3 dòng đi cùng nhau — **không sửa tay riêng dòng nào**:

| Dòng | Giá trị | Nghĩa |
|---|---|---|
| `COMPOSE_PROFILES=` | trống | Không dựng giao diện web. Script deploy tự bỏ qua nó |
| `API_BIND=0.0.0.0` | | Mở cổng 3000 của api ra internet |
| `TRUSTED_PROXY_HOPS=0` | | Không có proxy nào đứng trước — api nhìn thấy IP thật của người dùng |

### P4.3. Chạy lần đầu — giữ api KHOÁ trong lúc tạo quản trị viên

Tạo alias `dc` như đầu [Phần F](#phần-f--chạy-lần-đầu), rồi 🖥️:

```bash
API_BIND=127.0.0.1 docker compose -f docker-compose.prod.yml up -d --build
```

`API_BIND=127.0.0.1` đứng trước lệnh **ghi đè tạm** giá trị trong `.env` cho riêng lần chạy này: api chỉ nghe trong VPS. Lý do như [F2](#f2-build-và-chạy-mọi-thứ--trừ-giao-diện-web): chưa có quản trị viên thì ai gọi được api cũng chiếm được tài khoản đó.

Chờ 10–25 phút, kiểm tra như [F3](#f3-theo-dõi-khởi-động) (không có dòng `web` — đúng). Rồi tạo quản trị viên như [F4](#f4-tạo-tài-khoản-quản-trị-nền-tảng-đầu-tiên):

```bash
bash scripts/bootstrap-admin.sh
```

Xong mới mở cổng (lần này không có `API_BIND=` đứng trước, nên giá trị `0.0.0.0` trong `.env` có hiệu lực):

```bash
dc up -d
```

### P4.4. Kiểm tra

💻

```powershell
curl.exe http://76.13.16.235:3000/health
foreach ($p in 5432, 6379, 8000) { "$p : " + (Test-NetConnection 76.13.16.235 -Port $p -WarningAction SilentlyContinue).TcpTestSucceeded }
```

✅ **Đúng khi:** dòng đầu có `"status":"healthy"`; ba cổng database, Redis, AI đều `False` — chỉ api được mở.

### P4.5. Giao cho đội app mobile

| Việc | Chi tiết |
|---|---|
| Địa chỉ API | `http://76.13.16.235:3000/v1` |
| Cho phép HTTP trong bản build thử | Android (từ 9) và iOS **mặc định chặn HTTP**. Bản build thử phải khai ngoại lệ cho IP này: Android — `network_security_config.xml` cho phép cleartext tới `76.13.16.235`; iOS — `NSAppTransportSecurity` / `NSExceptionDomains`. Gỡ ngoại lệ khi chuyển sang HTTPS |
| Chữ ký chấm công | Production bắt buộc chữ ký HMAC (`ATTENDANCE_SIGNATURE_REQUIRED=true`) kể cả ở chế độ này — bản app chưa ký sẽ bị từ chối mọi lượt chấm công |
| Chốt IP văn phòng | Hoạt động đúng ở chế độ này (`TRUSTED_PROXY_HOPS=0`, api thấy IP thật) |

### P4.6. Lập trình viên chạy giao diện web trên máy, nối vào backend VPS

💻 Trong `web-smart\.env` trên máy lập trình viên:

```dotenv
VITE_API_PROXY_TARGET=http://76.13.16.235:3000
# ... cộng 4 dòng VITE_FIREBASE_* của CÙNG dự án Firebase với backend
```

Rồi `npm run dev` → mở `http://localhost:5173`. Vite chuyển tiếp `/v1` sang VPS nên không vướng CORS, và `localhost` là tên miền Firebase cho phép sẵn — không cần B4.

### P4.7. Deploy tự động vẫn dùng được

[Phần G](#phần-g--bật-deploy-tự-động) làm y hệt. Vì `COMPOSE_PROFILES` trống, mỗi lần deploy chỉ cập nhật backend, không đụng tới web.

### P4.8. Khi đã có tên miền — chuyển sang chế độ đầy đủ

1. Làm [Phần A](#phần-a--cloudflare-tên-miền-và-https) (Cloudflare, record A, HTTPS, chứng chỉ Origin), [B2](#b2-lấy-cấu-hình-web-app-cho-giao-diện-web), [B4](#b4-cho-phép-tên-miền-đăng-nhập).
2. 🖥️ `nano .env` → điền `VITE_FIREBASE_API_KEY` và `VITE_FIREBASE_APP_ID` ([E3](#e3-điền-3-giá-trị-còn-thiếu)).
3. Đặt chứng chỉ ([E4](#e4-đặt-chứng-chỉ-https)).
4. 🖥️ Chuyển chế độ — script tự kiểm đủ chứng chỉ và API key rồi mới đổi:

   ```bash
   cd /opt/smartface/server-backend-smart
   bash scripts/enable-domain.sh smartface.congty.vn
   dc up -d --build
   ```

   ✅ **Đúng khi:** `dc ps` có thêm dòng `web`, và từ 💻 `Test-NetConnection 76.13.16.235 -Port 3000` giờ là `False` — api đã đóng lại sau nginx.
5. Kiểm tra toàn bộ như [F6](#f6-kiểm-tra-toàn-bộ).
6. Báo đội app: địa chỉ API mới `https://smartface.congty.vn/v1`, gỡ ngoại lệ HTTP.
7. **Dữ liệu thử vẫn nằm trong database.** Trước khi cho khách hàng thật dùng: vào web xoá/ngưng các công ty thử. Muốn làm sạch hoàn toàn thì nhờ lập trình viên dựng lại database từ đầu — thao tác đó xoá toàn bộ dữ liệu, kể cả tài khoản quản trị (phải chạy lại F4).

## Đọc thêm

| Tài liệu | Nội dung |
|---|---|
| [22-huong-dan-deploy-vps.md](./22-huong-dan-deploy-vps.md) | Giải thích kỹ thuật: vì sao từng cấu hình như vậy, các chốt bảo mật |
| `server-backend-smart/.env.production.example` | Mẫu `.env` production, chú thích từng nhóm biến |
| `server-backend-smart/.env.example` | Giải thích chi tiết từng biến (bản cho môi trường phát triển) |
| `server-ai-smart/README.md` mục 8 | Tải và chuyển đổi model AI từ đầu (khi không có máy nào giữ sẵn) |
| `server-backend-smart/docs/storage-lifecycle.md` | Quy tắc tự xoá ảnh cũ trên Firebase Storage |
