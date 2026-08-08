import { ipInAnyCidr, ipInCidr, isPrivateIp, isValidCidr, normalizeIp } from './ip.util';

/**
 * AF-02b — chỉ chấm công được từ mạng văn phòng.
 *
 * Sai ở đây có hai hướng, cả hai đều tệ:
 *   - Chặt quá → toàn bộ nhân viên không chấm công được.
 *   - Lỏng quá → chốt mất tác dụng mà không ai biết.
 */
describe('normalizeIp', () => {
  it('quy IPv4 ánh xạ trong IPv6 về lại IPv4', () => {
    // Node trả dạng này cho kết nối IPv4 trên socket dual-stack. Không quy đổi
    // thì dải 203.0.113.0/24 không khớp và TOÀN BỘ nhân viên bị chặn — mà nhìn
    // log thì hai địa chỉ "trông giống nhau".
    expect(normalizeIp('::ffff:203.0.113.5')).toBe('203.0.113.5');
    expect(normalizeIp('::FFFF:203.0.113.5')).toBe('203.0.113.5');
  });

  it('bỏ cổng khỏi địa chỉ IPv4', () => {
    expect(normalizeIp('203.0.113.5:54321')).toBe('203.0.113.5');
  });

  it('bỏ ngoặc vuông và cổng khỏi địa chỉ IPv6', () => {
    expect(normalizeIp('[2001:db8::1]:8080')).toBe('2001:db8::1');
  });

  it('cắt khoảng trắng và đưa về chữ thường', () => {
    expect(normalizeIp('  2001:DB8::1  ')).toBe('2001:db8::1');
  });

  it.each([null, undefined, ''])('%s → chuỗi rỗng', (input) => {
    expect(normalizeIp(input)).toBe('');
  });
});

describe('ipInCidr — IPv4', () => {
  it('địa chỉ trong dải thì khớp', () => {
    expect(ipInCidr('203.0.113.5', '203.0.113.0/24')).toBe(true);
    expect(ipInCidr('203.0.113.255', '203.0.113.0/24')).toBe(true);
    expect(ipInCidr('203.0.113.0', '203.0.113.0/24')).toBe(true);
  });

  it('địa chỉ ngoài dải thì không khớp', () => {
    expect(ipInCidr('203.0.114.1', '203.0.113.0/24')).toBe(false);
    expect(ipInCidr('203.0.112.255', '203.0.113.0/24')).toBe(false);
  });

  it('/32 chỉ khớp đúng một địa chỉ', () => {
    expect(ipInCidr('203.0.113.5', '203.0.113.5/32')).toBe(true);
    expect(ipInCidr('203.0.113.6', '203.0.113.5/32')).toBe(false);
  });

  it('không có tiền tố = một địa chỉ đơn lẻ', () => {
    // HR gõ "203.0.113.5" thay vì "203.0.113.5/32" là chuyện thường.
    expect(ipInCidr('203.0.113.5', '203.0.113.5')).toBe(true);
    expect(ipInCidr('203.0.113.6', '203.0.113.5')).toBe(false);
  });

  it('/0 khớp mọi địa chỉ IPv4', () => {
    // Khai /0 làm dải văn phòng nghĩa là tắt chốt. Hàm vẫn phải tính đúng để
    // tầng cấu hình còn cảnh báo được.
    expect(ipInCidr('8.8.8.8', '0.0.0.0/0')).toBe(true);
  });

  it('tiền tố lẻ vẫn tính đúng bit', () => {
    // /28 = 16 địa chỉ: .16 tới .31
    expect(ipInCidr('203.0.113.16', '203.0.113.16/28')).toBe(true);
    expect(ipInCidr('203.0.113.31', '203.0.113.16/28')).toBe(true);
    expect(ipInCidr('203.0.113.32', '203.0.113.16/28')).toBe(false);
    expect(ipInCidr('203.0.113.15', '203.0.113.16/28')).toBe(false);
  });

  it('dải khai không đúng biên mạng vẫn hoạt động', () => {
    // HR gõ "203.0.113.5/24" thay vì "203.0.113.0/24" — che mặt nạ rồi mới so.
    expect(ipInCidr('203.0.113.99', '203.0.113.5/24')).toBe(true);
  });

  it('khớp qua dạng IPv4 ánh xạ trong IPv6', () => {
    expect(ipInCidr('::ffff:203.0.113.5', '203.0.113.0/24')).toBe(true);
  });
});

