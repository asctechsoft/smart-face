import { normalizeBssid } from 'src/common/utils';

/**
 * AF-02 — bắt buộc kết nối WiFi công ty mới chấm công được.
 *
 * `evaluateWifiRequirement` là private trong `AttendanceService`, và service đó
 * có 12 phụ thuộc. Dựng cả nó lên chỉ để kiểm một nhánh quyết định là đắt và
 * giòn. Thay vào đó bộ test này khoá **đúng logic quyết định** bằng một bản sao
 * thu gọn, cộng với `network.util.spec.ts` khoá phần chuẩn hoá BSSID.
 *
 * ⚠ Sửa `evaluateWifiRequirement` thì phải sửa `decide()` ở đây cho khớp. Hai
 * bên lệch nhau thì test vẫn xanh trong khi hệ thống đã hỏng — đây là điểm yếu
 * đã biết của cách kiểm này, ghi ra để người sau không hiểu nhầm là nó đủ.
 */
type Requirement = 'BLOCK' | 'FLAG' | 'OFF';

interface Geo {
  branch: { id: string; name: string; wifiBssids: string[] } | null;
  exemptOnTrip: boolean;
}

function decide(
  requirement: Requirement,
  geo: Geo,
  reportedBssid: string | undefined,
): { decision: 'ALLOW' | 'FLAG' | 'BLOCK'; errorCode?: string } {
  if (requirement === 'OFF') return { decision: 'ALLOW' };
  if (geo.exemptOnTrip) return { decision: 'ALLOW' };

  if (!geo.branch) {
    return requirement === 'BLOCK'
      ? { decision: 'BLOCK', errorCode: 'ATT_WIFI_NOT_CONFIGURED' }
      : { decision: 'FLAG' };
  }

  const allowed = geo.branch.wifiBssids.map(normalizeBssid).filter(Boolean);
  if (allowed.length === 0) {
    return requirement === 'BLOCK'
      ? { decision: 'BLOCK', errorCode: 'ATT_WIFI_NOT_CONFIGURED' }
      : { decision: 'FLAG' };
  }

  const reported = normalizeBssid(reportedBssid ?? '');
  if (reported.length > 0 && allowed.includes(reported)) return { decision: 'ALLOW' };

  return requirement === 'BLOCK'
    ? { decision: 'BLOCK', errorCode: 'ATT_WIFI_REQUIRED' }
    : { decision: 'FLAG' };
}

const OFFICE = 'a4:2b:8c:11:9d:0e';
const branchWith = (bssids: string[]): Geo => ({
  branch: { id: 'brc_1', name: 'VP Hà Nội', wifiBssids: bssids },
  exemptOnTrip: false,
});

