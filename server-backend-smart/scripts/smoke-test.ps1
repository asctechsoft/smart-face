<#
.SYNOPSIS
  Chạy thử toàn bộ luồng nghiệp vụ qua API thật: đăng nhập → đổi mật khẩu →
  đăng ký khuôn mặt → chấm công, kèm các trường hợp PHẢI bị từ chối.

.DESCRIPTION
  Kịch bản này KHÔNG thay thế test tự động. Nó trả lời một câu hỏi khác:
  "hệ thống đã dựng lên có chạy thông từ đầu tới cuối không" — thứ mà unit test
  không kiểm được vì chúng chạy với mock.

  Mỗi bước in ra kết quả và dừng ngay khi gặp lỗi không mong đợi.

.PARAMETER ApiUrl
  Gốc API của Backend. Mặc định http://localhost:3000/v1

.PARAMETER AiUrl
  Gốc AI Server. Mặc định http://localhost:8000

.EXAMPLE
  .\scripts\smoke-test.ps1
  .\scripts\smoke-test.ps1 -ApiUrl http://localhost:3000/v1 -Verbose
#>
param(
  [string]$ApiUrl = 'http://localhost:3000/v1',
  [string]$AiUrl = 'http://localhost:8000',
  [string]$Domain = 'amobi.vn',
  [string]$Email = 'duc@amobi.vn',
  [string]$Password = 'SmartFaceDev2026',
  # Mật khẩu mới cho bước đổi mật khẩu. Chạy lại lần hai thì dùng mật khẩu này
  # làm mật khẩu đăng nhập.
  [string]$NewPassword = 'CaiDenHoiHaiDongSau2026',
  # BSSID đã seed cho chi nhánh demo (AF-02). Sai giá trị này thì chấm công bị
  # từ chối với ATT_WIFI_REQUIRED.
  [string]$WifiBssid = 'a4:2b:8c:11:9d:0e'
)

$ErrorActionPreference = 'Stop'
$script:DeviceId = "smoke-$([guid]::NewGuid().ToString('N').Substring(0,12))"
$script:Step = 0

# ---------------------------------------------------------------------------
#  Tiện ích
# ---------------------------------------------------------------------------

function Write-Step([string]$Text) {
  $script:Step++
  Write-Host ''
  Write-Host ("[{0}] {1}" -f $script:Step, $Text) -ForegroundColor Cyan
}

function Write-Ok([string]$Text) { Write-Host "    OK   $Text" -ForegroundColor Green }
function Write-Info([string]$Text) { Write-Host "         $Text" -ForegroundColor DarkGray }

function Write-Fail([string]$Text) {
  Write-Host "    LOI  $Text" -ForegroundColor Red
  exit 1
}

<#
  Gọi API và trả về đối tượng { StatusCode, Body }.
  Không ném lỗi khi HTTP 4xx/5xx — kịch bản cần kiểm cả trường hợp bị từ chối.
#>
function Invoke-Api {
  param(
    [string]$Method,
    [string]$Path,
    $Body,
    [hashtable]$Headers = @{},
    [string]$Token,
    [byte[]]$RawBody,
    [string]$ContentType = 'application/json'
  )

  $uri = if ($Path -match '^https?://') { $Path } else { "$ApiUrl$Path" }
  $allHeaders = @{} + $Headers
  if ($Token) {
    $allHeaders['Authorization'] = "Bearer $Token"
    # AF-16: token của App BẮT BUỘC kèm header này, thiếu là 401.
    $allHeaders['X-Device-Id'] = $script:DeviceId
  }

  $params = @{
    Uri             = $uri
    Method          = $Method
    Headers         = $allHeaders
    UseBasicParsing = $true
    ErrorAction     = 'SilentlyContinue'
  }
  if ($RawBody) {
    $params['Body'] = $RawBody
    $params['ContentType'] = $ContentType
  } elseif ($null -ne $Body) {
    $params['Body'] = ($Body | ConvertTo-Json -Depth 10 -Compress)
    $params['ContentType'] = 'application/json'
  }

  try {
    $response = Invoke-WebRequest @params
    return @{ StatusCode = [int]$response.StatusCode; Body = ($response.Content | ConvertFrom-Json) }
  } catch {
    $webResponse = $_.Exception.Response
    if (-not $webResponse) { Write-Fail "Không kết nối được $uri — $($_.Exception.Message)" }

    $reader = New-Object System.IO.StreamReader($webResponse.GetResponseStream())
    $text = $reader.ReadToEnd()
    $reader.Close()

    $parsed = $null
    try { $parsed = $text | ConvertFrom-Json } catch { $parsed = @{ raw = $text } }
    return @{ StatusCode = [int]$webResponse.StatusCode; Body = $parsed }
  }
}

