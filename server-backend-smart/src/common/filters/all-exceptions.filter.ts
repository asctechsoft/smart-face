import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { ulid } from 'ulid';
import { AppException, ERROR_CATALOG, ErrorCode, ErrorDefinition } from '../errors';
import type { AuthenticatedRequest } from '../types/request-context';

/**
 * Chuẩn hoá TOÀN BỘ lỗi về error contract của docs/02 mục 9.
 *
 * ```json
 * { "success": false, "error": { "code", "message", "messageEn", "hint", "retryable", "details", "traceId" } }
 * ```
 *
 * Không có lỗi nào lọt ra ngoài dạng khác — App/Web chỉ cần xử lý một hình dạng.
 */
// `@Catch()` không tham số = bắt MỌI thứ ném ra, kể cả giá trị không phải Error
// (`throw 'oops'`). Khai kiểu cụ thể sẽ để lọt những trường hợp còn lại ra
// handler mặc định của Nest, và client nhận về một hình dạng phản hồi khác.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<AuthenticatedRequest>();
    const response = context.getResponse<Response>();
    // Ưu tiên traceId đã có sẵn trong request để log và phản hồi trỏ về cùng
    // một mã. Sinh mới chỉ là phương án cuối, cho lỗi xảy ra TRƯỚC khi guard kịp
    // dựng context (vd: body JSON hỏng, chết ngay ở tầng parse).
    const traceId = request.ctx?.traceId ?? request.traceId ?? ulid();

    const resolved = this.resolve(exception);

    // Phân tầng log theo mức nghiêm trọng, cố ý:
    //   >= 500 → `error` kèm stack, đây là bug cần người vào xem.
    //   < 500  → `debug`, vì đây là lỗi nghiệp vụ bình thường (sai mật khẩu,
    //            hết phép, ngoài vùng geofence). Ghi mức `error` cho những thứ
    //            này sẽ nhấn chìm bug thật giữa hàng nghìn dòng nhiễu.
    if (resolved.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `[${traceId}] ${request.method} ${request.url} → ${resolved.code}: ${
          exception instanceof Error ? exception.message : String(exception)
        }`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.debug(`[${traceId}] ${request.method} ${request.url} → ${resolved.code}`);
    }

    response.status(resolved.status).json({
      success: false,
      error: {
        code: resolved.code,
        message: resolved.message,
        messageEn: resolved.messageEn,
        ...(resolved.hint ? { hint: resolved.hint } : {}),
        retryable: resolved.retryable,
        ...(resolved.details ? { details: resolved.details } : {}),
        traceId,
      },
    });
  }

  /**
   * Quy mọi loại ngoại lệ về một hình dạng phản hồi duy nhất.
   *
   * ⚠ THỨ TỰ 5 NHÁNH LÀ CÓ Ý, từ cụ thể nhất tới chung nhất. Đưa nhánh 4
   * (`HttpException` chung) lên trước nhánh 2 sẽ nuốt hết lỗi validation, vì
   * `BadRequestException` cũng là một `HttpException`.
   */
  private resolve(exception: unknown): {
    status: number;
    code: string;
    message: string;
    messageEn: string;
    hint?: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  } {
    // 1. Lỗi nghiệp vụ đã khai trong bảng mã lỗi — đường đi chính.
    if (exception instanceof AppException) {
      return {
        status: exception.definition.status,
        code: exception.code,
        message: exception.definition.message,
        messageEn: exception.definition.messageEn,
        hint: exception.definition.hint,
        retryable: exception.definition.retryable,
        details: exception.details,
      };
    }

    // 2. Lỗi validation của ValidationPipe.
    if (exception instanceof HttpException && exception.getStatus() === HttpStatus.BAD_REQUEST) {
      const payload = exception.getResponse() as { message?: string | string[] };
      const violations = Array.isArray(payload?.message)
        ? payload.message
        : payload?.message
          ? [payload.message]
          : [];
      return {
        ...this.fromCatalog('SYS_VALIDATION_ERROR'),
        details: violations.length > 0 ? { violations } : undefined,
      };
    }

    // 3. Lỗi Prisma đã biết → ánh xạ sang mã nghiệp vụ.
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.fromPrisma(exception);
    }

    // 4. HttpException khác của Nest (404 route, 405…).
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status === HttpStatus.NOT_FOUND) return this.fromCatalog('SYS_NOT_FOUND');
      if (status === HttpStatus.UNAUTHORIZED) return this.fromCatalog('AUTH_TOKEN_INVALID');
      if (status === HttpStatus.FORBIDDEN) return this.fromCatalog('AUTH_FORBIDDEN');
      if (status === HttpStatus.TOO_MANY_REQUESTS) return this.fromCatalog('SYS_RATE_LIMITED');
      if (status === HttpStatus.PAYLOAD_TOO_LARGE) {
        return this.fromCatalog('REQ_ATTACHMENT_INVALID');
      }
      return { ...this.fromCatalog('SYS_INTERNAL_ERROR'), status };
    }

    // 5. Không xác định → 500, KHÔNG lộ chi tiết nội bộ ra ngoài.
    //
    // Thông điệp gốc có thể chứa đường dẫn file, tên bảng, chuỗi kết nối, đoạn
    // câu lệnh SQL. Người dùng nhận `traceId` để báo lỗi; chi tiết nằm ở log
    // phía server, nơi chỉ người vận hành đọc được.
    return this.fromCatalog('SYS_INTERNAL_ERROR');
  }

  /**
   * Ánh xạ mã lỗi Prisma sang mã nghiệp vụ mà người dùng hiểu được.
   *
   * "Unique constraint failed on the fields: (`employeeCode`)" là câu dành cho
   * lập trình viên. Người dùng cần đọc được "Mã nhân viên này đã tồn tại".
   *
   * ⚠ Đoán ý nghĩa qua TÊN CỘT (`fields.some(...includes('phone'))`) là cách làm
   * mong manh: đổi tên cột trong `schema.prisma` sẽ âm thầm rơi xuống nhánh
   * mặc định, và người dùng nhận lỗi chung chung thay vì thông báo đúng. Sửa
   * schema thì nhớ rà lại chỗ này.
   */
  private fromPrisma(error: Prisma.PrismaClientKnownRequestError) {
    const target = (error.meta?.target as string[] | string | undefined) ?? [];
    const fields = Array.isArray(target) ? target : [target];

    switch (error.code) {
      case 'P2002': {
        // Vi phạm unique constraint
        if (fields.some((field) => field.includes('employeeCode'))) {
          return this.fromCatalog('EMP_CODE_TAKEN');
        }
        if (fields.some((field) => field.includes('phone'))) {
          return this.fromCatalog('EMP_PHONE_TAKEN');
        }
        if (fields.some((field) => field.includes('code'))) {
          return this.fromCatalog('TEN_CODE_TAKEN');
        }
        return { ...this.fromCatalog('SYS_VALIDATION_ERROR'), details: { conflictFields: fields } };
      }
      // P2025 — bản ghi cần thao tác không tồn tại. Thường là do WHERE có kèm
      // `companyId` mà bản ghi thuộc công ty khác: đúng ra phải trả "không tìm
      // thấy" chứ không phải "không có quyền", vì thông báo sau đã xác nhận cho
      // kẻ dò biết id đó có tồn tại ở đâu đó.
      case 'P2025':
        return this.fromCatalog('SYS_NOT_FOUND');
      // P2003 — khoá ngoại trỏ tới bản ghi không tồn tại (vd: departmentId sai).
      case 'P2003':
        return {
          ...this.fromCatalog('SYS_VALIDATION_ERROR'),
          details: { reason: 'Tham chiếu tới bản ghi không tồn tại', fields },
        };
      default:
        return this.fromCatalog('SYS_INTERNAL_ERROR');
    }
  }

  private fromCatalog(code: ErrorCode) {
    // ERROR_CATALOG dùng `as const` nên mỗi entry có kiểu literal riêng; ép về
    // ErrorDefinition để truy cập `hint` (không phải entry nào cũng khai).
    const definition: ErrorDefinition = ERROR_CATALOG[code];
    return {
      status: definition.status as number,
      code: code as string,
      message: definition.message,
      messageEn: definition.messageEn,
      hint: definition.hint,
      retryable: definition.retryable,
      details: undefined as Record<string, unknown> | undefined,
    };
  }
}
