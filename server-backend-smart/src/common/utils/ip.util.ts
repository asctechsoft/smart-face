/**
 * Đối chiếu địa chỉ IP với dải CIDR (AF-02b).
 *
 * Dùng cho chốt "chỉ chấm công được từ mạng văn phòng". Khác với BSSID — thứ do
 * App tự khai và sửa được — IP nguồn là thứ **server tự quan sát** từ kết nối
 * TCP. Client không tự khai được.
 *
 * ⚠ Với điều kiện `trust proxy` được cấu hình đúng. Xem `configuration.ts` và
 * `env.validation.ts`: sai chỗ đó thì hoặc mọi người đều bị chặn, hoặc ai cũng
 * qua được chỉ bằng một dòng header.
 *
 * Tự cài thay vì thêm thư viện: phép toán chỉ là so bit sau khi che mặt nạ, và
 * đây là đường xác thực nên càng ít phụ thuộc càng tốt.
 */

/**
 * Đưa địa chỉ về dạng chuẩn để so sánh.
 *
 * Node trả `::ffff:203.0.113.5` cho kết nối IPv4 trên socket dual-stack. Không
 * quy về IPv4 thì dải `203.0.113.0/24` sẽ không khớp và **toàn bộ nhân viên bị
 * chặn** — mà nhìn log thì hai địa chỉ "trông giống nhau".
 */
export function normalizeIp(raw: string | null | undefined): string {
  if (!raw) return '';

  let value = raw.trim().toLowerCase();

  // Bỏ cổng nếu có: "203.0.113.5:54321" hoặc "[::1]:8080"
  if (value.startsWith('[')) {
    const closing = value.indexOf(']');
    if (closing > 0) value = value.slice(1, closing);
  } else if (value.split(':').length === 2 && value.includes('.')) {
    value = value.split(':')[0];
  }

  // IPv4 ánh xạ trong IPv6 → về lại IPv4
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(value);
  if (mapped) return mapped[1];

  return value;
}

export function isIpv4(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const octet = Number(part);
    // Chặn "01" và "0x7f": Number() chấp nhận nhưng chúng là cách viết nhập
    // nhằng, và một số bộ phân giải hiểu "010" là hệ bát phân.
    if (part.length > 1 && part[0] === '0') return false;
    return octet >= 0 && octet <= 255;
  });
}

/** IPv4 → số nguyên 32 bit không dấu. */
function ipv4ToBigInt(value: string): bigint {
  return value
    .split('.')
    .reduce((accumulator, part) => (accumulator << 8n) | BigInt(Number(part)), 0n);
}

/** IPv6 → số nguyên 128 bit. Hỗ trợ rút gọn `::` và đuôi IPv4. */
function ipv6ToBigInt(value: string): bigint | null {
  let text = value;

  // Đuôi dạng IPv4: ::ffff:1.2.3.4 → đổi 4 octet thành 2 nhóm hex.
  const tail = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(text);
  if (tail) {
    if (!isIpv4(tail[1])) return null;
    const asNumber = ipv4ToBigInt(tail[1]);
    const high = (asNumber >> 16n).toString(16);
    const low = (asNumber & 0xffffn).toString(16);
    text = `${text.slice(0, tail.index)}${high}:${low}`;
  }

  const doubleColon = text.split('::');
  if (doubleColon.length > 2) return null;

  const toGroups = (part: string) => (part === '' ? [] : part.split(':'));
  const head = toGroups(doubleColon[0]);
  const rear = doubleColon.length === 2 ? toGroups(doubleColon[1]) : [];

  if (doubleColon.length === 1 && head.length !== 8) return null;
  if (head.length + rear.length > 8) return null;

  const groups = [
    ...head,
    ...Array<string>(8 - head.length - rear.length).fill('0'),
    ...rear,
  ];

  let result = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    result = (result << 16n) | BigInt(Number.parseInt(group, 16));
  }
  return result;
}

interface ParsedIp {
  value: bigint;
  bits: 32 | 128;
}

function parseIp(raw: string): ParsedIp | null {
  const normalized = normalizeIp(raw);
  if (!normalized) return null;

  if (isIpv4(normalized)) {
    return { value: ipv4ToBigInt(normalized), bits: 32 };
  }

  const asIpv6 = ipv6ToBigInt(normalized);
  return asIpv6 === null ? null : { value: asIpv6, bits: 128 };
}

/**
 * Kiểm tra một dải CIDR có hợp lệ không.
 *
 * Dùng lúc HR nhập cấu hình: dải gõ sai phải báo ngay, KHÔNG được im lặng bỏ
 * qua rồi để nhân viên phát hiện bằng cách không chấm công được.
 */
export function isValidCidr(raw: string | null | undefined): boolean {
  return parseCidr(raw) !== null;
}

interface ParsedCidr {
  network: bigint;
  mask: bigint;
  bits: 32 | 128;
}

function parseCidr(raw: string | null | undefined): ParsedCidr | null {
  if (!raw) return null;

  const [addressPart, prefixPart] = raw.trim().split('/');
  const address = parseIp(addressPart);
  if (!address) return null;

  // Không có `/` = một địa chỉ đơn lẻ, tương đương /32 hoặc /128.
  const prefix = prefixPart === undefined ? address.bits : Number(prefixPart);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > address.bits) return null;

  const hostBits = BigInt(address.bits - prefix);
  const mask = hostBits === 0n ? (1n << BigInt(address.bits)) - 1n : ~((1n << hostBits) - 1n);
  const full = (1n << BigInt(address.bits)) - 1n;

  return { network: address.value & mask & full, mask: mask & full, bits: address.bits };
}

/** Địa chỉ có nằm trong dải không. Sai định dạng ở bất kỳ phía nào → `false`. */
export function ipInCidr(ip: string | null | undefined, cidr: string | null | undefined): boolean {
  const address = parseIp(ip ?? '');
  const range = parseCidr(cidr);
  if (!address || !range) return false;

  // IPv4 và IPv6 không so với nhau được. Trả false thay vì cố quy đổi: quy đổi
  // nhầm sẽ cho một địa chỉ ngoài văn phòng lọt vào dải hợp lệ.
  if (address.bits !== range.bits) return false;

  return (address.value & range.mask) === range.network;
}

export function ipInAnyCidr(
  ip: string | null | undefined,
  cidrs: readonly (string | null | undefined)[],
): boolean {
  return cidrs.some((cidr) => ipInCidr(ip, cidr));
}

/**
 * IP thuộc dải riêng (RFC 1918, loopback, link-local).
 *
 * Dùng để cảnh báo lúc cấu hình: khai `192.168.1.0/24` làm dải văn phòng gần
 * như luôn là nhầm lẫn — đó là địa chỉ nội bộ sau NAT, còn thứ server nhìn thấy
 * là IP công cộng mà nhà mạng cấp cho văn phòng.
 *
 * Nhầm chỗ này thì cấu hình trông có vẻ đúng mà chặn sạch mọi người.
 */
export function isPrivateIp(raw: string | null | undefined): boolean {
  const normalized = normalizeIp(raw);
  if (!normalized) return false;

  return ipInAnyCidr(normalized, [
    '10.0.0.0/8',
    '172.16.0.0/12',
    '192.168.0.0/16',
    '127.0.0.0/8',
    '169.254.0.0/16',
    '::1/128',
    'fc00::/7',
    'fe80::/10',
  ]);
}
