import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AttendanceType } from '@prisma/client';
import { CurrentTenant, CurrentUser, RequireSignature } from 'src/common/decorators';
import { ApiErrors } from 'src/common/decorators/api-standard-responses.decorator';
import { RateLimit } from 'src/common/guards/rate-limit.guard';
import { VerifyBodyHashInterceptor } from 'src/common/interceptors';
import { AppException } from 'src/common/errors';
import { PaginatedResult } from 'src/common/dto';
import { buildMeta, formatWorkDate } from 'src/common/utils';
import type {
  AuthenticatedRequest,
  RequestContext,
  TenantContext,
} from 'src/common/types/request-context';
import { AttendanceAdminService } from './attendance-admin.service';
import { AttendanceService } from './attendance.service';
import { AttendanceHistoryQueryDto, CheckInDto } from './dto/attendance.dto';

// Trần 5MB cho ảnh chấm công. Ảnh selfie từ điện thoại đời mới cỡ 2–4MB; đặt
// cao hơn nữa chỉ khiến người dùng ở vùng sóng yếu chờ lâu rồi timeout, mà độ
// chính xác nhận diện không tăng thêm (model resize về 112×112 trước khi chạy).
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * docs/08-hop-dong-api.md mục 4 — API Chấm công (App Nhân viên).
 *
 * Mọi endpoint ở đây đều thao tác trên CHÍNH người đang đăng nhập, lấy từ JWT.
 * Không endpoint nào nhận `employeeId` từ client — nhận là mở đường cho việc
 * chấm công hộ chỉ bằng cách đổi một tham số. Xem `attendance-admin.controller.ts`
 * cho các thao tác trên người khác, nơi có kiểm tra vai trò và phạm vi đầy đủ.
 */
