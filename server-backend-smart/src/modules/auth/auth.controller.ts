import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowPendingPassword, CurrentUser, Public, SkipTenant } from 'src/common/decorators';
import { ApiErrors } from 'src/common/decorators/api-standard-responses.decorator';
import { RateLimit } from 'src/common/guards/rate-limit.guard';
import type { RequestContext } from 'src/common/types/request-context';
import { AuthService } from './auth.service';
import { DeviceService } from './device.service';
import {
  ChangePasswordDto,
  CreateSessionDto,
  DisableTwoFactorDto,
  EnableTwoFactorDto,
  LogoutDto,
  ReauthVerifyDto,
  RefreshTokenDto,
  ResendTwoFactorDto,
  SetupTwoFactorDto,
  VerifyTwoFactorDto,
} from './dto/auth.dto';

/**
 * docs/08-hop-dong-api.md mục 2 — API Xác thực.
 *
 * Ba decorator nới lỏng chốt an ninh, mỗi cái mở đúng một cửa. Hiểu sai là mở
 * nhầm cửa, nên ghi rõ ở đây:
 *
 * | Decorator                | Bỏ qua guard nào     | Vì sao cần                                        |
 * |--------------------------|----------------------|---------------------------------------------------|
 * | `@Public()`              | JwtAuthGuard         | Chưa đăng nhập thì lấy đâu ra token (login, refresh) |
 * | `@SkipTenant()`          | TenantGuard          | Thao tác trên TÀI KHOẢN, chưa chọn công ty nào    |
 * | `@AllowPendingPassword()`| PasswordChangeGuard  | Là LỐI RA của trạng thái buộc đổi mật khẩu        |
 *
 * `@AllowPendingPassword()` chỉ được đặt ở `password/change`, `logout` và `me`.
 * Người dùng đang bị buộc đổi mật khẩu phải đổi được (lối ra), phải thoát được
 * (logout), và App phải đọc được trạng thái để hiện đúng màn hình (me). Đặt nó ở
 * bất kỳ endpoint nào khác là vô hiệu hoá luôn cơ chế buộc đổi mật khẩu.
 */