<# Mã lỗi nghiệp vụ nằm trong error.code của response chuẩn. #>
function Get-ErrorCode($Result) {
  if ($Result.Body -and $Result.Body.error) { return $Result.Body.error.code }
  return $null
}

function Assert-Rejected {
  param($Result, [string]$ExpectedCode, [string]$What)

  $actual = Get-ErrorCode $Result
  if ($Result.StatusCode -lt 400) {
    Write-Fail "$What — đáng lẽ phải bị từ chối nhưng lại trả HTTP $($Result.StatusCode)"
  }
  if ($ExpectedCode -and $actual -ne $ExpectedCode) {
    Write-Fail "$What — chờ mã $ExpectedCode, nhận $actual (HTTP $($Result.StatusCode))"
  }
  Write-Ok "$What → $actual (HTTP $($Result.StatusCode))"
}

<# Dựng body multipart/form-data. PowerShell 5.1 không có -Form nên phải tự làm. #>
function New-Multipart {
  param([hashtable]$Fields, [string]$FileField, [byte[]]$FileBytes, [string]$FileName = 'face.jpg')

  $boundary = "----smoke$([guid]::NewGuid().ToString('N'))"
  $stream = New-Object System.IO.MemoryStream
  $writer = New-Object System.IO.StreamWriter($stream, [System.Text.Encoding]::UTF8)
  $writer.NewLine = "`r`n"

  foreach ($key in $Fields.Keys) {
    $writer.WriteLine("--$boundary")
    $writer.WriteLine("Content-Disposition: form-data; name=`"$key`"")
    $writer.WriteLine()
    $writer.WriteLine([string]$Fields[$key])
  }

  if ($FileBytes) {
    $writer.WriteLine("--$boundary")
    $writer.WriteLine("Content-Disposition: form-data; name=`"$FileField`"; filename=`"$FileName`"")
    $writer.WriteLine("Content-Type: image/jpeg")
    $writer.WriteLine()
    $writer.Flush()
    $stream.Write($FileBytes, 0, $FileBytes.Length)
    $writer.WriteLine()
  }

  $writer.WriteLine("--$boundary--")
  $writer.Flush()

  return @{ Bytes = $stream.ToArray(); ContentType = "multipart/form-data; boundary=$boundary" }
}

<#
  Sinh ảnh JPEG có nội dung ngẫu nhiên tất định theo `Seed`.

  Engine giả của AI Server băm nội dung ảnh ra embedding, nên cùng seed = cùng
  khuôn mặt. Đổi seed = "người khác".
#>
function New-TestImage([int]$Seed = 1, [int]$Size = 480) {
  Add-Type -AssemblyName System.Drawing
  $bitmap = New-Object System.Drawing.Bitmap $Size, $Size
  $random = New-Object System.Random $Seed

  for ($y = 0; $y -lt $Size; $y += 3) {
    for ($x = 0; $x -lt $Size; $x += 3) {
      $color = [System.Drawing.Color]::FromArgb($random.Next(60, 200), $random.Next(60, 200), $random.Next(60, 200))
      $bitmap.SetPixel($x, $y, $color)
    }
  }

  $memory = New-Object System.IO.MemoryStream
  $bitmap.Save($memory, [System.Drawing.Imaging.ImageFormat]::Jpeg)
  $bitmap.Dispose()
  return $memory.ToArray()
}

