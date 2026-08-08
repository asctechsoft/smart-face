import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AllowPendingPassword,
  CurrentUser,
  Public,
  SkipTenant,
} from 'src/common/decorators';
import { ApiErrors } from 'src/common/decorators/api-standard-responses.decorator';
import { RateLimit } from 'src/common/guards/rate-limit.guard';
import type { RequestContext } from 'src/common/types/request-context';
import { AuthService } from './auth.service';
import { DeviceService } from './device.service';
import {
  ChangePasswordDto,
  DisableTwoFactorDto,
  EnableTwoFactorDto,
  LoginDto,
  LogoutDto,
  ReauthVerifyDto,
  RefreshTokenDto,
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

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  // Chặn dò mật khẩu hàng loạt ở tầng hạ tầng, trước cả khi chạm tới scrypt.
  // `by: 'ip'` chứ không phải 'account': chưa đăng nhập nên chưa có tài khoản để
  // đếm. Cũng đúng về mặt phòng thủ — kẻ dò mật khẩu thử nhiều tài khoản khác
  // nhau, giới hạn theo tài khoản sẽ không cản được gì.
  @RateLimit({ bucket: 'login', limit: 20, windowSeconds: 900, by: 'ip' })
  @ApiOperation({
    summary: 'Đăng nhập bằng tên miền + email + mật khẩu',
    description:
      'Tài khoản do công ty cấp sẵn. Đăng nhập lần đầu trả `nextStep: CHANGE_PASSWORD` và token bị chặn ở mọi API khác cho tới khi đổi mật khẩu.\n\n' +
      'Tài khoản đã bật xác thực 2 lớp sẽ nhận `nextStep: TWO_FACTOR` kèm `twoFactorToken` thay vì token đăng nhập.\n\n' +
      '⚠ Sai tên miền, sai email và sai mật khẩu đều trả CÙNG một mã lỗi `AUTH_INVALID_CREDENTIALS`. Phân biệt ra sẽ biến màn hình đăng nhập thành công cụ dò danh sách email nhân viên.',
  })
  @ApiErrors(
    'AUTH_INVALID_CREDENTIALS',
    'AUTH_ACCOUNT_LOCKED',
    'AUTH_ACCOUNT_SUSPENDED',
    'AUTH_COMPANY_INACTIVE',
    'SYS_RATE_LIMITED',
  )
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Post('2fa/verify')
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ bucket: 'login-2fa', limit: 10, windowSeconds: 900, by: 'ip' })
  @ApiOperation({
    summary: 'Bước hai của đăng nhập — nhập mã xác thực 2 lớp',
    description:
      'Nhận mã 6 số từ ứng dụng xác thực, hoặc một mã dự phòng khi mất thiết bị. Mã dự phòng dùng một lần rồi mất.',
  })
  @ApiErrors('AUTH_2FA_INVALID', 'AUTH_2FA_NOT_ENABLED', 'SYS_RATE_LIMITED')
  verifyTwoFactor(@Body() dto: VerifyTwoFactorDto) {
    return this.auth.verifyTwoFactor(dto);
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
      'Bắt buộc sau khi đăng nhập lần đầu bằng mật khẩu tạm. Đổi xong sẽ THU HỒI toàn bộ phiên khác và cấp phiên mới — nếu mật khẩu đã lộ và kẻ tấn công đang có phiên mở, đổi mật khẩu mà không thu hồi thì phiên của hắn vẫn sống.',
  })
  @ApiErrors('AUTH_INVALID_CREDENTIALS', 'AUTH_PASSWORD_TOO_WEAK', 'AUTH_PASSWORD_REUSED')
  changePassword(@CurrentUser() ctx: RequestContext, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(ctx.userId, dto.currentPassword, dto.newPassword);
  }

  // ---------------------------------------------------------------------------
  // Xác thực 2 lớp
  // ---------------------------------------------------------------------------

  @Post('2fa/setup')
  @HttpCode(HttpStatus.OK)
  @SkipTenant()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Bước 1 — sinh secret và URI mã QR',
    description:
      'Chưa bật 2FA ở bước này. Phải nhập đúng một mã sinh từ secret (bước `enable`) mới bật thật — bật ngay sẽ khoá chính người dùng ra ngoài nếu họ quét mã QR hỏng.',
  })
  @ApiErrors('AUTH_2FA_ALREADY_ENABLED')
  setupTwoFactor(@CurrentUser() ctx: RequestContext) {
    return this.auth.setupTwoFactor(ctx.userId);
  }

  @Post('2fa/enable')
  @HttpCode(HttpStatus.OK)
  @SkipTenant()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Bước 2 — xác nhận và bật',
    description:
      'Trả về mã dự phòng, hiển thị MỘT LẦN. Server chỉ lưu bản băm nên không cấp lại được.',
  })
  @ApiErrors('AUTH_2FA_INVALID', 'AUTH_2FA_ALREADY_ENABLED')
  enableTwoFactor(@CurrentUser() ctx: RequestContext, @Body() dto: EnableTwoFactorDto) {
    return this.auth.enableTwoFactor(ctx.userId, dto.code);
  }

  @Post('2fa/disable')
  @HttpCode(HttpStatus.OK)
  @SkipTenant()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Tắt xác thực 2 lớp — bắt buộc xác nhận bằng mật khẩu' })
  @ApiErrors('AUTH_2FA_NOT_ENABLED', 'AUTH_INVALID_CREDENTIALS')
  disableTwoFactor(@CurrentUser() ctx: RequestContext, @Body() dto: DisableTwoFactorDto) {
    return this.auth.disableTwoFactor(ctx.userId, dto.password);
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

  @Post('reauth/verify')
  @HttpCode(HttpStatus.OK)
  @SkipTenant()
  @RateLimit({ bucket: 'reauth', limit: 10, windowSeconds: 900, by: 'account' })
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Xác thực lại và nhận reauthToken (dùng một lần, TTL 5 phút)',
    description:
      'Bắt buộc trước các thao tác nhạy cảm: đổi/xoá khuôn mặt, đăng ký vân tay cho thiết bị khác.\n\n' +
      'Dùng MẬT KHẨU chứ không dùng OTP SMS — kẻ cầm được điện thoại đang đăng nhập cũng nhận được SMS gửi tới chính máy đó.',
  })
  @ApiErrors('AUTH_INVALID_CREDENTIALS', 'AUTH_2FA_REQUIRED', 'SYS_RATE_LIMITED')
  verifyReauth(@CurrentUser() ctx: RequestContext, @Body() dto: ReauthVerifyDto) {
    return this.auth.verifyReauth(ctx.userId, dto.password, dto.totpCode);
  }
}
