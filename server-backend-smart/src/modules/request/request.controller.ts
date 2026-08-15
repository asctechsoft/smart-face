import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { Audit, CurrentTenant, DepartmentScoped, Roles } from 'src/common/decorators';
import { ApiErrors } from 'src/common/decorators/api-standard-responses.decorator';
import { AppException } from 'src/common/errors';
import { resolveDepartmentScope } from 'src/common/guards/scope.guard';
import type { TenantContext } from 'src/common/types/request-context';
import {
  ApprovalPreviewQueryDto,
  ApproveRequestDto,
  BulkApproveDto,
  CancelRequestDto,
  CreateRequestDto,
  CreateRequestOnBehalfDto,
  RejectRequestDto,
  RequestQueryDto,
  UpdateRequestDto,
} from './dto/request.dto';
import { RequestService } from './request.service';

// 10MB — gấp đôi ảnh chấm công vì đính kèm thường là ảnh chụp giấy tờ (giấy
// khám bệnh, giấy mời) hoặc file PDF nhiều trang, không phải ảnh selfie.
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/**
 * docs/08-hop-dong-api.md mục 5 — API Đơn từ (dùng chung App và Web Quản lý).
 *
 * Là controller DUY NHẤT phục vụ cả hai loại client, vì cùng một con người vừa
 * là người nộp đơn vừa có thể là người duyệt đơn của cấp dưới. Tách đôi sẽ phải
 * nhân bản toàn bộ logic trạng thái đơn ở hai nơi.
 *
 * Quyền không dựa vào việc client là App hay Web, mà dựa vào quan hệ với từng
 * đơn: người tạo sửa/huỷ được đơn mình, người duyệt duyệt được đơn của cấp dưới.
 * `ScopeGuard` + `resolveDepartmentScope()` lo phần phạm vi phòng ban.
 *
 * ⚠ BR-APV-03: không ai được duyệt đơn của chính mình, kể cả COMPANY_ADMIN.
 */
@ApiTags('Đơn từ')
@ApiBearerAuth()
@Controller()
export class RequestController {
  constructor(private readonly requests: RequestService) {}

  @Get('request-types')
  @ApiOperation({ summary: 'Danh mục loại đơn của công ty kèm luồng duyệt' })
  listTypes(@CurrentTenant() ctx: TenantContext) {
    return this.requests.listRequestTypes(ctx.companyId);
  }

  @Get('requests/reference')
  @ApiOperation({
    summary: 'Thông tin tham chiếu trước khi tạo đơn',
    description: 'FR-APP-REQ-02 — phép năm còn lại, giờ nợ/dư, số đơn đang chờ duyệt.',
  })
  reference(@CurrentTenant() ctx: TenantContext) {
    if (!ctx.employeeId) throw new AppException('AUTH_COMPANY_REQUIRED');
    return this.requests.getReference(ctx.companyId, ctx.employeeId);
  }

  // ⚠ Route tĩnh (`reference`, `pending-approval`) PHẢI khai trước `requests/:id`.
  // Nest so khớp theo thứ tự khai báo; đảo lại thì `:id` nuốt hết và
  // `GET /requests/pending-approval` bị hiểu thành đơn có id = 'pending-approval'.
  @Get('requests/pending-approval')
  @DepartmentScoped()
  @ApiOperation({
    summary: 'Đơn tôi cần duyệt',
    description: 'Không bao giờ hiển thị đơn của chính mình (BR-APV-03).',
  })
  pendingApproval(@CurrentTenant() ctx: TenantContext, @Query() query: RequestQueryDto) {
    return this.requests.listPendingApproval(ctx, query);
  }

  @Get('requests')
  @DepartmentScoped()
  @ApiOperation({
    summary: 'Danh sách đơn',
    description:
      'Nhân viên truyền `mineOnly=true`. MANAGER chỉ thấy đơn của phòng ban mình quản lý (ScopeGuard).',
  })
  list(@CurrentTenant() ctx: TenantContext, @Query() query: RequestQueryDto) {
    return this.requests.list(ctx, query, resolveDepartmentScope(ctx));
  }

