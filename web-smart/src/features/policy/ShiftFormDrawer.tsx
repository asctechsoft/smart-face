import { useState, type ReactNode } from 'react';
import { Button as AntButton, Input, InputNumber, Switch, TimePicker } from 'antd';
import { Button, Drawer, Field, useToast } from '@/components/ui';
import { useAuth } from '@/lib/auth/auth-context';
import { useErrorToast } from '@/lib/errors/use-error-toast';
import { dayjs, type Dayjs } from '@/lib/utils/dayjs';
import { todayWorkDate } from '@/lib/utils/date';
import { useHolidays, useUpsertShift, type Shift } from './policy.api';
import { estimateWorkMinutes, formatHours, resolveBreakMinutes } from './shift-hours';
import { Icon } from '@/components/ui';

/**
 * Thiết lập ca làm việc — FR-WEB-POL-04, dùng cho cả THÊM và SỬA.
 *
 * ## Vì sao là drawer bên phải, không phải hộp thoại giữa màn hình
 *
 * Người dùng sửa ca trong lúc đang đọc bảng danh mục: "ca chiều lệch 30 phút so
 * với ca sáng" là thứ chỉ thấy khi hai dòng còn nằm cạnh nhau. Hộp thoại giữa
 * màn hình che mất chính bảng đó. Drawer giữ bảng ở lại bên trái.
 *
 * ## Biểu mẫu chỉ có đúng những trường trong thiết kế
 *
 * Không có ngăn "nâng cao". Những cột không xuất hiện ở đây vẫn tồn tại trong
 * cơ sở dữ liệu và vẫn được gửi lên nguyên vẹn khi sửa (`value` là
 * `{...shift, ...draft}`), nên mở một ca ra sửa tên KHÔNG xoá cấu hình cũ của
 * nó. Điều mất đi là khả năng ĐỔI chúng từ màn này:
 *
 *   `weekdayMask`, `departmentIds`, `isDefault`, `workDayCredit`,
 *   `requireCheckOut`, `type` — ca mới nhận giá trị mặc định của `NEW_SHIFT`
 *   (T2–T6, mọi phòng ban, không phải ca mặc định, 1 ngày công, có chấm ra, ca
 *   cố định). Ca mặc định của công ty hiện chỉ đặt được ở wizard thiết lập ban
 *   đầu.
 *
 * Hai cột thì KHÔNG thể để mặc kệ, nên chúng được suy ra thay vì hỏi:
 *
 *   `crossesMidnight` — suy từ giờ ca (xem `spansMidnight`). Ca đêm tính vào
 *   NGÀY BẮT ĐẦU; khai sai là một ca bị tách thành hai ngày công dở dang.
 *
 *   `effectiveFrom` — luôn là HÔM NAY. Backend đóng bản ca hiện tại tại mốc này
 *   rồi mở bản kế nhiệm từ đó, nên gửi lại mốc cũ sẽ khiến giờ ca mới có hiệu
 *   lực ngược về quá khứ và bảng công đã chốt bị tính lệch.
 */
