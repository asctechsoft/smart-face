import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
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

/**
 * Độ dài tối đa cho một Firebase ID token.
 *
 * Token là JWT ba phần, thường 900–1300 byte và phình theo số custom claim.
 * Chặn ở 4096 để một chuỗi vài MB không đi được tới bước xác minh chữ ký.
 */
const FIREBASE_ID_TOKEN_MAX_LENGTH = 4096;

/**
 * Đổi Firebase ID token lấy phiên làm việc của Backend.
 *
 * Client tự đăng nhập với Firebase trước (email + mật khẩu qua SDK), rồi gửi ID
 * token nhận được lên đây. Backend KHÔNG bao giờ nhìn thấy mật khẩu.
 */
export class CreateSessionDto {
  @ApiProperty({
    example: 'amobi.vn',
    description: 'Tên miền công ty cấp cho nhân viên. Chấp nhận cả dạng có https:// và dấu / cuối.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  domain!: string;

  @ApiProperty({
    description: 'ID token lấy từ Firebase SDK sau khi đăng nhập thành công (`user.getIdToken()`).',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(FIREBASE_ID_TOKEN_MAX_LENGTH)
  firebaseIdToken!: string;

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
    description: 'Mã 6 số vừa nhận qua SMS, hoặc một mã dự phòng.',
  })
  @IsString()
  @Length(6, 20)
  code!: string;
}

export class ResendTwoFactorDto {
  @ApiProperty({ description: 'Lấy từ phản hồi đăng nhập khi nextStep = TWO_FACTOR' })
  @IsString()
  @IsNotEmpty()
  twoFactorToken!: string;
}

// ---------------------------------------------------------------------------
//  Mật khẩu
// ---------------------------------------------------------------------------

/**
 * Đổi mật khẩu.
 *
 * Không còn trường `currentPassword`: Backend không giữ mật khẩu nên không đối
 * chiếu được. Thay vào đó client gọi `reauthenticateWithCredential` của Firebase
 * (người dùng gõ lại mật khẩu cũ) rồi gửi lên ID token vừa làm mới — `auth_time`
 * trong token chứng minh việc gõ lại vừa xảy ra.
 */
export class ChangePasswordDto {
  @ApiProperty({
    description:
      'ID token vừa làm mới sau khi xác thực lại với Firebase. Quá hạn `FIREBASE_FRESH_AUTH_WINDOW_SECONDS` sẽ bị từ chối.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(FIREBASE_ID_TOKEN_MAX_LENGTH)
  firebaseIdToken!: string;

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

export class SetupTwoFactorDto {
  @ApiProperty({
    example: '0912345678',
    description:
      'Số nhận mã OTP. Nhận cả dạng `+84…`; hệ thống tự chuẩn hoá về `0…`. Chỉ được ghi nhận sau khi nhập đúng mã gửi tới số này.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  phone!: string;
}

export class EnableTwoFactorDto {
  @ApiProperty({ example: '123456', description: 'Mã 6 số vừa nhận qua SMS' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Mã xác thực gồm đúng 6 chữ số' })
  code!: string;
}

/**
 * Tắt 2FA — dùng ID token vừa làm mới thay cho mật khẩu, cùng lý do với
 * `ChangePasswordDto`.
 */
export class DisableTwoFactorDto {
  @ApiProperty({
    description: 'ID token vừa làm mới sau khi xác thực lại với Firebase.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(FIREBASE_ID_TOKEN_MAX_LENGTH)
  firebaseIdToken!: string;
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
 * Neo vào MẬT KHẨU (qua Firebase) chứ không phải chỉ OTP: kẻ cầm được điện thoại
 * đang đăng nhập cũng nhận được SMS gửi tới chính máy đó, nên OTP một mình không
 * phải rào cản trong đúng kịch bản mà chốt này sinh ra để chặn.
 */
export class ReauthVerifyDto {
  @ApiProperty({
    description: 'ID token vừa làm mới sau khi xác thực lại với Firebase.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(FIREBASE_ID_TOKEN_MAX_LENGTH)
  firebaseIdToken!: string;

  @ApiPropertyOptional({
    description:
      'Bắt buộc nếu tài khoản đã bật xác thực 2 lớp. Lấy mã bằng POST /auth/reauth/code. Nhận cả mã dự phòng.',
  })
  @IsOptional()
  @IsString()
  @Length(6, 20)
  twoFactorCode?: string;
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

/** Thông tin mã OTP vừa gửi — đủ để App vẽ màn hình chờ mà không lộ số đầy đủ. */
export class TwoFactorDeliveryDto {
  @ApiProperty({ example: '090****567', description: 'Số nhận mã, đã che bớt' })
  maskedPhone!: string;

  @ApiProperty({ example: 300, description: 'Số giây mã còn hiệu lực' })
  codeExpiresIn!: number;

  @ApiProperty({ example: 60, description: 'Số giây phải chờ trước khi được gửi lại' })
  resendAfter!: number;

  @ApiPropertyOptional({
    description: 'CHỈ có khi OTP_DEBUG_RETURN=true (dev). Production không bao giờ trả trường này.',
  })
  debugCode?: string;
}

/** Phản hồi khi Firebase đã xác nhận danh tính nhưng tài khoản còn lớp thứ hai. */
export class TwoFactorChallengeDto extends TwoFactorDeliveryDto {
  @ApiProperty({ enum: ['TWO_FACTOR'] })
  nextStep!: 'TWO_FACTOR';

  @ApiProperty({ description: 'Gửi kèm mã xác thực tới POST /auth/2fa/verify. Dùng một lần.' })
  twoFactorToken!: string;

  @ApiProperty({ example: 300, description: 'Số giây `twoFactorToken` còn hiệu lực' })
  expiresIn!: number;
}

export type LoginResultDto = AuthTokenResponseDto | TwoFactorChallengeDto;
