import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { AttendanceType, AuthMethod, DailyStatus } from '@prisma/client';
import { DateRangeQueryDto, PaginationQueryDto } from 'src/common/dto';

/**
 * Toạ độ GPS kèm siêu dữ liệu để đánh giá độ tin cậy.
 *
 * ⚠ Không trường nào ở đây đáng tin tuyệt đối — toàn bộ do App tự khai, mà App
 * chạy trên máy của người dùng. Máy đã root cài app giả toạ độ có thể điền bất
 * cứ giá trị nào. Vì thế đây chỉ là MỘT tín hiệu, cộng với WiFi BSSID, beacon,
 * lịch sử hành vi và điểm khuôn mặt mới thành quyết định (AF-01).
 */
export class LocationDto {
  // Chặn khoảng vĩ độ/kinh độ hợp lệ. Bắt được lỗi lập trình phổ biến nhất:
  // đảo ngược latitude và longitude — với Việt Nam (21, 105) thì kinh độ 105
  // vượt ngưỡng 90 nên lộ ra ngay, thay vì âm thầm trỏ sang giữa đại dương.
  @ApiProperty({ example: 21.012345 })
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @ApiProperty({ example: 105.798765 })
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;

  /**
   * Bán kính sai số do hệ điều hành báo, tính bằng mét.
   *
   * Quan trọng khi so với geofence: toạ độ nằm ngoài vùng 30m nhưng `accuracy`
   * là 50m thì người đó vẫn có thể đang ở trong văn phòng. Bỏ qua trường này mà
   * chỉ so khoảng cách sẽ chặn oan người ngồi gần cửa sổ hoặc trong nhà xưởng.
   */
  @ApiPropertyOptional({ example: 8.2, description: 'Bán kính sai số, tính bằng mét' })
  @IsOptional()
  @IsNumber()
  accuracy?: number;

  // `network` (định vị theo trạm phát sóng) sai số hàng trăm mét — không đủ tin
  // cậy để làm bằng chứng vị trí. `mock` là App tự thú nhận đang dùng toạ độ giả.
  @ApiPropertyOptional({ example: 'gps', enum: ['gps', 'network', 'fused', 'mock'] })
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiPropertyOptional({
    description:
      'AF-01: cờ mock location do App báo. Backend KHÔNG tin tuyệt đối — đây chỉ là MỘT tín hiệu trong nhiều lớp phòng thủ.',
  })
  @IsOptional()
  @IsBoolean()
  isMocked?: boolean;

  // Độ cao — phân biệt tầng trong toà nhà cao tầng, nơi toạ độ phẳng như nhau.
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  altitude?: number;

  // Tốc độ di chuyển. Chấm công khi đang chạy 60 km/h là dấu hiệu rõ ràng của
  // việc chấm công từ trên xe, chưa hề tới nơi làm việc.
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  speed?: number;

  // Thời điểm LẤY ĐƯỢC toạ độ, khác thời điểm gửi request. Chênh lệch lớn nghĩa
  // là App dùng lại toạ độ cũ trong cache — có thể do mất sóng, cũng có thể là
  // cố tình lưu lại toạ độ văn phòng để dùng khi ở nhà.
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  capturedAt?: string;
}

/**
 * Bối cảnh thiết bị — trả lời câu hỏi "máy này có đáng tin không".
 */
export class DeviceContextDto {
  // Phải khớp `deviceId` trong JWT (AF-16). Lệch nghĩa là token đang được dùng
  // trên máy khác máy đã đăng nhập — dấu hiệu token bị đánh cắp.
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  deviceId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  osVersion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  appVersion?: string;

  // AF-14. Nghịch lý: máy root để giả toạ độ cũng là máy sửa được cờ này thành
  // `false`. Nên `true` là bằng chứng đáng tin, còn `false` thì không chứng minh
  // được gì. Dùng như tín hiệu một chiều, đừng coi `false` là "máy sạch".
  @ApiPropertyOptional({ description: 'AF-14' })
  @IsOptional()
  @IsBoolean()
  isRooted?: boolean;