function New-DeviceContext([string]$Bssid = $WifiBssid) {
  return (@{
      deviceId   = $script:DeviceId
      model      = 'SmokeTest Phone'
      osVersion  = '17.5'
      appVersion = '1.0.0'
      isRooted   = $false
      wifiBssid  = $Bssid
    } | ConvertTo-Json -Compress)
}

function New-Location {
  # Toạ độ chi nhánh demo trong seed.
  return (@{
      latitude  = 21.0123
      longitude = 105.7987
      accuracy  = 8.2
      provider  = 'gps'
      isMocked  = $false
    } | ConvertTo-Json -Compress)
}

# ===========================================================================
#  BẮT ĐẦU
# ===========================================================================

Write-Host ''
Write-Host '======================================================================' -ForegroundColor Yellow
Write-Host ' SmartFace — chạy thử luồng nghiệp vụ qua API thật' -ForegroundColor Yellow
Write-Host '======================================================================' -ForegroundColor Yellow
Write-Info "Backend   : $ApiUrl"
Write-Info "AI Server : $AiUrl"
Write-Info "Thiết bị  : $script:DeviceId"

# ---------------------------------------------------------------------------
Write-Step 'Kiểm tra hai dịch vụ còn sống'

# `/health` nằm NGOÀI prefix /v1 (main.ts loại nó khỏi setGlobalPrefix).
$healthUrl = ($ApiUrl -replace '/v1/?$', '') + '/health'
$health = Invoke-Api -Method GET -Path $healthUrl
if ($health.StatusCode -ne 200) { Write-Fail 'Backend không phản hồi. Đã chạy: npm run start:dev ?' }
Write-Ok 'Backend sống'

$aiHealth = Invoke-Api -Method GET -Path "$AiUrl/health"
if ($aiHealth.StatusCode -ne 200) { Write-Fail "AI Server không phản hồi. Đã chạy uvicorn chưa?" }
Write-Ok "AI Server sống — engine: $($aiHealth.Body.engine), trạng thái: $($aiHealth.Body.status)"
if ($aiHealth.Body.engine -eq 'stub') {
  Write-Info 'Đang dùng engine GIẢ: số liệu nhận diện là dữ liệu bịa, chỉ để kiểm luồng.'
}

# ---------------------------------------------------------------------------
Write-Step 'Đăng nhập sai — cả ba loại sai phải trả CÙNG một mã lỗi'

$wrongDomain = Invoke-Api -Method POST -Path '/auth/login' -Body @{ domain = 'khong-ton-tai.vn'; email = $Email; password = $Password }
Assert-Rejected $wrongDomain 'AUTH_INVALID_CREDENTIALS' 'Sai tên miền'

$wrongEmail = Invoke-Api -Method POST -Path '/auth/login' -Body @{ domain = $Domain; email = 'khong-co@amobi.vn'; password = $Password }
Assert-Rejected $wrongEmail 'AUTH_INVALID_CREDENTIALS' 'Email không tồn tại'

$wrongPassword = Invoke-Api -Method POST -Path '/auth/login' -Body @{ domain = $Domain; email = $Email; password = 'SaiBetMatKhau2026' }
Assert-Rejected $wrongPassword 'AUTH_INVALID_CREDENTIALS' 'Sai mật khẩu'

Write-Info 'Ba mã giống nhau = màn hình đăng nhập không dùng để dò email nhân viên được.'

# ---------------------------------------------------------------------------
Write-Step 'Đăng nhập đúng'

$login = Invoke-Api -Method POST -Path '/auth/login' -Body @{
  domain     = $Domain
  email      = $Email
  password   = $Password
  deviceId   = $script:DeviceId
  deviceInfo = @{ model = 'SmokeTest Phone'; os = 'iOS'; osVersion = '17.5'; appVersion = '1.0.0' }
}

