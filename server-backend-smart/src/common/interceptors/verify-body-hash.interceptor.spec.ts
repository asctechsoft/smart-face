import { CallHandler, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { of } from 'rxjs';
import { computeMultipartBodyHash } from '../utils/crypto.util';
import { VerifyBodyHashInterceptor } from './verify-body-hash.interceptor';

/**
 * AF-12 — ràng buộc nội dung của request multipart.
 *
 * Lỗ hổng được vá: trước đây `bodyHash` của mọi request multipart đều là
 * `sha256('')` — một hằng số. Chữ ký vẫn chặn được replay (nhờ nonce) nhưng
 * KHÔNG ràng buộc nội dung. Kẻ chặn được request đã ký giữa đường sửa được
 * request đang bay: tráo ảnh khuôn mặt sang người khác, hoặc đổi toạ độ GPS.
 *
 * Chuỗi tin cậy cần cả hai mắt xích:
 *   SignatureGuard  → client có deviceSecret và đã cam kết hash H
 *   Interceptor này → body thật đúng là băm ra H
 */
describe('VerifyBodyHashInterceptor (AF-12)', () => {
  const IMAGE = Buffer.from('anh-khuon-mat-goc');
  const FIELDS = {
    nonce: 'cm3x9k2-lz8f4a',
    clientTime: '2026-08-05T01:02:19.882Z',
    authMethod: 'FACE',
    location: '{"latitude":21.012345,"longitude":105.798765}',
  };

  async function buildInterceptor(enforced: boolean) {
    const moduleRef = await Test.createTestingModule({
      providers: [
        VerifyBodyHashInterceptor,
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(enforced) } },
      ],
    }).compile();
    return moduleRef.get(VerifyBodyHashInterceptor);
  }

  function contextWith(options: {
    declaredHash?: string;
    file?: Buffer;
    fields?: Record<string, unknown>;
  }): ExecutionContext {
    const request = {
      method: 'POST',
      originalUrl: '/v1/attendance/check-in',
      headers: options.declaredHash ? { 'x-body-sha256': options.declaredHash } : {},
      body: options.fields ?? FIELDS,
      file: options.file ? { buffer: options.file } : undefined,
    };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  const nextHandler: CallHandler = { handle: () => of('da-di-qua') };

  // ===========================================================================
  //  Đường hợp lệ
  // ===========================================================================

  it('CHO QUA khi hash khớp nội dung thật', async () => {
    const interceptor = await buildInterceptor(true);
    const correct = computeMultipartBodyHash(IMAGE, FIELDS);

    const result = interceptor.intercept(
      contextWith({ declaredHash: correct, file: IMAGE }),
      nextHandler,
    );

    await expect(result.toPromise()).resolves.toBe('da-di-qua');
  });

  // ===========================================================================
  //  Các cách giả mạo
  // ===========================================================================

  it('CHẶN khi ảnh bị tráo — kịch bản chấm hộ', async () => {
    const interceptor = await buildInterceptor(true);
    // Kẻ tấn công giữ nguyên chữ ký và hash đã khai, chỉ đổi ảnh.
    const signedHash = computeMultipartBodyHash(IMAGE, FIELDS);

    expect(() =>
      interceptor.intercept(
        contextWith({ declaredHash: signedHash, file: Buffer.from('anh-cua-nguoi-khac') }),
        nextHandler,
      ),
    ).toThrow(expect.objectContaining({ code: 'AUTH_SIGNATURE_INVALID' }));
  });

  it('CHẶN khi toạ độ GPS bị sửa', async () => {
    const interceptor = await buildInterceptor(true);
    const signedHash = computeMultipartBodyHash(IMAGE, FIELDS);

    expect(() =>
      interceptor.intercept(
        contextWith({
          declaredHash: signedHash,
          file: IMAGE,
          fields: { ...FIELDS, location: '{"latitude":10.0,"longitude":106.0}' },
        }),
        nextHandler,
      ),
    ).toThrow(expect.objectContaining({ code: 'AUTH_SIGNATURE_INVALID' }));
  });

  it('CHẶN khi có trường bị xoá bớt', async () => {
    const interceptor = await buildInterceptor(true);
    const signedHash = computeMultipartBodyHash(IMAGE, FIELDS);
    const { location: _removed, ...withoutLocation } = FIELDS;

    expect(() =>
      interceptor.intercept(
        contextWith({ declaredHash: signedHash, file: IMAGE, fields: withoutLocation }),
        nextHandler,
      ),
    ).toThrow(expect.objectContaining({ code: 'AUTH_SIGNATURE_INVALID' }));
  });

  it('CHẶN khi ảnh bị bỏ đi hoàn toàn', async () => {
    const interceptor = await buildInterceptor(true);
    const signedHash = computeMultipartBodyHash(IMAGE, FIELDS);

    expect(() =>
      interceptor.intercept(
        contextWith({ declaredHash: signedHash, file: undefined }),
        nextHandler,
      ),
    ).toThrow(expect.objectContaining({ code: 'AUTH_SIGNATURE_INVALID' }));
  });

  // ===========================================================================
  //  Thiếu header
  // ===========================================================================

  it('CHẶN khi thiếu X-Body-Sha256 lúc đã bật cưỡng chế', async () => {
    const interceptor = await buildInterceptor(true);

    expect(() =>
      interceptor.intercept(contextWith({ file: IMAGE }), nextHandler),
    ).toThrow(expect.objectContaining({ code: 'AUTH_SIGNATURE_INVALID' }));
  });

  it('CHO QUA khi thiếu header lúc chưa bật cưỡng chế — App cũ vẫn chạy được ở dev', async () => {
    const interceptor = await buildInterceptor(false);

    const result = interceptor.intercept(contextWith({ file: IMAGE }), nextHandler);
    await expect(result.toPromise()).resolves.toBe('da-di-qua');
  });

  it('VẪN kiểm khi client có gửi header dù chưa bật cưỡng chế', async () => {
    // Gửi header nghĩa là App đã hỗ trợ — không có lý do gì để bỏ qua.
    const interceptor = await buildInterceptor(false);

    expect(() =>
      interceptor.intercept(
        contextWith({ declaredHash: 'hash-bia-ra', file: IMAGE }),
        nextHandler,
      ),
    ).toThrow(expect.objectContaining({ code: 'AUTH_SIGNATURE_INVALID' }));
  });
});