  // AF-15 — thứ DUY NHẤT ở DTO này không giả được, vì token do Google/Apple ký
  // và Backend xác minh với máy chủ của họ. Các cờ khác đều là lời tự khai của
  // App; token này là lời chứng của bên thứ ba.
  @ApiPropertyOptional({ description: 'AF-15: Play Integrity / App Attest token' })
  @IsOptional()
  @IsString()
  attestationToken?: string;

  // AF-02 — bằng chứng vị trí mạnh hơn GPS: muốn thấy được BSSID thì phải ở
  // trong tầm phủ sóng WiFi thật, không có app nào "giả WiFi từ xa" được.
  @ApiPropertyOptional({ description: 'AF-02: BSSID của WiFi văn phòng' })
  @IsOptional()
  @IsString()
  wifiBssid?: string;

  // Dành cho nhà xưởng, tầng hầm — nơi GPS gần như vô dụng.
  @ApiPropertyOptional({ description: 'AF-02: UUID của beacon BLE' })
  @IsOptional()
  @IsString()
  beaconUuid?: string;
}

/**
 * Payload chấm công.
 *
 * ⚠ TUYỆT ĐỐI KHÔNG có trường `faceVerified` / `biometricOk` / `livenessPassed`.
 * Backend tự kiểm chứng với AI Server (BR-02, AF-10). Nếu thấy trường như vậy
 * xuất hiện ở đây, đó là LỖI NGHIÊM TRỌNG cần sửa ngay.
 */
export class CheckInDto {
  /**
   * Nonce dùng MỘT LẦN, lấy từ `GET /attendance/challenge` (AF-12).
   *
   * Chặn replay: kẻ tấn công bắt được gói tin chấm công hợp lệ rồi gửi lại y
   * nguyên vào ngày hôm sau sẽ bị từ chối, vì nonce đó đã bị tiêu thụ. Redis
   * `SET NX EX` bảo đảm tính nguyên tử — nhiều pod chạy song song vẫn chỉ một
   * request duy nhất chiếm được nonce.
   */
  @ApiProperty({ description: 'Nonce lấy từ GET /attendance/challenge, dùng một lần' })
  @IsString()
  @IsNotEmpty()
  nonce!: string;

  /**
   * Giờ trên máy người dùng. KHÔNG dùng để tính công (BR-01).
   *
   * Lưu lại chỉ để so với giờ server: chênh lệch bất thường là dấu hiệu người
   * dùng chỉnh giờ máy nhằm lách chốt ca. Nếu dùng con số này tính giờ vào/ra
   * thì ai cũng "đi làm đúng giờ" chỉ bằng cách vặn đồng hồ điện thoại.
   */
  @ApiProperty({
    description: 'Giờ máy — CHỈ để đối chiếu phát hiện gian lận, KHÔNG dùng tính công (BR-01)',
  })
  @IsDateString()
  clientTime!: string;

  @ApiProperty({ enum: [AuthMethod.FACE, AuthMethod.FINGERPRINT] })
  @IsEnum(AuthMethod)
  authMethod!: AuthMethod;

  /**
   * Chữ ký nonce tạo từ khoá nằm trong secure enclave của máy.
   *
   * Vân tay KHÔNG bao giờ rời khỏi thiết bị — hệ điều hành chỉ mở khoá private
   * key sau khi người dùng chạm vân tay, rồi khoá đó ký nonce. Backend xác minh
   * bằng public key đã đăng ký. Nhờ vậy chứng minh được "đúng người, đúng máy"
   * mà server không bao giờ nắm giữ dữ liệu sinh trắc.
   *
   * Ràng buộc "bắt buộc khi FINGERPRINT" phải do service kiểm tra — decorator
   * không diễn đạt được điều kiện phụ thuộc vào trường khác.
   */
  @ApiPropertyOptional({
    description: 'Bắt buộc khi authMethod=FINGERPRINT: chữ ký nonce từ secure enclave',
  })
  @IsOptional()
  @IsString()
  signedChallenge?: string;

