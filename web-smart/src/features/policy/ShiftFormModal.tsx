import { useState } from 'react';
import { Alert, Input, InputNumber, Modal, Select, Switch, TimePicker } from 'antd';
import { Field, useToast } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { StatusBadge } from '@/components/StatusBadge';
import { WEEKDAYS } from '@/config/constants';
import { useErrorToast } from '@/lib/errors/use-error-toast';
import { useDepartments } from '@/features/shared/org.api';
import { dayjs, toDayjs, type Dayjs } from '@/lib/utils/dayjs';
import { toWorkDate } from '@/lib/utils/date';
import { DatePicker } from 'antd';
import { useHolidays, useUpsertShift, type Shift } from './policy.api';
import { estimateWorkMinutes, formatHours, resolveBreakMinutes } from './shift-hours';

/**
 * Danh mục ca — FR-WEB-POL-04.
 *
 * Form dài nên chia thành các cụm có tiêu đề, theo đúng thứ tự người dùng nghĩ:
 * ca này là ca gì → chạy từ mấy giờ tới mấy giờ → chấm công thế nào → tính bao
 * nhiêu công → áp dụng cho ai, từ bao giờ.
 *
 * Hai chỗ cố ý KHÔNG cho sửa, và cả hai đều có lý do nằm ngoài giao diện:
 *
 *   `Số giờ công` — suy ra từ giờ ca trừ giờ nghỉ. Cho gõ tay là mở đường cho
 *   một ca 08:00–17:30 mang số giờ công 10h mà không ai phát hiện.
 *
 *   `Yêu cầu chấm vào` — BR-ATT-02. Không có giờ vào thì không có gì để tính
 *   giờ công, và ngày đó rơi vào "thiếu bản ghi" chứ không phải "đi làm đủ".
 */
