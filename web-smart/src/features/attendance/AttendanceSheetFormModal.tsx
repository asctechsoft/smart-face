import { useEffect, useMemo, useState } from 'react';
import { Alert, DatePicker, Input, Modal } from 'antd';
import { Field, useToast } from '@/components/ui';
import {
  DepartmentTreeMultiSelect,
  withDescendantDepartments,
} from '@/components/DepartmentTreeSelect';
import { useErrorToast } from '@/lib/errors/use-error-toast';
import { useDepartments } from '@/features/shared/org.api';
import { useShiftSchedules } from '@/features/shifts/shifts.api';
import { dayjs } from '@/lib/utils/dayjs';
import { useCreateAttendanceSheet } from './attendance-sheets.api';

/** "Bảng chấm công Tháng 08/2026" — khớp đúng chuỗi Backend tự sinh khi bỏ trống tên. */
export function defaultSheetName(periodMonth: string): string {
  return `Bảng chấm công Tháng ${dayjs(periodMonth).format('MM/YYYY')}`;
}

/**
 * Tham số LẬP bảng chấm công — FR-WEB-ATT-08.
 *
 * Chỉ hỏi hai thứ: KỲ và PHÒNG BAN. Danh sách người không hỏi, vì nó phải khớp
 * với bảng phân ca của đúng tháng đó — bảng công phủ đúng tập người mà lịch ca
 * đã phủ, nếu không thì cuối tháng có người có ca mà không ai rà công cho họ.
 *
 * Form nói trước sẽ lấy người từ đâu. Đây không phải chi tiết kỹ thuật: bảng
 * dựng từ phân ca và bảng dựng từ danh sách phòng ban có mức tin cậy khác nhau,
 * và người rà công cần biết điều đó TRƯỚC khi bắt đầu rà, không phải khi phát
 * hiện thiếu một dòng vào ngày chốt lương.
 *
 * Chỉ dùng để LẬP MỚI, giống bảng phân ca: phạm vi đã chốt kéo theo danh sách
 * thành viên, nên sửa nó sau chỉ đổi bộ lọc chứ không đổi dữ liệu.
 */
