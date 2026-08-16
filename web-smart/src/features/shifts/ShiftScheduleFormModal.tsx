import { useEffect, useMemo, useState } from 'react';
import { Alert, DatePicker, Input, Modal, Select } from 'antd';
import { Field, useToast } from '@/components/ui';
import {
  DepartmentTreeMultiSelect,
  useDepartmentAncestors,
  withAncestorDepartments,
  withDescendantDepartments,
} from '@/components/DepartmentTreeSelect';
import { useErrorToast } from '@/lib/errors/use-error-toast';
import { useDepartments } from '@/features/shared/org.api';
import { useShifts } from '@/features/policy/policy.api';
import { dayjs } from '@/lib/utils/dayjs';
import { useCreateShiftSchedule } from './shifts.api';

/**
 * Ca có dùng được cho phạm vi phòng ban này không.
 *
 * `null` = chưa chọn phòng ban nào, khi đó hiện mọi ca: danh sách rỗng ở bước
 * đầu đọc như "công ty chưa khai ca nào" và làm người dùng đi tìm nhầm chỗ.
 * Ca không khai phòng ban nào là ca dùng chung, luôn hợp lệ.
 */
function shiftFits(shift: { departmentIds: string[] }, scope: Set<string> | null): boolean {
  if (!scope) return true;
  return shift.departmentIds.length === 0 || shift.departmentIds.some((id) => scope.has(id));
}

/** "Bảng phân ca Tháng 08/2026" — khớp đúng chuỗi Backend tự sinh khi bỏ trống tên. */
export function defaultScheduleName(periodMonth: string): string {
  const month = dayjs(periodMonth);
  return `Bảng phân ca Tháng ${month.format('MM/YYYY')}`;
}

/**
 * Tham số LẬP bảng phân ca — FR-WEB-HR-13.
 *
 * Ba trường đầu là PHẠM VI của bảng, chốt một lần tại đây: mọi thao tác trong
 * màn chi tiết (lọc, phân ca hàng loạt) chỉ chạy trong phạm vi này. Nhờ vậy
 * người xếp lịch không phải chọn lại phòng ban và ca ở từng bước, và cũng không
 * vô tình xếp ca của phòng khác vào bảng của mình.
 *
 * Chỉ dùng để LẬP MỚI. Sửa tham số của một bảng đã lập không có ở giao diện:
 * phạm vi đã chốt kéo theo danh sách thành viên và toàn bộ lịch đã xếp, nên nới
 * hay thu hẹp nó sau đó chỉ đổi bộ lọc chứ không đổi dữ liệu — hai thứ lệch
 * nhau đọc như một lỗi. Muốn đổi phạm vi thì xoá bảng và lập lại.
 *
 * Combo ca **lọc theo phòng ban đã chọn**: danh mục ca có trường "Phòng ban áp
 * dụng", và hiện cả những ca không dành cho phòng này chỉ tạo cơ hội chọn nhầm.
 * Ca không khai phòng ban nào thì áp dụng cho mọi phòng, nên luôn hiện.
 */
export function ShiftScheduleFormModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const showError = useErrorToast();
  const departments = useDepartments();
  const shifts = useShifts();
  const create = useCreateShiftSchedule();

  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const [shiftIds, setShiftIds] = useState<string[]>([]);
  const [periodMonth, setPeriodMonth] = useState<string>(dayjs().format('YYYY-MM-01'));
  const [name, setName] = useState('');
  /** Người dùng đã tự gõ tên chưa — gõ rồi thì đổi kỳ không được ghi đè lên. */
  const [nameTouched, setNameTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    const month = dayjs().format('YYYY-MM-01');
    setDepartmentIds([]);
    setShiftIds([]);
    setPeriodMonth(month);
    setName(defaultScheduleName(month));
    setNameTouched(false);
  }, [open]);

  /**
   * Ca hợp lệ cho các phòng ban đang chọn — đối chiếu với cả cấp TRÊN của
   * chúng, vì ca khai cho toàn công ty đương nhiên dùng được cho một tổ trong
   * công ty đó.
   */
  const shiftScope = useDepartmentAncestors(departmentIds);
  const shiftOptions = (shifts.data ?? []).filter((shift) => shiftFits(shift, shiftScope));

  function changeMonth(next: string) {
    setPeriodMonth(next);
    if (!nameTouched) setName(defaultScheduleName(next));
  }

  /**
   * Số CBNV sẽ được đưa vào bảng, đếm TRƯỚC khi bấm Lưu.
   *
   * Không có con số này thì phòng ban rỗng vẫn lập được bảng, và người dùng chỉ
   * phát hiện khi mở lưới chi tiết ra thấy trống — không có gì trên màn hình
   * giải thích vì sao. Backend cũng từ chối (`POL_SCHEDULE_NO_MEMBERS`), nhưng
   * biết trước lúc chọn vẫn hơn biết sau khi bấm.
   */
  const memberPreview = useMemo(() => {
    const all = departments.data ?? [];
    const byId = new Map(all.map((d) => [d.id, d]));
    return withDescendantDepartments(all, departmentIds).reduce(
      (total, id) => total + (byId.get(id)?._count?.employees ?? 0),
      0,
    );
  }, [departments.data, departmentIds]);

  const canSave =
    departmentIds.length > 0 && shiftIds.length > 0 && Boolean(name.trim()) && memberPreview > 0;

  async function submit() {
    try {
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
      onClose();
    } catch (caught) {
      showError(caught);
    }
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title="Lập bảng phân ca"
      okText="Lập bảng"
      cancelText="Huỷ bỏ"
      okButtonProps={{ loading: create.isPending, disabled: !canSave }}
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
              //
              // Phạm vi phải tính từ `ids` — tham số của chính sự kiện này —
              // chứ không từ `shiftScope`: state vừa `set` ở dòng trên chỉ có
              // giá trị mới ở lần render sau.
              const scope = ids.length
                ? new Set(withAncestorDepartments(departments.data ?? [], ids))
                : null;
              setShiftIds((prev) =>
                prev.filter((id) => {
                  const shift = (shifts.data ?? []).find((s) => s.id === id);
                  return shift ? shiftFits(shift, scope) : false;
                }),
              );
            }}
            placeholder="Chọn một hoặc nhiều phòng ban"
          />
          {departmentIds.length === 0 ? (
            <Hint>
              Toàn bộ CBNV đang làm việc của các phòng ban này — kể cả các phòng ban cấp dưới — sẽ
              được đưa vào bảng.
            </Hint>
          ) : memberPreview > 0 ? (
            <Hint>
              Sẽ đưa <strong>{memberPreview} CBNV</strong> đang làm việc vào bảng (đã tính cả phòng
              ban cấp dưới), chưa xếp ca gì.
            </Hint>
          ) : (
            <p className="sf-body-sm" style={{ margin: '4px 0 0', color: 'var(--sf-error)' }}>
              Các phòng ban này chưa có CBNV nào đang làm việc — bảng lập ra sẽ trống và không xếp
              được ca cho ai. Chọn phòng ban khác, hoặc thêm nhân viên vào phòng ban trước.
            </p>
          )}
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
            value={dayjs(periodMonth)}
            onChange={(date) => date && changeMonth(date.format('YYYY-MM-01'))}
          />
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

        <Alert
          type="info"
          showIcon
          message="Mỗi người mỗi tháng chỉ thuộc một bảng"
          description="Nếu có ai đó đã nằm trong bảng khác của cùng tháng, hệ thống sẽ báo tên cụ thể và không lập bảng."
        />
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
