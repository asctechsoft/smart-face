import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { Audit, CurrentTenant, DepartmentScoped, Roles } from 'src/common/decorators';
import { ApiErrors } from 'src/common/decorators/api-standard-responses.decorator';
import { resolveDepartmentScope } from 'src/common/guards/scope.guard';
import type { TenantContext } from 'src/common/types/request-context';
import { AttendanceSheetService } from './attendance-sheet.service';
import {
  AttendanceSheetBoardQueryDto,
  AttendanceSheetMemberDto,
  AttendanceSheetQueryDto,
  CreateAttendanceSheetDto,
} from './dto/attendance-sheet.dto';

/**
 * Bảng chấm công — Web Quản lý (FR-WEB-ATT-08, FR-WEB-ATT-09).
 *
 * Cùng hình dạng với `admin/shift-schedules`, và cố ý như vậy: danh sách bảng
 * theo tháng + phòng ban là cửa vào, mở một bảng ra mới tới lưới người × ngày.
 *
 * `admin/attendance` (danh sách phẳng theo ngày, hiệu chỉnh, xuất Excel) vẫn giữ
 * nguyên — lưới này là cách ĐỌC dữ liệu đó, không thay thế đường ghi.
 */
@ApiTags('Web Quản lý · Bảng chấm công')
@ApiBearerAuth()
@Controller('admin/attendance-sheets')
export class AttendanceSheetController {
  constructor(private readonly sheets: AttendanceSheetService) {}

  @Get()
  @Roles(SystemRole.COMPANY_ADMIN, SystemRole.HR_PAYROLL, SystemRole.MANAGER)
  @DepartmentScoped()
  @ApiOperation({ summary: 'Danh sách bảng chấm công' })
  list(@CurrentTenant() ctx: TenantContext, @Query() query: AttendanceSheetQueryDto) {
    return this.sheets.list(ctx.companyId, query, resolveDepartmentScope(ctx));
  }

  @Get(':id')
  @Roles(SystemRole.COMPANY_ADMIN, SystemRole.HR_PAYROLL, SystemRole.MANAGER)
  @ApiOperation({ summary: 'Chi tiết một bảng chấm công' })
  @ApiErrors('ATT_SHEET_NOT_FOUND')
  get(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.sheets.get(ctx.companyId, id);
  }

  /**
   * Lưới người × ngày.
   *
   * Là route con của bảng chứ không phải endpoint riêng ở gốc: không có bảng thì
   * không có lưới — tập dòng do thành viên bảng quyết định, không do bộ lọc.
   */
  @Get(':id/board')
  @Roles(SystemRole.COMPANY_ADMIN, SystemRole.HR_PAYROLL, SystemRole.MANAGER)
  @DepartmentScoped()
  @ApiOperation({
    summary: 'Lưới chấm công người × ngày của một bảng',
    description:
      'Trả về cùng lúc thành viên, lịch ca đã xếp, công đã tính (AttendanceDaily) và đơn từ chạm vào kỳ. Phân trang theo NGƯỜI.',
  })
  @ApiErrors('ATT_SHEET_NOT_FOUND', 'ATT_SHEET_OUT_OF_PERIOD')
  board(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Query() query: AttendanceSheetBoardQueryDto,
  ) {
    return this.sheets.getBoard(ctx.companyId, id, query, resolveDepartmentScope(ctx));
  }

  @Post()
  @Roles(SystemRole.COMPANY_ADMIN, SystemRole.HR_PAYROLL, SystemRole.MANAGER)
  @DepartmentScoped()
  @Audit({ action: 'ATTENDANCE_SHEET_CREATE', targetType: 'ATTENDANCE_SHEET' })
  @ApiOperation({
    summary: 'Lập bảng chấm công',
    description:
      'Thành viên lấy từ bảng phân ca của cùng tháng và các phòng ban đã chọn; tháng chưa có bảng phân ca nào thì lấy toàn bộ CBNV đang làm việc của các phòng ban đó. Mỗi người mỗi tháng chỉ thuộc một bảng chấm công.',
  })
  @ApiErrors('ATT_SHEET_NO_MEMBERS', 'ATT_SHEET_EMPLOYEE_TAKEN')
  create(@CurrentTenant() ctx: TenantContext, @Body() dto: CreateAttendanceSheetDto) {
    return this.sheets.create(ctx.companyId, dto, ctx.userId, resolveDepartmentScope(ctx));
  }