describe('ipInCidr — IPv6', () => {
  it('địa chỉ trong dải thì khớp', () => {
    expect(ipInCidr('2001:db8::1', '2001:db8::/32')).toBe(true);
    expect(ipInCidr('2001:db8:ffff::1', '2001:db8::/32')).toBe(true);
  });

  it('địa chỉ ngoài dải thì không khớp', () => {
    expect(ipInCidr('2001:db9::1', '2001:db8::/32')).toBe(false);
  });

  it('xử lý đúng dạng rút gọn ::', () => {
    expect(ipInCidr('::1', '::1/128')).toBe(true);
    expect(ipInCidr('2001:db8:0:0:0:0:0:1', '2001:db8::1/128')).toBe(true);
  });

  it('không so IPv4 với dải IPv6 và ngược lại', () => {
    // Cố quy đổi giữa hai họ địa chỉ có thể cho một địa chỉ ngoài văn phòng
    // lọt vào dải hợp lệ. Thà trả false.
    expect(ipInCidr('203.0.113.5', '::/0')).toBe(false);
    expect(ipInCidr('2001:db8::1', '0.0.0.0/0')).toBe(false);
  });
});

describe('ipInCidr — dữ liệu hỏng', () => {
  it.each([
    ['203.0.113.5', 'khong-phai-cidr', 'dải hỏng'],
    ['khong-phai-ip', '203.0.113.0/24', 'IP hỏng'],
    ['203.0.113.5', '203.0.113.0/33', 'tiền tố vượt 32'],
    ['203.0.113.5', '203.0.113.0/-1', 'tiền tố âm'],
    ['203.0.113.5', '203.0.113.0/abc', 'tiền tố không phải số'],
    ['203.0.113.256', '203.0.113.0/24', 'octet vượt 255'],
    ['203.0.113', '203.0.113.0/24', 'thiếu octet'],
    ['', '203.0.113.0/24', 'IP rỗng'],
    ['203.0.113.5', '', 'dải rỗng'],
  ])('%s vs %s (%s) → false', (ip, cidr) => {
    expect(ipInCidr(ip, cidr)).toBe(false);
  });

  it('từ chối octet viết kiểu bát phân', () => {
    // Một số bộ phân giải hiểu "010" là 8, số khác hiểu là 10. Nhập nhằng ở
    // danh sách cho phép là chỗ dễ sinh lỗ hổng.
    expect(ipInCidr('203.0.113.010', '203.0.113.8/32')).toBe(false);
    expect(isValidCidr('203.0.113.010/32')).toBe(false);
  });
});

describe('ipInAnyCidr', () => {
  const OFFICE = ['203.0.113.0/24', '198.51.100.7/32'];

  it('khớp dải bất kỳ trong danh sách', () => {
    expect(ipInAnyCidr('203.0.113.99', OFFICE)).toBe(true);
    expect(ipInAnyCidr('198.51.100.7', OFFICE)).toBe(true);
  });

  it('không khớp dải nào thì false', () => {
    expect(ipInAnyCidr('8.8.8.8', OFFICE)).toBe(false);
  });

  it('danh sách rỗng thì false — KHÔNG cho qua', () => {
    // Chưa cấu hình mà cho qua nghĩa là chốt âm thầm mất tác dụng.
    expect(ipInAnyCidr('203.0.113.5', [])).toBe(false);
  });

  it('bỏ qua mục hỏng nhưng vẫn xét mục hợp lệ', () => {
    expect(ipInAnyCidr('203.0.113.5', ['rac', null, '203.0.113.0/24'])).toBe(true);
  });
});

describe('isValidCidr', () => {
  it.each(['203.0.113.0/24', '203.0.113.5/32', '203.0.113.5', '2001:db8::/32', '::1/128'])(
    '%s hợp lệ',
    (cidr) => expect(isValidCidr(cidr)).toBe(true),
  );

  it.each(['', null, undefined, 'rac', '203.0.113.0/33', '999.0.0.1/24'])(
    '%s không hợp lệ',
    (cidr) => expect(isValidCidr(cidr)).toBe(false),
  );
});

describe('isPrivateIp', () => {
  it.each(['10.1.2.3', '172.16.0.1', '192.168.1.100', '127.0.0.1', '169.254.1.1', '::1'])(
    '%s là địa chỉ nội bộ',
    (ip) => expect(isPrivateIp(ip)).toBe(true),
  );

  it.each(['203.0.113.5', '8.8.8.8', '2001:db8::1'])('%s là địa chỉ công cộng', (ip) =>
    expect(isPrivateIp(ip)).toBe(false),
  );

  it('172.32.0.1 KHÔNG nội bộ — dải riêng chỉ tới 172.31', () => {
    // Ranh giới hay bị nhớ nhầm thành 172.16–172.32.
    expect(isPrivateIp('172.32.0.1')).toBe(false);
    expect(isPrivateIp('172.31.255.255')).toBe(true);
  });
});
