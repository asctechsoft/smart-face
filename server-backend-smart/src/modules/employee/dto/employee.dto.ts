import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { EmployeeStatus, SystemRole } from '@prisma/client';
import { PaginationQueryDto } from 'src/common/dto';

export class EmployeeQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: EmployeeStatus })
  @IsOptional()
  @IsEnum(EmployeeStatus)
  status?: EmployeeStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  branchId?: string;
}

/**
 * Xem trước mã nhân viên hệ thống sẽ sinh, TRƯỚC khi bấm lưu.
 *
 * Có endpoint riêng vì mã nhân viên bị KHOÁ sau lần chấm công đầu tiên (BR-04).
 * HR cần nhìn thấy `ducnv.amobi` và kịp đổi ngay lúc tạo, thay vì phát hiện sai
 * khi đã quá muộn để sửa.
 */
export class PreviewCodeDto {
  @ApiProperty({ example: 'Nguyễn Văn Đức' })
  @IsString()
  @Length(2, 100)
  fullName!: string;
}

/** Luồng B — HR tạo hồ sơ trước trên Web (docs/01 mục 9, FR-WEB-HR-05). */
export class CreateEmployeeDto {
  @ApiProperty({ example: 'Nguyễn Văn Đức' })
  @IsString()
  @Length(2, 100)
  fullName!: string;

  /**
   * Regex cố ý DỄ DÃI: chấp nhận cả `+84`, khoảng trắng, dấu chấm, dấu gạch.
   *
   * HR nhập liệu từ nhiều nguồn (danh bạ, file Excel cũ, hợp đồng giấy) với đủ
   * kiểu định dạng. Bắt chặt đúng một dạng thì người ta sẽ bỏ qua trường này
   * hoặc điền bừa cho xong. Việc chuẩn hoá về một dạng để gửi SMS là nhiệm vụ
   * của service, không phải của tầng validate.
   */
  @ApiProperty({ example: '0901234567' })
  @IsString()
  @Matches(/^[0-9+\s.-]{9,15}$/, { message: 'Số điện thoại không hợp lệ' })
  phone!: string;

  // Bỏ trống thì `employee-code.util.ts` tự sinh từ họ tên + mã công ty.
  // Cho phép HR đặt tay để khớp với mã đang dùng ở hệ thống nhân sự cũ.
  @ApiPropertyOptional({
    description: 'Bỏ trống = hệ thống tự sinh. HR sửa được TRƯỚC khi nhân viên kích hoạt.',
    example: 'ducnv.amobi',
  })
  @IsOptional()
  @IsString()
  employeeCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  branchId?: string;

  @ApiPropertyOptional({ example: 'Nhân viên' })
  @IsOptional()
  @IsString()
  position?: string;

  @ApiPropertyOptional({ example: 'Chính thức' })
  @IsOptional()
  @IsString()
  contractType?: string;

  @ApiPropertyOptional({ example: '2026-08-01' })
  @IsOptional()
  @IsDateString()
  joinedAt?: string;

  @ApiPropertyOptional({ enum: SystemRole, isArray: true, default: [SystemRole.EMPLOYEE] })
  @IsOptional()
  @IsArray()
  @IsEnum(SystemRole, { each: true })
  roles?: SystemRole[];

  /**
   * Phạm vi dữ liệu của MANAGER — vai trò nói được LÀM GÌ, trường này nói được
   * làm TRÊN AI (FR-WEB-NOT-05).
   *
   * Vai trò MANAGER mà để trống danh sách này thì `ScopeGuard` không có phòng
   * ban nào để cho phép, người đó đăng nhập vào sẽ không thấy nhân viên nào cả.
   * Ngược lại, khai thừa một phòng ban là trao quyền xem lương của cả phòng đó.
   */
  @ApiPropertyOptional({
    type: [String],
    description: 'Phạm vi phòng ban cho vai trò MANAGER (FR-WEB-NOT-05)',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  managedDepartmentIds?: string[];

  // Tắt khi nhập hàng loạt đầu kỳ: 500 tin SMS bay đi cùng lúc trong lúc dữ liệu
  // còn đang rà soát sẽ khiến cả công ty nhận lời mời rồi lại phải huỷ.
  @ApiPropertyOptional({ default: true, description: 'Gửi SMS mời ngay (FR-WEB-HR-07)' })
  @IsOptional()
  @IsBoolean()
  sendInvite?: boolean;
}

/**
 * Sửa hồ sơ nhân viên.
 *
 * Không có `phone` ở đây một cách có chủ đích: số điện thoại là định danh nhận
 * OTP, đổi được tuỳ ý nghĩa là chiếm được tài khoản. Đổi số phải đi qua
 * `POST /v1/system/users/:id/change-phone` với quyền cao hơn và có audit riêng.
 */
export class UpdateEmployeeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 100)
  fullName?: string;

