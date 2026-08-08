import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
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
  @ApiPropertyOptional({ description: 'Thời điểm bắt đầu hiệu lực (D6). Mặc định là ngay bây giờ.' })
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

  @ApiPropertyOptional({ example: 60, description: 'Phút nghỉ giữa ca (nghỉ trưa)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  breakMinutes?: number;

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
  @ApiPropertyOptional({ example: '2026-09-03', description: 'Ngày nghỉ bù khi lễ trùng cuối tuần' })
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