  @Delete(':id')
  @Roles(SystemRole.COMPANY_ADMIN, SystemRole.HR_PAYROLL)
  @Audit({ action: 'ATTENDANCE_SHEET_DELETE', targetType: 'ATTENDANCE_SHEET' })
  @ApiOperation({
    summary: 'Xoá bảng chấm công',
    description:
      'Chỉ xoá khung rà soát. Công đã tính, bản ghi thô và đơn từ không bị đụng tới — lập lại bảng là thấy lại đúng số liệu.',
  })
  @ApiErrors('ATT_SHEET_NOT_FOUND')
  remove(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.sheets.remove(ctx.companyId, id);
  }

  @Post(':id/members')
  @Roles(SystemRole.COMPANY_ADMIN, SystemRole.HR_PAYROLL, SystemRole.MANAGER)
  @DepartmentScoped()
  @Audit({ action: 'ATTENDANCE_SHEET_MEMBER_ADD', targetType: 'ATTENDANCE_SHEET' })
  @ApiOperation({ summary: 'Thêm CBNV vào bảng chấm công' })
  @ApiErrors('ATT_SHEET_NOT_FOUND', 'ATT_SHEET_CLOSED', 'ATT_SHEET_EMPLOYEE_TAKEN')
  addMembers(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: AttendanceSheetMemberDto,
  ) {
    return this.sheets.addMembers(ctx.companyId, id, dto, resolveDepartmentScope(ctx));
  }

  /** `POST .../remove` chứ không `DELETE`: danh sách id đi trong body, mà nhiều proxy cắt body của DELETE. */
  @Post(':id/members/remove')
  @Roles(SystemRole.COMPANY_ADMIN, SystemRole.HR_PAYROLL, SystemRole.MANAGER)
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'ATTENDANCE_SHEET_MEMBER_REMOVE', targetType: 'ATTENDANCE_SHEET' })
  @ApiOperation({
    summary: 'Bỏ CBNV khỏi bảng chấm công',
    description: 'Chỉ bỏ khỏi phạm vi rà soát — công của họ vẫn còn nguyên trong hệ thống.',
  })
  @ApiErrors('ATT_SHEET_NOT_FOUND', 'ATT_SHEET_CLOSED')
  removeMembers(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: AttendanceSheetMemberDto,
  ) {
    return this.sheets.removeMembers(ctx.companyId, id, dto);
  }

  @Post(':id/recalculate')
  @Roles(SystemRole.COMPANY_ADMIN, SystemRole.HR_PAYROLL, SystemRole.MANAGER)
  @HttpCode(HttpStatus.ACCEPTED)
  @Audit({ action: 'ATTENDANCE_SHEET_RECALCULATE', targetType: 'ATTENDANCE_SHEET' })
  @ApiOperation({
    summary: 'Cập nhật bảng công — tính lại công của cả kỳ cho thành viên trong bảng',
    description:
      'Cần thiết vì AttendanceDaily là bảng ĐÃ TÍNH: đơn duyệt ngược, sửa cấu hình ca hay xếp lại phân ca đều KHÔNG tự kích hoạt tính lại. Job idempotent (NFR-REL-06). Trả `jobId`; hỏi tiến độ qua `GET /v1/jobs/:id`. Ngày thuộc kỳ lương đã chốt bị bỏ qua, không ghi đè (BR-07).',
  })
  @ApiErrors('ATT_SHEET_NOT_FOUND')
  recalculate(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.sheets.recalculate(ctx, id);
  }

  @Post(':id/close')
  @Roles(SystemRole.COMPANY_ADMIN, SystemRole.HR_PAYROLL)
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'ATTENDANCE_SHEET_CLOSE', targetType: 'ATTENDANCE_SHEET' })
  @ApiOperation({
    summary: 'Chốt bảng chấm công',
    description:
      'Khoá việc thêm/bớt thành viên. Số liệu công vẫn tính lại được cho tới khi kỳ lương chốt.',
  })
  @ApiErrors('ATT_SHEET_NOT_FOUND')
  close(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.sheets.close(ctx.companyId, id, ctx.userId);
  }

  @Post(':id/reopen')
  @Roles(SystemRole.COMPANY_ADMIN, SystemRole.HR_PAYROLL)
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'ATTENDANCE_SHEET_REOPEN', targetType: 'ATTENDANCE_SHEET' })
  @ApiOperation({
    summary: 'Mở lại bảng đã chốt',
    description: 'BR-07: từ chối nếu kỳ lương phủ lên tháng của bảng đã chốt.',
  })
  @ApiErrors('ATT_SHEET_NOT_FOUND', 'PAY_PERIOD_CLOSED')
  reopen(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.sheets.reopen(ctx.companyId, id);
  }
}
