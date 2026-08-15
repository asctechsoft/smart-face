import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
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
import { ShiftType } from '@prisma/client';

/**
 * DTO cấu hình chính sách công ty — BR-12: không hard-code, mọi thứ chỉnh được.
 *
 * Đây là nơi mỗi công ty tự đặt luật của mình: bao nhiêu phút coi là đi muộn,
 * điểm khuôn mặt bao nhiêu thì chấp nhận, ra khỏi vùng geofence thì chặn hay cho
 * qua chờ duyệt. Nhét các ngưỡng này vào code nghĩa là mỗi khách hàng mới lại
 * phải sửa mã nguồn và deploy lại.
 */
export class UpdatePoliciesDto {
  /**
   * Kiểu `Record<string, unknown>` là có chủ đích, không phải lười khai kiểu.
   *
   * Danh mục chính sách còn dài ra theo thời gian; khai cứng thành class thì
   * thêm một chính sách là phải sửa DTO, sửa Swagger, sửa client. Đổi lại,
   * `policy.service.ts` PHẢI kiểm tra từng key theo danh mục `PolicyKeys` và
   * ép đúng kiểu giá trị — không có tầng đó thì gõ sai tên key sẽ được lưu im
   * lặng và chính sách không bao giờ có tác dụng, mà không ai báo lỗi.
   */
  @ApiProperty({
    description: 'Cặp key-value chính sách. Key phải nằm trong danh mục PolicyKeys.',
    example: {
      'attendance.geofence.outOfRangeAction': 'PENDING_REVIEW',
      'ai.face.matchThreshold': 0.5,
    },
  })
  @IsObject()
  policies!: Record<string, unknown>;

  /**
   * D6 — chính sách có hiệu lực theo thời gian, KHÔNG ghi đè lịch sử.
   *
   * Đổi ngưỡng đi muộn hôm nay không được phép tính lại bảng công tháng trước.
   * Nhân viên đã bị trừ lương theo luật cũ mà tự dưng đổi ngược lại là sai, và
   * ngược lại cũng vậy. Vì thế mỗi thay đổi tạo một bản ghi mới có mốc hiệu lực,
   * bản cũ giữ nguyên để tính lại kỳ cũ vẫn ra đúng con số ngày trước.
   */
  @ApiPropertyOptional({
    description: 'Thời điểm bắt đầu hiệu lực (D6). Mặc định là ngay bây giờ.',
  })
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  // Ghi vào audit log. Khi có tranh chấp lương, câu hỏi đầu tiên luôn là "ai đổi
  // ngưỡng này, lúc nào, vì sao" — không có trường này thì chỉ trả lời được 2/3.
  @ApiPropertyOptional({ description: 'Lý do thay đổi — ghi vào audit log.' })
  @IsOptional()
  @IsString()
  reason?: string;
}

/**
 * Một đoạn của ca gãy — ví dụ ca hành chính 08:00–12:00 và 13:30–17:30.
 *
 * Tách đoạn để giờ nghỉ trưa KHÔNG bị tính vào giờ công, và để người ra ngoài
 * giữa hai đoạn không bị coi là bỏ vị trí.
 */
export class ShiftSegmentDto {
  // Thứ tự đoạn trong ngày. Cần tường minh vì client gửi mảng lên không bảo đảm
  // đúng thứ tự, mà tính giờ công thì phụ thuộc đoạn nào trước đoạn nào.
  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  order!: number;

  // Dạng 'HH:mm' theo giờ ĐỊA PHƯƠNG của công ty, không phải UTC. Ca làm là khái
  // niệm theo giờ treo tường: "08:00" luôn là 8 giờ sáng ở chỗ người ta làm việc,
  // kể cả khi công ty có chi nhánh ở múi giờ khác.
  @ApiProperty({ example: '08:00' })
  @IsString()
  startTime!: string;

  @ApiProperty({ example: '12:00' })
  @IsString()
  endTime!: string;
}

/**
 * Hệ số ngày công của MỘT ca trong MỘT ngày lễ cụ thể.
 *
 * Dùng `holidayId` chứ không dùng ngày: ngày lễ có thể được dời (nghỉ bù khi lễ
 * rơi vào cuối tuần), và khi dời thì ngoại lệ phải đi theo ngày lễ đó chứ không
 * ở lại ô lịch cũ.
 */