@ApiTags('Xác thực')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly devices: DeviceService,
  ) {}

  // ---------------------------------------------------------------------------
  // Đăng nhập
  // ---------------------------------------------------------------------------

  @Post('session')
  @Public()
  @HttpCode(HttpStatus.OK)
  // Mật khẩu do Firebase kiểm nên việc dò mật khẩu bị chặn ở phía Firebase. Giới
  // hạn ở đây phục vụ việc khác: chặn dò xem uid nào đã được cấp hồ sơ, và chặn
  // ép Backend gọi verifyIdToken liên tục.
  @RateLimit({ bucket: 'session', limit: 20, windowSeconds: 900, by: 'ip' })
  @ApiOperation({
    summary: 'Đổi Firebase ID token lấy phiên làm việc',
    description:
      'Client đăng nhập với Firebase trước (email + mật khẩu qua SDK) rồi gửi ID token lên đây. Backend KHÔNG bao giờ nhận mật khẩu.\n\n' +
      'Đăng nhập lần đầu trả `nextStep: CHANGE_PASSWORD` và token bị chặn ở mọi API khác cho tới khi đổi mật khẩu.\n\n' +
      'Tài khoản đã bật xác thực 2 lớp sẽ nhận `nextStep: TWO_FACTOR` kèm `twoFactorToken`, và một mã OTP được gửi tới số đã đăng ký.\n\n' +
      '⚠ Gõ sai tên miền trả `AUTH_DOMAIN_MISMATCH` — tên miền phải khớp công ty của tài khoản, vì Firebase chỉ xác nhận danh tính chứ không biết gì về ranh giới công ty.',
  })
  @ApiErrors(
    'AUTH_FIREBASE_TOKEN_INVALID',
    'AUTH_FIREBASE_TOKEN_EXPIRED',
    'AUTH_ACCOUNT_NOT_PROVISIONED',
    'AUTH_DOMAIN_MISMATCH',
    'AUTH_ACCOUNT_SUSPENDED',
    'AUTH_COMPANY_INACTIVE',
    'SYS_RATE_LIMITED',
  )
  createSession(@Body() dto: CreateSessionDto) {
    return this.auth.createSession(dto);
  }

  @Post('2fa/verify')
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ bucket: 'login-2fa', limit: 10, windowSeconds: 900, by: 'ip' })
  @ApiOperation({
    summary: 'Bước hai của đăng nhập — nhập mã OTP',
    description:
      'Nhận mã 6 số vừa gửi qua SMS, hoặc một mã dự phòng khi mất điện thoại. Mã dự phòng dùng một lần rồi mất.',
  })
  @ApiErrors(
    'AUTH_2FA_INVALID',
    'AUTH_2FA_NOT_ENABLED',
    'AUTH_OTP_INVALID',
    'AUTH_OTP_EXPIRED',
    'AUTH_OTP_MAX_ATTEMPTS',
    'SYS_RATE_LIMITED',
  )
  verifyTwoFactor(@Body() dto: VerifyTwoFactorDto) {
    return this.auth.verifyTwoFactor(dto);
  }

  @Post('2fa/resend')
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ bucket: 'login-2fa-resend', limit: 5, windowSeconds: 900, by: 'ip' })
  @ApiOperation({
    summary: 'Gửi lại mã OTP cho một thử thách đang mở',
    description:
      'Giãn cách giữa hai lần gửi và số lần gửi mỗi giờ do `OtpService` cưỡng chế; giới hạn ở đây chỉ là lớp chặn thêm theo IP.',
  })
  @ApiErrors(
    'AUTH_2FA_INVALID',
    'AUTH_2FA_NOT_ENABLED',
    'AUTH_OTP_RESEND_TOO_SOON',
    'AUTH_OTP_SEND_LIMIT',
    'SYS_RATE_LIMITED',
  )
  resendTwoFactor(@Body() dto: ResendTwoFactorDto) {
    return this.auth.resendTwoFactorCode(dto.twoFactorToken);
  }

  // ---------------------------------------------------------------------------
  // Mật khẩu
  // ---------------------------------------------------------------------------

  @Post('password/change')
  @HttpCode(HttpStatus.OK)
  @SkipTenant()
  // Phải chạy được khi đang bị chặn vì chưa đổi mật khẩu — đây chính là lối ra.
  @AllowPendingPassword()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Đổi mật khẩu',
    description:
      'Bắt buộc sau khi đăng nhập lần đầu bằng mật khẩu tạm.\n\n' +
      'Client phải gọi `reauthenticateWithCredential` của Firebase trước (người dùng gõ lại mật khẩu cũ) rồi gửi lên ID token vừa làm mới — Backend không giữ mật khẩu nên không tự đối chiếu được.\n\n' +
      'Đổi xong sẽ THU HỒI toàn bộ phiên khác ở CẢ HAI phía (Backend và Firebase) rồi cấp phiên mới. Nếu mật khẩu đã lộ và kẻ tấn công đang có phiên mở, đổi mật khẩu mà không thu hồi thì phiên của hắn vẫn sống.',
  })
  @ApiErrors('AUTH_FIREBASE_TOKEN_INVALID', 'AUTH_REAUTH_STALE', 'AUTH_PASSWORD_TOO_WEAK')
  changePassword(@CurrentUser() ctx: RequestContext, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(ctx.userId, dto.firebaseIdToken, dto.newPassword);
  }

  // ---------------------------------------------------------------------------
  // Xác thực 2 lớp
  // ---------------------------------------------------------------------------

  @Post('2fa/setup')
  @HttpCode(HttpStatus.OK)
  @SkipTenant()
  @RateLimit({ bucket: '2fa-setup', limit: 10, windowSeconds: 3600, by: 'account' })
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Bước 1 — khai số điện thoại và nhận mã xác minh',
    description:
      'Gửi một mã OTP tới số vừa khai. Chưa ghi số vào tài khoản ở bước này: số chỉ được lưu khi đã chứng minh người dùng nhận được tin nhắn tới đúng số đó (bước `enable`).\n\n' +
      'Ghi trước rồi mới xác minh nghĩa là gõ nhầm một chữ số cũng đủ khiến mọi mã OTP về sau bay tới máy người lạ — và người dùng thì tự khoá mình ra ngoài.',
  })
  @ApiErrors(
    'AUTH_2FA_ALREADY_ENABLED',
    'AUTH_PHONE_INVALID',
    'AUTH_OTP_RESEND_TOO_SOON',
    'AUTH_OTP_SEND_LIMIT',
  )
  setupTwoFactor(@CurrentUser() ctx: RequestContext, @Body() dto: SetupTwoFactorDto) {
    return this.auth.setupTwoFactor(ctx.userId, dto.phone);
  }

  @Post('2fa/enable')
  @HttpCode(HttpStatus.OK)
  @SkipTenant()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Bước 2 — xác nhận mã và bật',
    description:
      'Trả về mã dự phòng, hiển thị MỘT LẦN. Server chỉ lưu bản băm nên không cấp lại được.',
  })
  @ApiErrors(
    'AUTH_2FA_INVALID',
    'AUTH_2FA_ALREADY_ENABLED',
    'AUTH_OTP_INVALID',
    'AUTH_OTP_EXPIRED',
    'AUTH_OTP_MAX_ATTEMPTS',
  )
  enableTwoFactor(@CurrentUser() ctx: RequestContext, @Body() dto: EnableTwoFactorDto) {
    return this.auth.enableTwoFactor(ctx.userId, dto.code);
  }

  @Post('2fa/disable')
  @HttpCode(HttpStatus.OK)
  @SkipTenant()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Tắt xác thực 2 lớp — bắt buộc xác thực lại với Firebase',
    description:
      'Cần ID token vừa làm mới (người dùng gõ lại mật khẩu) thay cho trường `password` trước đây, vì Backend không còn giữ mật khẩu để đối chiếu.',
  })
  @ApiErrors('AUTH_2FA_NOT_ENABLED', 'AUTH_FIREBASE_TOKEN_INVALID', 'AUTH_REAUTH_STALE')
  disableTwoFactor(@CurrentUser() ctx: RequestContext, @Body() dto: DisableTwoFactorDto) {
    return this.auth.disableTwoFactor(ctx.userId, dto.firebaseIdToken);
  }

  // ---------------------------------------------------------------------------
  // Phiên
  // ---------------------------------------------------------------------------

  // `@Public()` vì access token đã hết hạn thì `JwtAuthGuard` sẽ chặn — mà hết
  // hạn chính là lý do người ta gọi endpoint này. Chốt an toàn nằm ở bản thân
  // refresh token: chuỗi ngẫu nhiên lưu trong DB, tra được thì mới cấp phiên mới.
  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Làm mới phiên đăng nhập',
    description:
      'Refresh token XOAY VÒNG: mỗi lần dùng cấp token mới, token cũ vô hiệu. Dùng lại token đã bị thay thế → thu hồi toàn bộ phiên (AF-16).',
  })
  @ApiErrors('AUTH_REFRESH_INVALID', 'AUTH_REFRESH_REUSE_DETECTED', 'AUTH_ACCOUNT_SUSPENDED')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @SkipTenant()
  @AllowPendingPassword()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Đăng xuất. Bỏ trống refreshToken = thu hồi mọi phiên.' })
  logout(@CurrentUser() ctx: RequestContext, @Body() dto: LogoutDto) {
    return this.auth.logout(ctx.userId, dto.refreshToken);
  }

  @Get('me')
  @SkipTenant()
  @AllowPendingPassword()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Thông tin phiên hiện tại' })
  me(@CurrentUser() ctx: RequestContext) {
    // Trả thẳng từ `ctx` (đã giải mã sẵn từ JWT), KHÔNG truy vấn database.
    // App gọi endpoint này mỗi lần mở lên; thêm một vòng đọc DB cho dữ liệu vốn
    // đã nằm trong token là tải vô ích ở đường nóng nhất.
    //
    // Hệ quả cần biết: dữ liệu ở đây cũ tối đa bằng TTL của access token (900s).
    // Vai trò vừa bị thu hồi vẫn hiện ở đây cho tới khi token hết hạn — quyền
    // thực tế do guard quyết định ở từng request, không phải theo phản hồi này.
    return {
      userId: ctx.userId,
      employeeId: ctx.employeeId,
      companyId: ctx.companyId,
      roles: ctx.roles,
      deviceId: ctx.deviceId,
      isSystemAdmin: ctx.isSystemAdmin,
      mustChangePassword: ctx.mustChangePassword,
    };
  }

  @Get('devices')
  @SkipTenant()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Thiết bị đã liên kết với tài khoản (BR-11)' })
  devicesList(@CurrentUser() ctx: RequestContext) {
    return this.devices.listForUser(ctx.userId);
  }

  // ---------------------------------------------------------------------------
  // Xác thực lại danh tính
  // ---------------------------------------------------------------------------

  @Post('reauth/code')
  @HttpCode(HttpStatus.OK)
  @SkipTenant()
  @RateLimit({ bucket: 'reauth-code', limit: 5, windowSeconds: 900, by: 'account' })
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Gửi mã OTP phục vụ bước xác thực lại',
    description:
      'Chỉ cần gọi khi tài khoản đã bật xác thực 2 lớp. Tách khỏi `reauth/verify` vì thứ tự bắt buộc là gửi mã → người dùng đọc tin nhắn → gọi verify kèm mã.',
  })
  @ApiErrors('AUTH_2FA_NOT_ENABLED', 'AUTH_OTP_RESEND_TOO_SOON', 'AUTH_OTP_SEND_LIMIT')
  requestReauthCode(@CurrentUser() ctx: RequestContext) {
    return this.auth.requestReauthCode(ctx.userId);
  }

  @Post('reauth/verify')
  @HttpCode(HttpStatus.OK)
  @SkipTenant()
  @RateLimit({ bucket: 'reauth', limit: 10, windowSeconds: 900, by: 'account' })
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Xác thực lại và nhận reauthToken (dùng một lần, TTL 5 phút)',
    description:
      'Bắt buộc trước các thao tác nhạy cảm: đổi/xoá khuôn mặt, đăng ký vân tay cho thiết bị khác.\n\n' +
      'Neo vào MẬT KHẨU (qua ID token vừa làm mới của Firebase) chứ không phải chỉ OTP — kẻ cầm được điện thoại đang đăng nhập cũng nhận được SMS gửi tới chính máy đó.',
  })
  @ApiErrors(
    'AUTH_FIREBASE_TOKEN_INVALID',
    'AUTH_REAUTH_STALE',
    'AUTH_2FA_REQUIRED',
    'SYS_RATE_LIMITED',
  )
  verifyReauth(@CurrentUser() ctx: RequestContext, @Body() dto: ReauthVerifyDto) {
    return this.auth.verifyReauth(ctx.userId, dto.firebaseIdToken, dto.twoFactorCode);
  }
}
