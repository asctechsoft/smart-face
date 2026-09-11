import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppException } from '../errors';
import { REQUIRE_VERSION_KEY } from '../decorators/version.decorator';
import { assertNotVersionConflict, versionedWhere } from 'src/infra/prisma/optimistic-lock';
import { VersionGuard } from './version.guard';

const buildContext = (request: unknown): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  }) as unknown as ExecutionContext;

const reflectorWith = (value: unknown): Reflector =>
  ({
    getAllAndOverride: (key: string) => (key === REQUIRE_VERSION_KEY ? value : undefined),
  }) as unknown as Reflector;

describe('VersionGuard — bóc If-Match', () => {
  it('không khai @RequireVersion thì không đụng tới header', () => {
    const request = { headers: { 'if-match': '5' } } as Record<string, unknown>;
    expect(new VersionGuard(reflectorWith(undefined)).canActivate(buildContext(request))).toBe(
      true,
    );
    expect(request.expectedVersion).toBeUndefined();
  });

  it('bóc số nguyên ra request.expectedVersion', () => {
    const request: Record<string, unknown> = { headers: { 'if-match': '7' } };
    new VersionGuard(reflectorWith({})).canActivate(buildContext(request));
    expect(request.expectedVersion).toBe(7);
  });

  it('chấp nhận dạng ETag có ngoặc kép và W/ vì client HTTP hay tự thêm', () => {
    for (const [header, expected] of [
      ['"7"', 7],
      ['W/"12"', 12],
    ] as const) {
      const request: Record<string, unknown> = { headers: { 'if-match': header } };
      new VersionGuard(reflectorWith({})).canActivate(buildContext(request));
      expect(request.expectedVersion).toBe(expected);
    }
  });

  it('header rác bị từ chối chứ không âm thầm thành ghi mù', () => {
    const request = { headers: { 'if-match': 'abc' } };
    expect(() => new VersionGuard(reflectorWith({})).canActivate(buildContext(request))).toThrow(
      AppException,
    );
  });

  it('required=true thì thiếu header là từ chối', () => {
    const request = { headers: {} };
    expect(() =>
      new VersionGuard(reflectorWith({ required: true })).canActivate(buildContext(request)),
    ).toThrow(AppException);
  });

  it('required mặc định false — client cũ chưa gửi header vẫn chạy', () => {
    const request: Record<string, unknown> = { headers: {} };
    expect(new VersionGuard(reflectorWith({})).canActivate(buildContext(request))).toBe(true);
    expect(request.expectedVersion).toBeUndefined();
  });

  it('If-Match: * là ghi mù có chủ ý, không phải phiên bản 0', () => {
    const request: Record<string, unknown> = { headers: { 'if-match': '*' } };
    new VersionGuard(reflectorWith({})).canActivate(buildContext(request));
    expect(request.expectedVersion).toBeUndefined();
  });
});

describe('Khoá lạc quan ở tầng repository (BR-13 kiểm #5)', () => {
  it('điều kiện phiên bản đi vào WHERE, không kiểm ở tầng ứng dụng', () => {
    const where = { id: 'req_1', companyId: 'cmp_1' };
    expect(versionedWhere(where, 3)).toEqual({ id: 'req_1', companyId: 'cmp_1', rowVersion: 3 });
    // Không gửi If-Match thì WHERE giữ nguyên — không vô tình thành `rowVersion: undefined`,
    // thứ mà Prisma sẽ bỏ qua nhưng người đọc code lại tưởng là có kiểm.
    expect(versionedWhere(where, undefined)).toEqual(where);
  });

  it('bản ghi vẫn khớp điều kiện nghiệp vụ nhưng khác phiên bản → VERSION_CONFLICT', async () => {
    const delegate = { findFirst: jest.fn().mockResolvedValue({ rowVersion: 9 }) };

    await expect(
      assertNotVersionConflict(delegate, { id: 'req_1' }, 7, 'LEAVE_REQUEST'),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });

  it('bản ghi không còn khớp WHERE → trả về im lặng để chỗ gọi báo lỗi nghiệp vụ', async () => {
    // Phân biệt được hai chuyện là điểm chính: "đơn đã được gửi đi duyệt rồi"
    // và "có người vừa sửa trước bạn" cần hai thông báo khác nhau.
    const delegate = { findFirst: jest.fn().mockResolvedValue(null) };

    await expect(
      assertNotVersionConflict(delegate, { id: 'req_1' }, 7, 'LEAVE_REQUEST'),
    ).resolves.toBeUndefined();
  });

  it('không gửi If-Match thì không tốn thêm lượt đọc DB', async () => {
    const delegate = { findFirst: jest.fn() };

    await assertNotVersionConflict(delegate, { id: 'req_1' }, undefined, 'LEAVE_REQUEST');
    expect(delegate.findFirst).not.toHaveBeenCalled();
  });
});
