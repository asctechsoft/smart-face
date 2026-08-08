import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PasswordService } from '../password.service';

export class DeviceInfoDto {
  @ApiPropertyOptional({ example: 'iPhone 14' })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({ example: 'iOS' })
  @IsOptional()
  @IsString()
  os?: string;

  @ApiPropertyOptional({ example: '17.5' })
  @IsOptional()
  @IsString()
  osVersion?: string;

  @ApiPropertyOptional({ example: '1.0.0' })
  @IsOptional()
  @IsString()
  appVersion?: string;

  @ApiPropertyOptional({ description: 'AF-14: thiết bị root/jailbreak' })
  @IsOptional()
  @IsBoolean()
  isRooted?: boolean;

  @ApiPropertyOptional({ description: 'Token FCM để nhận push' })
  @IsOptional()
  @IsString()
  pushToken?: string;
}

// ---------------------------------------------------------------------------
//  Đăng nhập
// ---------------------------------------------------------------------------

export class LoginDto {
  @ApiProperty({
    example: 'amobi.vn',
    description: 'Tên miền công ty cấp cho nhân viên. Chấp nhận cả dạng có https:// và dấu / cuối.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  domain!: string;

  @ApiProperty({ example: 'duc@amobi.vn' })
  @IsEmail({}, { message: 'Email không hợp lệ' })
  @MaxLength(255)
  email!: string;

  @ApiProperty({ description: 'Mật khẩu do công ty cấp, hoặc mật khẩu đã đổi' })
  @IsString()
  @IsNotEmpty()
  // Chặn chuỗi khổng lồ ngay ở tầng validate: scrypt cố tình tốn kém.
  @MaxLength(PasswordService.MAX_LENGTH)
  password!: string;

  @ApiPropertyOptional({ description: 'Bắt buộc với App; Web quản lý không cần.' })
  @IsOptional()
  @IsString()
  deviceId?: string;

  @ApiPropertyOptional({ type: DeviceInfoDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DeviceInfoDto)
  deviceInfo?: DeviceInfoDto;
}

export class VerifyTwoFactorDto {
  @ApiProperty({ description: 'Lấy từ phản hồi đăng nhập khi nextStep = TWO_FACTOR' })
  @IsString()
  @IsNotEmpty()
  twoFactorToken!: string;

  @ApiProperty({
    example: '123456',
    description: 'Mã 6 số từ ứng dụng xác thực, hoặc một mã dự phòng.',
  })
  @IsString()
  @Length(6, 20)
  code!: string;
}

// ---------------------------------------------------------------------------
//  Mật khẩu
// ---------------------------------------------------------------------------

export class ChangePasswordDto {
  @ApiProperty({ description: 'Mật khẩu hiện tại — mật khẩu tạm nếu đây là lần đầu' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(PasswordService.MAX_LENGTH)
  currentPassword!: string;

  @ApiProperty({
    description: `Tối thiểu ${PasswordService.MIN_LENGTH} ký tự. Không bắt buộc chữ hoa/ký tự đặc biệt — độ dài mới là thứ có tác dụng.`,
  })
  @IsString()
  @Length(PasswordService.MIN_LENGTH, PasswordService.MAX_LENGTH)
  newPassword!: string;
}

// ---------------------------------------------------------------------------
//  Xác thực 2 lớp
// ---------------------------------------------------------------------------

export class EnableTwoFactorDto {
  @ApiProperty({ example: '123456', description: 'Mã hiện tại từ ứng dụng xác thực' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Mã xác thực gồm đúng 6 chữ số' })
  code!: string;
}

export class DisableTwoFactorDto {
  @ApiProperty({ description: 'Xác nhận bằng mật khẩu để không ai tắt hộ' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(PasswordService.MAX_LENGTH)
  password!: string;
}

// ---------------------------------------------------------------------------
//  Phiên
// ---------------------------------------------------------------------------

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}

export class LogoutDto {
  @ApiPropertyOptional({ description: 'Bỏ trống = thu hồi toàn bộ phiên của tài khoản' })
  @IsOptional()
  @IsString()
  refreshToken?: string;
}

/**
 * Xác thực lại danh tính trước thao tác nhạy cảm (FR-APP-PRO-02, docs/03 mục 8.1).
 *
 * Dùng mật khẩu chứ không dùng OTP SMS: kẻ cầm được điện thoại đang đăng nhập
 * cũng nhận được SMS gửi tới chính máy đó, nên OTP không phải rào cản trong đúng
 * kịch bản mà chốt này sinh ra để chặn.
 */
export class ReauthVerifyDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(PasswordService.MAX_LENGTH)
  password!: string;

  @ApiPropertyOptional({ description: 'Bắt buộc nếu tài khoản đã bật xác thực 2 lớp' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/)
  totpCode?: string;
}

// ---------------------------------------------------------------------------
//  Response
// ---------------------------------------------------------------------------

/**
 * Bước tiếp theo App phải điều hướng tới (docs/08 mục 2).
 *
 * Thứ tự xử lý: `TWO_FACTOR` → `CHANGE_PASSWORD` → `SETUP_BIOMETRIC` → `HOME`.
 * Không còn `ENTER_INVITE_CODE` (bỏ luồng mã mời) và `SELECT_COMPANY` (tài
 * khoản gắn với đúng một công ty).
 */
export type NextStep = 'TWO_FACTOR' | 'CHANGE_PASSWORD' | 'SETUP_BIOMETRIC' | 'HOME';

export class AuthUserDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  fullName!: string;

  @ApiProperty({ example: 'duc@amobi.vn' })
  email!: string;

  @ApiProperty({ nullable: true })
  phone!: string | null;

  @ApiPropertyOptional({ nullable: true })
  avatarUrl?: string | null;

  @ApiProperty()
  twoFactorEnabled!: boolean;
}

export class AuthEmployeeDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'ducnv.amobi' })
  employeeCode!: string;

  @ApiProperty()
  companyId!: string;

  @ApiProperty({ example: 'ACTIVE' })
  status!: string;

  @ApiProperty({ type: [String] })
  roles!: string[];
}

export class AuthTokenResponseDto {
  @ApiProperty()
  accessToken!: string;

  @ApiProperty()
  refreshToken!: string;

  @ApiProperty({ example: 900 })
  expiresIn!: number;

  @ApiPropertyOptional({
    description:
      'CHỈ trả về một lần khi liên kết thiết bị mới. App lưu vào secure enclave để ký HMAC (AF-12).',
  })
  deviceSecret?: string;

  @ApiProperty({ enum: ['TWO_FACTOR', 'CHANGE_PASSWORD', 'SETUP_BIOMETRIC', 'HOME'] })
  nextStep!: NextStep;

  @ApiProperty({ type: AuthUserDto })
  user!: AuthUserDto;

  @ApiProperty({ type: AuthEmployeeDto, nullable: true })
  employee!: AuthEmployeeDto | null;
}

/** Phản hồi khi mật khẩu đúng nhưng tài khoản đã bật xác thực 2 lớp. */
export class TwoFactorChallengeDto {
  @ApiProperty({ enum: ['TWO_FACTOR'] })
  nextStep!: 'TWO_FACTOR';

  @ApiProperty({ description: 'Gửi kèm mã xác thực tới POST /auth/2fa/verify. Dùng một lần.' })
  twoFactorToken!: string;

  @ApiProperty({ example: 300 })
  expiresIn!: number;
}

export type LoginResultDto = AuthTokenResponseDto | TwoFactorChallengeDto;
