import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from 'src/common/dto';

/**
 * Bộ lọc audit log.
 *
 * ⚠ Mọi field phải được khai báo + decorate ở đây. ValidationPipe chạy với
 * `whitelist: true` nên field không khai sẽ bị LOẠI BỎ khỏi query — bộ lọc sẽ
 * âm thầm không có tác dụng.
 */
export class AuditLogQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Chỉ Web Admin mới lọc xuyên tenant được' })
  @IsOptional()
  @IsString()
  companyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  actorUserId?: string;

  @ApiPropertyOptional({ example: 'PAYROLL_REOPEN' })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional({ example: 'EMPLOYEE' })
  @IsOptional()
  @IsString()
  targetType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  targetId?: string;

  @ApiPropertyOptional({ example: '2026-08-01' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-08-31' })
  @IsOptional()
  @IsString()
  to?: string;
}
