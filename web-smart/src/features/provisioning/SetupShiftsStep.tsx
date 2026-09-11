import { useRef, useState, type RefObject } from 'react';
import { useShifts, useUpsertShift, type Shift } from '@/features/policy/policy.api';
import { estimateWorkMinutes, formatHours, resolveBreakMinutes } from '@/features/policy/shift-hours';
import { useErrorToast } from '@/lib/errors/use-error-toast';
import {
  Badge,
  Button,
  CardSkeleton,
  ErrorState,
  Field,
  Icon,
  TextInput,
  useToast,
} from '@/components/ui';

/**
 * Bước 3 của wizard — danh mục ca bên trái, biểu mẫu ca mặc định bên phải
 * (mockup Figma `67:78`).
 *
 * ## Vì sao biểu mẫu ở đây hẹp hơn `ShiftFormDrawer` rất nhiều
 *
 * Hộp thoại chính thức có ~20 trường: ca gãy, ca linh hoạt, hệ số riêng cho
 * từng ngày lễ, mặt nạ ngày áp dụng, mốc hiệu lực. Chúng cần thiết — nhưng
 * KHÔNG phải ở lần khai đầu tiên, khi công ty còn chưa có nhân viên nào để
 * phân ca. Bản vẽ chọn đúng chín trường quyết định một ca hành chính, và những
 * trường còn lại nhận giá trị mặc định hợp lệ ở `BASE`.
 *
 * Đây là chỗ CỐ Ý khác `ShiftCatalogTab`: người dùng vào lại màn Ca làm việc sau này
 * vẫn thấy đủ 20 trường, không mất gì cả.
 */

/** Phần ca hành chính mà bước này không hỏi — mọi giá trị đều hợp lệ ngay. */
const BASE: Partial<Shift> = {
  type: 'FIXED',
  requireCheckIn: true,
  requireCheckOut: true,
  workDayCredit: 1,
  holidayFactors: [],
  departmentIds: [],
  lateToleranceMinutes: 5,
  earlyLeaveToleranceMinutes: 0,
  /** 31 = Thứ 2 → Thứ 6. */
  weekdayMask: 31,
};

const DEFAULT_FORM = {
  code: 'HC01',
  name: 'Hành chính',
  symbol: 'HC',
  startTime: '08:00',
  endTime: '17:30',
  checkInFrom: '07:30',
  checkInTo: '09:00',
  checkOutFrom: '16:30',
  checkOutTo: '19:00',
  breakStart: '12:00',
  breakEnd: '13:00',
  normalDayFactor: '1',
  weeklyRestFactor: '2',
  holidayFactor: '3',
};