export class ShiftHolidayFactorDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  holidayId!: string;

  @ApiProperty({ example: 3.5 })
  @IsNumber()
  @Min(0)
  @Max(10)
  factor!: number;
}

/**
 * Tạo/sửa ca làm việc.
 *
 * Gần như mọi trường đều `optional` vì một DTO phải phục vụ nhiều loại ca:
 * ca cố định cần `startTime`/`endTime`, ca linh hoạt chỉ cần `requiredMinutes`,
 * ca gãy dùng `segments`. Ràng buộc "loại ca nào bắt buộc trường nào" nằm ở
 * `policy-admin.service.ts` chứ không diễn đạt được bằng decorator.
 */
export class UpsertShiftDto {
  @ApiProperty({ example: 'Hành chính' })
  @IsString()
  @Length(1, 100)
  name!: string;

  /**
   * Mã ca — duy nhất trong công ty, KHÔNG đổi được sau khi ca đã được phân.
   *
   * Chuẩn hoá về chữ hoa ngay tại DTO. Không làm thì "hc" và "HC" cùng lọt qua
   * ràng buộc duy nhất và trở thành hai ca mà mắt người đọc là một.
   */
  @ApiProperty({ example: 'HC', description: 'Mã ca, duy nhất trong công ty' })
  @IsString()
  @Length(1, 20)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  code!: string;

  @ApiPropertyOptional({ example: 'X', description: 'Ký hiệu in trên bảng chấm công' })
  @IsOptional()
  @IsString()
  @Length(1, 10)
  symbol?: string;

  /**
   * Phòng ban áp dụng. Rỗng = mọi phòng ban.
   *
   * Chỉ lọc gợi ý ở màn phân ca, không chặn — xem chú thích trong `schema.prisma`.
   */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  departmentIds?: string[];

  @ApiPropertyOptional({ enum: ShiftType, default: ShiftType.FIXED })
  @IsOptional()
  type?: ShiftType;

  @ApiPropertyOptional({ example: '08:00' })
  @IsOptional()
  @IsString()
  startTime?: string;

  @ApiPropertyOptional({ example: '17:30' })
  @IsOptional()
  @IsString()
  endTime?: string;

