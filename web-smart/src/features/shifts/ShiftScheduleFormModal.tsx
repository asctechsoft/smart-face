import { useEffect, useState } from 'react';
import { Alert, DatePicker, Input, Modal, Select } from 'antd';
import { Field, useToast } from '@/components/ui';
import { DepartmentTreeMultiSelect } from '@/components/DepartmentTreeSelect';
import { useErrorToast } from '@/lib/errors/use-error-toast';
import { useShifts } from '@/features/policy/policy.api';
import { dayjs } from '@/lib/utils/dayjs';
import { useCreateShiftSchedule, useUpdateShiftSchedule, type ShiftSchedule } from './shifts.api';

/** "Bảng phân ca Tháng 08/2026" — khớp đúng chuỗi Backend tự sinh khi bỏ trống tên. */
export function defaultScheduleName(periodMonth: string): string {
  const month = dayjs(periodMonth);
  return `Bảng phân ca Tháng ${month.format('MM/YYYY')}`;
}

/**
 * Tham số lập bảng phân ca — FR-WEB-HR-13.
 *
 * Ba trường đầu là PHẠM VI của bảng, chốt một lần tại đây: mọi thao tác trong
 * màn chi tiết (lọc, phân ca hàng loạt) chỉ chạy trong phạm vi này. Nhờ vậy
 * người xếp lịch không phải chọn lại phòng ban và ca ở từng bước, và cũng không
 * vô tình xếp ca của phòng khác vào bảng của mình.
 *
 * Combo ca **lọc theo phòng ban đã chọn**: danh mục ca có trường "Phòng ban áp
 * dụng", và hiện cả những ca không dành cho phòng này chỉ tạo cơ hội chọn nhầm.
 * Ca không khai phòng ban nào thì áp dụng cho mọi phòng, nên luôn hiện.
 */