  @Post('requests')
  @ApiOperation({
    summary: 'Tạo đơn (nháp hoặc gửi luôn)',
    description:
      'Chặn đơn trùng khoảng thời gian (BR-REQ-02), kiểm tra số dư phép (FR-APP-REQ-10) và chặn đơn rơi vào kỳ lương đã chốt (BR-REQ-04).',
  })
  @ApiErrors(
    'REQ_TYPE_NOT_FOUND',
    'REQ_INSUFFICIENT_LEAVE',
    'REQ_OVERLAP',
    'REQ_ATTACHMENT_REQUIRED',
    'REQ_PERIOD_LOCKED',
  )
  create(@CurrentTenant() ctx: TenantContext, @Body() dto: CreateRequestDto) {
    // Bốn chốt trong `create()` đều phải chạy TRONG một transaction cùng với
    // việc ghi đơn. Kiểm tra số dư phép rồi mới ghi ở lệnh riêng thì hai đơn gửi
    // cùng lúc đều thấy "còn 1 ngày phép" và cùng được duyệt — nhân viên nghỉ 2
    // ngày trong khi chỉ còn 1. Loại lỗi này chỉ xuất hiện khi có tải thật.
    return this.requests.create(ctx, dto);
  }

  @Get('admin/requests/approval-preview')
  @Roles(SystemRole.MANAGER, SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
  @DepartmentScoped()
  @ApiOperation({
    summary: 'Xem trước luồng duyệt trước khi tạo đơn hộ (FR-WEB-REQ-09)',
    description:
      'Trả về đúng những bước duyệt sẽ được sinh ra cho đơn này, kèm người duyệt hệ thống tự suy và danh sách ứng viên thay thế cho từng bước. Luồng duyệt phụ thuộc ĐỘ DÀI đơn (nghỉ 1 ngày chỉ cần trưởng phòng, nghỉ 3 ngày trở lên mới thêm bước HR), nên phải hỏi lại mỗi khi đổi loại đơn hoặc khoảng ngày.',
  })
  @ApiErrors('EMP_NOT_FOUND', 'AUTH_FORBIDDEN', 'REQ_TYPE_NOT_FOUND')
  approvalPreview(
    @CurrentTenant() ctx: TenantContext,
    @Query() query: ApprovalPreviewQueryDto,
  ) {
    return this.requests.previewApprovalFlow(ctx, query, resolveDepartmentScope(ctx));
  }

  @Post('admin/requests')
  @Roles(SystemRole.MANAGER, SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN)
  @DepartmentScoped()
  @ApiOperation({
    summary: 'Tạo đơn THAY MẶT nhân viên (FR-WEB-REQ-09)',
    description:
      'Dành cho nhân viên nộp đơn giấy, nghỉ ốm đột xuất hoặc chưa cài ứng dụng. Đơn vào trạng thái CHỜ DUYỆT và đi qua đúng luồng duyệt của loại đơn — người tạo hộ không tự duyệt thay được. Bắt buộc `onBehalfReason` và ghi audit `REQUEST_CREATE_ON_BEHALF`. MANAGER chỉ tạo được cho nhân viên thuộc phòng ban mình quản lý.',
  })
  @ApiErrors(
    'EMP_NOT_FOUND',
    'AUTH_FORBIDDEN',
    'REQ_TYPE_NOT_FOUND',
    'REQ_INSUFFICIENT_LEAVE',
    'REQ_OVERLAP',
    'REQ_ATTACHMENT_REQUIRED',
    'REQ_PERIOD_LOCKED',
  )
  createOnBehalf(@CurrentTenant() ctx: TenantContext, @Body() dto: CreateRequestOnBehalfDto) {
    return this.requests.createOnBehalf(ctx, dto, resolveDepartmentScope(ctx));
  }

  @Get('requests/:id')
  @ApiOperation({ summary: 'Chi tiết đơn + lịch sử duyệt (FR-WEB-REQ-06)' })
  @ApiErrors('REQ_NOT_FOUND')
  detail(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.requests.getDetail(ctx.companyId, id);
  }

  @Patch('requests/:id')
  @ApiOperation({ summary: 'Sửa đơn nháp' })
  @ApiErrors('REQ_NOT_FOUND', 'REQ_INVALID_STATUS', 'AUTH_FORBIDDEN')
  update(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpdateRequestDto,
  ) {
    return this.requests.update(ctx, id, dto);
  }

  @Post('requests/:id/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Gửi đơn nháp đi duyệt' })
  @ApiErrors('REQ_NOT_FOUND', 'REQ_INVALID_STATUS', 'REQ_ATTACHMENT_REQUIRED', 'REQ_OVERLAP')
  submit(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.requests.submit(ctx, id);
  }

