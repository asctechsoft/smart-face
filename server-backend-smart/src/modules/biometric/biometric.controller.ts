import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsObject, IsOptional, IsString, Length, Min } from 'class-validator';
import { CurrentTenant, CurrentUser, RequireSignature } from 'src/common/decorators';
import { ApiErrors } from 'src/common/decorators/api-standard-responses.decorator';
import { RateLimit } from 'src/common/guards/rate-limit.guard';
import { VerifyBodyHashInterceptor } from 'src/common/interceptors';
import { AppException } from 'src/common/errors';
import type { RequestContext, TenantContext } from 'src/common/types/request-context';
import { AuthService } from '../auth/auth.service';
import { BiometricService } from './biometric.service';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Bắt đầu phiên đăng ký khuôn mặt.
 *
 * `reauthToken` bắt buộc khi ĐÈ lên hồ sơ đã có — đó chính là kịch bản tấn công
 * nguy hiểm nhất: kẻ mượn được điện thoại đang mở khoá chỉ cần đăng ký lại mặt
 * mình là chấm công thay người khác mãi mãi. Bắt nhập lại mật khẩu chặn đúng
 * kịch bản đó. Lần đăng ký ĐẦU TIÊN thì chưa có gì để đè nên không cần.
 */
class StartEnrollDto {
  @ApiPropertyOptional({
    description:
      'BẮT BUỘC khi đã có hồ sơ khuôn mặt (đăng ký ĐÈ). Bỏ trống khi đăng ký lần đầu lúc onboarding. Lấy từ POST /auth/reauth/verify.',
  })
  @IsOptional()
  @IsString()
  reauthToken?: string;
}

/**
 * Nộp từng ảnh trong phiên đăng ký.
 *
 * Đăng ký cần NHIỀU ảnh ở các góc khác nhau, nộp lần lượt chứ không gửi một
 * lượt: mỗi ảnh phải qua kiểm tra chất lượng và phản hồi ngay để người dùng biết
 * chụp lại. Gửi cả loạt rồi mới báo "ảnh thứ 3 bị mờ" là bắt họ làm lại từ đầu.
 *
 * `sessionId` nối các ảnh vào cùng một phiên; `order` cho server biết ảnh này
 * ứng với tư thế nào trong kịch bản đã yêu cầu.
 */
class SubmitEnrollDto {
  @ApiProperty()
  @IsString()
  sessionId!: string;

  // `@Type(() => Number)` vì gửi kèm ảnh bằng multipart, mọi trường đều là chuỗi.
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  order!: number;
}

/**
 * Đăng ký vân tay — chính xác hơn là đăng ký KHOÁ CÔNG KHAI của thiết bị.
 *
 * Server không bao giờ thấy vân tay. Hệ điều hành giữ private key trong secure
 * enclave và chỉ mở khoá sau khi người dùng chạm vân tay; server chỉ giữ public
 * key để xác minh chữ ký. Vì thế dữ liệu sinh trắc không thể rò rỉ từ server —
 * nó chưa từng ở đó.
 */
class RegisterFingerprintDto {
  @ApiProperty()
  @IsString()
  deviceId!: string;

  @ApiProperty({
    description: 'PUBLIC KEY dạng PEM sinh trong secure enclave. Server KHÔNG nhận private key.',
    example: '-----BEGIN PUBLIC KEY-----\nMFkwEw...\n-----END PUBLIC KEY-----',
  })
  @IsString()
  publicKey!: string;

  @ApiPropertyOptional({ default: 'ES256' })
  @IsOptional()
  @IsString()
  algorithm?: string;

  @ApiPropertyOptional({ description: 'Kết quả Play Integrity / App Attest lúc đăng ký' })
  @IsOptional()
  @IsObject()
  attestation?: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      'BẮT BUỘC khi `deviceId` khác thiết bị trong token. App đăng ký cho chính máy nó đang chạy thì không cần.',
  })
  @IsOptional()
  @IsString()
  reauthToken?: string;
}

class ResetBiometricDto {
  @ApiProperty({ description: 'Lấy từ POST /auth/reauth/verify — dùng một lần, TTL 5 phút' })
  @IsString()
  reauthToken!: string;

  @ApiProperty({ minLength: 10 })
  @IsString()
  @Length(10, 500)
  reason!: string;
}

