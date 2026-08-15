import { ShiftType } from '@prisma/client';
import { AppException } from 'src/common/errors';
import { PolicyAdminService, computeShiftWorkMinutes } from './policy-admin.service';
import { PolicyService } from './policy.service';
import type { UpsertShiftDto } from './dto/policy.dto';

/**
 * Danh mục ca — FR-WEB-POL-04.
 *
 * Tập trung vào hai thứ dễ sai mà không ai nhìn thấy cho tới lúc chốt lương:
 * công thức giờ công (ca đêm, ca gãy, nghỉ giữa ca) và các luật chặn cấu hình
 * vô nghĩa.
 */
describe('Danh mục ca', () => {
  describe('computeShiftWorkMinutes', () => {
    const base = {
      type: ShiftType.FIXED,
      breakMinutes: 0,
      requiredMinutes: null,
      segments: [] as { startTime: string; endTime: string }[],
    };

    it('ca hành chính trừ giờ nghỉ trưa', () => {
      const minutes = computeShiftWorkMinutes({
        ...base,
        startTime: '08:00',
        endTime: '17:30',
        breakMinutes: 60,
      });
      expect(minutes).toBe(8 * 60 + 30);
    });

    /**
     * Đây là trường hợp mà một phép trừ thẳng cho ra SỐ ÂM: 06:00 − 22:00 = −960
     * phút. Không xử lý thì ca đêm hiện "0h" trên danh mục và mọi người tưởng
     * cấu hình hỏng.
     */
    it('ca đêm vắt qua nửa đêm ra số dương', () => {
      const minutes = computeShiftWorkMinutes({
        ...base,
        startTime: '22:00',
        endTime: '06:00',
        breakMinutes: 30,
      });
      expect(minutes).toBe(7 * 60 + 30);
    });

    it('ca 24 tiếng khi giờ vào trùng giờ ra', () => {
      const minutes = computeShiftWorkMinutes({ ...base, startTime: '08:00', endTime: '08:00' });
      expect(minutes).toBe(24 * 60);
    });

    /**
     * Các đoạn của ca gãy ĐÃ loại giờ nghỉ ra khỏi ca. Trừ `breakMinutes` lần
     * nữa là trừ hai lần cùng một khoảng — nhân viên mất một tiếng công mỗi ngày.
     */
    it('ca gãy cộng các đoạn và KHÔNG trừ giờ nghỉ thêm lần nữa', () => {
      const minutes = computeShiftWorkMinutes({
        ...base,
        startTime: '08:00',
        endTime: '17:30',
        breakMinutes: 60,
        segments: [
          { startTime: '08:00', endTime: '12:00' },
          { startTime: '13:30', endTime: '17:30' },
        ],
      });
      expect(minutes).toBe(8 * 60);
    });

    it('ca linh hoạt lấy thẳng số phút phải làm', () => {
      const minutes = computeShiftWorkMinutes({
        ...base,
        type: ShiftType.FLEXIBLE,
        startTime: null,
        endTime: null,
        requiredMinutes: 450,
      });
      expect(minutes).toBe(450);
    });

    it('giờ nghỉ dài hơn ca thì về 0 chứ không âm', () => {
      const minutes = computeShiftWorkMinutes({
        ...base,
        startTime: '08:00',
        endTime: '10:00',
        breakMinutes: 300,
      });
      expect(minutes).toBe(0);
    });
  });

  describe('luật cấu hình', () => {
    let service: PolicyAdminService;

    const dto = (patch: Partial<UpsertShiftDto> = {}): UpsertShiftDto =>
      ({
        name: 'Hành chính',
        code: 'HC',
        startTime: '08:00',
        endTime: '17:30',
        ...patch,
      }) as UpsertShiftDto;

    /** Chỉ cần `assertValidTime` thật — phần còn lại của service không tham gia. */
    const callValidate = (input: UpsertShiftDto) =>
      (service as unknown as { validateShiftCatalog: (d: UpsertShiftDto) => void })
        .validateShiftCatalog(input);

    beforeEach(() => {
      const policy = new PolicyService({} as never, {} as never, {} as never);
      service = new PolicyAdminService({} as never, {} as never, policy);
    });

    it('cấu hình hợp lệ thì không ném', () => {
      expect(() =>
        callValidate(
          dto({ checkInFrom: '06:00', checkInTo: '10:00', breakStart: '12:00', breakEnd: '13:00' }),
        ),
      ).not.toThrow();
    });

    // BR-ATT-02 — không có giờ vào thì ngày đó không có gì để tính.
    it('từ chối ca tắt chấm vào', () => {
      expect(() => callValidate(dto({ requireCheckIn: false }))).toThrow(AppException);
      try {
        callValidate(dto({ requireCheckIn: false }));
      } catch (error) {
        expect((error as AppException).code).toBe('POL_SHIFT_CHECKIN_REQUIRED');
      }
    });

    it('cho phép tắt chấm ra', () => {
      expect(() => callValidate(dto({ requireCheckOut: false }))).not.toThrow();
    });

    it('từ chối khung giờ rỗng', () => {
      expect(() => callValidate(dto({ checkInFrom: '08:00', checkInTo: '08:00' }))).toThrow(
        AppException,
      );
    });

    /**
     * Lỗi hay gặp nhất khi nhân bản ca: đổi giờ ca sang ca đêm nhưng để nguyên
     * khoảng nghỉ trưa của mẫu cũ. Không chặn thì ca đêm âm thầm bị trừ một
     * tiếng không có thật.
     */
    it('từ chối khoảng nghỉ nằm ngoài giờ ca', () => {
      expect(() =>
        callValidate(
          dto({ startTime: '22:00', endTime: '06:00', breakStart: '12:00', breakEnd: '13:00' }),
        ),
      ).toThrow(AppException);
    });

    it('chấp nhận khoảng nghỉ nằm trong ca đêm', () => {
      expect(() =>
        callValidate(
          dto({ startTime: '22:00', endTime: '06:00', breakStart: '00:30', breakEnd: '01:00' }),
        ),
      ).not.toThrow();
    });

    it('từ chối giờ sai định dạng', () => {
      expect(() => callValidate(dto({ checkInFrom: '25:00' }))).toThrow(AppException);
    });
  });
});
