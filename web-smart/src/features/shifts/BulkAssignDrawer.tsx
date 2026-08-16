import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, DatePicker, Drawer, Radio, Select } from 'antd';
import { toUserMessage } from '@/lib/errors/api-error';
import { toWorkDate } from '@/lib/utils/date';
import { toDayjs } from '@/lib/utils/dayjs';
import {
  DepartmentTreeSelect,
  useDepartmentDescendants,
} from '@/components/DepartmentTreeSelect';
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

type Coverage = 'ALL' | 'PICK';

/**
 * Phân ca hàng loạt — `FR-WEB-HR-04`.
 *
 * Các trường xếp theo đúng thứ tự người dùng quyết định: **phòng nào → ca nào →
 * những ngày nào → cho ai**. Trước đây "cho ai" đứng đầu, buộc người dùng chọn
 * tên trước khi biết mình đang xếp ca gì.
 *
 * Phòng ban và ca **giới hạn trong phạm vi của bảng phân ca**: bảng đã chốt
 * những thứ đó lúc lập, và Backend cũng từ chối nếu đi ra ngoài. Hiện đầy đủ ở
 * giao diện rồi mới báo lỗi khi bấm Lưu là bắt người dùng đoán luật.
 *
 * "Toàn bộ CBNV" là một LỰA CHỌN riêng chứ không phải nút "chọn tất cả": nó có
 * nghĩa "mọi người thuộc phòng ban đã chọn", kể cả người ở trang sau của lưới.
 * Nút chọn-tất-cả kiểu cũ chỉ chọn được những người đang hiển thị, và đó chính
 * là chỗ người dùng tưởng đã xếp cho cả phòng mà thực ra chỉ 25 người đầu.
 */