/**
 * docs/08-hop-dong-api.md mục 3 — API Sinh trắc học.
 *
 * Nguyên tắc xuyên suốt: thao tác nào làm THAY ĐỔI thứ dùng để xác minh danh
 * tính đều đòi `reauthToken` (đăng ký đè khuôn mặt, xoá khuôn mặt, đăng ký vân
 * tay cho máy khác). Lý do: access token nằm sẵn trên máy đang mở khoá, còn mật
 * khẩu thì không. Đây là lớp duy nhất chặn được người mượn được điện thoại.
 *
 * ⚠ Server lưu embedding (vector số) chứ KHÔNG lưu ảnh khuôn mặt gốc, và không
 * bao giờ nhận private key của vân tay.
 */
@ApiTags('App · Sinh trắc học')
@ApiBearerAuth()
@Controller('biometric')
export class BiometricController {
  constructor(
    private readonly biometric: BiometricService,
    private readonly auth: AuthService,
  ) {}

  @Get('status')
  @ApiOperation({
    summary: 'Trạng thái đăng ký sinh trắc học',
    description: 'BR-03: `satisfiesMinimum = false` thì App phải chặn vào Home.',
  })
  status(@CurrentTenant() ctx: TenantContext) {
    return this.biometric.getStatus(ctx);
  }

  // ---------------------------------------------------------------------------
  // Khuôn mặt
  // ---------------------------------------------------------------------------

  @Post('face/enroll/start')
  @HttpCode(HttpStatus.OK)
  @RequireSignature()
  @RateLimit({ bucket: 'face-enroll', limit: 20, windowSeconds: 3600, by: 'account' })
  @ApiOperation({
    summary: 'Bắt đầu phiên đăng ký khuôn mặt đa góc',
    description:
      'Trả về danh sách bước. Bước cuối kèm hành động liveness NGẪU NHIÊN do server chọn (AF-05) — kẻ gian không quay sẵn video được.\n\n' +
      'Đăng ký LẦN ĐẦU (onboarding) không cần gì thêm. Đăng ký ĐÈ lên hồ sơ đang có thì BẮT BUỘC `reauthToken`, nếu không trả `AUTH_REAUTH_REQUIRED`.',
  })
  @ApiErrors(
    'AUTH_COMPANY_REQUIRED',
    'AUTH_REAUTH_REQUIRED',
    'AUTH_SIGNATURE_INVALID',
    'SYS_RATE_LIMITED',
  )
  async startEnroll(@CurrentTenant() ctx: TenantContext, @Body() dto: StartEnrollDto) {
    // Tiêu thụ token trước rồi mới hỏi service có cần hay không. Token dùng một
    // lần nên tiêu thụ thừa chỉ tốn của chính người dùng một lượt OTP, còn để
    // service tự tiêu thụ thì phải kéo AuthService vào BiometricModule và tạo
    // phụ thuộc vòng.
    if (dto.reauthToken) {
      await this.auth.consumeReauthToken(ctx.userId, dto.reauthToken);
    }
    return this.biometric.startFaceEnrollment(ctx, {
      reauthVerified: Boolean(dto.reauthToken),
    });
  }