  @ApiProperty({ type: LocationDto })
  @IsObject()
  @ValidateNested()
  @Type(() => LocationDto)
  // App gửi bằng `multipart/form-data` (có kèm ảnh) thì object lồng nhau tới
  // server dưới dạng CHUỖI JSON, không phải object. Không parse ở đây thì
  // `@ValidateNested()` nhận vào một chuỗi và mọi request có ảnh đều bị 400.
  @Transform(({ value }) => (typeof value === 'string' ? JSON.parse(value) : value))
  location!: LocationDto;

  @ApiProperty({ type: DeviceContextDto })
  @IsObject()
  @ValidateNested()
  @Type(() => DeviceContextDto)
  // App gửi bằng `multipart/form-data` (có kèm ảnh) thì object lồng nhau tới
  // server dưới dạng CHUỖI JSON, không phải object. Không parse ở đây thì
  // `@ValidateNested()` nhận vào một chuỗi và mọi request có ảnh đều bị 400.
  @Transform(({ value }) => (typeof value === 'string' ? JSON.parse(value) : value))
  deviceContext!: DeviceContextDto;

  @ApiPropertyOptional({ description: 'Chi nhánh dự kiến. Bỏ trống = tự chọn chi nhánh gần nhất.' })
  @IsOptional()
  @IsString()
  branchId?: string;
}

// ---------------------------------------------------------------------------
// Truy vấn
// ---------------------------------------------------------------------------

export class AttendanceHistoryQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: '2026-08-01' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-08-31' })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional({ enum: DailyStatus })
  @IsOptional()
  @IsEnum(DailyStatus)
  status?: DailyStatus;
}

export class AdminAttendanceQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: '2026-08-01' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-08-31' })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  branchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  employeeId?: string;

  @ApiPropertyOptional({ enum: DailyStatus })
  @IsOptional()
  @IsEnum(DailyStatus)
  status?: DailyStatus;

  @ApiPropertyOptional({ description: 'Chỉ lấy ngày có cờ nghi vấn' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  hasFraudFlag?: boolean;
}

/**
 * BR-ADJ-01 — hiệu chỉnh KHÔNG sửa đè bản ghi thô, mà tạo bản ghi điều chỉnh riêng.
 *
 * Bản ghi chấm công gốc là bằng chứng: nó ghi lại đúng những gì thiết bị thu
 * được tại thời điểm đó. Cho phép sửa đè nghĩa là quản lý có thể lặng lẽ đổi giờ
 * vào của nhân viên mà không để lại dấu vết — mất sạch giá trị đối chứng khi
 * tranh chấp lao động, và hệ thống chấm công không còn đáng tin.
 *
 * Thay vào đó mỗi lần hiệu chỉnh tạo một `AttendanceAdjustment` mới, giữ nguyên
 * bản gốc. Bảng công cuối cùng = bản ghi thô + các điều chỉnh chồng lên, và luôn
 * truy được ai sửa, sửa gì, vì sao.
 */
export class AdjustAttendanceDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  employeeId!: string;

  @ApiProperty({ example: '2026-08-02' })
  @IsDateString()
  workDate!: string;

  /**
   * - `ADD`         — thêm lượt còn thiếu (quên chấm công, máy hỏng).
   * - `MODIFY_TIME` — chỉnh giờ của một lượt đã có.
   * - `VOID`        — vô hiệu hoá một lượt sai (chấm nhầm, chấm trùng).
   *
   * `VOID` KHÔNG xoá bản ghi, chỉ đánh dấu không tính vào bảng công. Bản ghi gốc
   * vẫn nằm đó để tra cứu.
   */
  @ApiProperty({ enum: ['ADD', 'MODIFY_TIME', 'VOID'] })
  @IsIn(['ADD', 'MODIFY_TIME', 'VOID'])
  adjustType!: 'ADD' | 'MODIFY_TIME' | 'VOID';

  @ApiPropertyOptional({ description: 'Bắt buộc với MODIFY_TIME và VOID' })
  @IsOptional()
  @IsString()
  attendanceLogId?: string;

  @ApiPropertyOptional({
    description: 'Giá trị mới. VD: { "recordedAt": "2026-08-02T01:00:00Z", "type": "CHECK_IN" }',
  })
  @IsOptional()
  @IsObject()
  afterValue?: Record<string, unknown>;

  /**
   * BR-ADJ-02 — bắt buộc, tối thiểu 10 ký tự.
   *
   * Sàn 10 ký tự là để chặn thói quen gõ "ok", "sửa", "." cho xong. Hiệu chỉnh
   * công là thao tác đụng thẳng vào tiền lương; sáu tháng sau khi có khiếu nại,
   * một dòng "." không giúp ai giải thích được điều gì.
   */
  @ApiProperty({ description: 'BR-ADJ-02: bắt buộc, tối thiểu 10 ký tự', minLength: 10 })
  @IsString()
  @Length(10, 1000)
  reason!: string;

  @ApiPropertyOptional({ description: 'Đơn "Bổ sung công" liên quan' })
  @IsOptional()
  @IsString()
  requestId?: string;
}

