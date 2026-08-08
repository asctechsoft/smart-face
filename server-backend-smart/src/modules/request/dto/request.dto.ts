import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { RequestStatus } from '@prisma/client';
import { PaginationQueryDto } from 'src/common/dto';

/**
 * Tạo đơn từ — nghỉ phép, làm bù, xin ra ngoài, giải trình công.
 */
export class CreateRequestDto {
  /**
   * Dùng MÃ chứ không dùng id.
   *
   * Loại đơn do từng công ty tự định nghĩa, nên id là chuỗi sinh ngẫu nhiên khác
   * nhau ở mỗi công ty. Client dùng mã thì cùng một bản build App chạy được cho
   * mọi khách hàng, và người đọc log hiểu ngay `ANNUAL_LEAVE` là đơn gì.
   */
  @ApiProperty({ example: 'ANNUAL_LEAVE', description: 'Mã loại đơn của công ty' })
  @IsString()
  @IsNotEmpty()
  requestTypeCode!: string;

  /**
   * ⚠ Phải kèm offset múi giờ (`+07:00`) như trong ví dụ.
   *
   * Gửi `2026-08-10T00:00:00` trần thì Node hiểu là giờ UTC, thành 07:00 sáng
   * giờ Việt Nam — đơn nghỉ cả ngày biến thành nghỉ từ 7 giờ sáng, và ngày cuối
   * bị lệch sang hôm sau. Trừ đúng một ngày phép của người ta vì thiếu 6 ký tự.
   */
  @ApiProperty({ example: '2026-08-10T00:00:00+07:00' })
  @IsDateString()
  startAt!: string;

  // Service phải kiểm tra `endAt >= startAt` — `@IsDateString()` chỉ soát định
  // dạng từng trường, không so sánh được hai trường với nhau.
  @ApiProperty({ example: '2026-08-12T23:59:59+07:00' })
  @IsDateString()
  endAt!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isHalfDay?: boolean;

  @ApiProperty({ example: 'Việc gia đình', maxLength: 500 })
  @IsString()
  @Length(1, 500)
  reason!: string;

  @ApiPropertyOptional({ description: 'Đơn "Xin ra ngoài": giờ về dự kiến' })
  @IsOptional()
  @IsDateString()
  expectedReturnAt?: string;

  /**
   * `false` = lưu nháp, chưa gửi đi duyệt (FR-APP-REQ-03).
   *
   * Đơn nháp KHÔNG khoá ngày phép và không hiện ở hàng chờ của quản lý. Người
   * dùng soạn dở rồi bỏ đó là chuyện thường; nếu nháp cũng trừ phép thì số ngày
   * phép còn lại hiển thị sai.
   */
  @ApiPropertyOptional({ default: true, description: 'false = lưu nháp (FR-APP-REQ-03)' })
  @IsOptional()
  @IsBoolean()
  submitNow?: boolean;
}

/**
 * Sửa đơn — CHỈ sửa được khi đơn còn ở trạng thái nháp hoặc chờ duyệt.
 *
 * Không có `requestTypeCode` ở đây một cách có chủ đích: đổi loại đơn giữa chừng
 * làm luồng duyệt đã chạy dở trở nên vô nghĩa (đơn nghỉ 1 ngày chỉ cần trưởng
 * phòng, đổi thành 5 ngày lại cần thêm HR). Muốn đổi loại thì huỷ và tạo đơn mới.
 */
export class UpdateRequestDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isHalfDay?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 500)
  reason?: string;
}

/** Duyệt đơn — ghi chú không bắt buộc, vì đồng ý thì không cần giải thích. */
export class ApproveRequestDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 500)
  comment?: string;
}

/**
 * Từ chối đơn — lý do BẮT BUỘC (FR-WEB-REQ-04).
 *
 * Đối xứng có chủ đích với `ApproveRequestDto`: duyệt thì không cần nói gì,
 * từ chối thì phải nói. Người bị từ chối có quyền biết vì sao, và đây cũng là
 * bằng chứng khi có khiếu nại về việc đối xử không công bằng.
 * `@Length(1, ...)` chặn luôn chuỗi rỗng, thứ mà `@IsString()` vẫn cho qua.
 */
export class RejectRequestDto {
  @ApiProperty({ description: 'FR-WEB-REQ-04: bắt buộc nhập lý do khi từ chối' })
  @IsString()
  @Length(1, 500)
  reason!: string;
}

/**
 * Duyệt hàng loạt — quản lý tick nhiều đơn rồi duyệt một lượt.
 *
 * ⚠ Chỉ có duyệt hàng loạt, KHÔNG có từ chối hàng loạt. Từ chối cần lý do riêng
 * cho từng đơn; gộp lại thì tất cả cùng nhận một lý do chung vô nghĩa.
 *
 * Service phải xử lý từng đơn độc lập: một đơn hỏng (hết phép, ai đó vừa huỷ)
 * không được làm rớt cả lô, và phải trả về rõ đơn nào thành công đơn nào không.
 */
export class BulkApproveDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  requestIds!: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  comment?: string;
}

/** Người tạo đơn tự huỷ đơn của mình. Khác `reject` — đó là quản lý từ chối. */
export class CancelRequestDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 500)
  reason?: string;
}

/**
 * Bộ lọc danh sách đơn — dùng chung cho cả App và Web Quản lý.
 *
 * ⚠ Không trường nào ở đây được phép mở rộng quyền xem. Nhân viên thường gọi
 * kèm `employeeId` của người khác thì service vẫn phải chặn theo vai trò và
 * phạm vi phòng ban — bộ lọc chỉ THU HẸP tập dữ liệu mà người gọi vốn đã được
 * phép xem, không bao giờ nới rộng ra.
 */
export class RequestQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: RequestStatus })
  @IsOptional()
  @IsEnum(RequestStatus)
  status?: RequestStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  requestTypeCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional()
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
  employeeId?: string;

  /**
   * `@Transform` là bắt buộc với boolean trong query string.
   *
   * `?mineOnly=true` tới server là chuỗi `'true'`, mà chuỗi `'false'` cũng là
   * giá trị truthy trong JS — không chuyển đổi tường minh thì `?mineOnly=false`
   * lại được hiểu thành `true`, đúng ngược ý người dùng.
   */
  @ApiPropertyOptional({ description: 'Chỉ lấy đơn của tôi' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  mineOnly?: boolean;
}
