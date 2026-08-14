import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Select, Spin } from 'antd';
import { Icon } from '@/components/Icon';
import { useCan } from '@/lib/rbac/Can';
import { useEmployeeList } from '@/features/employees/employees.api';

/**
 * Tìm nhanh nhân viên trên thanh trên cùng.
 *
 * Tra cứu một người là thao tác HR lặp lại nhiều nhất trong ngày — "chị Lan
 * phòng Kế toán hôm qua chấm công lúc mấy giờ", "anh Đức đã đăng ký khuôn mặt
 * chưa". Không có ô này thì mỗi lần đều phải: vào Nhân viên → gõ vào bộ lọc →
 * Enter → bấm vào tên. Bốn bước cho một câu hỏi.
 *
 * Ẩn với người không có `employee.view` thay vì để họ gõ rồi nhận danh sách rỗng.
 */
export function EmployeeQuickSearch() {
  const navigate = useNavigate();
  const canView = useCan('employee.view');

  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');

  /**
   * Hoãn 300ms trước khi gọi API.
   *
   * Gõ "Nguyễn" là 6 lần đổi state; không hoãn thì đó là 6 request mà 5 cái đầu
   * bị chính người dùng làm cho lỗi thời trước khi về tới nơi.
   */
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), 300);
    return () => clearTimeout(timer);
  }, [term]);

  // `enabled` gián tiếp qua độ dài: một ký tự khớp gần như mọi nhân viên, danh
  // sách trả về vô dụng mà vẫn tốn một truy vấn.
  const shouldSearch = debounced.length >= 2;
  const results = useEmployeeList(shouldSearch ? { q: debounced, pageSize: 8 } : { pageSize: 0 });

  if (!canView) return null;

  const options = shouldSearch
    ? (results.data?.items ?? []).map((employee) => ({
        value: employee.id,
        label: `${employee.fullName} · ${employee.employeeCode}`,
        department: employee.department?.name,
      }))
    : [];

  return (
    <Select
      showSearch
      value={null}
      // Ô này KHÔNG phải bộ lọc — chọn xong là điều hướng, không giữ giá trị.
      // Để `value={null}` nên sau khi nhảy trang ô tự trống, sẵn sàng cho lần sau.
      placeholder="Tìm nhân viên theo tên hoặc mã…"
      style={{ width: '100%', maxWidth: 360 }}
      suffixIcon={<Icon name="search" size={18} />}
      filterOption={false}
      searchValue={term}
      onSearch={setTerm}
      onChange={(employeeId: string) => {
        setTerm('');
        navigate(`/employees/${employeeId}`);
      }}
      notFoundContent={
        !shouldSearch ? (
          <span className="sf-body-sm sf-text-variant">Gõ tối thiểu 2 ký tự</span>
        ) : results.isFetching ? (
          <Spin size="small" />
        ) : (
          <span className="sf-body-sm sf-text-variant">Không tìm thấy nhân viên nào</span>
        )
      }
      options={options.map((option) => ({
        value: option.value,
        label: (
          <span>
            {option.label}
            {option.department ? (
              <span className="sf-body-sm sf-text-variant"> · {option.department}</span>
            ) : null}
          </span>
        ),
      }))}
    />
  );
}
