import { PaginatedResult, PaginationMetaDto } from '../dto/api-response.dto';

export function buildMeta(page: number, pageSize: number, total: number): PaginationMetaDto {
  return {
    page,
    pageSize,
    total,
    totalPages: pageSize > 0 ? Math.ceil(total / pageSize) : 0,
  };
}

export function paginate<T>(
  items: T[],
  page: number,
  pageSize: number,
  total: number,
): PaginatedResult<T> {
  return new PaginatedResult(items, buildMeta(page, pageSize, total));
}

/**
 * Chuyển tham số `sort` của API (docs/08 mục 1.5) thành orderBy của Prisma.
 * Chỉ chấp nhận field nằm trong `allowed` — tránh sắp xếp theo cột tuỳ ý.
 *
 * `-recordedAt,employeeId` → `[{ recordedAt: 'desc' }, { employeeId: 'asc' }]`
 */
export function parseSort<T extends string>(
  sort: string | undefined,
  allowed: readonly T[],
  fallback: Record<string, 'asc' | 'desc'>,
): Record<string, 'asc' | 'desc'>[] {
  if (!sort) return [fallback];

  const orderBy = sort
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      const direction: 'asc' | 'desc' = token.startsWith('-') ? 'desc' : 'asc';
      const field = token.replace(/^[-+]/, '');
      return allowed.includes(field as T) ? { [field]: direction } : null;
    })
    .filter((item): item is Record<string, 'asc' | 'desc'> => item !== null);

  return orderBy.length > 0 ? orderBy : [fallback];
}
