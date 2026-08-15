import { useState } from 'react';
import { Button, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DataTable } from '@/components/DataTable';
import { StatusBadge } from '@/components/StatusBadge';
import { Icon } from '@/components/Icon';
import { useCan } from '@/lib/rbac/Can';
import { useAuth } from '@/lib/auth/auth-context';
import { WEEKDAYS } from '@/config/constants';
import { formatDay } from '@/lib/utils/date';
import { useDepartments } from '@/features/shared/org.api';
import { useDeleteShift, useShifts, type Shift } from '../policy.api';
import { ShiftFormModal } from '../ShiftFormModal';
import { formatHours } from '../shift-hours';
import { ConfirmDialog, useToast } from '@/components/ui';
import { useErrorToast } from '@/lib/errors/use-error-toast';

/** Ca mới bắt đầu từ mẫu hành chính — mẫu hay dùng nhất, và hợp lệ ngay. */
const NEW_SHIFT: Partial<Shift> = {
  type: 'FIXED',
  startTime: '08:00',
  endTime: '17:30',
  breakStart: '12:00',
  breakEnd: '13:00',
  breakMinutes: 60,
  requireCheckIn: true,
  requireCheckOut: true,
  workDayCredit: 1,
  normalDayFactor: 1,
  weeklyRestFactor: 2,
  holidayFactor: 3,
  holidayFactors: [],
  departmentIds: [],
  lateToleranceMinutes: 5,
  earlyLeaveToleranceMinutes: 0,
  weekdayMask: 31,
  crossesMidnight: false,
};

/**
 * Danh mục ca làm việc — docs/04 mục 6.1.
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
  const departments = useDepartments();
  const remove = useDeleteShift();
  const [editing, setEditing] = useState<Partial<Shift> | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Shift | null>(null);

  const departmentName = new Map((departments.data ?? []).map((d) => [d.id, d.name]));

  const columns: ColumnsType<Shift> = [
    {
      title: 'Mã · Tên ca',
      key: 'name',
      width: 220,
      render: (_, row) => (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="sf-body-md" style={{ fontWeight: 600 }}>
              {row.name}
            </span>
            {row.isDefault ? (
              <StatusBadge tone="teal" soft>
                Mặc định
              </StatusBadge>
            ) : null}
          </div>
          <div className="sf-body-sm sf-text-variant">
            {row.code ?? '—'}
            {row.symbol ? ` · ký hiệu "${row.symbol}"` : ''}
          </div>
        </div>
      ),
    },
    {
      title: 'Giờ ca',
      key: 'time',
      width: 170,
      render: (_, row) =>
        row.type === 'FLEXIBLE' ? (
          <span>Linh hoạt</span>
        ) : (
          <div>
            <div>
              {row.startTime ?? '—'} – {row.endTime ?? '—'}
            </div>
            {row.crossesMidnight ? (
              <StatusBadge tone="warning" soft>
                Qua đêm
              </StatusBadge>
            ) : null}
          </div>
        ),
    },
    {
      title: 'Giờ công',
      key: 'workHours',
      width: 110,
      align: 'right',
      render: (_, row) => (
        <Tooltip
          title={
            row.breakMinutes > 0
              ? `Đã trừ ${row.breakMinutes} phút nghỉ giữa ca`
              : 'Không có nghỉ giữa ca'
          }
        >
          <span style={{ fontWeight: 600 }}>{formatHours(row.workMinutes)}</span>
        </Tooltip>
      ),
    },
    {
      title: 'Ngày công',
      dataIndex: 'workDayCredit',
      key: 'workDayCredit',
      width: 100,
      align: 'right',
      render: (value: number) => value,
    },
    {
      title: 'Chấm công',
      key: 'checks',
      width: 190,
      render: (_, row) => (
        <div className="sf-body-sm">
          <div>Vào: {formatWindow(row.checkInFrom, row.checkInTo)}</div>
          <div>
            Ra: {row.requireCheckOut ? formatWindow(row.checkOutFrom, row.checkOutTo) : '—'}
          </div>
        </div>
      ),
    },
    {
      title: 'Hệ số (T · N · L)',
      key: 'factors',
      width: 150,
      render: (_, row) => {
        // `?? []` không phải phòng xa vô cớ: TanStack Query hiển thị bản cache cũ
        // TRƯỚC khi lần tải mới về tới nơi. Ngay sau khi Backend được nâng cấp,
        // bản cache đó còn theo hình dạng cũ (chưa có `holidayFactors`), và một
        // lần `.length` trên `undefined` ở đây làm trắng cả trang chứ không chỉ
        // hỏng một ô.
        const overrides = row.holidayFactors ?? [];
        return (
          <Tooltip
            title={`Ngày thường ${row.normalDayFactor} · Nghỉ tuần ${row.weeklyRestFactor} · Ngày lễ ${row.holidayFactor}${
              overrides.length > 0 ? ` · ${overrides.length} ngày lễ đặt riêng` : ''
            }`}
          >
            <span>
              {row.normalDayFactor} · {row.weeklyRestFactor} · {row.holidayFactor}
              {overrides.length > 0 ? (
                <StatusBadge tone="neutral" soft>
                  +{overrides.length}
                </StatusBadge>
              ) : null}
            </span>
          </Tooltip>
        );
      },
    },
    {
      title: 'Phòng ban',
      key: 'departments',
      width: 180,
      render: (_, row) => {
        const ids = row.departmentIds ?? [];
        return ids.length === 0 ? (
          <span className="sf-text-variant">Mọi phòng ban</span>
        ) : (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {ids.map((id) => (
              <StatusBadge key={id} tone="neutral" soft>
                {departmentName.get(id) ?? 'Đã xoá'}
              </StatusBadge>
            ))}
          </div>
        );
      },
    },
    {
      title: 'Ngày áp dụng',
      dataIndex: 'weekdayMask',
      key: 'weekday',
      width: 190,
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
            fixed: 'right' as const,
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
            onClick={() => setEditing({ ...NEW_SHIFT })}
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
        scroll={{ x: 1600 }}
        emptyIcon="schedule"
        emptyTitle="Chưa có ca làm việc nào"
        emptyDescription="Tạo ít nhất một ca hành chính và đánh dấu là ca mặc định. Nhân viên không được phân ca cụ thể sẽ dùng ca này để tính công."
        emptyAction={
          canEdit ? (
            <Button
              type="primary"
              onClick={() =>
                setEditing({ ...NEW_SHIFT, name: 'Hành chính', code: 'HC', isDefault: true })
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
        message="Nhân viên đang được phân ca này sẽ chuyển về ca mặc định của công ty. Bảng công đã tính không thay đổi, và mã ca vẫn được giữ chỗ vì nó đã nằm trên bảng công đã in."
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

/** "07:00–09:00", "từ 07:00", "tới 09:00", hoặc "bất kỳ" khi bỏ trống cả hai. */
function formatWindow(from: string | null, to: string | null): string {
  if (from && to) return `${from}–${to}`;
  if (from) return `từ ${from}`;
  if (to) return `tới ${to}`;
  return 'bất kỳ';
}