export function ShiftFormDrawer({
  shift,
  onClose,
}: {
  shift: Partial<Shift> | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const showError = useErrorToast();
  const upsert = useUpsertShift();
  const { timezone } = useAuth();
  const holidays = useHolidays(dayjs().year());

  const [draft, setDraft] = useState<Partial<Shift>>({});
  const [showHolidayOverrides, setShowHolidayOverrides] = useState(false);
  /*
   * Hệ số ngày lễ trước khi người dùng tắt công tắc "Áp dụng ngày lễ".
   *
   * Tắt rồi bật lại phải trả về đúng con số cũ. Không nhớ thì mỗi lần bật lại là
   * một lần rơi về mặc định 3.0, và người đã khai 2.5 mất con số của mình chỉ vì
   * lỡ tay chạm công tắc.
   */
  const [holidayFactorMemo, setHolidayFactorMemo] = useState<number | null>(null);

  const value = { ...shift, ...draft };
  const isFlexible = value.type === 'FLEXIBLE';
  const requireCheckOut = value.requireCheckOut ?? true;

  const crossesMidnight = spansMidnight(value.startTime, value.endTime);
  const workMinutes = estimateWorkMinutes(value);
  const breakMinutes = resolveBreakMinutes(value);
  const overrides = value.holidayFactors ?? [];

  const normalFactor = Number(value.normalDayFactor ?? 1);
  const holidayFactor = Number(value.holidayFactor ?? 3);
  /*
   * "Áp dụng ngày lễ" KHÔNG phải một cột trong cơ sở dữ liệu — `Shift` chỉ có
   * `holidayFactor`. Công tắc là lối tắt trên chính cột đó: bật = ngày lễ có hệ
   * số riêng, tắt = ngày lễ tính như ngày thường (`holidayFactor` bằng
   * `normalDayFactor`). Thêm một cột boolean nữa sẽ mở ra trạng thái thứ ba
   * "tắt nhưng hệ số vẫn 3.0", và không ai đoán được lúc đó lương tính kiểu gì.
   */
  const holidayEnabled = holidayFactor !== normalFactor;

  function patch(next: Partial<Shift>) {
    setDraft((prev) => ({ ...prev, ...next }));
  }

  function toggleHoliday(enabled: boolean) {
    if (enabled) {
      const restored = holidayFactorMemo ?? 3;
      patch({ holidayFactor: restored === normalFactor ? normalFactor + 1 : restored });
      return;
    }
    setHolidayFactorMemo(holidayFactor);
    // Bỏ luôn ngoại lệ từng ngày: giữ lại thì bảng danh mục vẫn hiện "+2 ngày lễ
    // đặt riêng" trên một ca vừa được khai là không áp dụng ngày lễ.
    patch({ holidayFactor: normalFactor, holidayFactors: [] });
  }

  function setOverride(holidayId: string, factor: number | null) {
    patch({
      holidayFactors:
        factor === null
          ? overrides.filter((row) => row.holidayId !== holidayId)
          : [...overrides.filter((row) => row.holidayId !== holidayId), { holidayId, factor }],
    });
  }

  const canSave = Boolean(
    value.name?.trim() &&
    value.code?.trim() &&
    value.symbol?.trim() &&
    (isFlexible || (value.startTime && value.endTime)),
  );

  async function save() {
    try {
      await upsert.mutateAsync({
        ...value,
        /*
         * Ca qua đêm suy ra từ chính giờ ca, không hỏi lại người dùng: giờ kết
         * thúc không lớn hơn giờ bắt đầu thì ca chạy sang ngày hôm sau, không có
         * cách hiểu nào khác. Ô tích cũ chỉ tạo thêm một chỗ để quên, và quên nó
         * là một ca đêm bị tách thành hai ngày công dở dang.
         */
        crossesMidnight: !isFlexible && crossesMidnight,
        /*
         * Hiệu lực luôn tính từ HÔM NAY. Backend đóng bản ca hiện tại tại mốc
         * này rồi mở bản kế nhiệm từ đó (`createSuccessorShift`), nên gửi lại
         * mốc cũ của ca sẽ khiến giờ ca mới có hiệu lực NGƯỢC VỀ QUÁ KHỨ và
         * bảng công đã chốt bị tính lệch.
         */
        effectiveFrom: todayWorkDate(timezone),
      });
      toast.success('Đã lưu ca làm việc');
      onClose();
    } catch (caught) {
      showError(caught);
    }
  }

  function close() {
    setDraft({});
    setShowHolidayOverrides(false);
    setHolidayFactorMemo(null);
    onClose();
  }

  return (
    <Drawer
      open={Boolean(shift)}
      onClose={close}
      title="Thiết lập ca làm việc"
      width={640}
      footer={
        <>
          <AntButton onClick={close}>Hủy</AntButton>
          <Button variant="action" loading={upsert.isPending} disabled={!canSave} onClick={save}>
            Lưu ca làm việc
          </Button>
        </>
      }
    >
      <Row>
        <Field label="Mã ca" htmlFor="s-code" required>
          <Input
            id="s-code"
            value={value.code ?? ''}
            onChange={(event) => patch({ code: event.target.value.toUpperCase() })}
            placeholder="HC01"
          />
        </Field>
        <Field label="Tên ca" htmlFor="s-name" required>
          <Input
            id="s-name"
            value={value.name ?? ''}
            onChange={(event) => patch({ name: event.target.value })}
            placeholder="Hành chính"
          />
        </Field>
      </Row>

      {/*
        Bắt buộc theo thiết kế, dù cột `symbol` cho phép rỗng. Ký hiệu là thứ
        NGƯỜI ĐỌC bảng chấm công nhìn thấy — một ca không có ký hiệu hiện ra
        thành ô "—" giữa bảng, và người ký duyệt không biết ô đó là ca gì.
      */}
      <Field
        label="Ký hiệu chấm công"
        htmlFor="s-symbol"
        required
        hint="Ký hiệu in trên bảng chấm công. Nhiều ca dùng chung một ký hiệu cũng được."
      >
        <Input
          id="s-symbol"
          maxLength={4}
          value={value.symbol ?? ''}
          onChange={(event) => patch({ symbol: event.target.value.toUpperCase() })}
          placeholder="HC"
          style={{ width: 96, textAlign: 'center', fontWeight: 600 }}
        />
      </Field>

      {isFlexible ? (
        <Field
          label="Số phút phải làm mỗi ngày"
          htmlFor="s-required"
          hint="Ca linh hoạt không tính đi muộn — chỉ tính đủ hay thiếu giờ."
        >
          <InputNumber
            id="s-required"
            style={{ width: '100%' }}
            min={0}
            addonAfter="phút"
            value={value.requiredMinutes ?? 480}
            onChange={(minutes) => patch({ requiredMinutes: minutes ?? 480 })}
          />
        </Field>
      ) : (
        <>
          <Row>
            <Field label="Giờ bắt đầu làm việc" htmlFor="s-start" required>
              <TimeField
                id="s-start"
                value={value.startTime}
                onChange={(time) => patch({ startTime: time })}
              />
            </Field>
            <Field label="Giờ kết thúc làm việc" htmlFor="s-end" required>
              <TimeField
                id="s-end"
                value={value.endTime}
                onChange={(time) => patch({ endTime: time })}
              />
            </Field>
          </Row>

          {/* Số giờ công là ô CHỈ ĐỌC nhưng phải nhìn thấy ngay lúc gõ: một ca
              08:00–17:30 khai nhầm nghỉ trưa 3 tiếng chỉ lộ ra ở con số này. */}
          <Hint>
            Giờ công: <strong>{formatHours(workMinutes)}</strong>
            {breakMinutes > 0 ? ` (đã trừ ${breakMinutes} phút nghỉ)` : ''}
            {crossesMidnight ? ' · ca qua đêm, tính vào ngày bắt đầu' : ''}
          </Hint>

          <Row>
            <Field label="Bắt đầu được chấm vào" htmlFor="s-ci-from">
              <TimeField
                id="s-ci-from"
                value={value.checkInFrom}
                onChange={(time) => patch({ checkInFrom: time })}
              />
            </Field>
            <Field label="Kết thúc được chấm vào" htmlFor="s-ci-to">
              <TimeField
                id="s-ci-to"
                value={value.checkInTo}
                onChange={(time) => patch({ checkInTo: time })}
              />
            </Field>
          </Row>

          <Row>
            <Field label="Bắt đầu được chấm ra" htmlFor="s-co-from">
              <TimeField
                id="s-co-from"
                value={value.checkOutFrom}
                onChange={(time) => patch({ checkOutFrom: time })}
              />
            </Field>
            <Field label="Kết thúc được chấm ra" htmlFor="s-co-to">
              <TimeField
                id="s-co-to"
                value={value.checkOutTo}
                onChange={(time) => patch({ checkOutTo: time })}
              />
            </Field>
          </Row>

          <Hint>
            Bỏ trống một khung giờ = chấp nhận chấm bất kỳ lúc nào trong ngày.
            {requireCheckOut
              ? ''
              : ' Ca này đang được đặt là KHÔNG yêu cầu chấm ra, nên khung giờ ra không được dùng tới.'}
          </Hint>

          <GroupBox title="Nghỉ trưa">
            <Row>
              <Field label="Bắt đầu nghỉ trưa" htmlFor="s-break-start">
                <TimeField
                  id="s-break-start"
                  value={value.breakStart}
                  onChange={(time) => patch({ breakStart: time })}
                />
              </Field>
              <Field label="Kết thúc nghỉ trưa" htmlFor="s-break-end">
                <TimeField
                  id="s-break-end"
                  value={value.breakEnd}
                  onChange={(time) => patch({ breakEnd: time })}
                />
              </Field>
            </Row>
            <Hint>
              Khoảng nghỉ bị trừ khỏi giờ công. Ca không có nghỉ giữa ca thì bỏ trống cả hai ô.
            </Hint>
          </GroupBox>
        </>
      )}

      <GroupBox title="Hệ số tính công">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          <Field label="Ngày thường" htmlFor="s-f-normal" required>
            <FactorInput
              id="s-f-normal"
              value={normalFactor}
              onChange={(next) => patch({ normalDayFactor: next })}
            />
          </Field>
          <Field label="Ngày nghỉ" htmlFor="s-f-week" required>
            <FactorInput
              id="s-f-week"
              value={Number(value.weeklyRestFactor ?? 2)}
              onChange={(next) => patch({ weeklyRestFactor: next })}
            />
          </Field>
          <Field label="Ngày lễ" htmlFor="s-f-holiday" required>
            <FactorInput
              id="s-f-holiday"
              value={holidayFactor}
              disabled={!holidayEnabled}
              onChange={(next) => patch({ holidayFactor: next })}
            />
          </Field>
        </div>
        {/* Nói thẳng ra giới hạn hiện tại thay vì để người dùng tự phát hiện khi
            đối chiếu bảng lương — docs/06 mục 6.5. */}
        <Hint>Hệ số được lưu và hiển thị, nhưng máy tính công chưa đọc tới.</Hint>
      </GroupBox>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div>
          <div className="sf-body-md" style={{ fontWeight: 600 }}>
            Áp dụng ngày lễ
          </div>
          <div className="sf-body-sm sf-text-variant">
            Tắt thì ngày lễ tính như ngày thường (hệ số {normalFactor.toFixed(1)}).
          </div>
        </div>
        <Switch checked={holidayEnabled} onChange={toggleHoliday} aria-label="Áp dụng ngày lễ" />
      </div>

      {holidayEnabled ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 16px',
            borderRadius: 12,
            background: 'var(--sf-blue-50)',
          }}
        >
          <Icon name="calendar_month" size={20} />
          <span style={{ flex: 1 }}>
            Ngày lễ công ty:{' '}
            <strong>{holidays.isLoading ? '…' : `${(holidays.data ?? []).length} ngày`}</strong>
          </span>
          {/* Mở danh sách NGAY TẠI CHỖ chứ không dẫn sang trang Thiết lập: rời
              drawer lúc này là mất trắng những gì vừa gõ. */}
          <button
            type="button"
            className="sf-link"
            aria-expanded={showHolidayOverrides}
            onClick={() => setShowHolidayOverrides((open) => !open)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', font: 'inherit' }}
          >
            {showHolidayOverrides ? 'Thu gọn' : 'Xem chi tiết'}
          </button>
        </div>
      ) : null}

      {holidayEnabled && showHolidayOverrides ? (
        <HolidayOverrides
          holidays={holidays.data ?? []}
          loading={holidays.isLoading}
          defaultFactor={holidayFactor}
          overrides={overrides}
          onChange={setOverride}
        />
      ) : null}
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
//  Mảnh dùng lại trong form
// ---------------------------------------------------------------------------

/** Hai ô cạnh nhau — nhịp hai cột của thiết kế. */
function Row({ children }: { children: ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>{children}</div>;
}

/** Cụm có viền và tiêu đề — "Nghỉ trưa", "Hệ số tính công" trong thiết kế. */
function GroupBox({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      style={{
        display: 'grid',
        gap: 12,
        padding: 16,
        borderRadius: 12,
        border: '1px solid var(--sf-outline-variant)',
      }}
    >
      <h3 className="sf-body-md" style={{ margin: 0, fontWeight: 600 }}>
        {title}
      </h3>
      {children}
    </section>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return (
    <p className="sf-body-sm sf-text-variant" style={{ margin: 0 }}>
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

function FactorInput({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <InputNumber
      id={id}
      style={{ width: '100%' }}
      min={0}
      max={10}
      step={0.1}
      disabled={disabled}
      value={value}
      onChange={(next) => onChange(next ?? 0)}
    />
  );
}

/**
 * Bảng ngoại lệ hệ số theo từng ngày lễ.
 *
 * Mỗi dòng mặc định "dùng hệ số chung" và chỉ thành ngoại lệ khi người dùng bật
 * công tắc. Nhờ vậy danh sách gửi lên Backend chỉ chứa những ngày thật sự khác —
 * lưu cả 12 dòng bằng nhau thì sau này đổi hệ số chung sẽ không ngày nào đổi
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
    return <Hint>Chưa khai báo ngày lễ nào trong năm nay. Thêm ở Thiết lập → Ngày nghỉ lễ.</Hint>;
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

/**
 * Ca có chạy sang ngày hôm sau không.
 *
 * Giờ kết thúc KHÔNG lớn hơn giờ bắt đầu thì ca vắt qua nửa đêm — "22:00 →
 * 06:00" không còn cách hiểu nào khác. Cùng công thức mà `spanMinutes` trong
 * `shift-hours.ts` dùng để tính giờ công, nên hai nơi không thể lệch nhau.
 */
function spansMidnight(start: string | null | undefined, end: string | null | undefined): boolean {
  if (!start || !end) return false;
  return toMinutes(end) <= toMinutes(start);
}

function toMinutes(value: string): number {
  const [hh = '0', mm = '0'] = value.split(':');
  return Number(hh) * 60 + Number(mm);
}
