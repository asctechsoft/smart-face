import { ipInAnyCidr, isValidCidr } from 'src/common/utils';

/**
 * AF-02b — chỉ chấm công được từ dải IP mạng văn phòng.
 *
 * `evaluateIpRestriction` là private trong `AttendanceService` (12 phụ thuộc),
 * nên bộ test này khoá **đúng logic quyết định** bằng một bản sao thu gọn, cộng
 * với `ip.util.spec.ts` khoá phần đối chiếu CIDR.
 *
 * ⚠ Sửa `evaluateIpRestriction` thì phải sửa `decide()` ở đây cho khớp — hai
 * bên lệch nhau thì test vẫn xanh trong khi hệ thống đã hỏng.
 */
type Requirement = 'BLOCK' | 'FLAG' | 'OFF';

interface Geo {
  branch: { id: string; name: string; allowedIpCidrs: string[] } | null;
  exemptOnTrip: boolean;
}

function decide(
  requirement: Requirement,
  geo: Geo,
  ipAddress: string | undefined,
): { decision: 'ALLOW' | 'FLAG' | 'BLOCK'; errorCode?: string } {
  if (requirement === 'OFF') return { decision: 'ALLOW' };
  if (geo.exemptOnTrip) return { decision: 'ALLOW' };

  const notConfigured = () =>
    requirement === 'BLOCK'
      ? { decision: 'BLOCK' as const, errorCode: 'ATT_IP_NOT_CONFIGURED' }
      : { decision: 'FLAG' as const };

  if (!geo.branch) return notConfigured();

  const allowed = geo.branch.allowedIpCidrs.filter(isValidCidr);
  if (allowed.length === 0) return notConfigured();

  if (!ipAddress) {
    return requirement === 'BLOCK'
      ? { decision: 'BLOCK', errorCode: 'ATT_IP_NOT_ALLOWED' }
      : { decision: 'FLAG' };
  }

  if (ipInAnyCidr(ipAddress, allowed)) return { decision: 'ALLOW' };

  return requirement === 'BLOCK'
    ? { decision: 'BLOCK', errorCode: 'ATT_IP_NOT_ALLOWED' }
    : { decision: 'FLAG' };
}

const OFFICE_CIDR = '203.0.113.0/24';
const branchWith = (cidrs: string[]): Geo => ({
  branch: { id: 'brc_1', name: 'VP Hà Nội', allowedIpCidrs: cidrs },
  exemptOnTrip: false,
});

describe('AF-02b — bắt buộc gọi từ dải IP văn phòng', () => {
  describe('chính sách BLOCK (mặc định)', () => {
    it('CHO QUA khi request đến từ mạng văn phòng', () => {
      expect(decide('BLOCK', branchWith([OFFICE_CIDR]), '203.0.113.42').decision).toBe('ALLOW');
    });

    it('CHẶN khi dùng 4G', () => {
      const result = decide('BLOCK', branchWith([OFFICE_CIDR]), '113.161.40.7');
      expect(result).toEqual({ decision: 'BLOCK', errorCode: 'ATT_IP_NOT_ALLOWED' });
    });

    it('CHẶN khi dùng WiFi nhà', () => {
      expect(decide('BLOCK', branchWith([OFFICE_CIDR]), '14.161.20.9').decision).toBe('BLOCK');
    });

    it('CHẶN khi chi nhánh chưa khai dải IP — mã lỗi KHÁC', () => {
      const result = decide('BLOCK', branchWith([]), '203.0.113.42');
      expect(result).toEqual({ decision: 'BLOCK', errorCode: 'ATT_IP_NOT_CONFIGURED' });
    });

    it('CHẶN khi không đọc được địa chỉ nguồn', () => {
      // Cho qua ở đây nghĩa là chỉ cần làm request rơi vào trường hợp biên là
      // thoát chốt. Không đọc được thì không kết luận được là hợp lệ.
      const result = decide('BLOCK', branchWith([OFFICE_CIDR]), undefined);
      expect(result.decision).toBe('BLOCK');
    });

    it('dải khai sai định dạng bị loại — coi như chưa khai', () => {
      // HR gõ nhầm thì phải báo, KHÔNG được im lặng cho qua.
      const result = decide('BLOCK', branchWith(['192.168.1']), '203.0.113.42');
      expect(result.errorCode).toBe('ATT_IP_NOT_CONFIGURED');
    });

    it('khớp qua dạng IPv4 ánh xạ trong IPv6', () => {
      // Node trả dạng này cho kết nối IPv4 trên socket dual-stack. Không xử lý
      // thì TOÀN BỘ nhân viên bị chặn.
      expect(decide('BLOCK', branchWith([OFFICE_CIDR]), '::ffff:203.0.113.42').decision).toBe(
        'ALLOW',
      );
    });

    it('nhiều dải: khớp dải bất kỳ là qua', () => {
      const geo = branchWith([OFFICE_CIDR, '198.51.100.7/32']);
      expect(decide('BLOCK', geo, '198.51.100.7').decision).toBe('ALLOW');
    });

    it('địa chỉ đơn lẻ /32 chỉ khớp đúng nó', () => {
      const geo = branchWith(['198.51.100.7/32']);
      expect(decide('BLOCK', geo, '198.51.100.7').decision).toBe('ALLOW');
      expect(decide('BLOCK', geo, '198.51.100.8').decision).toBe('BLOCK');
    });
  });

  describe('miễn trừ đơn công tác (BR-ATT-06)', () => {
    it('CHO QUA dù đang ở mạng khác', () => {
      // Người ở nhà khách hàng không thể đi ra từ IP văn phòng.
      const geo: Geo = { ...branchWith([OFFICE_CIDR]), exemptOnTrip: true };
      expect(decide('BLOCK', geo, '113.161.40.7').decision).toBe('ALLOW');
    });
  });

  describe('chính sách FLAG', () => {
    it('KHÔNG chặn nhưng gắn cờ', () => {
      expect(decide('FLAG', branchWith([OFFICE_CIDR]), '113.161.40.7').decision).toBe('FLAG');
    });

    it('đúng mạng văn phòng thì không gắn cờ', () => {
      expect(decide('FLAG', branchWith([OFFICE_CIDR]), '203.0.113.42').decision).toBe('ALLOW');
    });
  });

  describe('chính sách OFF', () => {
    it('bỏ qua hoàn toàn', () => {
      expect(decide('OFF', branchWith([]), undefined).decision).toBe('ALLOW');
    });
  });

  // ===========================================================================
  //  Quan hệ với chốt WiFi
  // ===========================================================================

  describe('hai chốt bổ trợ nhau, không thay thế nhau', () => {
    it('VPN về văn phòng qua được chốt IP', () => {
      // Đây là điểm yếu đã biết của chốt IP: người cắm VPN về văn phòng có IP
      // nguồn hợp lệ dù đang ngồi ở nhà. Chốt BSSID mới bắt được trường hợp
      // này — thiết bị phải thật sự trong tầm sóng văn phòng.
      expect(decide('BLOCK', branchWith([OFFICE_CIDR]), '203.0.113.42').decision).toBe('ALLOW');
    });

    it('app bị sửa qua được chốt BSSID nhưng KHÔNG qua được chốt IP', () => {
      // Ngược lại: BSSID do App khai nên sửa được, còn IP nguồn thì server tự
      // quan sát từ kết nối TCP — client không có cách nào tự đặt.
      expect(decide('BLOCK', branchWith([OFFICE_CIDR]), '113.161.40.7').decision).toBe('BLOCK');
    });
  });
});