export function AttendanceSheetFormModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const showError = useErrorToast();
  const departments = useDepartments();
  const create = useCreateAttendanceSheet();

  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const [periodMonth, setPeriodMonth] = useState<string>(dayjs().format('YYYY-MM-01'));
  const [name, setName] = useState('');
  /** Người dùng đã tự gõ tên chưa — gõ rồi thì đổi kỳ không được ghi đè lên. */
  const [nameTouched, setNameTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    const month = dayjs().format('YYYY-MM-01');
    setDepartmentIds([]);
    setPeriodMonth(month);
    setName(defaultSheetName(month));
    setNameTouched(false);
  }, [open]);

  /**
   * Bảng phân ca của đúng kỳ này.
   *
   * Lọc phòng ban ở phía Web thay vì gửi `departmentId` lên: bảng chấm công
   * nhận NHIỀU phòng ban còn endpoint chỉ nhận một. Số bảng phân ca mỗi tháng
   * đếm trên đầu ngón tay nên tải hết một tháng rồi lọc là rẻ.
   */
  const schedules = useShiftSchedules({ month: periodMonth, pageSize: 100 });

  const scopedDepartmentIds = useMemo(
    () => withDescendantDepartments(departments.data ?? [], departmentIds),
    [departments.data, departmentIds],
  );

  const matchingSchedules = useMemo(() => {
    if (departmentIds.length === 0) return [];
    const scope = new Set(scopedDepartmentIds);
    return (schedules.data?.items ?? []).filter((schedule) =>
      schedule.departmentIds.some((id) => scope.has(id)),
    );
  }, [schedules.data, scopedDepartmentIds, departmentIds]);

  /**
   * Số CBNV của các phòng ban đã chọn — chỉ dùng cho trường hợp KHÔNG có bảng
   * phân ca, vì khi đó Backend lấy đúng tập người này. Có phân ca thì con số
   * thật do bảng phân ca quyết định, và đoán bừa ở đây sẽ hiện một số khác với
   * số hiện ra sau khi lưu.
   */
  const departmentHeadcount = useMemo(() => {
    const byId = new Map((departments.data ?? []).map((d) => [d.id, d]));
    return scopedDepartmentIds.reduce(
      (total, id) => total + (byId.get(id)?._count?.employees ?? 0),
      0,
    );
  }, [departments.data, scopedDepartmentIds]);

  const willBeEmpty =
    departmentIds.length > 0 && matchingSchedules.length === 0 && departmentHeadcount === 0;
  const canSave = departmentIds.length > 0 && Boolean(name.trim()) && !willBeEmpty;

  function changeMonth(next: string) {
    setPeriodMonth(next);
    if (!nameTouched) setName(defaultSheetName(next));
  }

  async function submit() {
    try {
      const created = await create.mutateAsync({
        departmentIds,
        periodMonth,
        name: name.trim(),
      });
      toast.success(
        `Đã lập ${created.name}`,
        `${created.memberCount} CBNV trong bảng, lấy từ ${
          created.shiftScheduleIds.length > 0 ? 'bảng phân ca của tháng' : 'danh sách phòng ban'
        }.`,
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
      title="Lập bảng chấm công"
      okText="Lập bảng"
      cancelText="Huỷ bỏ"
      okButtonProps={{ loading: create.isPending, disabled: !canSave }}
      width={640}
      destroyOnClose
      onOk={() => void submit()}
    >
      <div style={{ display: 'grid', gap: 16 }}>
        <Field label="Kỳ chấm công" htmlFor="af-period" required>
          <DatePicker
            id="af-period"
            picker="month"
            allowClear={false}
            format="MM/YYYY"
            style={{ width: '100%' }}
            value={dayjs(periodMonth)}
            onChange={(date) => date && changeMonth(date.format('YYYY-MM-01'))}
          />
        </Field>

        <Field label="Phòng ban áp dụng" htmlFor="af-dept" required>
          <DepartmentTreeMultiSelect
            id="af-dept"
            value={departmentIds}
            onChange={setDepartmentIds}
            placeholder="Chọn một hoặc nhiều phòng ban"
          />
          <SourceHint
            loading={schedules.isLoading}
            picked={departmentIds.length > 0}
            scheduleNames={matchingSchedules.map((schedule) => schedule.name)}
            headcount={departmentHeadcount}
            period={periodMonth}
          />
        </Field>

        <Field label="Tên bảng chấm công" htmlFor="af-name" required>
          <Input
            id="af-name"
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
          message="Mỗi người mỗi tháng chỉ thuộc một bảng chấm công"
          description="Nếu có ai đó đã nằm trong bảng khác của cùng tháng, hệ thống sẽ báo tên cụ thể và không lập bảng."
        />
      </div>
    </Modal>
  );
}

/**
 * Nói trước thành viên sẽ lấy từ đâu.
 *
 * Ba trạng thái, ba hệ quả khác nhau, nên không gộp thành một câu chung chung:
 * lấy từ phân ca là đường đúng; rơi về phòng ban là chấp nhận được nhưng dễ
 * thiếu người điều động giữa tháng; không có nguồn nào là lập bảng sẽ hỏng.
 */
function SourceHint({
  loading,
  picked,
  scheduleNames,
  headcount,
  period,
}: {
  loading: boolean;
  picked: boolean;
  scheduleNames: string[];
  headcount: number;
  period: string;
}) {
  if (!picked) {
    return (
      <Hint>
        Thành viên lấy từ bảng phân ca của kỳ này cho các phòng ban đã chọn — kể cả phòng ban cấp
        dưới.
      </Hint>
    );
  }

  if (loading) return <Hint>Đang tìm bảng phân ca của kỳ {dayjs(period).format('MM/YYYY')}…</Hint>;

  if (scheduleNames.length > 0) {
    return (
      <Hint>
        Lấy CBNV từ <strong>{scheduleNames.join(', ')}</strong>, kèm lịch ca đã xếp trong đó.
      </Hint>
    );
  }

  if (headcount > 0) {
    return (
      <p className="sf-body-sm" style={{ margin: '4px 0 0', color: 'var(--sf-warning-800)' }}>
        Kỳ {dayjs(period).format('MM/YYYY')} chưa có bảng phân ca nào cho các phòng ban này. Bảng sẽ
        lấy <strong>{headcount} CBNV</strong> đang làm việc của chúng, và công tính theo ca mặc định
        của công ty.
      </p>
    );
  }

  return (
    <p className="sf-body-sm" style={{ margin: '4px 0 0', color: 'var(--sf-error)' }}>
      Không có bảng phân ca nào cho kỳ này, mà các phòng ban đã chọn cũng chưa có CBNV nào đang làm
      việc. Bảng lập ra sẽ trống.
    </p>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p className="sf-body-sm sf-text-variant" style={{ margin: '4px 0 0' }}>
      {children}
    </p>
  );
}