@ApiTags('App · Chấm công')
@ApiBearerAuth()
@Controller('attendance')
export class AttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly admin: AttendanceAdminService,
  ) {}

  @Get('challenge')
  @ApiOperation({
    summary: 'Lấy nonce + thao tác liveness ngẫu nhiên + giờ server',
    description:
      'BẮT BUỘC gọi trước mỗi lần chấm công. `livenessAction` do SERVER chọn ngẫu nhiên mỗi lần (AF-05) — App không được tự quyết, nếu không kẻ gian chỉ cần quay sẵn một video. `serverTime` để App đối chiếu giờ máy (AF-18).',
  })
  @ApiErrors('AUTH_COMPANY_REQUIRED', 'AUTH_ACCOUNT_SUSPENDED')
  challenge(@CurrentUser() ctx: RequestContext) {
    return this.attendance.createChallenge(ctx);
  }

  @Post('check-in')
  // 200 thay vì 201 mặc định của POST: chấm công không "tạo tài nguyên" theo
  // nghĩa REST mà ghi nhận một sự kiện. Client đọc kết quả trong body chứ không
  // đi theo header `Location`.
  @HttpCode(HttpStatus.OK)
  // AF-12 — lớp DUY NHẤT chặn được kẻ đã đánh cắp access token. Xem .env.example.
  @RequireSignature()
  // docs/08 mục 10: 10 req/giờ theo tài khoản + thiết bị (bình thường 2-4 lần/ngày).
  @RateLimit({ bucket: 'attendance', limit: 10, windowSeconds: 3600, by: 'account+device' })
  // VerifyBodyHashInterceptor PHẢI đứng sau FileInterceptor — nó cần `request.file`
  // đã được multer parse xong. Đảo thứ tự là mọi request đều bị từ chối.
  @UseInterceptors(
    FileInterceptor('image', { limits: { fileSize: MAX_IMAGE_BYTES } }),
    VerifyBodyHashInterceptor,
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Chấm vào',
    description:
      'Endpoint quan trọng nhất hệ thống. Payload TUYỆT ĐỐI KHÔNG chứa cờ `faceVerified`/`biometricOk` — Backend tự gọi AI Server kiểm chứng rồi tự so ngưỡng cấu hình theo công ty (BR-02, AF-10, P3). Thời gian ghi nhận là GIỜ SERVER (BR-01).',
  })
  @ApiErrors(
    'ATT_INVALID_NONCE',
    'AUTH_DEVICE_MISMATCH',
    'AUTH_SIGNATURE_INVALID',
    'FRAUD_MOCK_LOCATION',
    'FRAUD_ROOTED_DEVICE',
    'FRAUD_ATTESTATION_FAILED',
    'FRAUD_REPLAY_DETECTED',
    'FRAUD_CLOCK_SKEW',
    'FRAUD_LOW_GPS_ACCURACY',
    'FRAUD_RISK_TOO_HIGH',
    'ATT_OUT_OF_GEOFENCE',
    'ATT_WIFI_REQUIRED',
    'ATT_WIFI_NOT_CONFIGURED',
    'ATT_IP_NOT_ALLOWED',
    'ATT_IP_NOT_CONFIGURED',
    'ATT_ALREADY_CHECKED_IN',
    'ATT_NO_SHIFT_TODAY',
    'ATT_PERIOD_LOCKED',
    'FACE_LIVENESS_FAILED',
    'FACE_NOT_MATCHED',
    'FACE_NOT_ENROLLED',
    'SYS_RATE_LIMITED',
    'SYS_AI_UNAVAILABLE',
  )
  checkIn(
    @CurrentUser() ctx: RequestContext,
    @Body() dto: CheckInDto,
    @UploadedFile() image: Express.Multer.File | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    // `punch()` dùng chung cho cả vào lẫn ra — toàn bộ chuỗi kiểm tra (nonce,
    // geofence, WiFi, khuôn mặt, chấm điểm rủi ro) giống hệt nhau, chỉ khác
    // `AttendanceType`. Viết hai bản là bảo đảm sớm muộn có một bên thiếu chốt.
    //
    // `request.ip` lấy từ Express, đã áp `trust proxy` cấu hình ở main.ts —
    // KHÔNG đọc thẳng header `X-Forwarded-For`, vì client tự đặt được (AF-02b).
    return this.attendance.punch(ctx, dto, image?.buffer, AttendanceType.CHECK_IN, request.ip);
  }

  @Post('check-out')
  @HttpCode(HttpStatus.OK)
  @RequireSignature()
  @RateLimit({ bucket: 'attendance', limit: 10, windowSeconds: 3600, by: 'account+device' })
  @UseInterceptors(
    FileInterceptor('image', { limits: { fileSize: MAX_IMAGE_BYTES } }),
    VerifyBodyHashInterceptor,
  )
  @ApiConsumes('multipart/form-data')
  // Danh sách lỗi ngắn hơn `check-in` là đúng, không phải sót: các chốt về thiết
  // bị, geofence, gian lận đã chạy và đã chặn ở lượt vào. Người đã vào được thì
  // đang ở đúng chỗ; lượt ra chỉ cần xác nhận đúng người và đúng phiên.
  @ApiOperation({ summary: 'Chấm ra' })
  @ApiErrors(
    'ATT_INVALID_NONCE',
    'FRAUD_REPLAY_DETECTED',
    'ATT_NOT_CHECKED_IN',
    'ATT_PERIOD_LOCKED',
    'FACE_LIVENESS_FAILED',
    'FACE_NOT_MATCHED',
    'SYS_AI_UNAVAILABLE',
  )
  checkOut(
    @CurrentUser() ctx: RequestContext,
    @Body() dto: CheckInDto,
    @UploadedFile() image: Express.Multer.File | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.attendance.punch(ctx, dto, image?.buffer, AttendanceType.CHECK_OUT, request.ip);
  }

  @Get('today')
  @ApiOperation({
    summary: 'Trạng thái chấm công hôm nay',
    description:
      'Trả kèm `serverTime` để đồng hồ đếm giờ trên Home khớp giờ server, không lệch khi đổi múi giờ máy (FR-APP-HOME-04).',
  })
  today(@CurrentUser() ctx: RequestContext) {
    return this.attendance.getToday(ctx);
  }

  @Get('history')
  @ApiOperation({
    summary: 'Lịch sử chấm công theo ngày',
    description: 'Query trên AttendanceDaily (đã tính sẵn), không quét bảng thô.',
  })
  async history(@CurrentTenant() ctx: TenantContext, @Query() query: AttendanceHistoryQueryDto) {
    if (!ctx.employeeId) {
      throw new AppException('AUTH_COMPANY_REQUIRED');
    }

    // `companyId` và `employeeId` lấy từ JWT, truyền xuống Service như chốt an
    // toàn chứ không phải bộ lọc tiện dụng — xem `AttendanceService.getHistory`.
    const { items, total } = await this.attendance.getHistory(ctx.companyId, ctx.employeeId, {
      from: query.from,
      to: query.to,
      status: query.status,
      skip: query.skip,
      take: query.take,
    });

    // `formatWorkDate` đổi Date sang chuỗi 'YYYY-MM-DD'. Trả Date thô thì
    // JSON.stringify sinh ra ISO kèm giờ UTC — ngày công 2026-08-02 của Việt Nam
    // hiện thành "2026-08-01T17:00:00Z" trên App, lệch hẳn một ngày.
    return new PaginatedResult(
      items.map((item) => ({ ...item, workDate: formatWorkDate(item.workDate) })),
      buildMeta(query.page, query.pageSize, total),
    );
  }

  @Get('adjustments')
  @ApiOperation({
    summary: 'Lịch sử hiệu chỉnh công của tôi',
    description: 'BR-ADJ-06 — minh bạch với người lao động, giảm khiếu nại.',
  })
  adjustments(
    @CurrentTenant() ctx: TenantContext,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (!ctx.employeeId) {
      throw new AppException('AUTH_COMPANY_REQUIRED');
    }
    return this.admin.listAdjustments(ctx.companyId, ctx.employeeId, from, to);
  }

  // ⚠ `@Get(':id')` phải là route GET CUỐI CÙNG trong class. Nest so khớp theo
  // thứ tự khai báo, nên đặt trước `challenge`/`today`/`history` sẽ nuốt hết —
  // `GET /attendance/today` bị hiểu thành `id = 'today'` và luôn trả 404.
  @Get(':id')
  @ApiOperation({
    summary: 'Chi tiết một lượt chấm công của tôi',
    description: 'Ảnh trả về qua presigned URL hết hạn sau 5 phút (NFR-SEC-12).',
  })
  @ApiErrors('ATT_NOT_FOUND')
  detail(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    if (!ctx.employeeId) {
      throw new AppException('AUTH_COMPANY_REQUIRED');
    }
    // Nhân viên chỉ xem được lượt chấm công của CHÍNH MÌNH.
    return this.attendance.getLogDetail(ctx.companyId, id, ctx.employeeId);
  }
}
