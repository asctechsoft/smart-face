import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { CurrentTenant, Roles } from 'src/common/decorators';
import type { TenantContext } from 'src/common/types/request-context';
import { AuditLogQueryDto } from './dto/audit.dto';
import { AuditService } from './audit.service';

/**
 * Tra cứu nhật ký kiểm toán cho Web Quản lý.
 *
 * Chỉ có ĐỌC. Không có POST/PATCH/DELETE ở đây một cách có chủ đích: nhật ký sửa
 * được thì mất sạch giá trị đối chứng khi có tranh chấp lao động. Bản ghi được
 * tạo tự động bởi `AuditInterceptor`, không do controller nào tạo tay.
 */
@ApiTags('Web Quản lý · Audit log')
@ApiBearerAuth()
@Controller('admin/audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Roles(SystemRole.COMPANY_ADMIN, SystemRole.HR_PAYROLL)
  @ApiOperation({
    summary: 'Tra cứu audit log của công ty',
    description:
      'companyId LUÔN lấy từ JWT, bỏ qua giá trị client gửi lên (BR-09). Admin hệ thống dùng /system/audit-logs để tra cứu xuyên tenant.',
  })
  search(@CurrentTenant() ctx: TenantContext, @Query() query: AuditLogQueryDto) {
    // `companyId` lấy từ `ctx` (giải mã từ JWT), KHÔNG lấy từ `query`. Nếu nhận
    // từ query thì bất kỳ admin nào cũng chỉ cần đổi một tham số trên URL là đọc
    // được nhật ký của công ty khác. Đây là lý do tham số này được truyền tách
    // rời khỏi `query` thay vì trộn chung (BR-09).
    return this.audit.search(query, { companyId: ctx.companyId });
  }
}