  /**
   * Ca đêm vắt qua nửa đêm — trường nhỏ nhưng sai là hỏng cả bảng công.
   *
   * Không có cờ này thì `endTime < startTime` (06:00 < 22:00) sẽ bị tính ra giờ
   * công ÂM, hoặc bị hiểu thành ca 16 tiếng. Cờ này cũng quyết định lượt chấm
   * công lúc 02:00 sáng thuộc về NGÀY LÀM VIỆC nào — người làm ca đêm hôm trước
   * phải được tính vào ngày hôm trước, không phải ngày mới.
   */
  @ApiPropertyOptional({
    description: 'true nếu ca kết thúc vào NGÀY HÔM SAU (ca đêm 22:00 → 06:00)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  crossesMidnight?: boolean;

  /**
   * Phút nghỉ giữa ca — nguồn DUY NHẤT mà máy tính công đọc.
   *
   * Gửi kèm `breakStart`/`breakEnd` thì trường này bị BỎ QUA và tính lại từ hai
   * mốc giờ đó. Ưu tiên như vậy để không bao giờ tồn tại một ca khai nghỉ
   * 12:00–13:00 mà `breakMinutes` lại là 30 — hai con số cùng mô tả một việc thì
   * phải có một cái làm chủ, và cái mô tả cụ thể hơn thắng.
   */
  @ApiPropertyOptional({ example: 60, description: 'Phút nghỉ giữa ca (nghỉ trưa)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  breakMinutes?: number;

  @ApiPropertyOptional({ example: '12:00', description: 'Giờ bắt đầu nghỉ giữa ca' })
  @IsOptional()
  @IsString()
  breakStart?: string;

  @ApiPropertyOptional({ example: '13:00', description: 'Giờ kết thúc nghỉ giữa ca' })
  @IsOptional()
  @IsString()
  breakEnd?: string;

  // ---------------------------------------------------------------------------
  //  Yêu cầu chấm công
  // ---------------------------------------------------------------------------

  /**
   * BR-ATT-02 — service từ chối `false`. Trường vẫn nhận vào để thông báo lỗi
   * nói đúng chuyện gì bị từ chối, thay vì âm thầm ghi đè thành `true`.
   */
  @ApiPropertyOptional({ default: true, description: 'Luôn phải là true' })
  @IsOptional()
  @IsBoolean()
  requireCheckIn?: boolean;

  @ApiPropertyOptional({ example: '07:00', description: 'Chấm vào sớm nhất được chấp nhận' })
  @IsOptional()
  @IsString()
  checkInFrom?: string;

  @ApiPropertyOptional({ example: '09:00', description: 'Chấm vào muộn nhất được chấp nhận' })
  @IsOptional()
  @IsString()
  checkInTo?: string;

  @ApiPropertyOptional({ default: true, description: 'Tắt cho ca chỉ điểm danh đầu giờ' })
  @IsOptional()
  @IsBoolean()
  requireCheckOut?: boolean;

  @ApiPropertyOptional({ example: '17:00' })
  @IsOptional()
  @IsString()
  checkOutFrom?: string;

  @ApiPropertyOptional({ example: '20:00' })
  @IsOptional()
  @IsString()
  checkOutTo?: string;

  // ---------------------------------------------------------------------------
  //  Ngày công & hệ số
  // ---------------------------------------------------------------------------

  @ApiPropertyOptional({ example: 1, description: 'Số ngày công ca này được tính. Nửa buổi = 0.5' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10)
  workDayCredit?: number;

  /**
   * Hệ số ngày công theo tính chất của ngày.
   *
   * ⚠ CHƯA nối vào máy tính công — lưu và hiển thị, chưa tác động tới bảng công.
   * `@Max(10)` chỉ để chặn số vô lý do gõ nhầm (nhập 300 thay vì 3.0).
   */
  @ApiPropertyOptional({ example: 1, description: 'Hệ số ngày thường' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10)
  normalDayFactor?: number;

  @ApiPropertyOptional({ example: 2, description: 'Hệ số ngày nghỉ tuần' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10)
  weeklyRestFactor?: number;

  @ApiPropertyOptional({ example: 3, description: 'Hệ số ngày lễ (mặc định chung)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10)
  holidayFactor?: number;

  /**
   * Hệ số đặt riêng cho từng ngày lễ — chỉ liệt kê NGOẠI LỆ.
   *
   * Gửi mảng lên là thay thế toàn bộ danh sách ngoại lệ hiện có: gửi `[]` nghĩa
   * là mọi ngày lễ quay về dùng `holidayFactor` chung. Bỏ trống (không gửi
   * trường) thì giữ nguyên danh sách cũ.
   */
  @ApiPropertyOptional({ type: [ShiftHolidayFactorDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShiftHolidayFactorDto)
  holidayFactors?: ShiftHolidayFactorDto[];

  @ApiPropertyOptional({ description: 'Ca linh hoạt: tổng phút phải làm trong ngày' })
  @IsOptional()
  @IsInt()
  @Min(0)
  requiredMinutes?: number;

  // Biên độ dung thứ, không phải "giờ vào mới". Đến 08:04 với biên độ 5 phút thì
  // KHÔNG bị ghi đi muộn, nhưng giờ vào vẫn lưu là 08:04 — báo cáo phải phản ánh
  // sự thật, chỉ có phần xử phạt mới được nới.
  @ApiPropertyOptional({ example: 5, description: 'Số phút trễ được bỏ qua (FR-WEB-POL-04)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  lateToleranceMinutes?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  earlyLeaveToleranceMinutes?: number;

  @ApiPropertyOptional({ description: 'Ca mặc định khi nhân viên không được phân ca cụ thể' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  /**
   * Bitmask ngày áp dụng — mỗi thứ là một bit, cộng lại thành một số.
   *
   * Ví dụ 31 = 1+2+4+8+16 = T2 đến T6 (tuần làm việc hành chính).
   * `@Max(127)` vì 7 bit đầy đủ là 1111111₂ = 127; số lớn hơn nghĩa là có bit
   * không ứng với thứ nào, chắc chắn do client tính sai.
   *
   * ⚠ Đây là một trong hai cách đánh số thứ tồn tại song song trong module này:
   * chỗ này dùng BITMASK (1, 2, 4, 8…), còn `BulkShiftAssignmentDto.weekdays`
   * dùng SỐ THỨ TỰ (1=T2 … 7=CN). Nhầm giữa hai cách sẽ cho lịch sai mà vẫn
   * chạy trơn tru — kiểm tra kỹ khi sửa code ở đây.
   */
  @ApiPropertyOptional({
    description: 'Bitmask ngày áp dụng: 1=T2, 2=T3, 4=T4, 8=T5, 16=T6, 32=T7, 64=CN. 0 = mọi ngày.',
    example: 31,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(127)
  weekdayMask?: number;

  @ApiPropertyOptional({ description: 'Hiệu lực từ (D6). Mặc định hôm nay.' })
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  effectiveTo?: string;

  @ApiPropertyOptional({ type: [ShiftSegmentDto], description: 'Ca gãy: nhiều đoạn trong ngày' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShiftSegmentDto)
  segments?: ShiftSegmentDto[];
}

/**
 * Phân ca hàng loạt — xếp một ca cho nhiều người trong một khoảng ngày.
 *
 * Có endpoint riêng vì thao tác thật của người dùng là "xếp ca tháng 8 cho cả
 * phòng 40 người": gọi 40×31 request đơn lẻ vừa chậm vừa hỏng dở chừng, để lại
 * lịch phân ca chỉ đúng một nửa.
 */
export class BulkShiftAssignmentDto {
  /**
   * Gắn lượt phân ca vào một bảng.
   *
   * Có `scheduleId` thì service kiểm tra thêm ba điều mà bảng đã chốt: ca phải
   * nằm trong danh sách ca của bảng, khoảng ngày phải nằm trong kỳ, và nhân
   * viên phải là thành viên. Không có thì đây là phân ca tự do như trước.
   */
  @ApiPropertyOptional({ description: 'Bảng phân ca chứa lượt xếp này' })
  @IsOptional()
  @IsString()
  scheduleId?: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  employeeIds!: string[];

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  shiftId!: string;

  @ApiProperty({ example: '2026-08-01' })
  @IsDateString()
  from!: string;

  @ApiProperty({ example: '2026-08-31' })
  @IsDateString()
  to!: string;

  /**
   * ⚠ Ở ĐÂY là SỐ THỨ TỰ (1=T2 … 7=CN), KHÁC với `UpsertShiftDto.weekdayMask`
   * vốn là bitmask. `[1,2,3,4,5]` ở đây nghĩa là T2–T6; cùng dãy số đó hiểu theo
   * bitmask sẽ ra kết quả hoàn toàn khác.
   */
  @ApiPropertyOptional({
    description: 'Chỉ phân ca cho các thứ này (1=T2 … 7=CN). Bỏ trống = mọi ngày.',
    example: [1, 2, 3, 4, 5],
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  weekdays?: number[];
}

/**
 * Bảng phân ca của một khoảng ngày — dữ liệu dựng màn hình lịch ca (FR-WEB-HR-03).
 *
 * Khoảng ngày do client quyết định nhưng service chặn trần 62 ngày: bảng phân ca
 * là ma trận `nhân viên × ngày`, xin 1 năm cho 500 người là 182.500 ô — trình
 * duyệt dựng không nổi mà database cũng không nên phải trả lời câu hỏi đó.
 */
export class ShiftAssignmentQueryDto {
  @ApiProperty({ example: '2026-08-01' })
  @IsDateString()
  from!: string;

  @ApiProperty({ example: '2026-08-31' })
  @IsDateString()
  to!: string;

  /**
   * Giới hạn bảng vào ĐÚNG danh sách thành viên của một bảng phân ca.
   *
   * Khác hẳn lọc theo `departmentId`: thành viên được chốt lúc lập bảng, còn
   * phòng ban thì đổi được bất cứ lúc nào. Không có tham số này thì một lần
   * chuyển phòng của nhân viên sẽ làm họ biến mất khỏi bảng đang xếp dở.
   */
  @ApiPropertyOptional({ description: 'Chỉ lấy thành viên của bảng phân ca này' })
  @IsOptional()
  @IsString()
  scheduleId?: string;

  @ApiPropertyOptional({ description: 'Lọc theo phòng ban. MANAGER bị ScopeGuard thu hẹp thêm.' })
  @IsOptional()
  @IsString()
  departmentId?: string;

  @ApiPropertyOptional({ description: 'Tìm theo tên hoặc mã nhân viên' })
  @IsOptional()
  @IsString()
  q?: string;

  // Phân trang theo NHÂN VIÊN (mỗi người một dòng lịch), không theo bản ghi phân
  // ca — người dùng đọc bảng này theo dòng, cắt trang giữa chừng một người sẽ ra
  // hai dòng rời rạc của cùng một cái tên.
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;
}

/**
 * Xoá phân ca trong một khoảng ngày — thao tác "dọn lịch để xếp lại".
 *
 * Có endpoint riêng thay vì gọi bulk-assign với `shiftId` rỗng: xoá và gán là
 * hai ý định khác nhau, và gộp chúng thì một request thiếu trường sẽ âm thầm
 * xoá sạch lịch cả tháng.
 */
export class ClearShiftAssignmentDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  employeeIds!: string[];

  @ApiProperty({ example: '2026-08-01' })
  @IsDateString()
  from!: string;

  @ApiProperty({ example: '2026-08-31' })
  @IsDateString()
  to!: string;
}

// =============================================================================
//  Bảng phân ca — FR-WEB-HR-13
// =============================================================================

/**
 * Tham số lập bảng phân ca.
 *
 * Ba trường đầu là PHẠM VI của bảng và được chốt lại tại đây: mọi thao tác bên
 * trong màn chi tiết (lọc, phân ca hàng loạt) chỉ chạy trong phạm vi này. Nhờ
 * vậy người xếp lịch không vô tình xếp ca của phòng khác vào bảng của mình.
 */
export class CreateShiftScheduleDto {
  @ApiProperty({ type: [String], description: 'Phòng ban áp dụng — lấy toàn bộ CBNV đang làm việc' })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  departmentIds!: string[];

  @ApiProperty({ type: [String], description: 'Các ca được phép dùng trong bảng này' })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  shiftIds!: string[];

  /**
   * Kỳ lập bảng. Nhận ngày bất kỳ trong tháng, service chuẩn hoá về ngày 01 —
   * client gửi `2026-08-15` hay `2026-08-01` đều ra cùng một kỳ.
   */
  @ApiProperty({ example: '2026-08-01', description: 'Tháng lập bảng' })
  @IsDateString()
  periodMonth!: string;

  @ApiPropertyOptional({
    example: 'Bảng phân ca Tháng 08/2026',
    description: 'Bỏ trống = tự sinh theo kỳ',
  })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;
}

/** Sửa bảng: đổi tên, mở rộng/thu hẹp phạm vi. Kỳ lập bảng KHÔNG đổi được. */
export class UpdateShiftScheduleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  departmentIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  shiftIds?: string[];
}

export class ShiftScheduleQueryDto {
  @ApiPropertyOptional({ example: '2026-08-01', description: 'Lọc theo tháng lập bảng' })
  @IsOptional()
  @IsDateString()
  month?: string;

  @ApiPropertyOptional({ description: 'Bảng có áp dụng cho phòng ban này' })
  @IsOptional()
  @IsString()
  departmentId?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}

/** Thêm / bớt CBNV khỏi bảng đã lập. */
export class ShiftScheduleMemberDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  employeeIds!: string[];
}

/**
 * Chính sách phép năm — `FR-WEB-POL-07`, `FR-WEB-POL-08`.
 *
 * Một công ty có nhiều bản: mỗi loại hợp đồng một chính sách, cộng một bản
 * `contractType = null` làm mặc định cho loại hợp đồng chưa khai riêng.
 *
 * Giống ca làm việc và chính sách key-value, bản ghi ở đây có hiệu lực theo thời
 * gian (D6): sửa mức phép giữa năm KHÔNG ghi đè bản cũ, vì số phép đã cấp cho
 * nhân viên hồi đầu năm phải giải thích được bằng chính sách lúc đó.
 */
export class UpsertLeavePolicyDto {
  @ApiPropertyOptional({
    example: 'Chính thức',
    description: 'Bỏ trống = chính sách mặc định, áp cho mọi loại hợp đồng chưa khai riêng.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  contractType?: string;

  // NFR-LEGAL-07: sàn 12 ngày do service kiểm tra, không đặt ở `@Min` — mức sàn
  // thay đổi theo quy định pháp luật, còn DTO thì không nên phải sửa mỗi lần luật đổi.
  @ApiProperty({ example: 12, description: 'NFR-LEGAL-07: tối thiểu 12 ngày/năm' })
  @IsNumber()
  @Min(0)
  baseDaysPerYear!: number;

  @ApiPropertyOptional({ example: 1, description: 'Số ngày cộng thêm mỗi mốc thâm niên' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  seniorityBonusDays?: number;

  @ApiPropertyOptional({ example: 5, description: 'Cứ mỗi N năm làm việc thì cộng thêm phép' })
  @IsOptional()
  @IsInt()
  @Min(1)
  seniorityEveryYears?: number;

  @ApiPropertyOptional({ description: 'Cho phép chuyển phép chưa dùng sang năm sau' })
  @IsOptional()
  @IsBoolean()
  allowCarryOver?: boolean;

  @ApiPropertyOptional({
    example: 5,
    description: 'Trần số ngày được cộng dồn. Bỏ trống = không giới hạn.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxCarryOverDays?: number;

  // Phép cộng dồn không có hạn dùng thì nó tích luỹ vô hạn và biến thành một
  // khoản nợ tiền mặt khi nhân viên nghỉ việc.
  @ApiPropertyOptional({
    example: 3,
    description: 'Phép cộng dồn hết hạn cuối tháng mấy của năm sau (3 = hết Q1).',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  carryOverExpireMonth?: number;

  @ApiPropertyOptional({
    example: 'YEARLY',
    description:
      'YEARLY = cấp trọn gói đầu năm. MONTHLY = cộng dần theo tháng làm việc (đúng hơn với người vào giữa năm).',
  })
  @IsOptional()
  @IsString()
  accrualMode?: string;

  @ApiPropertyOptional({ description: 'Hiệu lực từ (D6). Mặc định hôm nay.' })
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;
}

/**
 * Ngày lễ — ảnh hưởng trực tiếp tới tiền lương nên có ràng buộc pháp lý.
 */
export class UpsertHolidayDto {
  @ApiProperty({ example: 'Quốc khánh' })
  @IsString()
  @Length(1, 200)
  name!: string;

  @ApiProperty({ example: '2026-09-02' })
  @IsDateString()
  date!: string;

  // Lễ rơi vào thứ Bảy/Chủ nhật thì luật lao động cho nghỉ bù ngày kế tiếp.
  @ApiPropertyOptional({
    example: '2026-09-03',
    description: 'Ngày nghỉ bù khi lễ trùng cuối tuần',
  })
  @IsOptional()
  @IsDateString()
  substituteDate?: string;

  /**
   * Hệ số OT ngày lễ. `@Min(1)` chỉ chặn được trường hợp vô lý nhất (trả ít hơn
   * lương thường); mức sàn 300% theo NFR-LEGAL-05 do `policy-admin.service.ts`
   * kiểm tra, vì mức sàn thay đổi theo quy định pháp luật còn DTO thì không nên
   * phải sửa mỗi lần luật đổi.
   */
  @ApiPropertyOptional({ example: 3.0, description: 'NFR-LEGAL-05: ngày lễ tối thiểu 300%' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  otMultiplier?: number;

  // Cho phép lễ riêng theo chi nhánh — công ty có chi nhánh ở nước ngoài thì
  // ngày lễ mỗi nơi mỗi khác.
  @ApiPropertyOptional({ type: [String], description: 'Rỗng = áp dụng toàn công ty' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  branchIds?: string[];
}

/**
 * Chi nhánh — nơi định nghĩa "ở công ty" nghĩa là ở đâu.
 *
 * Toạ độ, bán kính, WiFi và beacon ở đây chính là dữ liệu mà chốt chống chấm
 * công hộ dựa vào (AF-02). Khai sai một chi nhánh là cả chi nhánh đó hoặc không
 * chấm công được, hoặc chấm được từ nhà.
 */
export class UpsertBranchDto {
  @ApiProperty({ example: 'Văn phòng Hà Nội' })
  @IsString()
  @Length(1, 200)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ example: 21.0123 })
  @IsOptional()
  @IsNumber()
  latitude?: number;

  @ApiPropertyOptional({ example: 105.7987 })
  @IsOptional()
  @IsNumber()
  longitude?: number;

  /**
   * Bán kính geofence — đặt sai theo cả hai hướng đều hỏng.
   *
   * Quá NHỎ  → GPS trong nhà lệch 20–50m, nhân viên ngồi đúng bàn mình vẫn bị
   *            báo ngoài vùng. Đây là lỗi bị than phiền nhiều nhất khi triển khai.
   * Quá LỚN  → bán kính 5km phủ cả khu dân cư, chấm công từ nhà vẫn qua.
   *
   * `@Min(20)` vì dưới 20m thì nhỏ hơn chính sai số của GPS, đặt vậy là tự tạo
   * lỗi cho mình. `@Max(5000)` để một cú gõ nhầm thêm số 0 không vô hiệu hoá
   * toàn bộ chốt vị trí.
   */
  @ApiPropertyOptional({
    example: 100,
    description: 'Bán kính geofence. GPS trong nhà sai số 20–50m, khuyến nghị ≥ 100m.',
  })
  @IsOptional()
  @IsInt()
  @Min(20)
  @Max(5000)
  radiusMeters?: number;

  /**
   * BSSID WiFi — lớp xác thực vị trí thứ hai, mạnh hơn GPS (AF-02).
   *
   * GPS giả được bằng app fake location cài trên máy đã root, còn BSSID là địa
   * chỉ MAC của thiết bị phát WiFi thật, muốn giả phải ở gần đủ để bắt sóng.
   * Vì thế chính sách "chỉ chấm công khi thấy WiFi văn phòng" chặt hơn nhiều so
   * với chỉ dựa vào toạ độ.
   */
  @ApiPropertyOptional({ type: [String], description: 'AF-02: WiFi văn phòng làm xác thực lớp 2' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  wifiBssids?: string[];

  // Beacon BLE — dùng cho nhà xưởng/tầng hầm nơi GPS gần như không bắt được.
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  beaconUuids?: string[];

  // Chi nhánh khác múi giờ với trụ sở thì ranh giới "ngày làm việc" cũng khác.
  // Bỏ trống là kế thừa `Company.timezone`.
  @ApiPropertyOptional({ description: 'Ghi đè timezone công ty nếu chi nhánh khác múi giờ' })
  @IsOptional()
  @IsString()
  timezone?: string;
}

/**
 * Phòng ban — cấu trúc cây, quyết định luồng duyệt đơn.
 */
export class UpsertDepartmentDto {
  @ApiProperty({ example: 'Phòng Kỹ thuật' })
  @IsString()
  @Length(1, 200)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  branchId?: string;

  // ⚠ Service phải chặn tự trỏ vào chính mình và chặn vòng lặp (A→B→A). Cây
  // phòng ban có vòng thì mọi thuật toán duyệt lên cấp trên sẽ chạy vô hạn.
  @ApiPropertyOptional({ description: 'Phòng ban cha (cây phòng ban)' })
  @IsOptional()
  @IsString()
  parentId?: string;

  // Bước `DIRECT_MANAGER` trong luồng duyệt đơn phân giải qua trường này. Phòng
  // ban chưa có trưởng phòng thì đơn của nhân viên phòng đó sẽ treo không ai
  // duyệt được — service phải leo lên phòng ban cha để tìm người thay thế.
  @ApiPropertyOptional({ description: 'Trưởng phòng — dùng cho bước duyệt DIRECT_MANAGER' })
  @IsOptional()
  @IsString()
  managerId?: string;
}