describe('AF-02 — bắt buộc WiFi công ty', () => {
  describe('chính sách BLOCK (mặc định)', () => {
    it('CHO QUA khi bắt đúng WiFi văn phòng', () => {
      expect(decide('BLOCK', branchWith([OFFICE]), OFFICE).decision).toBe('ALLOW');
    });

    it('CHẶN khi dùng 4G — không có BSSID nào', () => {
      const result = decide('BLOCK', branchWith([OFFICE]), undefined);
      expect(result).toEqual({ decision: 'BLOCK', errorCode: 'ATT_WIFI_REQUIRED' });
    });

    it('CHẶN khi bắt WiFi hàng xóm', () => {
      const result = decide('BLOCK', branchWith([OFFICE]), 'ff:ee:dd:cc:bb:aa');
      expect(result).toEqual({ decision: 'BLOCK', errorCode: 'ATT_WIFI_REQUIRED' });
    });

    it('CHẶN khi chi nhánh chưa khai BSSID — lỗi cấu hình, mã lỗi KHÁC', () => {
      // Tách mã lỗi để App hiển thị đúng hướng dẫn: bảo nhân viên "liên hệ HR"
      // khi thật ra chỉ cần bật WiFi là gây phiền vô ích, và ngược lại.
      const result = decide('BLOCK', branchWith([]), OFFICE);
      expect(result).toEqual({ decision: 'BLOCK', errorCode: 'ATT_WIFI_NOT_CONFIGURED' });
    });

    it('CHẶN khi công ty chưa cấu hình chi nhánh nào', () => {
      const result = decide('BLOCK', { branch: null, exemptOnTrip: false }, OFFICE);
      expect(result.errorCode).toBe('ATT_WIFI_NOT_CONFIGURED');
    });

    it('thiếu cấu hình thì CHẶN chứ không cho qua', () => {
      // Cho qua nghĩa là một chi nhánh bị quên cấu hình sẽ âm thầm mất lớp
      // phòng thủ này, và không ai biết cho tới khi có sự cố.
      expect(decide('BLOCK', branchWith([]), OFFICE).decision).toBe('BLOCK');
    });
  });

  describe('chuẩn hoá cách viết BSSID', () => {
    it.each([
      ['A4:2B:8C:11:9D:0E', 'chữ hoa'],
      ['A4-2B-8C-11-9D-0E', 'dấu gạch kiểu Windows'],
      ['a42b8c119d0e', 'HR chép tay không dấu phân tách'],
    ])('%s (%s) vẫn khớp', (reported) => {
      // Không chuẩn hoá thì nhân viên bị từ chối chỉ vì HR gõ chữ hoa — nhìn
      // bằng mắt hai chuỗi giống hệt nhau nên cực khó lần ra.
      expect(decide('BLOCK', branchWith([OFFICE]), reported).decision).toBe('ALLOW');
    });

    it('khớp với BSSID thứ hai khi văn phòng có nhiều bộ phát', () => {
      const second = 'a4:2b:8c:11:9d:0f';
      expect(decide('BLOCK', branchWith([OFFICE, second]), second).decision).toBe('ALLOW');
    });

    it('BSSID khai sai định dạng bị loại khỏi danh sách hợp lệ', () => {
      // HR gõ nhầm thì coi như chưa khai, KHÔNG được im lặng cho qua.
      const result = decide('BLOCK', branchWith(['khong-phai-mac']), OFFICE);
      expect(result.errorCode).toBe('ATT_WIFI_NOT_CONFIGURED');
    });

    it('02:00:00:00:00:00 KHÔNG được coi là bắt được WiFi', () => {
      // Android trả giá trị này khi app thiếu quyền vị trí. Chấp nhận nó nghĩa
      // là chỉ cần từ chối cấp quyền vị trí là qua được chốt.
      const result = decide('BLOCK', branchWith([OFFICE]), '02:00:00:00:00:00');
      expect(result.decision).toBe('BLOCK');
    });
  });

  describe('miễn trừ đơn công tác (BR-ATT-06)', () => {
    it('CHO QUA dù không bắt được WiFi nào', () => {
      // Người đang ở nhà khách hàng không thể bắt WiFi văn phòng. Miễn geofence
      // mà không miễn WiFi thì đơn công tác vẫn vô dụng.
      const geo: Geo = { ...branchWith([OFFICE]), exemptOnTrip: true };
      expect(decide('BLOCK', geo, undefined).decision).toBe('ALLOW');
    });
  });

  describe('chính sách FLAG', () => {
    it('KHÔNG chặn nhưng gắn cờ', () => {
      expect(decide('FLAG', branchWith([OFFICE]), undefined).decision).toBe('FLAG');
    });

    it('thiếu cấu hình cũng chỉ gắn cờ', () => {
      expect(decide('FLAG', branchWith([]), OFFICE).decision).toBe('FLAG');
    });

    it('bắt đúng WiFi thì không gắn cờ', () => {
      expect(decide('FLAG', branchWith([OFFICE]), OFFICE).decision).toBe('ALLOW');
    });
  });

  describe('chính sách OFF', () => {
    it('bỏ qua hoàn toàn, kể cả khi chưa cấu hình gì', () => {
      expect(decide('OFF', branchWith([]), undefined).decision).toBe('ALLOW');
      expect(decide('OFF', { branch: null, exemptOnTrip: false }, undefined).decision).toBe(
        'ALLOW',
      );
    });
  });
});