export function SetupShiftsStep() {
  const shifts = useShifts();
  const formRef = useRef<HTMLInputElement>(null);

  if (shifts.isPending) return <CardSkeleton height={420} />;
  if (shifts.isError) {
    return (
      <ErrorState
        title="Chưa đọc được danh mục ca làm việc"
        description="Không tải được danh sách ca từ máy chủ. Thử lại sau ít phút."
        onRetry={() => void shifts.refetch()}
      />
    );
  }

  const rows = shifts.data ?? [];

  return (
    <div className="sf-wizard-split sf-wizard-split--narrow-left">
      <section className="sf-card sf-panel" style={{ padding: 0 }}>
        <header className="sf-panel__head">
          <h2 className="sf-title-md">Danh mục ca làm việc</h2>
          <span className="sf-body-sm sf-text-variant">
            {rows.length > 0 ? `${rows.length} ca` : 'Chưa có ca'}
          </span>
        </header>

        {rows.length === 0 ? (
          <div style={{ padding: '32px 20px', textAlign: 'center', display: 'grid', gap: 12 }}>
            <Icon
              name="calendar_month"
              size={32}
              color="var(--sf-on-surface-muted)"
              style={{ margin: '0 auto' }}
            />
            <p className="sf-body-md sf-text-variant" style={{ margin: 0 }}>
              Chưa có ca làm việc nào. Hãy tạo ca đầu tiên để thiết lập khung giờ chấm công của
              công ty.
            </p>
            <div>
              <Button
                variant="primary"
                icon="add"
                onClick={() => formRef.current?.focus()}
              >
                Tạo ca làm việc đầu tiên
              </Button>
            </div>
          </div>
        ) : (
          <ul className="sf-mini-list">
            {rows.map((shift) => (
              <li key={shift.id}>
                <Icon name="schedule" size={20} color="var(--sf-on-surface-muted)" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="sf-body-md" style={{ fontWeight: 600 }}>
                      {shift.name}
                    </span>
                    {shift.isDefault ? (
                      <Badge tone="teal" soft>
                        Mặc định
                      </Badge>
                    ) : null}
                  </div>
                  <div className="sf-body-sm sf-text-variant">
                    {shift.code}
                    {shift.symbol ? ` · ${shift.symbol}` : ''} · {shift.startTime ?? '—'}–
                    {shift.endTime ?? '—'}
                  </div>
                </div>
                <span className="sf-body-sm" style={{ fontWeight: 600 }}>
                  {formatHours(shift.workMinutes)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ShiftForm firstInputRef={formRef} isFirst={rows.length === 0} />
    </div>
  );
}

function ShiftForm({
  firstInputRef,
  isFirst,
}: {
  firstInputRef: RefObject<HTMLInputElement | null>;
  isFirst: boolean;
}) {
  const toast = useToast();
  const showError = useErrorToast();
  const upsert = useUpsertShift();

  const [form, setForm] = useState(DEFAULT_FORM);

  const patch = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  /*
   * Giờ công hiện ngay trong lúc gõ — xem `shift-hours.ts` về việc vì sao công
   * thức được nhân đôi ở phía Web.
   */
  const draft: Partial<Shift> = {
    ...BASE,
    startTime: form.startTime,
    endTime: form.endTime,
    breakStart: form.breakStart || null,
    breakEnd: form.breakEnd || null,
  };
  const workMinutes = estimateWorkMinutes(draft);

  const submit = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    try {
      await upsert.mutateAsync({
        ...BASE,
        code: form.code.trim(),
        name: form.name.trim(),
        symbol: form.symbol.trim() || null,
        startTime: form.startTime,
        endTime: form.endTime,
        checkInFrom: form.checkInFrom || null,
        checkInTo: form.checkInTo || null,
        checkOutFrom: form.checkOutFrom || null,
        checkOutTo: form.checkOutTo || null,
        breakStart: form.breakStart || null,
        breakEnd: form.breakEnd || null,
        breakMinutes: resolveBreakMinutes(draft),
        // Ca vắt qua nửa đêm gắn với NGÀY BẮT ĐẦU ca. Suy ra từ giờ thay vì hỏi:
        // ở một ca hành chính khai lúc khởi tạo, giờ kết thúc nhỏ hơn giờ bắt
        // đầu chỉ có đúng một nghĩa.
        crossesMidnight: form.endTime <= form.startTime,
        normalDayFactor: Number(form.normalDayFactor),
        weeklyRestFactor: Number(form.weeklyRestFactor),
        holidayFactor: Number(form.holidayFactor),
        // Ca đầu tiên là ca mặc định: nhân viên chưa được phân ca cụ thể sẽ tính
        // công theo nó, và không có ca mặc định thì họ không có công nào cả.
        isDefault: isFirst,
        effectiveFrom: new Date().toISOString().slice(0, 10),
      });
      toast.success(`Đã tạo ca "${form.name.trim()}"`);
      // Xoá ba ô định danh: mã ca là DUY NHẤT trong công ty, giữ nguyên "HC01"
      // trong ô rồi bấm lần nữa chỉ nhận về lỗi trùng mã. Giờ giấc và hệ số thì
      // giữ lại — ca thứ hai thường chỉ lệch vài mốc so với ca vừa khai.
      setForm((prev) => ({ ...prev, code: '', name: '', symbol: '' }));
    } catch (error) {
      showError(error);
    }
  };

  return (
    <section className="sf-card sf-panel" style={{ padding: 0 }}>
      <header className="sf-panel__head">
        <h2 className="sf-title-md">{isFirst ? 'Ca làm việc mặc định' : 'Tạo thêm ca làm việc'}</h2>
        <span className="sf-body-sm sf-text-variant">Giờ công: {formatHours(workMinutes)}</span>
      </header>

      <form style={{ padding: 20 }} onSubmit={submit}>
        <div className="sf-form-grid sf-form-grid--3">
          <Field label="Mã ca" required>
            {(field) => (
              <TextInput
                {...field}
                ref={firstInputRef}
                value={form.code}
                onChange={patch('code')}
                required
              />
            )}
          </Field>

          <Field label="Tên ca" required>
            {(field) => <TextInput {...field} value={form.name} onChange={patch('name')} required />}
          </Field>

          <Field label="Ký hiệu" hint="In trên bảng chấm công.">
            {(field) => <TextInput {...field} value={form.symbol} onChange={patch('symbol')} />}
          </Field>
        </div>

        <div className="sf-form-grid" style={{ marginTop: 16 }}>
          <Field label="Bắt đầu" required>
            {(field) => (
              <TextInput
                {...field}
                type="time"
                value={form.startTime}
                onChange={patch('startTime')}
                required
              />
            )}
          </Field>

          <Field label="Kết thúc" required>
            {(field) => (
              <TextInput
                {...field}
                type="time"
                value={form.endTime}
                onChange={patch('endTime')}
                required
              />
            )}
          </Field>
        </div>

        <div className="sf-form-grid" style={{ marginTop: 16 }}>
          <TimeRange
            label="Được chấm vào"
            hint="Chấm ngoài khung này không được ghi nhận là giờ vào."
            from={form.checkInFrom}
            to={form.checkInTo}
            onFrom={patch('checkInFrom')}
            onTo={patch('checkInTo')}
          />

          <TimeRange
            label="Được chấm ra"
            from={form.checkOutFrom}
            to={form.checkOutTo}
            onFrom={patch('checkOutFrom')}
            onTo={patch('checkOutTo')}
          />

          <TimeRange
            label="Nghỉ giữa ca"
            hint="Khoảng nghỉ này bị trừ khỏi giờ công."
            from={form.breakStart}
            to={form.breakEnd}
            onFrom={patch('breakStart')}
            onTo={patch('breakEnd')}
          />
        </div>

        <fieldset
          className="sf-form-section"
          style={{ border: 0, margin: 0, padding: 0, marginTop: 20, paddingTop: 20 }}
        >
          <legend className="sf-title-sm sf-form-section__title">Hệ số ngày công</legend>

          <div className="sf-form-grid sf-form-grid--3">
            <Field label="Ngày thường" required>
              {(field) => (
                <TextInput
                  {...field}
                  type="number"
                  step="0.1"
                  min="0"
                  value={form.normalDayFactor}
                  onChange={patch('normalDayFactor')}
                  required
                />
              )}
            </Field>

            <Field label="Ngày nghỉ" required>
              {(field) => (
                <TextInput
                  {...field}
                  type="number"
                  step="0.1"
                  min="0"
                  value={form.weeklyRestFactor}
                  onChange={patch('weeklyRestFactor')}
                  required
                />
              )}
            </Field>

            <Field label="Ngày lễ" required>
              {(field) => (
                <TextInput
                  {...field}
                  type="number"
                  step="0.1"
                  min="0"
                  value={form.holidayFactor}
                  onChange={patch('holidayFactor')}
                  required
                />
              )}
            </Field>
          </div>

          <div className="sf-banner sf-banner--info" style={{ marginTop: 16 }}>
            <Icon name="info" size={20} color="var(--sf-primary)" />
            <span className="sf-body-sm" style={{ flex: 1 }}>
              Ngày lễ khai riêng ở <strong>Danh mục ngày lễ</strong>, không khai trong ca. Hệ số ở
              đây là hệ số áp cho những ngày đó.
            </span>
          </div>
        </fieldset>

        <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
          <Button
            type="submit"
            variant="primary"
            icon="save"
            loading={upsert.isPending}
            disabled={!form.code.trim() || !form.name.trim()}
          >
            {isFirst ? 'Tạo ca làm việc' : 'Tạo thêm ca'}
          </Button>
        </div>
      </form>
    </section>
  );
}

/** Một khung "từ … đến …" gồm hai ô giờ. */
function TimeRange({
  label,
  hint,
  from,
  to,
  onFrom,
  onTo,
}: {
  label: string;
  hint?: string;
  from: string;
  to: string;
  onFrom: (event: { target: { value: string } }) => void;
  onTo: (event: { target: { value: string } }) => void;
}) {
  return (
    <div className="sf-field">
      {/* Không dùng `Field`: nó nối nhãn vào MỘT ô, còn đây là hai ô ngang hàng. */}
      <span className="sf-field__label">{label}</span>
      <div className="sf-time-range">
        <TextInput type="time" value={from} onChange={onFrom} aria-label={`${label} — từ`} />
        <span className="sf-time-range__dash" aria-hidden="true">
          –
        </span>
        <TextInput type="time" value={to} onChange={onTo} aria-label={`${label} — đến`} />
      </div>
      {hint ? (
        <p className="sf-field__hint" style={{ margin: 0 }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