if ($login.StatusCode -ne 200) {
  $code = Get-ErrorCode $login
  if ($code -eq 'AUTH_INVALID_CREDENTIALS') {
    Write-Info "Thử lại với mật khẩu đã đổi ở lần chạy trước..."
    $login = Invoke-Api -Method POST -Path '/auth/login' -Body @{
      domain = $Domain; email = $Email; password = $NewPassword; deviceId = $script:DeviceId
    }
  }
  if ($login.StatusCode -ne 200) { Write-Fail "Đăng nhập thất bại: $(Get-ErrorCode $login)" }
}

$token = $login.Body.data.accessToken
$nextStep = $login.Body.data.nextStep
Write-Ok "Đăng nhập thành công — nextStep: $nextStep"
Write-Info "Nhân viên: $($login.Body.data.employee.employeeCode)"
if ($login.Body.data.deviceSecret) {
  Write-Info 'deviceSecret được cấp (chỉ một lần) — App lưu vào secure enclave để ký HMAC.'
}

# ---------------------------------------------------------------------------
if ($nextStep -eq 'CHANGE_PASSWORD') {
  Write-Step 'Chưa đổi mật khẩu tạm — mọi API khác PHẢI bị chặn'

  $blocked = Invoke-Api -Method GET -Path '/attendance/today' -Token $token
  Assert-Rejected $blocked 'AUTH_MUST_CHANGE_PASSWORD' 'Gọi /attendance/today khi còn mật khẩu tạm'
  Write-Info 'Chốt này cưỡng chế ở SERVER, không phải chỉ điều hướng ở App.'

  Write-Step 'Đổi mật khẩu'
  $changed = Invoke-Api -Method POST -Path '/auth/password/change' -Token $token -Body @{
    currentPassword = $Password; newPassword = $NewPassword
  }
  if ($changed.StatusCode -ne 200) { Write-Fail "Đổi mật khẩu thất bại: $(Get-ErrorCode $changed)" }

  $token = $changed.Body.data.accessToken
  $nextStep = $changed.Body.data.nextStep
  Write-Ok "Đã đổi — nextStep: $nextStep, thu hồi $($changed.Body.data.revokedSessions) phiên cũ"
}

# ---------------------------------------------------------------------------
Write-Step 'Mật khẩu yếu phải bị từ chối'

$weak = Invoke-Api -Method POST -Path '/auth/password/change' -Token $token -Body @{
  currentPassword = $NewPassword; newPassword = 'abc123'
}
Assert-Rejected $weak $null 'Mật khẩu quá ngắn'

# ---------------------------------------------------------------------------
Write-Step 'Trạng thái sinh trắc học'

$bio = Invoke-Api -Method GET -Path '/biometric/status' -Token $token
if ($bio.StatusCode -ne 200) { Write-Fail "Không đọc được trạng thái: $(Get-ErrorCode $bio)" }
$hasFace = $bio.Body.data.face.enrolled
Write-Ok "Đã đăng ký khuôn mặt: $hasFace | vân tay: $($bio.Body.data.fingerprint.enrolled)"