export function ShiftScheduleFormModal({
  open,
  editing,
  onClose,
}: {
  open: boolean;
  /** Có giá trị = sửa bảng đã có. Kỳ lập bảng khi đó không đổi được. */
  editing: ShiftSchedule | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const showError = useErrorToast();
  const shifts = useShifts();
  const create = useCreateShiftSchedule();
  const update = useUpdateShiftSchedule();

  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const [shiftIds, setShiftIds] = useState<string[]>([]);
  const [periodMonth, setPeriodMonth] = useState<string>(dayjs().format('YYYY-MM-01'));
  const [name, setName] = useState('');
  /** Người dùng đã tự gõ tên chưa — gõ rồi thì đổi kỳ không được ghi đè lên. */
  const [nameTouched, setNameTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setDepartmentIds(editing.departmentIds);
      setShiftIds(editing.shiftIds);
      setPeriodMonth(editing.periodMonth);
      setName(editing.name);
      setNameTouched(true);
    } else {
      const month = dayjs().format('YYYY-MM-01');
      setDepartmentIds([]);
      setShiftIds([]);
      setPeriodMonth(month);
      setName(defaultScheduleName(month));
      setNameTouched(false);
    }
  }, [open, editing]);

  /**
   * Ca hợp lệ cho các phòng ban đang chọn.
   *
   * Chưa chọn phòng ban nào thì hiện tất cả — danh sách rỗng ở bước đầu đọc như
   * "công ty chưa khai ca nào", sai và làm người dùng đi tìm nhầm chỗ.
   */
  const shiftOptions = (shifts.data ?? []).filter(
    (shift) =>
      departmentIds.length === 0 ||
      shift.departmentIds.length === 0 ||
      shift.departmentIds.some((id) => departmentIds.includes(id)),
  );

  function changeMonth(next: string) {
    setPeriodMonth(next);
    if (!nameTouched) setName(defaultScheduleName(next));
  }

  const canSave = departmentIds.length > 0 && shiftIds.length > 0 && Boolean(name.trim());

  async function submit() {
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, name: name.trim(), departmentIds, shiftIds });
        toast.success('Đã lưu bảng phân ca');
      } else {
        const created = await create.mutateAsync({
          departmentIds,
          shiftIds,
          periodMonth,
          name: name.trim(),
        });
        toast.success(
          `Đã lập ${created.name}`,
          `${created.memberCount} nhân viên được đưa vào bảng, chưa xếp ca.`,
        );
      }
      onClose();
    } catch (caught) {
      showError(caught);
    }
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={editing ? `Sửa ${editing.name}` : 'Lập bảng phân ca'}
      okText={editing ? 'Lưu' : 'Lập bảng'}
      cancelText="Huỷ bỏ"
      okButtonProps={{ loading: create.isPending || update.isPending, disabled: !canSave }}
      width={640}
      destroyOnClose
      onOk={() => void submit()}
    >
      <div style={{ display: 'grid', gap: 16 }}>
        <Field label="Phòng ban áp dụng" htmlFor="sf-dept" required>
          <DepartmentTreeMultiSelect
            id="sf-dept"
            value={departmentIds}
            onChange={(ids) => {
              setDepartmentIds(ids);
              // Bỏ ca không còn hợp lệ với phòng ban vừa chọn, thay vì để lại
              // một lựa chọn mà chính form này không cho chọn lại.
              setShiftIds((prev) =>
                prev.filter((id) => {
                  const shift = (shifts.data ?? []).find((s) => s.id === id);
                  if (!shift) return false;
                  return (
                    ids.length === 0 ||
                    shift.departmentIds.length === 0 ||
                    shift.departmentIds.some((d) => ids.includes(d))
                  );
                }),
              );
            }}
            placeholder="Chọn một hoặc nhiều phòng ban"
          />
          <Hint>Toàn bộ CBNV đang làm việc của các phòng ban này sẽ được đưa vào bảng.</Hint>
        </Field>

        <Field label="Ca làm việc được dùng" htmlFor="sf-shifts" required>
          <Select
            id="sf-shifts"
            mode="multiple"
            style={{ width: '100%' }}
            placeholder="Chọn các ca sẽ dùng trong bảng này"
            loading={shifts.isLoading}
            value={shiftIds}
            onChange={setShiftIds}
            optionFilterProp="label"
            options={shiftOptions.map((shift) => ({
              value: shift.id,
              label: `${shift.code} · ${shift.name}${
                shift.type === 'FLEXIBLE'
                  ? ' · linh hoạt'
                  : ` · ${shift.startTime ?? '—'}–${shift.endTime ?? '—'}`
              }`,
            }))}
          />
          <Hint>
            Chỉ hiện ca áp dụng cho phòng ban đã chọn, cộng các ca dùng chung cho mọi phòng ban.
          </Hint>
        </Field>

        <Field label="Kỳ lập bảng" htmlFor="sf-period" required>
          <DatePicker
            id="sf-period"
            picker="month"
            allowClear={false}
            format="MM/YYYY"
            style={{ width: '100%' }}
            disabled={Boolean(editing)}
            value={dayjs(periodMonth)}
            onChange={(date) => date && changeMonth(date.format('YYYY-MM-01'))}
          />
          {editing ? (
            <Hint>Kỳ lập bảng không đổi được — lịch ca đã xếp gắn với đúng tháng này.</Hint>
          ) : null}
        </Field>

        <Field label="Tên bảng phân ca" htmlFor="sf-name" required>
          <Input
            id="sf-name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setNameTouched(true);
            }}
          />
        </Field>

        {editing ? (
          <Alert
            type="warning"
            showIcon
            message="Thu hẹp phạm vi không tự bỏ người ra khỏi bảng"
            description="Bỏ bớt phòng ban ở đây chỉ đổi bộ lọc của màn chi tiết. Muốn bỏ hẳn ai đó khỏi bảng thì dùng chức năng Bỏ khỏi bảng trong màn chi tiết — thao tác đó xoá luôn lịch ca của họ."
          />
        ) : (
          <Alert
            type="info"
            showIcon
            message="Mỗi người mỗi tháng chỉ thuộc một bảng"
            description="Nếu có ai đó đã nằm trong bảng khác của cùng tháng, hệ thống sẽ báo tên cụ thể và không lập bảng."
          />
        )}
      </div>
    </Modal>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p className="sf-body-sm sf-text-variant" style={{ margin: '4px 0 0' }}>
      {children}
    </p>
  );
}