export function BulkAssignDrawer({
  open,
  onClose,
  defaultRange,
  preselectedIds,
  employees,
  onDone,
  scheduleId,
  allowedDepartmentIds,
  allowedShiftIds,
  periodBounds,
}: {
  open: boolean;
  onClose: () => void;
  defaultRange: { from: string; to: string };
  preselectedIds: string[];
  employees: ShiftBoardEmployee[];
  onDone: () => void;
  /** Xếp trong một bảng phân ca — Backend kiểm tra ca, kỳ và thành viên theo bảng. */
  scheduleId?: string;
  allowedDepartmentIds?: string[];
  allowedShiftIds?: string[];
  /** Khoảng ngày hợp lệ của kỳ. Ngoài khoảng này Backend từ chối. */
  periodBounds?: { from: string; to: string };
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const showError = useErrorToast();
  const shifts = useShifts();
  const assign = useBulkAssignShifts();
  const clear = useClearShiftAssignments();

  const [departmentId, setDepartmentId] = useState<string | undefined>();
  const [shiftId, setShiftId] = useState<string | undefined>();
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  const [coverage, setCoverage] = useState<Coverage>('ALL');
  const [employeeIds, setEmployeeIds] = useState<string[]>([]);
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [error, setError] = useState<string | null>(null);
  const [clearOpen, setClearOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setFrom(defaultRange.from);
    setTo(defaultRange.to);
    setDepartmentId(allowedDepartmentIds?.length === 1 ? allowedDepartmentIds[0] : undefined);
    // Có người được tích sẵn trên lưới thì rõ ràng ý định là xếp cho đúng những
    // người đó, không phải cả phòng.
    setCoverage(preselectedIds.length > 0 ? 'PICK' : 'ALL');
    setEmployeeIds(preselectedIds);
  }, [open, preselectedIds, defaultRange.from, defaultRange.to, allowedDepartmentIds]);

  /**
   * Nhân viên thuộc phòng ban đang chọn — nguồn cho cả hai nhánh "toàn bộ" và
   * "từng người".
   *
   * Tính theo cả CẤP DƯỚI của phòng ban đã chọn: người gắn ở lá của cây, nên so
   * bằng `=== departmentId` thì chọn một khối cho ra "0 người" và ô "Toàn bộ
   * CBNV" đếm sai ngay trước mắt người dùng.
   */
  const inScope = useDepartmentDescendants(departmentId ? [departmentId] : undefined);
  const scoped = inScope
    ? employees.filter((employee) => employee.department && inScope.has(employee.department.id))
    : employees;

  const shiftOptions = (shifts.data ?? []).filter(
    (shift) => !allowedShiftIds || allowedShiftIds.includes(shift.id),
  );

  const targetIds = coverage === 'ALL' ? scoped.map((employee) => employee.id) : employeeIds;
  const canSubmit = targetIds.length > 0 && Boolean(shiftId);

  async function submit() {
    if (!shiftId) return;
    setError(null);

    try {
      const result = await assign.mutateAsync({
        employeeIds: targetIds,
        shiftId,
        from,
        to,
        // Gửi `undefined` thay vì mảng rỗng: Backend hiểu "bỏ trống = mọi ngày",
        // còn mảng rỗng đi qua bộ lọc sẽ khớp KHÔNG ngày nào và không phân ca gì cả.
        weekdays: weekdays.length > 0 ? weekdays : undefined,
        scheduleId,
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
          'Những người này không thuộc bảng, hoặc ngoài phạm vi phòng ban bạn quản lý.',
        );
      }
      // Trùng giờ thì bỏ qua đúng ô đó chứ không huỷ cả lượt xếp — nhưng phải
      // nói ra ngày nào vướng ca nào, nếu không người dùng đọc con số "đã xếp"
      // rồi tưởng cả tháng đã kín.
      if (result.conflictCount > 0) {
        const sample = result.conflicts
          .slice(0, 3)
          .map((item) => `${item.workDate} (trùng ${item.shiftName})`)
          .join(', ');
        toast.warning(
          `${result.conflictCount} ô không xếp được vì trùng giờ`,
          `${sample}${result.conflictCount > 3 ? '…' : ''}. Hai ca trong cùng một ngày phải có khung giờ không giao nhau.`,
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
      const result = await clear.mutateAsync({ employeeIds: targetIds, from, to });
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

  /** Ngày ngoài kỳ lập bảng thì Backend từ chối — chặn ngay ở lịch cho khỏi mất công. */
  const outOfPeriod = (value: string) =>
    Boolean(periodBounds) && (value < periodBounds!.from || value > periodBounds!.to);

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
            danger
            disabled={targetIds.length === 0}
            loading={clear.isPending}
            onClick={() => setClearOpen(true)}
          >
            Xoá phân ca
          </Button>
          <div style={{ display: 'flex', gap: 12 }}>
            <Button onClick={onClose}>Huỷ bỏ</Button>
            <Button
              type="primary"
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

        <Field label="Phòng ban" htmlFor="ba-dept">
          <DepartmentTreeSelect
            id="ba-dept"
            value={departmentId}
            onChange={(value) => {
              setDepartmentId(value);
              setEmployeeIds([]);
            }}
            limitTo={allowedDepartmentIds}
            placeholder="Tất cả phòng ban trong bảng"
          />
        </Field>

        <Field label="Ca làm việc" htmlFor="ba-shift" required>
          <Select
            id="ba-shift"
            style={{ width: '100%' }}
            placeholder="Chọn ca"
            loading={shifts.isLoading}
            value={shiftId}
            onChange={setShiftId}
            optionFilterProp="label"
            options={shiftOptions.map((shift) => ({
              value: shift.id,
              label:
                shift.type === 'FLEXIBLE'
                  ? `${shift.code} · ${shift.name} · linh hoạt`
                  : `${shift.code} · ${shift.name} · ${shift.startTime ?? '—'}–${shift.endTime ?? '—'}${shift.crossesMidnight ? ' (qua đêm)' : ''}`,
            }))}
          />
          {allowedShiftIds ? <Hint>Chỉ các ca đã chọn khi lập bảng phân ca này.</Hint> : null}
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Field label="Từ ngày" htmlFor="ba-from" required>
            <DatePicker
              id="ba-from"
              allowClear={false}
              format="DD/MM/YYYY"
              style={{ width: '100%' }}
              value={toDayjs(from)}
              disabledDate={(date) => outOfPeriod(date.format('YYYY-MM-DD'))}
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
              disabledDate={(date) => outOfPeriod(date.format('YYYY-MM-DD'))}
              onChange={(date) => setTo(toWorkDate(date?.toDate()) ?? to)}
            />
          </Field>
        </div>

        {/*
          Thứ tự các trường bám theo trình tự người dùng quyết định: phòng nào →
          ca nào → những NGÀY nào (khoảng ngày rồi lọc thứ trong tuần) → cho ai.
          "Chỉ áp dụng cho các thứ" là phần thu hẹp của khoảng ngày ngay phía
          trên nó, nên phải đứng liền sau, trước khi chuyển sang chọn người.
        */}
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
          <Hint>
            Không chọn thứ nào = phân ca cho mọi ngày trong khoảng, kể cả cuối tuần và ngày lễ.
          </Hint>
        </Field>

        <Field label="Áp dụng cho">
          <Radio.Group
            value={coverage}
            onChange={(event) => setCoverage(event.target.value as Coverage)}
            style={{ display: 'grid', gap: 8 }}
          >
            <Radio value="ALL">
              Toàn bộ CBNV
              <span className="sf-body-sm sf-text-variant" style={{ marginLeft: 8 }}>
                ({scoped.length} người
                {departmentId ? ' trong phòng ban đã chọn' : ' trong bảng'})
              </span>
            </Radio>
            <Radio value="PICK">Từng CBNV</Radio>
          </Radio.Group>

          {coverage === 'PICK' ? (
            <Select
              mode="multiple"
              style={{ width: '100%', marginTop: 8 }}
              placeholder="Chọn nhân viên"
              value={employeeIds}
              onChange={setEmployeeIds}
              optionFilterProp="label"
              options={scoped.map((employee) => ({
                value: employee.id,
                label: `${employee.fullName} · ${employee.employeeCode}`,
              }))}
              aria-label="Danh sách nhân viên được phân ca"
            />
          ) : null}
        </Field>

        <Alert
          type="info"
          showIcon
          message="Xếp thêm ca, không thay ca cũ"
          description="Một ngày mang được nhiều ca miễn giờ không giao nhau. Ngày nào đã có ca trùng giờ sẽ bị bỏ qua và báo lại cụ thể — muốn thay ca thì dùng Xoá phân ca trước rồi xếp lại. Bảng công của những ngày ĐÃ TÍNH không tự đổi theo; muốn áp dụng thì chạy lại tính công ở màn Kỳ lương."
        />
      </div>

      <ConfirmDialog
        open={clearOpen}
        title="Xoá phân ca trong khoảng đã chọn?"
        message={`${targetIds.length} nhân viên sẽ mất phân ca từ ${from} đến ${to} và quay về ca mặc định của công ty. Bảng công đã tính của những ngày đó không thay đổi.`}
        confirmText="Xoá phân ca"
        danger
        loading={clear.isPending}
        onCancel={() => setClearOpen(false)}
        onConfirm={() => void clearAssignments()}
      />
    </Drawer>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p className="sf-body-sm sf-text-variant" style={{ margin: '4px 0 0' }}>
      {children}
    </p>
  );
}