export function ShiftFormModal({
  shift,
  onClose,
}: {
  shift: Partial<Shift> | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const showError = useErrorToast();
  const upsert = useUpsertShift();
  const departments = useDepartments();
  const holidays = useHolidays(dayjs().year());

  const [draft, setDraft] = useState<Partial<Shift>>({});
  const [showHolidayOverrides, setShowHolidayOverrides] = useState(false);

  const value = { ...shift, ...draft };
  const isFlexible = value.type === 'FLEXIBLE';
  const hasBreak = Boolean(value.breakStart && value.breakEnd);

  const workMinutes = estimateWorkMinutes(value);
  const breakMinutes = resolveBreakMinutes(value);
  const overrides = value.holidayFactors ?? [];

  function patch(next: Partial<Shift>) {
    setDraft((prev) => ({ ...prev, ...next }));
  }

  function toggleWeekday(mask: number) {
    const current = value.weekdayMask ?? 0;
    patch({ weekdayMask: (current & mask) !== 0 ? current & ~mask : current | mask });
  }

  function setOverride(holidayId: string, factor: number | null) {
    patch({
      holidayFactors:
        factor === null
          ? overrides.filter((row) => row.holidayId !== holidayId)
          : [...overrides.filter((row) => row.holidayId !== holidayId), { holidayId, factor }],
    });
  }

  const canSave = Boolean(value.name?.trim() && value.code?.trim());

  return (
    <Modal
      open={Boolean(shift)}
      onCancel={onClose}
      title={shift?.id ? `Sửa ca · ${shift.name}` : 'Thêm ca làm việc'}
      okText="Lưu"
      cancelText="Huỷ bỏ"
      okButtonProps={{ loading: upsert.isPending, disabled: !canSave }}
      width={760}
      destroyOnClose
      afterOpenChange={(open) => {
        if (open) {
          setDraft({});
          setShowHolidayOverrides(false);
        }
      }}
      onOk={async () => {
        try {
          await upsert.mutateAsync({
            ...value,
            effectiveFrom: value.effectiveFrom ?? new Date().toISOString().slice(0, 10),
          });
          toast.success('Đã lưu ca làm việc');
          onClose();
        } catch (caught) {
          showError(caught);
        }
      }}
    >
      <div style={{ display: 'grid', gap: 24 }}>
        <Section title="Nhận dạng">
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 16 }}>
            <Field label="Tên ca" htmlFor="s-name" required>
              <Input
                id="s-name"
                value={value.name ?? ''}
                onChange={(event) => patch({ name: event.target.value })}
                placeholder="Hành chính"
              />
            </Field>
            <Field label="Mã ca" htmlFor="s-code" required>
              <Input
                id="s-code"
                value={value.code ?? ''}
                onChange={(event) => patch({ code: event.target.value.toUpperCase() })}
                placeholder="HC"
              />
            </Field>
            <Field label="Ký hiệu chấm công" htmlFor="s-symbol">
              <Input
                id="s-symbol"
                value={value.symbol ?? ''}
                onChange={(event) => patch({ symbol: event.target.value })}
                placeholder="X"
              />
            </Field>
          </div>

          <Field label="Phòng ban áp dụng" htmlFor="s-depts">
            <Select
              id="s-depts"
              mode="multiple"
              allowClear
              style={{ width: '100%' }}
              placeholder="Để trống = áp dụng cho mọi phòng ban"
              loading={departments.isLoading}
              value={value.departmentIds ?? []}
              onChange={(ids: string[]) => patch({ departmentIds: ids })}
              options={(departments.data ?? []).map((d) => ({ value: d.id, label: d.name }))}
              filterOption={(input, option) =>
                String(option?.label ?? '')
                  .toLowerCase()
                  .includes(input.toLowerCase())
              }
            />
            <Hint>
              Chỉ dùng để lọc gợi ý ở màn Phân ca, không chặn. Vẫn xếp được ca này cho người phòng
              khác khi cần.
            </Hint>
          </Field>
        </Section>

        <Section title="Giờ ca">
          <Field label="Loại ca" htmlFor="s-type">
            <Select
              id="s-type"
              style={{ width: '100%' }}
              value={value.type ?? 'FIXED'}
              onChange={(type) => patch({ type })}
              options={[
                { value: 'FIXED', label: 'Ca cố định (giờ vào/ra rõ ràng)' },
                { value: 'ROTATING', label: 'Ca xoay / ca kíp' },
                { value: 'FLEXIBLE', label: 'Ca linh hoạt (tính theo tổng giờ)' },
              ]}
            />
          </Field>

          {isFlexible ? (
            <Field label="Số giờ phải làm mỗi ngày" htmlFor="s-required">
              <InputNumber
                id="s-required"
                style={{ width: '100%' }}
                min={0}
                addonAfter="phút"
                value={value.requiredMinutes ?? 480}
                onChange={(minutes) => patch({ requiredMinutes: minutes ?? 480 })}
              />
              <Hint>Ca linh hoạt không tính đi muộn — chỉ tính đủ hay thiếu giờ.</Hint>
            </Field>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.2fr', gap: 16 }}>
                <Field label="Giờ bắt đầu ca" htmlFor="s-start">
                  <TimeField
                    id="s-start"
                    value={value.startTime}
                    onChange={(time) => patch({ startTime: time })}
                  />
                </Field>
                <Field label="Giờ kết thúc ca" htmlFor="s-end">
                  <TimeField
                    id="s-end"
                    value={value.endTime}
                    onChange={(time) => patch({ endTime: time })}
                  />
                </Field>
                <ReadOnlyStat
                  label="Số giờ công"
                  value={formatHours(workMinutes)}
                  note={
                    breakMinutes > 0
                      ? `${formatHours(workMinutes + breakMinutes)} ca − ${breakMinutes} phút nghỉ`
                      : 'Tính từ giờ bắt đầu và giờ kết thúc'
                  }
                />
              </div>

              <ToggleRow
                title="Ca kết thúc vào ngày hôm sau"
                description="Bật cho ca đêm (VD 22:00 → 06:00). Bảng công gắn với ngày BẮT ĐẦU ca, không phải ngày chấm ra."
                checked={Boolean(value.crossesMidnight)}
                onChange={(checked) => patch({ crossesMidnight: checked })}
              />
            </>
          )}
        </Section>

        <Section title="Nghỉ giữa ca">
          <ToggleRow
            title="Có nghỉ giữa ca"
            description="Khoảng nghỉ bị trừ khỏi giờ công và phải nằm trong giờ ca."
            checked={hasBreak}
            onChange={(checked) =>
              patch(
                checked
                  ? { breakStart: '12:00', breakEnd: '13:00' }
                  : { breakStart: null, breakEnd: null, breakMinutes: 0 },
              )
            }
          />

          {hasBreak ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
              <Field label="Bắt đầu nghỉ" htmlFor="s-break-start">
                <TimeField
                  id="s-break-start"
                  value={value.breakStart}
                  onChange={(time) => patch({ breakStart: time })}
                />
              </Field>
              <Field label="Kết thúc nghỉ" htmlFor="s-break-end">
                <TimeField
                  id="s-break-end"
                  value={value.breakEnd}
                  onChange={(time) => patch({ breakEnd: time })}
                />
              </Field>
              <ReadOnlyStat label="Thời gian nghỉ" value={`${breakMinutes} phút`} />
            </div>
          ) : null}
        </Section>

        <Section title="Yêu cầu chấm công">
          <ToggleRow
            title="Yêu cầu chấm vào"
            description="Luôn bắt buộc. Không có giờ vào thì không tính được giờ công, và ngày đó bị ghi là thiếu bản ghi."
            checked
            disabled
            onChange={() => undefined}
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="Chấm vào sớm nhất" htmlFor="s-ci-from">
              <TimeField
                id="s-ci-from"
                value={value.checkInFrom}
                onChange={(time) => patch({ checkInFrom: time })}
              />
            </Field>
            <Field label="Chấm vào muộn nhất" htmlFor="s-ci-to">
              <TimeField
                id="s-ci-to"
                value={value.checkInTo}
                onChange={(time) => patch({ checkInTo: time })}
              />
            </Field>
          </div>
          <Hint>Bỏ trống cả hai = chấp nhận chấm vào bất kỳ lúc nào trong ngày.</Hint>

          <ToggleRow
            title="Yêu cầu chấm ra"
            description="Tắt cho ca chỉ điểm danh đầu giờ, ví dụ buổi đào tạo hay họp đầu ngày."
            checked={value.requireCheckOut ?? true}
            onChange={(checked) => patch({ requireCheckOut: checked })}
          />

          {(value.requireCheckOut ?? true) ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Field label="Chấm ra sớm nhất" htmlFor="s-co-from">
                <TimeField
                  id="s-co-from"
                  value={value.checkOutFrom}
                  onChange={(time) => patch({ checkOutFrom: time })}
                />
              </Field>
              <Field label="Chấm ra muộn nhất" htmlFor="s-co-to">
                <TimeField
                  id="s-co-to"
                  value={value.checkOutTo}
                  onChange={(time) => patch({ checkOutTo: time })}
                />
              </Field>
            </div>
          ) : null}
        </Section>

        <Section title="Ngày công & hệ số">
          <Alert
            type="info"
            showIcon
            message="Hệ số chưa tác động tới bảng công"
            description="Các hệ số dưới đây được lưu và hiển thị, nhưng máy tính công chưa đọc tới. Số liệu kỳ lương hiện tại không thay đổi khi bạn sửa chúng."
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 16 }}>
            <Field label="Số ngày công" htmlFor="s-credit">
              <InputNumber
                id="s-credit"
                style={{ width: '100%' }}
                min={0}
                max={10}
                step={0.5}
                value={value.workDayCredit ?? 1}
                onChange={(next) => patch({ workDayCredit: next ?? 1 })}
              />
            </Field>
            <Field label="Hệ số ngày thường" htmlFor="s-f-normal">
              <FactorInput
                id="s-f-normal"
                value={value.normalDayFactor ?? 1}
                onChange={(next) => patch({ normalDayFactor: next })}
              />
            </Field>
            <Field label="Hệ số ngày nghỉ tuần" htmlFor="s-f-week">
              <FactorInput
                id="s-f-week"
                value={value.weeklyRestFactor ?? 2}
                onChange={(next) => patch({ weeklyRestFactor: next })}
              />
            </Field>
            <Field label="Hệ số ngày lễ" htmlFor="s-f-holiday">
              <FactorInput
                id="s-f-holiday"
                value={value.holidayFactor ?? 3}
                onChange={(next) => patch({ holidayFactor: next })}
              />
            </Field>
          </div>

          <button
            type="button"
            onClick={() => setShowHolidayOverrides((open) => !open)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: 0,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--sf-teal-700)',
              font: 'inherit',
            }}
            aria-expanded={showHolidayOverrides}
          >
            <Icon name={showHolidayOverrides ? 'expand_less' : 'expand_more'} size={20} />
            Thiết lập riêng cho từng ngày lễ
            {overrides.length > 0 ? (
              <StatusBadge tone="teal" soft>
                {overrides.length} ngoại lệ
              </StatusBadge>
            ) : null}
          </button>

          {showHolidayOverrides ? (
            <HolidayOverrides
              holidays={holidays.data ?? []}
              loading={holidays.isLoading}
              defaultFactor={value.holidayFactor ?? 3}
              overrides={overrides}
              onChange={setOverride}
            />
          ) : null}
        </Section>

        <Section title="Áp dụng">
          <Field label="Ngày trong tuần áp dụng">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {WEEKDAYS.map((day) => {
                const selected = ((value.weekdayMask ?? 0) & day.mask) !== 0;
                return (
                  <button
                    key={day.mask}
                    type="button"
                    role="switch"
                    aria-checked={selected}
                    onClick={() => toggleWeekday(day.mask)}
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
            <Hint>Không chọn ngày nào = áp dụng cho mọi ngày.</Hint>
          </Field>

          <Field label="Hiệu lực từ" htmlFor="s-eff">
            <DatePicker
              id="s-eff"
              format="DD/MM/YYYY"
              style={{ width: '100%' }}
              value={toDayjs(value.effectiveFrom?.slice(0, 10))}
              onChange={(date) => patch({ effectiveFrom: toWorkDate(date?.toDate()) ?? undefined })}
            />
            <Alert
              style={{ marginTop: 8 }}
              type="warning"
              showIcon
              message="Đổi giờ ca không ghi đè lịch sử"
              description="Bảng công của những ngày trước mốc hiệu lực vẫn tính theo cấu hình cũ. Đặt mốc vào quá khứ sẽ làm bảng công đã tính bị lệch."
            />
          </Field>

          <ToggleRow
            title="Đặt làm ca mặc định của công ty"
            description="Áp dụng cho nhân viên chưa được phân ca cụ thể."
            checked={Boolean(value.isDefault)}
            onChange={(checked) => patch({ isDefault: checked })}
          />
        </Section>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
//  Mảnh dùng lại trong form
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: 'grid', gap: 16 }}>
      <h3
        className="sf-body-md"
        style={{
          margin: 0,
          fontWeight: 600,
          paddingBottom: 8,
          borderBottom: '1px solid var(--sf-neutral-300)',
        }}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p className="sf-body-sm sf-text-variant" style={{ margin: '4px 0 0' }}>
      {children}
    </p>
  );
}