  @Post('face/enroll/submit')
  @HttpCode(HttpStatus.OK)
  // Ảnh đăng ký là thứ quyết định danh tính về sau — tráo được ảnh ở đây thì
  // tráo được cả hồ sơ chấm công. Ràng buộc nội dung bằng X-Body-Sha256.
  @RequireSignature()
  @RateLimit({ bucket: 'face-enroll', limit: 20, windowSeconds: 3600, by: 'account' })
  @UseInterceptors(
    FileInterceptor('image', { limits: { fileSize: MAX_IMAGE_BYTES } }),
    VerifyBodyHashInterceptor,
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Gửi ảnh cho một bước đăng ký',
    description:
      'Hoàn tất bước cuối → đối chiếu với TOÀN BỘ embedding trong công ty (BR-10). Trùng nhân viên khác thì CHẶN và cảnh báo gian lận danh tính.',
  })
  @ApiErrors(
    'FACE_ENROLL_SESSION_INVALID',
    'FACE_NOT_FOUND',
    'FACE_MULTIPLE',
    'FACE_LOW_LIGHT',
    'FACE_BLURRY',
    'FACE_TOO_SMALL',
    'FACE_MASK_DETECTED',
    'FACE_LIVENESS_FAILED',
    'FACE_DUPLICATE_IDENTITY',
    'AUTH_SIGNATURE_INVALID',
    'SYS_AI_UNAVAILABLE',
  )
  submitEnroll(
    @CurrentTenant() ctx: TenantContext,
    @Body() dto: SubmitEnrollDto,
    @UploadedFile() image: Express.Multer.File,
  ) {
    if (!image?.buffer) {
      throw new AppException('FACE_NOT_FOUND', { reason: 'Thiếu ảnh.' });
    }
    return this.biometric.submitFaceEnrollment(ctx, dto.sessionId, dto.order, image.buffer);
  }

  @Delete('face')
  @HttpCode(HttpStatus.OK)
  @RequireSignature()
  @ApiOperation({
    summary: 'Đặt lại khuôn mặt để đăng ký lại',
    description:
      'BẮT BUỘC kèm `reauthToken` (FR-APP-PRO-02). Đây là điểm tấn công quan trọng: chiếm được điện thoại đang đăng nhập thì có thể đăng ký khuôn mặt của mình đè lên. Luôn ghi audit và thông báo HR.',
  })
  @ApiErrors('AUTH_REAUTH_REQUIRED', 'EMP_NOT_FOUND')
  async resetFace(@CurrentTenant() ctx: TenantContext, @Body() dto: ResetBiometricDto) {
    await this.auth.consumeReauthToken(ctx.userId, dto.reauthToken);
    return this.biometric.resetFace(ctx, dto.reason);
  }

  // ---------------------------------------------------------------------------
  // Vân tay
  // ---------------------------------------------------------------------------

  @Post('fingerprint/register')
  @RequireSignature()
  @ApiOperation({
    summary: 'Đăng ký vân tay — gửi PUBLIC KEY',
    description:
      'BR-05 / NFR-SEC-07: server CHỈ lưu public key. Private key nằm trong secure enclave, không rời khỏi thiết bị. Backend không bao giờ nhận cờ `fingerprintVerified`.\n\n' +
      '`deviceId` phải TRÙNG thiết bị trong token. Muốn đăng ký cho thiết bị khác thì bắt buộc `reauthToken` — chặn kẻ lấy được token đăng ký khoá của máy mình rồi chấm công thay người khác.',
  })
  @ApiErrors(
    'AUTH_COMPANY_REQUIRED',
    'AUTH_DEVICE_MISMATCH',
    'AUTH_REAUTH_REQUIRED',
    'AUTH_SIGNATURE_INVALID',
    'SYS_VALIDATION_ERROR',
  )
  async registerFingerprint(
    @CurrentTenant() ctx: TenantContext,
    @Body() dto: RegisterFingerprintDto,
  ) {
    if (dto.reauthToken) {
      await this.auth.consumeReauthToken(ctx.userId, dto.reauthToken);
    }
    return this.biometric.registerFingerprint(
      ctx,
      dto.deviceId,
      dto.publicKey,
      dto.algorithm ?? 'ES256',
      dto.attestation as never,
      { reauthVerified: Boolean(dto.reauthToken) },
    );
  }

  @Delete('fingerprint')
  @HttpCode(HttpStatus.OK)
  @RequireSignature()
  @ApiOperation({ summary: 'Thu hồi khoá vân tay để đăng ký lại' })
  @ApiErrors('AUTH_REAUTH_REQUIRED', 'AUTH_SIGNATURE_INVALID')
  async resetFingerprint(@CurrentTenant() ctx: TenantContext, @Body() dto: ResetBiometricDto) {
    await this.auth.consumeReauthToken(ctx.userId, dto.reauthToken);
    return this.biometric.resetFingerprint(ctx, dto.reason);
  }

  @Get('challenge')
  @ApiOperation({
    summary: 'Nonce để ký bằng vân tay',
    description:
      'Dùng cho luồng challenge–response: App yêu cầu OS xác thực vân tay, secure enclave ký nonce này rồi gửi lên qua `signedChallenge` khi chấm công.',
  })
  challenge(@CurrentUser() ctx: RequestContext) {
    return {
      // Nonce chấm công lấy từ GET /attendance/challenge — endpoint này chỉ trả
      // giờ server để App đối chiếu trước khi mở prompt sinh trắc học.
      serverTime: new Date().toISOString(),
      userId: ctx.userId,
    };
  }
}
