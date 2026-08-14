import { useState } from 'react';
import {
  Alert,
  Button,
  DatePicker,
  Input,
  InputNumber,
  Modal,
  Select,
  Switch,
  TimePicker,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DataTable } from '@/components/DataTable';
import { StatusBadge } from '@/components/StatusBadge';
import { Icon } from '@/components/Icon';
import { useCan } from '@/lib/rbac/Can';
import { useAuth } from '@/lib/auth/auth-context';
import { WEEKDAYS } from '@/config/constants';
import { formatDay, toWorkDate } from '@/lib/utils/date';
import { dayjs, toDayjs, type Dayjs } from '@/lib/utils/dayjs';
import { useDeleteShift, useShifts, useUpsertShift, type Shift } from '../policy.api';
import { ConfirmDialog, Field, useToast } from '@/components/ui';
import { useErrorToast } from '@/lib/errors/use-error-toast';

/**
 * Ca làm việc — docs/04 mục 6.1.
 *
 * Hai trường mà bỏ qua là sai lương, nên giao diện nói rõ ý nghĩa của chúng:
 *
 *   `crossesMidnight` — ca đêm 22:00 → 06:00 gắn với NGÀY BẮT ĐẦU ca, không phải
 *   ngày của timestamp chấm ra. Quên tích ô này thì một ca đêm bị tách thành hai
 *   ngày công dở dang.
 *
 *   `effectiveFrom` — đổi giờ ca không ghi đè bản cũ mà tạo hiệu lực mới từ một
 *   mốc. Bảng công của những ngày trước mốc đó vẫn tính theo giờ cũ.
 */
export function ShiftsTab() {
  const { timezone } = useAuth();
  const toast = useToast();
  const showError = useErrorToast();
  const canEdit = useCan('policy.edit');

  const shifts = useShifts();
  const remove = useDeleteShift();
  const [editing, setEditing] = useState<Partial<Shift> | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Shift | null>(null);

  const columns: ColumnsType<Shift> = [
    {
      title: 'Tên ca',
      key: 'name',
      width: 200,
      render: (_, row) => (
        <div>
          <div className="sf-body-md" style={{ fontWeight: 600 }}>
            {row.name}
          </div>
          {row.isDefault ? (
            <StatusBadge tone="teal" soft>
              Ca mặc định
            </StatusBadge>
          ) : null}
        </div>
      ),
    },
    {
      title: 'Giờ làm',
      key: 'time',
      width: 180,
      render: (_, row) =>
        row.type === 'FLEXIBLE' ? (
          <span>Linh hoạt · đủ {Math.round((row.requiredMinutes ?? 0) / 60)}h/ngày</span>
        ) : (
          <span>
            {row.startTime ?? '—'} – {row.endTime ?? '—'}
            {row.crossesMidnight ? (
              <StatusBadge tone="warning" soft>
                Qua đêm
              </StatusBadge>
            ) : null}
          </span>
        ),
    },
    {
      title: 'Nghỉ giữa ca',
      dataIndex: 'breakMinutes',
      key: 'break',
      width: 120,
      align: 'right',
      render: (value: number) => (value > 0 ? `${value} phút` : '—'),
    },
    {
      title: 'Trễ cho phép',
      dataIndex: 'lateToleranceMinutes',
      key: 'late',
      width: 130,
      align: 'right',
      render: (value: number) => `${value} phút`,
    },
    {
      title: 'Ngày áp dụng',
      dataIndex: 'weekdayMask',
      key: 'weekday',
      width: 200,
      render: (mask: number) =>
        mask === 0 ? (
          'Mọi ngày'
        ) : (
          <div style={{ display: 'flex', gap: 4 }}>
            {WEEKDAYS.filter((day) => (mask & day.mask) !== 0).map((day) => (
              <StatusBadge key={day.mask} tone="neutral" soft>
                {day.label}
              </StatusBadge>
            ))}
          </div>
        ),
    },
    {
      title: 'Hiệu lực',
      key: 'effective',
      width: 200,
      render: (_, row) =>
        `${formatDay(row.effectiveFrom, timezone)} → ${row.effectiveTo ? formatDay(row.effectiveTo, timezone) : 'không thời hạn'}`,
    },
    ...(canEdit
      ? [
          {
            title: '',
            key: 'actions',
            width: 140,
            render: (_: unknown, row: Shift) => (
              <div style={{ display: 'flex', gap: 8 }}>
                <Button size="small" onClick={() => setEditing(row)}>
                  Sửa
                </Button>
                <Button size="small" type="text" danger onClick={() => setDeleteTarget(row)}>
                  Xoá
                </Button>
              </div>
            ),
          } as ColumnsType<Shift>[number],
        ]
      : []),
  ];

  return (
    <div>
      {canEdit ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
          <Button
            type="primary"
            icon={<Icon name="add" size={20} />}
            onClick={() =>
              setEditing({
                type: 'FIXED',
                startTime: '08:00',
                endTime: '17:30',
                breakMinutes: 60,
                lateToleranceMinutes: 5,
                earlyLeaveToleranceMinutes: 0,
                weekdayMask: 31,
                crossesMidnight: false,
              })
            }
          >
            Thêm ca làm việc
          </Button>
        </div>
      ) : null}

      <DataTable<Shift>
        rowKey="id"
        data={shifts.data}
        isLoading={shifts.isLoading}
        error={shifts.error}
        onRetry={() => void shifts.refetch()}
        columns={columns}
        pagination={false}
        emptyIcon="schedule"
        emptyTitle="Chưa có ca làm việc nào"
        emptyDescription="Tạo ít nhất một ca hành chính và đánh dấu là ca mặc định. Nhân viên không được phân ca cụ thể sẽ dùng ca này để tính công."
        emptyAction={
          canEdit ? (
            <Button
              type="primary"
              onClick={() =>
                setEditing({
                  name: 'Hành chính',
                  type: 'FIXED',
                  startTime: '08:00',
                  endTime: '17:30',
                  breakMinutes: 60,
                  lateToleranceMinutes: 5,
                  isDefault: true,
                  weekdayMask: 31,
                })
              }
            >
              Tạo ca hành chính
            </Button>
          ) : undefined
        }
      />

      <ShiftFormModal shift={editing} onClose={() => setEditing(null)} />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={`Xoá ca "${deleteTarget?.name ?? ''}"?`}
        message="Nhân viên đang được phân ca này sẽ chuyển về ca mặc định của công ty. Bảng công đã tính không thay đổi."
        confirmText="Xoá ca"
        danger
        loading={remove.isPending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await remove.mutateAsync(deleteTarget.id);
            toast.success('Đã xoá ca làm việc');
            setDeleteTarget(null);
          } catch (caught) {
            showError(caught);
          }
        }}
      />
    </div>
  );
}

