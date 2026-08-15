import { useState } from 'react';
import { Alert, Modal, Select, Spin } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { qk } from '@/lib/api/query-client';
import { Field, useToast } from '@/components/ui';
import { DepartmentTreeSelect } from '@/components/DepartmentTreeSelect';
import { useErrorToast } from '@/lib/errors/use-error-toast';
import { EMPLOYABLE_STATUSES } from '@/config/constants';
import { useAddScheduleMembers } from './shifts.api';

interface EmployeeOption {
  id: string;
  fullName: string;
  employeeCode: string;
  department?: { id: string; name: string } | null;
}

/**
 * Thêm CBNV vào một bảng phân ca đã lập.
 *
 * Cần đến vì danh sách thành viên được CHỐT lúc lập bảng: người mới vào công ty
 * giữa tháng, hoặc người được điều động sang, sẽ không tự xuất hiện. Không có
 * chức năng này thì cách duy nhất là xoá bảng và lập lại — mất toàn bộ lịch đã xếp.
 *
 * Bộ lọc phòng ban ở đây KHÔNG giới hạn theo phạm vi của bảng: điều động người
 * từ phòng khác sang là đúng lý do người ta mở hộp thoại này.
 */
export function AddMembersModal({
  open,
  scheduleId,
  existingIds,
  onClose,
}: {
  open: boolean;
  scheduleId: string;
  existingIds: string[];
  onClose: () => void;
}) {
  const toast = useToast();
  const showError = useErrorToast();
  const addMembers = useAddScheduleMembers();

  const [departmentId, setDepartmentId] = useState<string | undefined>();
  const [selected, setSelected] = useState<string[]>([]);

  const employees = useQuery({
    queryKey: qk.employeeList({ scope: 'schedule-members', departmentId }),
    queryFn: () =>
      api.getPaginated<EmployeeOption>('/admin/employees', {
        departmentId,
        status: EMPLOYABLE_STATUSES,
        pageSize: 100,
      }),
    enabled: open,
  });

  const already = new Set(existingIds);
  const options = (employees.data?.items ?? []).filter((employee) => !already.has(employee.id));

  async function submit() {
    try {
      const result = await addMembers.mutateAsync({ id: scheduleId, employeeIds: selected });
      toast.success(
        `Đã thêm ${result.added} nhân viên vào bảng`,
        result.skipped > 0
          ? `${result.skipped} người bị bỏ qua vì ngoài phạm vi bạn quản lý.`
          : undefined,
      );
      setSelected([]);
      onClose();
    } catch (caught) {
      showError(caught);
    }
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title="Thêm CBNV vào bảng"
      okText="Thêm vào bảng"
      cancelText="Huỷ bỏ"
      okButtonProps={{ loading: addMembers.isPending, disabled: selected.length === 0 }}
      width={600}
      destroyOnClose
      afterOpenChange={(next) => {
        if (next) {
          setSelected([]);
          setDepartmentId(undefined);
        }
      }}
      onOk={() => void submit()}
    >
      <div style={{ display: 'grid', gap: 16 }}>
        <Field label="Lọc theo phòng ban" htmlFor="am-dept">
          <DepartmentTreeSelect
            id="am-dept"
            value={departmentId}
            onChange={(value) => {
              setDepartmentId(value);
              setSelected([]);
            }}
            placeholder="Tất cả phòng ban"
          />
        </Field>

        <Field label="Nhân viên" htmlFor="am-emp" required>
          {employees.isLoading ? (
            <Spin size="small" />
          ) : (
            <Select
              id="am-emp"
              mode="multiple"
              style={{ width: '100%' }}
              placeholder="Chọn nhân viên cần thêm"
              value={selected}
              onChange={setSelected}
              optionFilterProp="label"
              options={options.map((employee) => ({
                value: employee.id,
                label: `${employee.fullName} · ${employee.employeeCode}${
                  employee.department ? ` · ${employee.department.name}` : ''
                }`,
              }))}
            />
          )}
          <p className="sf-body-sm sf-text-variant" style={{ margin: '4px 0 0' }}>
            Người đã có trong bảng không hiện ở đây.
          </p>
        </Field>

        <Alert
          type="info"
          showIcon
          message="Mỗi người mỗi tháng chỉ thuộc một bảng"
          description="Ai đang nằm trong bảng khác của cùng tháng sẽ bị từ chối kèm tên cụ thể — bỏ họ khỏi bảng kia trước."
        />
      </div>
    </Modal>
  );
}
