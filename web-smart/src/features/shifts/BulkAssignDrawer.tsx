import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, DatePicker, Drawer, Select } from 'antd';
import { toUserMessage } from '@/lib/errors/api-error';
import { toWorkDate } from '@/lib/utils/date';
import { toDayjs } from '@/lib/utils/dayjs';
import { useShifts } from '@/features/policy/policy.api';
import {
  useBulkAssignShifts,
  useClearShiftAssignments,
  type ShiftBoardEmployee,
} from './shifts.api';
import { ConfirmDialog, Field, useToast } from '@/components/ui';
import { useErrorToast } from '@/lib/errors/use-error-toast';

/**
 * Thứ trong tuần dạng SỐ THỨ TỰ — `1 = T2 … 7 = CN`.
 *
 * ⚠ KHÁC với `WEEKDAYS` ở `config/constants.ts`, vốn là BITMASK (1, 2, 4, 8…)
 * dùng cho `Shift.weekdayMask`. Hai cách đánh số tồn tại song song trong hệ
 * thống và Backend cũng ghi rõ điều này ở `BulkShiftAssignmentDto`. Dùng nhầm
 * bảng sẽ cho lịch sai mà không có lỗi nào được ném ra.
 */
const ORDINAL_WEEKDAYS = [
  { value: 1, label: 'T2' },
  { value: 2, label: 'T3' },
  { value: 3, label: 'T4' },
  { value: 4, label: 'T5' },
  { value: 5, label: 'T6' },
  { value: 6, label: 'T7' },
  { value: 7, label: 'CN' },
] as const;

/**
 * Phân ca hàng loạt — `FR-WEB-HR-04`.
 *
 * Thao tác thật của người dùng là "xếp ca tháng 8 cho cả phòng 40 người", nên
 * cả ba chiều (ai, ca nào, những ngày nào) nằm trên cùng một form và gửi đi
 * trong MỘT request: 40 × 31 lời gọi đơn lẻ vừa chậm vừa có thể hỏng giữa
 * chừng, để lại lịch đúng một nửa mà không ai biết nửa nào.
 *
 * Có luôn nhánh XOÁ ở đây vì "xếp lại lịch" trong thực tế luôn bắt đầu bằng dọn
 * lịch cũ. Tách sang màn khác thì người dùng phải nhớ hai đường dẫn cho một việc.
 */