function ShiftFormModal({ shift, onClose }: { shift: Partial<Shift> | null; onClose: () => void }) {
  const toast = useToast();
  const showError = useErrorToast();
  const upsert = useUpsertShift();
  const [draft, setDraft] = useState<Partial<Shift>>({});

  const value = { ...shift, ...draft };
  const isFlexible = value.type === 'FLEXIBLE';

  function patch(next: Partial<Shift>) {
    setDraft((prev) => ({ ...prev, ...next }));
  }

  function toggleWeekday(mask: number) {
    const current = value.weekdayMask ?? 0;
    patch({ weekdayMask: (current & mask) !== 0 ? current & ~mask : current | mask });
  }

  return (
    <Modal
      open={Boolean(shift)}
      onCancel={onClose}
      title={shift?.id ? `Sửa ca · ${shift.name}` : 'Thêm ca làm việc'}
      okText="Lưu"
      cancelText="Huỷ bỏ"
      okButtonProps={{ loading: upsert.isPending, disabled: !value.name }}
      width={640}
      destroyOnClose
      afterOpenChange={(open) => {
        if (open) setDraft({});
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
      <div style={{ display: 'grid', gap: 16 }}>
        <Field label="Tên ca" htmlFor="s-name">
          <Input
            id="s-name"
            value={value.name ?? ''}
            onChange={(event) => patch({ name: event.target.value })}
            placeholder="Hành chính"
          />
        </Field>

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
            <p className="sf-body-sm sf-text-variant" style={{ margin: '4px 0 0' }}>
              Ca linh hoạt không tính đi muộn — chỉ tính đủ hay thiếu giờ.
            </p>
          </Field>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Field label="Giờ vào" htmlFor="s-start">
                <TimePicker
                  id="s-start"
                  format="HH:mm"
                  style={{ width: '100%' }}
                  value={parseTime(value.startTime)}
                  onChange={(time) => patch({ startTime: time?.format('HH:mm') ?? null })}
                />
              </Field>
              <Field label="Giờ ra" htmlFor="s-end">
                <TimePicker
                  id="s-end"
                  format="HH:mm"
                  style={{ width: '100%' }}
                  value={parseTime(value.endTime)}
                  onChange={(time) => patch({ endTime: time?.format('HH:mm') ?? null })}
                />
              </Field>
            </div>

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
                  Ca kết thúc vào ngày hôm sau
                </div>
                <div className="sf-body-sm sf-text-variant">
                  Bật cho ca đêm (VD 22:00 → 06:00). Bảng công gắn với ngày BẮT ĐẦU ca, không phải
                  ngày chấm ra.
                </div>
              </div>
              <Switch
                checked={Boolean(value.crossesMidnight)}
                onChange={(checked) => patch({ crossesMidnight: checked })}
                aria-label="Ca qua đêm"
              />
            </div>
          </>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
          <Field label="Nghỉ giữa ca" htmlFor="s-break">
            <InputNumber
              id="s-break"
              style={{ width: '100%' }}
              min={0}
              addonAfter="phút"
              value={value.breakMinutes ?? 0}
              onChange={(minutes) => patch({ breakMinutes: minutes ?? 0 })}
            />
          </Field>
          <Field label="Trễ cho phép" htmlFor="s-late">
            <InputNumber
              id="s-late"
              style={{ width: '100%' }}
              min={0}
              addonAfter="phút"
              value={value.lateToleranceMinutes ?? 0}
              onChange={(minutes) => patch({ lateToleranceMinutes: minutes ?? 0 })}
            />
          </Field>
          <Field label="Về sớm cho phép" htmlFor="s-early">
            <InputNumber
              id="s-early"
              style={{ width: '100%' }}
              min={0}
              addonAfter="phút"
              value={value.earlyLeaveToleranceMinutes ?? 0}
              onChange={(minutes) => patch({ earlyLeaveToleranceMinutes: minutes ?? 0 })}
            />
          </Field>
        </div>

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
          <p className="sf-body-sm sf-text-variant" style={{ margin: '4px 0 0' }}>
            Không chọn ngày nào = áp dụng cho mọi ngày.
          </p>
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
              Đặt làm ca mặc định của công ty
            </div>
            <div className="sf-body-sm sf-text-variant">
              Áp dụng cho nhân viên chưa được phân ca cụ thể.
            </div>
          </div>
          <Switch
            checked={Boolean(value.isDefault)}
            onChange={(checked) => patch({ isDefault: checked })}
            aria-label="Ca mặc định"
          />
        </div>
      </div>
    </Modal>
  );
}

function parseTime(value: string | null | undefined): Dayjs | null {
  return value ? dayjs(value, 'HH:mm') : null;
}