/**
 * Công thức băm là HỢP ĐỒNG với App — hai bên lệch nhau thì mọi lượt chấm công
 * đều trả AUTH_SIGNATURE_INVALID. Các test dưới khoá từng tính chất lại.
 */
describe('computeMultipartBodyHash — hợp đồng với App', () => {
  const IMAGE = Buffer.from('anh');

  it('không phụ thuộc thứ tự trường', () => {
    // Thứ tự trường trong multipart do thư viện HTTP của từng nền tảng quyết
    // định, không ổn định giữa iOS và Android.
    const a = computeMultipartBodyHash(IMAGE, { b: '2', a: '1', c: '3' });
    const b = computeMultipartBodyHash(IMAGE, { c: '3', a: '1', b: '2' });

    expect(a).toBe(b);
  });

  it('đổi ảnh thì đổi hash', () => {
    expect(computeMultipartBodyHash(Buffer.from('x'), {})).not.toBe(
      computeMultipartBodyHash(Buffer.from('y'), {}),
    );
  });

  it('đổi giá trị một trường thì đổi hash', () => {
    expect(computeMultipartBodyHash(IMAGE, { a: '1' })).not.toBe(
      computeMultipartBodyHash(IMAGE, { a: '2' }),
    );
  });

  it('đổi TÊN trường thì đổi hash', () => {
    expect(computeMultipartBodyHash(IMAGE, { a: '1' })).not.toBe(
      computeMultipartBodyHash(IMAGE, { b: '1' }),
    );
  });

  it('không nhập nhằng giữa các cách tách trường', () => {
    // Bản đầu tiên nối thẳng `tên=giá_trị` rồi ghép bằng '\n' — hai trường hợp
    // dưới đây băm ra GIỐNG HỆT nhau. Kẻ tấn công ký một request có đúng một
    // trường chứa ký tự xuống dòng, rồi trình bày lại thành hai trường riêng:
    // hash vẫn khớp, chữ ký vẫn hợp lệ, dữ liệu server đọc được đã khác hẳn.
    expect(computeMultipartBodyHash(IMAGE, { a: '1', b: '2' })).not.toBe(
      computeMultipartBodyHash(IMAGE, { a: '1\nb=2' }),
    );
  });

  it('không nhập nhằng khi giá trị chứa dấu bằng', () => {
    expect(computeMultipartBodyHash(IMAGE, { a: 'x', b: 'y' })).not.toBe(
      computeMultipartBodyHash(IMAGE, { 'a=x\n1:b': 'y' }),
    );
  });

  it('đo độ dài bằng BYTE UTF-8, không phải số ký tự', () => {
    // "Đức" = 3 ký tự nhưng 5 byte UTF-8. App viết bằng Dart/Swift/Kotlin đều
    // đếm byte; đếm ký tự ở phía server sẽ lệch hợp đồng với mọi tên tiếng Việt.
    const withDiacritics = computeMultipartBodyHash(IMAGE, { ten: 'Đức' });
    const sameCharCount = computeMultipartBodyHash(IMAGE, { ten: 'Duc' });

    expect(withDiacritics).not.toBe(sameCharCount);
  });

  it('bỏ qua trường null/undefined thay vì băm chữ "null"', () => {
    expect(computeMultipartBodyHash(IMAGE, { a: '1', b: null })).toBe(
      computeMultipartBodyHash(IMAGE, { a: '1' }),
    );
  });

  it('không có ảnh vẫn tính được', () => {
    expect(computeMultipartBodyHash(undefined, { a: '1' })).toHaveLength(64);
  });

  it('ảnh rỗng và không có ảnh cho cùng kết quả', () => {
    expect(computeMultipartBodyHash(Buffer.alloc(0), { a: '1' })).toBe(
      computeMultipartBodyHash(undefined, { a: '1' }),
    );
  });
});