function TimeField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string | null | undefined;
  onChange: (value: string | null) => void;
}) {
  return (
    <TimePicker
      id={id}
      format="HH:mm"
      minuteStep={5}
      style={{ width: '100%' }}
      value={parseTime(value)}
      onChange={(time) => onChange(time?.format('HH:mm') ?? null)}
    />
  );
}

/**
 * Ô chỉ đọc trông giống ô nhập.
 *
 * Cố ý KHÔNG dùng `<Input disabled>`: ô mờ đi đọc như "chỗ này đang hỏng" hoặc
 * "bạn chưa đủ quyền", trong khi ý nghĩa thật là "con số này luôn đúng vì nó
 * được tính ra". Nền đặc và dòng giải thích bên dưới nói đúng điều đó.
 */
function ReadOnlyStat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <div className="sf-label-md" style={{ marginBottom: 6 }}>
        {label}
      </div>
      <div
        style={{
          height: 38,
          display: 'flex',
          alignItems: 'center',
          paddingInline: 12,
          borderRadius: 8,
          background: 'var(--sf-neutral-100)',
          border: '1px solid var(--sf-neutral-300)',
          fontWeight: 600,
        }}
      >
        {value}
      </div>
      {note ? <Hint>{note}</Hint> : null}
    </div>
  );
}

function FactorInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <InputNumber
      id={id}
      style={{ width: '100%' }}
      min={0}
      max={10}
      step={0.1}
      value={value}
      onChange={(next) => onChange(next ?? 0)}
    />
  );
}

function ToggleRow({
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 16,
        padding: 12,
        background: 'var(--sf-neutral-100)',
        borderRadius: 12,
      }}
    >
      <div>
        <div className="sf-body-md" style={{ fontWeight: 600 }}>
          {title}
        </div>
        <div className="sf-body-sm sf-text-variant">{description}</div>
      </div>
      <Switch checked={checked} disabled={disabled} onChange={onChange} aria-label={title} />
    </div>
  );
}

/**
 * Bảng ngoại lệ hệ số theo từng ngày lễ.
 *
 * Mỗi dòng mặc định "dùng hệ số chung" và chỉ thành ngoại lệ khi người dùng bật
 * công tắc. Nhờ vậy danh sách gửi lên Backend chỉ chứa những ngày thật sự khác —
 * lưu cả 7 dòng bằng nhau thì sau này đổi hệ số chung sẽ không ngày nào đổi
 * theo, mà không ai hiểu tại sao.
 */
function HolidayOverrides({
  holidays,
  loading,
  defaultFactor,
  overrides,
  onChange,
}: {
  holidays: { id: string; name: string; date: string }[];
  loading: boolean;
  defaultFactor: number;
  overrides: { holidayId: string; factor: number }[];
  onChange: (holidayId: string, factor: number | null) => void;
}) {
  if (loading) {
    return <Hint>Đang tải danh sách ngày lễ…</Hint>;
  }
  if (holidays.length === 0) {
    return <Hint>Chưa khai báo ngày lễ nào trong năm nay. Thêm ở tab Ngày lễ trước.</Hint>;
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {holidays.map((holiday) => {
        const override = overrides.find((row) => row.holidayId === holiday.id);
        return (
          <div
            key={holiday.id}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto auto',
              alignItems: 'center',
              gap: 12,
              padding: '8px 12px',
              borderRadius: 8,
              background: 'var(--sf-neutral-100)',
            }}
          >
            <div>
              <div className="sf-body-md">{holiday.name}</div>
              <div className="sf-body-sm sf-text-variant">
                {dayjs(holiday.date).format('DD/MM/YYYY')}
              </div>
            </div>

            {override ? (
              <InputNumber
                min={0}
                max={10}
                step={0.1}
                style={{ width: 110 }}
                value={override.factor}
                onChange={(next) => onChange(holiday.id, next ?? 0)}
                aria-label={`Hệ số riêng cho ${holiday.name}`}
              />
            ) : (
              <span className="sf-body-sm sf-text-variant">Dùng hệ số chung ({defaultFactor})</span>
            )}

            <Switch
              size="small"
              checked={Boolean(override)}
              onChange={(checked) => onChange(holiday.id, checked ? defaultFactor : null)}
              aria-label={`Đặt hệ số riêng cho ${holiday.name}`}
            />
          </div>
        );
      })}
    </div>
  );
}

function parseTime(value: string | null | undefined): Dayjs | null {
  return value ? dayjs(value, 'HH:mm') : null;
}