  @Post('requests/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Huỷ đơn',
    description:
      'Đơn đã duyệt chỉ huỷ được nếu chính sách cho phép VÀ chưa tới ngày áp dụng (FR-APP-REQ-06). Huỷ đơn đã duyệt sẽ kích hoạt tính lại công.',
  })
  @ApiErrors('REQ_NOT_FOUND', 'REQ_INVALID_STATUS')
  cancel(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: CancelRequestDto,
  ) {
    return this.requests.cancel(ctx, id, dto.reason);
  }

  @Post('requests/:id/attachments')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ATTACHMENT_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload minh chứng',
    description: 'BR-REQ-06: jpg/png/pdf, ≤ 10MB mỗi file, ≤ 5 file mỗi đơn (cấu hình được).',
  })
  @ApiErrors('REQ_NOT_FOUND', 'REQ_ATTACHMENT_INVALID')
  addAttachment(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new AppException('REQ_ATTACHMENT_INVALID', { reason: 'Thiếu file.' });
    }
    return this.requests.addAttachment(ctx, id, file);
  }

  // ---------------------------------------------------------------------------
  // Duyệt
  // ---------------------------------------------------------------------------

  @Post('requests/:id/approve')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'REQUEST_APPROVE', targetType: 'LEAVE_REQUEST' })
  @ApiOperation({
    summary: 'Duyệt đơn',
    description:
      'BR-APV-01: chỉ chuyển ĐÃ DUYỆT khi tất cả cấp bắt buộc đã duyệt. BR-APV-06: tự kích hoạt tính lại công, kể cả đơn duyệt ngược về quá khứ (BR-REQ-03).',
  })
  @ApiErrors(
    'REQ_NOT_FOUND',
    'REQ_ALREADY_DECIDED',
    'REQ_CANNOT_APPROVE_OWN',
    'REQ_NOT_YOUR_TURN',
    'REQ_PERIOD_LOCKED',
  )
  approve(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: ApproveRequestDto,
  ) {
    return this.requests.approve(ctx, id, dto);
  }

  @Post('requests/:id/reject')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'REQUEST_REJECT', targetType: 'LEAVE_REQUEST' })
  @ApiOperation({
    summary: 'Từ chối đơn (bắt buộc lý do)',
    description: 'BR-APV-02: một cấp từ chối là đơn chuyển TỪ CHỐI ngay, các cấp sau không xử lý.',
  })
  @ApiErrors('REQ_NOT_FOUND', 'REQ_ALREADY_DECIDED', 'REQ_REJECT_REASON_REQUIRED', 'REQ_NOT_YOUR_TURN')
  reject(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: RejectRequestDto,
  ) {
    return this.requests.reject(ctx, id, dto.reason);
  }

  @Post('requests/bulk-approve')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'REQUEST_BULK_APPROVE', targetType: 'LEAVE_REQUEST' })
  @ApiOperation({
    summary: 'Duyệt hàng loạt',
    description:
      'BR-APV-05: vẫn kiểm tra ràng buộc từng đơn. Đơn không hợp lệ bị bỏ qua kèm lý do riêng, KHÔNG fail cả lô.',
  })
  bulkApprove(@CurrentTenant() ctx: TenantContext, @Body() dto: BulkApproveDto) {
    return this.requests.bulkApprove(ctx, dto);
  }
}
