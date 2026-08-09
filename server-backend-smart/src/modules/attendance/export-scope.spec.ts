import { SystemRole } from '@prisma/client';
import { resolveDepartmentScope } from 'src/common/guards/scope.guard';
import { resolveExportDepartmentFilter } from './attendance-admin.service';

/**
 * `BR-09` — phạm vi phòng ban của job xuất bảng công.
 *
 * Vì sao có riêng bộ test này: xuất Excel là đường rò rỉ dữ liệu êm nhất hệ
 * thống. Không có màn hình nào hiển thị sai để ai đó nhận ra — người dùng chỉ
 * nhận một file, mở ra, và không có cách nào biết trong đó lẽ ra không được có
 * phòng ban nào khác.
 *
 * Điểm mấu chốt: worker chạy ở pod riêng, sau khi request đã kết thúc, nên
 * phạm vi PHẢI được chốt lúc nhận yêu cầu rồi ghi vào params của job. Hàm dưới
 * đây là chỗ duy nhất quyết định điều đó.
 */
describe('resolveExportDepartmentFilter (BR-09)', () => {
  const KY_THUAT = 'dept_ky_thuat';
  const KE_TOAN = 'dept_ke_toan';
  const NHAN_SU = 'dept_nhan_su';

  describe('HR / Admin — không giới hạn (scope = null)', () => {
    it('không gửi bộ lọc → null, nghĩa là toàn công ty', () => {
      expect(resolveExportDepartmentFilter(undefined, null)).toBeNull();
    });

    it('mảng rỗng cũng là "không lọc", không phải "không phòng ban nào"', () => {
      // Ant Design gửi `departmentIds: []` khi người dùng xoá hết lựa chọn.
      // Hiểu nhầm thành fail-closed sẽ trả file trắng cho HR mà không báo lỗi.
      expect(resolveExportDepartmentFilter([], null)).toBeNull();
    });

    it('gửi bộ lọc → dùng nguyên', () => {
      expect(resolveExportDepartmentFilter([KY_THUAT, KE_TOAN], null)).toEqual([
        KY_THUAT,
        KE_TOAN,
      ]);
    });
  });

  describe('MANAGER — luôn bị giao với phạm vi được phân công', () => {
    const scope = [KY_THUAT, KE_TOAN];

    it('không gửi bộ lọc → đúng bằng phạm vi, KHÔNG phải toàn công ty', () => {
      expect(resolveExportDepartmentFilter(undefined, scope)).toEqual(scope);
    });

    it('lọc trong phạm vi → giữ nguyên', () => {
      expect(resolveExportDepartmentFilter([KY_THUAT], scope)).toEqual([KY_THUAT]);
    });

    it('lén thêm phòng ban ngoài phạm vi → bị loại khỏi kết quả', () => {
      // ScopeGuard đã ném AUTH_FORBIDDEN cho trường hợp này ở tầng trên. Đây là
      // lớp thứ hai: nếu ai đó bỏ @DepartmentScoped() khỏi endpoint, phép giao
      // vẫn giữ dữ liệu lại.
      expect(resolveExportDepartmentFilter([KY_THUAT, NHAN_SU], scope)).toEqual([KY_THUAT]);
    });

    it('chỉ gửi phòng ban ngoài phạm vi → mảng rỗng, không rơi về toàn công ty', () => {
      // Đây là dòng quan trọng nhất của tệp này. Trả `null` ở đây là mở cửa
      // toàn bộ công ty cho đúng người vừa cố vượt rào.
      expect(resolveExportDepartmentFilter([NHAN_SU], scope)).toEqual([]);
    });

    it('không sửa vào mảng scope gốc', () => {
      const original = [...scope];
      const result = resolveExportDepartmentFilter(undefined, scope);
      result?.push('dept_them_vao');
      expect(scope).toEqual(original);
    });
  });

  describe('vai trò không có quyền xem người khác → scope rỗng', () => {
    it('mảng rỗng giữ nguyên là rỗng, không thành null', () => {
      // `resolveDepartmentScope` trả [] cho vai trò như EMPLOYEE. Prisma dịch
      // `in: []` thành 0 dòng — đúng ý đồ fail-closed.
      expect(resolveExportDepartmentFilter(undefined, [])).toEqual([]);
      expect(resolveExportDepartmentFilter([KY_THUAT], [])).toEqual([]);
    });
  });

  describe('nối với resolveDepartmentScope — đúng thứ tự vai trò', () => {
    const buildCtx = (roles: SystemRole[], scopeDepartmentIds: string[] = []) => ({
      roles,
      isSystemAdmin: false,
      scopeDepartmentIds,
    });

    it('HR_PAYROLL xuất được toàn công ty', () => {
      const scope = resolveDepartmentScope(buildCtx([SystemRole.HR_PAYROLL]));
      expect(resolveExportDepartmentFilter(undefined, scope)).toBeNull();
    });

    it('MANAGER kiêm HR_PAYROLL được coi là HR — vai trò rộng hơn thắng', () => {
      const scope = resolveDepartmentScope(
        buildCtx([SystemRole.MANAGER, SystemRole.HR_PAYROLL], [KY_THUAT]),
      );
      expect(resolveExportDepartmentFilter(undefined, scope)).toBeNull();
    });

    it('MANAGER thuần tuý chỉ xuất được phòng ban mình quản lý', () => {
      const scope = resolveDepartmentScope(buildCtx([SystemRole.MANAGER], [KY_THUAT]));
      expect(resolveExportDepartmentFilter(undefined, scope)).toEqual([KY_THUAT]);
    });
  });
});