/**
 * Xuất bảng công ra Excel/CSV.
 *
 * Chạy nền qua BullMQ chứ không trả file ngay: một công ty 500 người × 31 ngày
 * là hơn 15.000 dòng, dựng file mất hàng chục giây và sẽ vượt timeout của HTTP.
 * Endpoint trả về `jobId`, client hỏi tiến độ qua `GET /v1/jobs/:id`.
 */
export class ExportAttendanceDto extends DateRangeQueryDto {
  /**
   * Bỏ trống = toàn bộ phạm vi người yêu cầu được phép xem, KHÔNG phải toàn công ty.
   * Với `MANAGER`, kết quả luôn bị giao với phạm vi phòng ban trong JWT — xem
   * `resolveExportDepartmentFilter()` ở `attendance-admin.service.ts`.
   */
  @ApiPropertyOptional({ type: [String], description: 'Bỏ trống = toàn bộ phạm vi được phép' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  departmentIds?: string[];

  @ApiPropertyOptional({ enum: ['XLSX', 'CSV'], default: 'XLSX' })
  @IsOptional()
  @IsIn(['XLSX', 'CSV'])
  format?: 'XLSX' | 'CSV';

  @ApiPropertyOptional({ default: 'default' })
  @IsOptional()
  @IsString()
  template?: string;
}

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

/**
 * Phản hồi của `GET /attendance/challenge` — bước BẮT BUỘC trước khi chấm công.
 *
 * Vì sao phải có bước riêng thay vì chấm công một phát:
 *
 * - Server phát nonce dùng một lần → chặn phát lại gói tin cũ (AF-12).
 * - Server chọn hành động liveness NGẪU NHIÊN → kẻ gian không chuẩn bị sẵn được
 *   video nháy mắt, vì không biết trước sẽ bị yêu cầu làm gì (AF-05).
 * - Server trả giờ chuẩn → App phát hiện máy bị chỉnh giờ (AF-18).
 */
export class AttendanceChallengeDto {
  @ApiProperty()
  nonce!: string;

  @ApiProperty({ description: 'BR-01: App đối chiếu với giờ máy để phát hiện chỉnh giờ (AF-18)' })
  serverTime!: string;

  @ApiProperty({ example: 60 })
  expiresIn!: number;

  @ApiProperty({
    example: 'BLINK',
    description: 'AF-05: hành động liveness do SERVER chọn NGẪU NHIÊN, App không tự quyết',
  })
  livenessAction!: string;

  // Server suy ra lượt tiếp theo là VÀO hay RA từ lịch sử trong ngày. App chỉ
  // hiển thị đúng nút; nếu để App tự đoán thì hai thiết bị của cùng một người có
  // thể cùng nghĩ đang cần "check-in" và tạo ra bản ghi trùng.
  @ApiProperty({ enum: AttendanceType })
  expectedType!: AttendanceType;

  // Tuỳ chính sách công ty: có nơi chỉ yêu cầu ảnh ở lượt vào, có nơi cả hai.
  @ApiProperty()
  requiresPhoto!: boolean;
}