export function BulkAssignDrawer({
  open,
  onClose,
  defaultRange,
  preselectedIds,
  employees,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  defaultRange: { from: string; to: string };
  preselectedIds: string[];
  employees: ShiftBoardEmployee[];
  onDone: () => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const showError = useErrorToast();
  const shifts = useShifts();
  const assign = useBulkAssignShifts();
  const clear = useClearShiftAssignments();

  const [employeeIds, setEmployeeIds] = useState<string[]>([]);
  const [shiftId, setShiftId] = useState<string | undefined>();
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [error, setError] = useState<string | null>(null);
  const [clearOpen, setClearOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setEmployeeIds(preselectedIds);
    setFrom(defaultRange.from);
    setTo(defaultRange.to);
  }, [open, preselectedIds, defaultRange.from, defaultRange.to]);

  const canSubmit = employeeIds.length > 0 && Boolean(shiftId);

  async function submit() {
    if (!shiftId) return;
    setError(null);

    try {
      const result = await assign.mutateAsync({
        employeeIds,
        shiftId,
        from,
        to,
        // Gửi `undefined` thay vì mảng rỗng: Backend hiểu "bỏ trống = mọi ngày",
        // còn mảng rỗng đi qua bộ lọc sẽ khớp KHÔNG ngày nào và không phân ca gì cả.
        weekdays: weekdays.length > 0 ? weekdays : undefined,
      });

      toast.success(
        `Đã phân ca cho ${result.employeeCount} nhân viên`,
        `${result.dayCount} ngày, tổng ${result.assigned} lượt. Bảng công của những ngày ĐÃ TÍNH không tự đổi theo ca mới.`,
        // Hệ quả nói ở dòng trên chỉ có ích khi kèm đường đi tới chỗ xử lý nó.
        { label: 'Chạy lại tính công', onClick: () => navigate('/payroll') },
      );
      if (result.skippedEmployeeIds.length > 0) {
        toast.warning(
          `Bỏ qua ${result.skippedEmployeeIds.length} nhân viên`,
          'Những người này không còn thuộc phạm vi phòng ban bạn quản lý.',
        );
      }
      onDone();
      onClose();
    } catch (caught) {
      setError(toUserMessage(caught));
    }
  }

  async function clearAssignments() {
    try {
      const result = await clear.mutateAsync({ employeeIds, from, to });
      toast.success(
        `Đã xoá ${result.deleted} lượt phân ca`,
        'Những người này quay về ca mặc định của công ty cho tới khi được xếp ca mới.',
      );
      setClearOpen(false);
      onDone();
      onClose();
    } catch (caught) {
      showError(caught);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={520}
      destroyOnClose
      title="Phân ca hàng loạt"
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <Button
            size="large"
            danger
            disabled={employeeIds.length === 0}
            loading={clear.isPending}
            onClick={() => setClearOpen(true)}
          >
            Xoá phân ca
          </Button>
          <div style={{ display: 'flex', gap: 12 }}>
            <Button size="large" onClick={onClose}>
              Huỷ bỏ
            </Button>
            <Button
              type="primary"
              size="large"
              disabled={!canSubmit}
              loading={assign.isPending}
              onClick={() => void submit()}
            >
              Phân ca
            </Button>
          </div>
        </div>
      }
    >
      <div style={{ display: 'grid', gap: 16 }}>
        {error ? <Alert type="error" showIcon message={error} role="alert" /> : null}

        <Field label="Nhân viên" htmlFor="ba-emp" required>
          <Select
            id="ba-emp"
            mode="multiple"
            style={{ width: '100%' }}
            placeholder="Chọn nhân viên"
            value={employeeIds}
            onChange={setEmployeeIds}
            optionFilterProp="label"
            options={employees.map((employee) => ({
              value: employee.id,
              label: `${employee.fullName} · ${employee.employeeCode}`,
            }))}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Button size="small" onClick={() => setEmployeeIds(employees.map((item) => item.id))}>
              Chọn tất cả đang hiển thị
            </Button>
            <Button size="small" type="text" onClick={() => setEmployeeIds([])}>
              Bỏ chọn
            </Button>
          </div>
          <p className="sf-body-sm sf-text-variant" style={{ margin: '4px 0 0' }}>
            Danh sách chỉ gồm nhân viên đang hiển thị trên lịch. Cần người ở trang khác thì chuyển
            trang rồi chọn thêm.
          </p>
        </Field>

        <Field label="Ca làm việc" htmlFor="ba-shift" required>
          <Select
            id="ba-shift"
            style={{ width: '100%' }}
            placeholder="Chọn ca"
            loading={shifts.isLoading}
            value={shiftId}
            onChange={setShiftId}
            options={(shifts.data ?? []).map((shift) => ({
              value: shift.id,
              label:
                shift.type === 'FLEXIBLE'
                  ? `${shift.name} · linh hoạt`
                  : `${shift.name} · ${shift.startTime ?? '—'}–${shift.endTime ?? '—'}${shift.crossesMidnight ? ' (qua đêm)' : ''}`,
            }))}
          />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Field label="Từ ngày" htmlFor="ba-from" required>
            <DatePicker
              id="ba-from"
              allowClear={false}
              format="DD/MM/YYYY"
              style={{ width: '100%' }}
              value={toDayjs(from)}
              onChange={(date) => setFrom(toWorkDate(date?.toDate()) ?? from)}
            />
          </Field>
          <Field label="Đến ngày" htmlFor="ba-to" required>
            <DatePicker
              id="ba-to"
              allowClear={false}
              format="DD/MM/YYYY"
              style={{ width: '100%' }}
              value={toDayjs(to)}
              onChange={(date) => setTo(toWorkDate(date?.toDate()) ?? to)}
            />
          </Field>
        </div>

        <Field label="Chỉ áp dụng cho các thứ">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {ORDINAL_WEEKDAYS.map((day) => {
              const selected = weekdays.includes(day.value);
              return (
                <button
                  key={day.value}
                  type="button"
                  role="switch"
                  aria-checked={selected}
                  onClick={() =>
                    setWeekdays((prev) =>
                      selected ? prev.filter((item) => item !== day.value) : [...prev, day.value],
                    )
                  }
                  style={{
                    height: 38,
                    paddingInline: 16,
                    borderRadius: 9999,
                    fontSize: 14,
                    cursor: 'pointer',
                    background: selected ? 'var(--sf-teal-700)' : 'transparent',
                    color: selected ? '#FFFFFF' : 'var(--sf-on-surface)',
                    border: `1px solid ${selected ? 'var(--sf-teal-700)' : 'var(--sf-neutral-500)'}`,
                    transition: 'background-color 150ms ease-out',
                  }}
                >
                  {day.label}
                </button>
              );
            })}
          </div>
          <p className="sf-body-sm sf-text-variant" style={{ margin: '4px 0 0' }}>
            Không chọn thứ nào = phân ca cho mọi ngày trong khoảng, kể cả cuối tuần và ngày lễ.
          </p>
        </Field>

        <Alert
          type="info"
          showIcon
          message="Phân ca đè lên lịch cũ"
          description="Ngày nào đã có ca khác sẽ bị thay bằng ca chọn ở đây. Bảng công của những ngày ĐÃ TÍNH không tự đổi theo — muốn áp dụng, chạy lại tính công cho khoảng đó ở màn Kỳ lương."
        />
      </div>

      <ConfirmDialog
        open={clearOpen}
        title="Xoá phân ca trong khoảng đã chọn?"
        message={`${employeeIds.length} nhân viên sẽ mất phân ca từ ${from} đến ${to} và quay về ca mặc định của công ty. Bảng công đã tính của những ngày đó không thay đổi.`}
        confirmText="Xoá phân ca"
        danger
        loading={clear.isPending}
        onCancel={() => setClearOpen(false)}
        onConfirm={() => void clearAssignments()}
      />
    </Drawer>
  );
}