# ---------------------------------------------------------------------------
if (-not $hasFace) {
  Write-Step 'Đăng ký khuôn mặt — 4 góc chụp'

  $start = Invoke-Api -Method POST -Path '/biometric/face/enroll/start' -Token $token -Body @{}
  if ($start.StatusCode -ne 200) { Write-Fail "Không mở được phiên: $(Get-ErrorCode $start)" }

  $sessionId = $start.Body.data.sessionId
  Write-Ok "Phiên $sessionId, $($start.Body.data.steps.Count) bước, hết hạn sau $($start.Body.data.expiresIn)s"
  foreach ($s in $start.Body.data.steps) {
    Write-Info "  bước $($s.order): góc $($s.angle), hành động $(if ($s.action) { $s.action } else { '(không)' })"
  }

  # Cùng một seed cho cả 4 bước: engine giả băm nội dung ảnh ra embedding, nên
  # 4 ảnh khác nhau sẽ thành "4 người khác nhau" và bước xác minh sẽ trượt.
  foreach ($s in $start.Body.data.steps) {
    $image = New-TestImage -Seed 1
    $form = New-Multipart -Fields @{ sessionId = $sessionId; order = $s.order } -FileField 'image' -FileBytes $image

    $submit = Invoke-Api -Method POST -Path '/biometric/face/enroll/submit' -Token $token `
      -RawBody $form.Bytes -ContentType $form.ContentType
    if ($submit.StatusCode -ne 200) { Write-Fail "Bước $($s.order) thất bại: $(Get-ErrorCode $submit)" }

    if ($submit.Body.data.completed) {
      Write-Ok "Hoàn tất — lưu $($submit.Body.data.profileCount) hồ sơ, model $($submit.Body.data.modelVersion)"
    } else {
      Write-Ok "Bước $($s.order) xong, tiếp theo: $($submit.Body.data.nextOrder)"
    }
  }
}

# ---------------------------------------------------------------------------
Write-Step 'Lấy challenge chấm công'

$challenge = Invoke-Api -Method GET -Path '/attendance/challenge' -Token $token
if ($challenge.StatusCode -ne 200) { Write-Fail "Không lấy được challenge: $(Get-ErrorCode $challenge)" }

$nonce = $challenge.Body.data.nonce
Write-Ok "nonce nhận được, hành động liveness: $($challenge.Body.data.livenessAction)"
Write-Info "Server chọn ngẫu nhiên mỗi lần (AF-05) — App không được tự quyết."
Write-Info "expectedType: $($challenge.Body.data.expectedType), giờ server: $($challenge.Body.data.serverTime)"

# ---------------------------------------------------------------------------
Write-Step 'Chấm công với BSSID SAI — phải bị từ chối (AF-02)'

$badWifiForm = New-Multipart -Fields @{
  nonce         = $nonce
  clientTime    = (Get-Date).ToUniversalTime().ToString('o')
  authMethod    = 'FACE'
  location      = New-Location
  deviceContext = New-DeviceContext -Bssid 'ff:ee:dd:cc:bb:aa'
} -FileField 'image' -FileBytes (New-TestImage -Seed 1)

$badWifi = Invoke-Api -Method POST -Path '/attendance/check-in' -Token $token `
  -RawBody $badWifiForm.Bytes -ContentType $badWifiForm.ContentType
Assert-Rejected $badWifi 'ATT_WIFI_REQUIRED' 'BSSID không phải WiFi văn phòng'
Write-Info 'Không có bản ghi chấm công nào được tạo.'

# ---------------------------------------------------------------------------
Write-Step 'Chấm công đúng điều kiện'

# Nonce đã bị tiêu thụ ở lần thử trên? Không — request bị chặn TRƯỚC khi ghi,
# nhưng nonce đã bị consume ở bước đầu của punch(). Lấy nonce mới.
$challenge2 = Invoke-Api -Method GET -Path '/attendance/challenge' -Token $token
$nonce2 = $challenge2.Body.data.nonce

$checkinForm = New-Multipart -Fields @{
  nonce         = $nonce2
  clientTime    = (Get-Date).ToUniversalTime().ToString('o')
  authMethod    = 'FACE'
  location      = New-Location
  deviceContext = New-DeviceContext
} -FileField 'image' -FileBytes (New-TestImage -Seed 1)

$checkin = Invoke-Api -Method POST -Path '/attendance/check-in' -Token $token `
  -RawBody $checkinForm.Bytes -ContentType $checkinForm.ContentType

if ($checkin.StatusCode -ne 200) {
  $code = Get-ErrorCode $checkin
  switch ($code) {
    'ATT_ALREADY_CHECKED_IN' { Write-Ok 'Đã chấm vào từ trước — đúng nghiệp vụ (BR-ATT-01)' }
    'ATT_IP_NOT_ALLOWED' {
      Write-Host '    IP nguồn không nằm trong dải cho phép (AF-02b).' -ForegroundColor Red
      Write-Host '    Seed đã khai 127.0.0.0/8 và ::1/128 cho chi nhánh demo.' -ForegroundColor Red
      Write-Fail 'Kiểm TRUSTED_PROXY_HOPS trong .env — chạy thẳng không proxy thì phải là 0.'
    }
    'ATT_IP_NOT_CONFIGURED' { Write-Fail 'Chi nhánh chưa khai allowedIpCidrs. Chạy lại: npm run seed' }
    'ATT_WIFI_NOT_CONFIGURED' { Write-Fail 'Chi nhánh chưa khai wifiBssids. Chạy lại: npm run seed' }
    'FACE_NOT_MATCHED' {
      Write-Host '    Khuôn mặt không khớp. Với engine GIẢ, ảnh đăng ký và ảnh chấm công' -ForegroundColor Red
      Write-Host '    phải GIỐNG HỆT (cùng seed) vì embedding sinh từ băm nội dung ảnh.' -ForegroundColor Red
      Write-Fail 'Nếu đã đăng ký ở lần chạy trước với seed khác, xoá hồ sơ khuôn mặt rồi chạy lại.'
    }
    default { Write-Fail "Chấm công thất bại: $code — $($checkin.Body.error.message)" }
  }
} else {
  $data = $checkin.Body.data
  Write-Ok 'Chấm công thành công'
  Write-Info "  attendanceId  : $($data.attendanceId)"
  Write-Info "  recordedAt    : $($data.recordedAt)   (GIỜ SERVER, không phải giờ máy)"
  Write-Info "  workDate      : $($data.workDate)"
  Write-Info "  decision      : $($data.decision)"
  Write-Info "  đi muộn       : $($data.lateMinutes) phút"
  Write-Info "  cách chi nhánh: $($data.distanceToBranchM) m, trong vùng: $($data.insideGeofence)"
  Write-Info "  fraudScore    : $($data.fraudScore)"
  if ($data.flags.Count -gt 0) {
    foreach ($f in $data.flags) { Write-Info "  cờ: $($f.code) [$($f.severity)] $($f.message)" }
  }
}

# ---------------------------------------------------------------------------
Write-Step 'Dùng lại nonce cũ — phải bị từ chối (chống replay)'

$replayForm = New-Multipart -Fields @{
  nonce         = $nonce2
  clientTime    = (Get-Date).ToUniversalTime().ToString('o')
  authMethod    = 'FACE'
  location      = New-Location
  deviceContext = New-DeviceContext
} -FileField 'image' -FileBytes (New-TestImage -Seed 1)

$replay = Invoke-Api -Method POST -Path '/attendance/check-in' -Token $token `
  -RawBody $replayForm.Bytes -ContentType $replayForm.ContentType
Assert-Rejected $replay $null 'Gửi lại nonce đã dùng'

# ---------------------------------------------------------------------------
Write-Step 'Thiếu header X-Device-Id — phải bị từ chối (AF-16)'

$noDevice = Invoke-Api -Method GET -Path '/attendance/today' -Headers @{ Authorization = "Bearer $token" }
Assert-Rejected $noDevice 'AUTH_DEVICE_MISMATCH' 'Token của App mà không gửi X-Device-Id'
Write-Info 'Bỏ header không còn là cách bỏ qua kiểm tra thiết bị.'

# ---------------------------------------------------------------------------
Write-Step 'Xem trạng thái hôm nay'

$today = Invoke-Api -Method GET -Path '/attendance/today' -Token $token
if ($today.StatusCode -eq 200) {
  Write-Ok "Trạng thái: $($today.Body.data.status), đã làm $($today.Body.data.workedMinutes) phút"
  Write-Info "Ca: $($today.Body.data.shift.name) $($today.Body.data.shift.startTime)–$($today.Body.data.shift.endTime)"
}

# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '======================================================================' -ForegroundColor Green
Write-Host ' HOÀN TẤT — toàn bộ luồng chạy thông' -ForegroundColor Green
Write-Host '======================================================================' -ForegroundColor Green
Write-Host ''
Write-Info "Mật khẩu hiện tại của $Email là: $NewPassword"
Write-Info 'Chạy lại kịch bản này sẽ tự nhận ra và dùng mật khẩu đó.'
Write-Host ''
