import { Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import {
  CurrentTenant,
  CurrentUser,
  RequirePermission,
  Roles,
  SkipTenant,
} from 'src/common/decorators';
import type { RequestContext, TenantContext } from 'src/common/types/request-context';
import { AccessService } from './access.service';

/**
 * Quyền hiệu lực của người đang đăng nhập (`docs/08` §2).
 *
 * ## Vì sao tách khỏi `GET /auth/me`
 *
 * `/auth/me` cố ý KHÔNG chạm database — nó đọc thẳng từ JWT, và vì vậy dữ liệu
 * ở đó cũ tối đa bằng tuổi thọ access token (900 giây). Với `roles` thì chấp
 * nhận được; với danh sách quyền thì không: gỡ quyền của một người là thao tác
 * người ta làm khi đang có sự cố, và bắt họ chờ 15 phút để giao diện cập nhật
 * là hỏng đúng lúc cần nhất.
 *
 * Endpoint này đọc `RoleAssignment` thật (qua cache 60 giây của `AccessService`)
 * nên Web hỏi lại được bất cứ lúc nào mà không phải đăng nhập lại.
 *
 * ## Đây là TRẢI NGHIỆM, không phải bảo mật
 *
 * Danh sách trả về chỉ để Web khỏi vẽ những nút bấm vào sẽ nhận 403. Quyền thật
 * do `PermissionGuard` và `ScopeGuard` quyết định ở từng request. Sửa phản hồi
 * này trong trình duyệt chỉ làm hiện thêm nút, không mở thêm quyền nào.
 */
@ApiTags('Phân quyền')
@ApiBearerAuth()
@Controller('access')
export class AccessController {
  constructor(private readonly access: AccessService) {}

  @Get('me')
  // Tài khoản nền tảng chưa thuộc công ty nào vẫn phải gọi được — họ có quyền
  // của riêng tầng nền tảng.
  @SkipTenant()
  @ApiOperation({
    summary: 'Quyền và phạm vi dữ liệu hiệu lực của tôi',
    description:
      'Mỗi quyền kèm phạm vi rộng nhất mà người này có cho nó. `nextExpiryAt` là lượt gán sắp hết hạn gần nhất — Web dùng để cảnh báo trước khi quyền tự mất (FR-GDW-ROLE-03).',
  })
  async me(@CurrentUser() ctx: RequestContext) {
    const effective = await this.access.resolveEffectiveAccess(ctx);

    return {
      roles: effective.roleCodes,
      /** Vai trò cũ trong token — Web còn dùng trong giai đoạn chuyển đổi. */
      legacyRoles: ctx.roles,
      permissions: [...effective.permissions].sort().map((code) => {
        const grant = effective.scopeByPermission.get(code);
        return {
          code,
          scope: grant?.level ?? null,
          /** Id chi nhánh hoặc phòng ban, tuỳ `scope`. Rỗng khi phạm vi là toàn công ty. */
          scopeIds: grant?.scopeIds ?? [],
        };
      }),
      nextExpiryAt: effective.nextExpiryAt,
    };
  }

  @Get('catalog')
  @RequirePermission('role.assign')
  @ApiOperation({
    summary: 'Toàn bộ danh mục quyền của hệ thống',
    description: 'Dùng cho màn hình cấu hình vai trò — không phải quyền của người đang gọi.',
  })
  catalog() {
    return this.access.listCatalog();
  }

  @Get('roles')
  @RequirePermission('role.view')
  @ApiOperation({
    summary: 'Vai trò và quyền của từng vai trò',
    description:
      'Gồm vai trò hệ thống (dùng chung mọi tenant) và vai trò tuỳ biến của công ty. Web dựng bảng "vai trò nào làm được gì" từ đây thay vì chép tay — bảng chép tay lệch khỏi quyền thật ngay lần đầu ai đó sửa, và bảng sai còn tệ hơn không có bảng.',
  })
  async roles(@CurrentTenant() ctx: TenantContext) {
    const roles = await this.access.listRoles(ctx.companyId);
    return roles.map((role) => ({
      id: role.id,
      code: role.code,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      /** `null` = vai trò hệ thống dùng chung, khác vai trò riêng của công ty. */
      companyId: role.companyId,
      permissions: role.permissions.map((link) => link.permission.code).sort(),
    }));
  }

  @Post('catalog/sync')
  @Roles(SystemRole.SYSTEM_ADMIN)
  @SkipTenant()
  @RequirePermission('platform.config')
  @ApiOperation({
    summary: 'Đồng bộ danh mục quyền và vai trò hệ thống từ code xuống DB',
    description:
      'Idempotent. Chạy sau khi triển khai bản có thêm quyền mới, thay cho việc phải chạy lại toàn bộ seed.',
  })
  sync() {
    return this.access.syncCatalog();
  }
}