  @ApiPropertyOptional({
    description: 'BR-04: chỉ sửa được TRƯỚC khi mã bị khoá bởi lần chấm công đầu tiên.',
  })
  @IsOptional()
  @IsString()
  employeeCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

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
  position?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contractType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  joinedAt?: string;

  @ApiPropertyOptional({ enum: SystemRole, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(SystemRole, { each: true })
  roles?: SystemRole[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  managedDepartmentIds?: string[];
}

/**
 * Dùng chung cho tạm ngưng / cho nghỉ việc / kích hoạt lại.
 *
 * Gộp một DTO vì cả ba đều là thay đổi vòng đời nhân sự có hệ quả thật: mất
 * quyền chấm công, khoá đăng nhập, chốt ngày tính lương cuối cùng.
 */
export class LifecycleActionDto {
  // BR-08 — cùng lý do với hiệu chỉnh công: sàn 10 ký tự để chặn ghi "ok".
  // Cho nghỉ việc là quyết định có thể bị kiện; lý do phải đọc được sau này.
  @ApiProperty({ description: 'BR-08: bắt buộc, tối thiểu 10 ký tự', minLength: 10 })
  @IsString()
  @Length(10, 1000)
  reason!: string;

  /**
   * Ngày hiệu lực, tách khỏi ngày bấm nút.
   *
   * HR thường nhập trước vài ngày. Nếu lấy luôn thời điểm bấm nút làm ngày nghỉ
   * việc thì những ngày còn đi làm thật sẽ bị cắt khỏi bảng lương cuối cùng.
   */
  @ApiPropertyOptional({ description: 'Ngày chấm dứt hợp đồng' })
  @IsOptional()
  @IsDateString()
  effectiveDate?: string;
}

/** Một dòng trong file Excel import (FR-WEB-HR-10). */
export class ImportRowDto {
  @ApiProperty()
  @IsString()
  fullName!: string;

  @ApiProperty({
    description: 'Định danh đăng nhập. BẮT BUỘC — nhân viên đăng nhập bằng tên miền + email.',
    example: 'duc@amobi.vn',
  })
  @IsString()
  email!: string;

  @ApiProperty()
  @IsString()
  phone!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  departmentName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  position?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  joinedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contractType?: string;
}

/**
 * Bước 1 của nhập Excel: KIỂM TRA, không ghi gì vào database.
 *
 * Tách hai bước validate → execute vì file Excel do người gõ tay gần như luôn có
 * lỗi: trùng email, phòng ban không tồn tại, sai định dạng ngày. Ghi thẳng thì
 * import 200 dòng chết ở dòng 137, để lại 136 nhân viên đã tạo dở dang mà HR
 * phải dọn tay. Kiểm tra trước cho HR thấy toàn bộ lỗi, sửa file rồi mới chạy.
 */
export class ImportValidateDto {
  @ApiProperty({ type: [ImportRowDto] })
  @IsArray()
  rows!: ImportRowDto[];
}

/**
 * Bước 2: thực sự tạo nhân viên.
 *
 * ⚠ Client gửi lại các dòng, nên KHÔNG được tin là chúng đã qua bước validate —
 * người gọi API có thể bỏ qua bước 1 hoàn toàn. Service phải kiểm tra lại từ đầu;
 * bước validate là để phục vụ trải nghiệm người dùng, không phải chốt an toàn.
 */
export class ImportExecuteDto {
  @ApiProperty({ type: [ImportRowDto], description: 'Chỉ gửi các dòng HỢP LỆ đã được validate' })
  @IsArray()
  rows!: ImportRowDto[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  sendInvite?: boolean;
}

// CreateInviteCodeDto đã bị xoá cùng luồng mã mời. Nhân viên không tự tham gia
// công ty nữa — HR cấp tài khoản (tên miền + email + mật khẩu tạm).
