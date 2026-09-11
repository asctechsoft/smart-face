import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Dropdown, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DataTable } from '@/components/DataTable';
import { useCan } from '@/lib/rbac/Can';
import { useAuth } from '@/lib/auth/auth-context';
import { WEEKDAYS } from '@/config/constants';
import { formatDay, todayWorkDate, workDateOf } from '@/lib/utils/date';
import { useDepartments } from '@/features/shared/org.api';
/*
 * Danh mục ca vẽ trên màn "Ca làm & Phân ca", nhưng dữ liệu của nó vẫn là dữ
 * liệu CHÍNH SÁCH: cùng nhóm endpoint `/admin/*`, cùng biểu mẫu mà wizard thiết
 * lập ban đầu dùng. Nên hook và modal vẫn ở `features/policy` — chép chúng sang
 * đây sẽ có hai bản biểu mẫu ca làm việc, và bẫy `effectiveFrom` (docs/06 mục
 * 6.6) chỉ cần một bản quên là đủ sai lương.
 */
import { useDeleteShift, useShifts, type Shift } from '@/features/policy/policy.api';
import { ShiftFormDrawer } from '@/features/policy/ShiftFormDrawer';
import { formatHours } from '@/features/policy/shift-hours';
import { ConfirmDialog, useToast } from '@/components/ui';
import { useErrorToast } from '@/lib/errors/use-error-toast';
import { Badge as StatusBadge, Card, Icon, IconButton, type BadgeTone } from '@/components/ui';
import { ShiftCatalogToolbar } from './ShiftCatalogToolbar';
import { NEW_SHIFT, matchesBranch, matchesKeyword } from './shift-catalog.filters';

/**
 * Tab "Danh mục Ca làm việc" của màn **Ca làm & Phân ca** — docs/06 mục 6.6.
 *
 * ## Vì sao nó rời khỏi trang Thiết lập
 *
 * Danh mục ca và bảng phân ca là HAI NỬA CỦA MỘT VIỆC: khai ca xong là xếp
 * ngay, và lúc xếp mới phát hiện thiếu một ca. Trước đây hai nửa nằm ở hai mục
 * sidenav khác nhau, nên thao tác thật của người dùng là đi đi lại lại giữa
 * "Thiết lập → Danh mục ca" và "Phân ca". Giờ chúng là hai tab cạnh nhau.
 *
 * ## Bảng một dòng, chi tiết nằm trong tooltip
 *
 * Mỗi ô đúng MỘT dòng chữ, theo thiết kế. Những thứ không có cột riêng —
 * phòng ban áp dụng, giờ công, ngày trong tuần, khoảng hiệu lực — không bị bỏ
 * đi mà chuyển vào `title`/tooltip của chính ô mang nó, và vào biểu mẫu khi mở
 * một ca ra. Nhồi thêm dòng phụ vào ô là cách bảng 12 cột biến thành bảng cao
 * gấp đôi mà vẫn phải cuộn ngang.
 *
 * ## Hai trường mà bỏ qua là sai lương
 *
 *   `crossesMidnight` — ca đêm 22:00 → 06:00 gắn với NGÀY BẮT ĐẦU ca, không phải
 *   ngày của timestamp chấm ra. Quên tích ô này thì một ca đêm bị tách thành hai
 *   ngày công dở dang. Chip ký hiệu chuyển tông tím và cột giờ ghi rõ "qua đêm".
 *
 *   `effectiveFrom` — đổi giờ ca không ghi đè bản cũ mà tạo hiệu lực mới từ một
 *   mốc. Bảng công của những ngày trước mốc đó vẫn tính theo giờ cũ. Cột "Trạng
 *   thái" nói ca đang ở giai đoạn nào của vòng đời đó.
 */
export function ShiftCatalogTab() {
  const { timezone } = useAuth();
  const toast = useToast();
  const showError = useErrorToast();
  /*
   * Hai quyền chứ không một: `shift_template.update` là quyền ĐÚNG NGHĨA cho
   * danh mục ca, còn `policy.update` là quyền mà màn hình này gác khi nó còn là
   * một tab của trang Thiết lập. Bỏ vế thứ hai đi là lặng lẽ tước quyền sửa của
   * những vai trò tuỳ biến đang dùng nó.
   */
  const canEditTemplate = useCan('shift_template.update');
  const canEditPolicy = useCan('policy.update');
  const canEdit = canEditTemplate || canEditPolicy;

  const [searchParams, setSearchParams] = useSearchParams();
  const shifts = useShifts();
  const departments = useDepartments();
  const remove = useDeleteShift();
  const [editing, setEditing] = useState<Partial<Shift> | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Shift | null>(null);
  /** Dòng đang chọn — "Chọn một ca để xem hoặc chỉnh sửa" ở đầu trang. */
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const query = searchParams.get('q') ?? '';
  const branchId = searchParams.get('branchId') ?? '';
  const creating = searchParams.get('new') === '1';

  const departmentName = new Map((departments.data ?? []).map((d) => [d.id, d.name]));
  const today = todayWorkDate(timezone);

  /*
   * Nút "Thêm ca làm việc" nằm ở thanh tab (`ShiftsPage`) chứ không trong tab
   * này, nên nó không gọi thẳng `setEditing` được. Nó đặt `?new=1`, và hiệu ứng
   * dưới đây mở biểu mẫu. Cái giá là một `useEffect`; cái được là đường dẫn
   * `/shifts?tab=catalog&new=1` mở thẳng biểu mẫu tạo ca — gửi được cho đồng
   * nghiệp, và là cách wizard thiết lập ban đầu trỏ người dùng sang đây.
   */
  useEffect(() => {
    if (creating && canEdit) setEditing({ ...NEW_SHIFT });
  }, [creating, canEdit]);

  function closeForm() {
    setEditing(null);
    if (!creating) return;
    const next = new URLSearchParams(searchParams);
    next.delete('new');
    setSearchParams(next, { replace: true });
  }

  /*
   * Lọc tại chỗ chứ không gọi lại API: `GET /admin/shifts` trả về TOÀN BỘ danh
   * mục (một công ty có vài chục ca, không phải vài nghìn), nên mỗi ký tự gõ vào
   * ô tìm kiếm mà đi một vòng mạng là chậm hơn chứ không nhanh hơn.
   */
  const visible = useMemo(() => {
    /*
     * ⚠ Chi nhánh KHÔNG phải một trường của ca — `Shift` chỉ có `departmentIds`.
     * Bộ lọc suy ra từ phòng ban: ca hiện lên khi nó áp dụng cho một phòng thuộc
     * chi nhánh đang chọn. Ca "mọi phòng ban" luôn hiện, vì nó thật sự áp dụng
     * cho mọi chi nhánh — bỏ nó đi thì lọc theo chi nhánh sẽ giấu mất chính ca
     * hành chính mặc định.
     */
    const branchDepartments = new Set(
      (departments.data ?? []).filter((d) => d.branchId === branchId).map((d) => d.id),
    );

    return (shifts.data ?? []).filter(
      (shift) => matchesKeyword(shift, query) && matchesBranch(shift, branchId, branchDepartments),
    );
  }, [shifts.data, departments.data, query, branchId]);

  const columns: ColumnsType<Shift> = [
    {
      title: 'Mã ca',
      dataIndex: 'code',
      key: 'code',
      width: 84,
      render: (code: string | null, row) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontWeight: 600 }}>{code ?? '—'}</span>
          {/* Ngôi sao thay cho huy hiệu "Mặc định": cột tên ca chỉ rộng 116px,
              một huy hiệu ở đó đẩy tên xuống dòng hai và làm dòng cao gấp rưỡi.
              Có `label` nên trình đọc màn hình vẫn đọc ra nghĩa, không phải một
              dấu hiệu chỉ nhìn mới thấy. */}
          {row.isDefault ? (
            <Tooltip title="Ca mặc định của công ty — dùng khi nhân viên không được phân ca">
              <span style={{ display: 'inline-flex', color: 'var(--sf-blue-700)' }}>
                <Icon name="star" size={16} fill label="Ca mặc định" />
              </span>
            </Tooltip>
          ) : null}
        </span>
      ),
    },
    {
      title: 'Tên ca',
      key: 'name',
      width: 128,
      render: (_, row) => (
        <Tooltip title={describeScope(row, departmentName)}>
          <span>{row.name}</span>
        </Tooltip>
      ),
    },
    {
      title: 'Ký hiệu chấm công',
      dataIndex: 'symbol',
      key: 'symbol',
      width: 86,
      align: 'center',
      render: (symbol: string | null, row) =>
        symbol ? (
          <StatusBadge tone={symbolTone(row)} soft title={symbolHint(row)}>
            {symbol}
          </StatusBadge>
        ) : (
          <span className="sf-text-variant">—</span>
        ),
    },
    {
      title: 'Giờ làm việc',
      key: 'time',
      width: 136,
      className: 'sf-nowrap',
      render: (_, row) => (
        <Tooltip
          title={`${formatHours(row.workMinutes)} công · ${row.workDayCredit} ngày công${
            row.crossesMidnight ? ' · ca qua đêm, tính vào ngày bắt đầu' : ''
          }`}
        >
          <span>
            {formatShiftHours(row)}
            {row.crossesMidnight ? (
              <span className="sf-text-variant" style={{ fontSize: 11, marginLeft: 4 }}>
                +1
              </span>
            ) : null}
          </span>
        </Tooltip>
      ),
    },
    {
      title: 'Khung chấm vào',
      key: 'checkIn',
      width: 128,
      className: 'sf-nowrap',
      render: (_, row) => formatWindow(row.checkInFrom, row.checkInTo),
    },
    {
      title: 'Khung chấm ra',
      key: 'checkOut',
      width: 128,
      className: 'sf-nowrap',
      render: (_, row) =>
        row.requireCheckOut ? (
          formatWindow(row.checkOutFrom, row.checkOutTo)
        ) : (
          <Tooltip title="Ca chỉ điểm danh đầu giờ — không yêu cầu chấm ra">
            <span className="sf-text-variant">Không chấm ra</span>
          </Tooltip>
        ),
    },
    {
      title: 'Nghỉ trưa',
      key: 'break',
      width: 128,
      className: 'sf-nowrap',
      render: (_, row) =>
        row.breakStart && row.breakEnd ? (
          <Tooltip title={`Trừ ${row.breakMinutes} phút khỏi giờ công`}>
            <span>
              {row.breakStart} - {row.breakEnd}
            </span>
          </Tooltip>
        ) : row.breakMinutes > 0 ? (
          <span>{row.breakMinutes} phút</span>
        ) : (
          <span className="sf-text-variant">—</span>
        ),
    },
    {
      title: 'Hệ số ngày thường',
      dataIndex: 'normalDayFactor',
      key: 'normalDayFactor',
      width: 78,
      className: 'sf-nowrap',
      render: (value: number) => formatFactor(value),
    },
    {
      title: 'Hệ số ngày nghỉ',
      dataIndex: 'weeklyRestFactor',
      key: 'weeklyRestFactor',
      width: 78,
      className: 'sf-nowrap',
      render: (value: number) => formatFactor(value),
    },
    {
      title: 'Hệ số ngày lễ',
      key: 'holidayFactor',
      width: 78,
      className: 'sf-nowrap',
      render: (_, row) => {
        // `?? []` không phải phòng xa vô cớ: TanStack Query hiển thị bản cache cũ
        // TRƯỚC khi lần tải mới về tới nơi. Ngay sau khi Backend được nâng cấp,
        // bản cache đó còn theo hình dạng cũ (chưa có `holidayFactors`), và một
        // lần `.length` trên `undefined` ở đây làm trắng cả trang chứ không chỉ
        // hỏng một ô.
        const overrides = row.holidayFactors ?? [];
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {formatFactor(row.holidayFactor)}
            {overrides.length > 0 ? (
              <StatusBadge
                tone="neutral"
                soft
                title={`${overrides.length} ngày lễ được đặt hệ số riêng`}
              >
                +{overrides.length}
              </StatusBadge>
            ) : null}
          </span>
        );
      },
    },
    {
      title: 'Trạng thái',
      key: 'status',
      width: 110,
      className: 'sf-nowrap',
      render: (_, row) => {
        const status = resolveStatus(row, today, timezone);
        return (
          <StatusBadge tone={status.tone} soft title={status.hint}>
            {status.label}
          </StatusBadge>
        );
      },
    },
    ...(canEdit
      ? [
          {
            title: 'Thao tác',
            key: 'actions',
            width: 78,
            align: 'center' as const,
            render: (_: unknown, row: Shift) => (
              <Dropdown
                trigger={['click']}
                menu={{
                  items: [
                    { key: 'edit', label: 'Sửa ca làm việc' },
                    { key: 'duplicate', label: 'Nhân bản thành ca mới' },
                    { type: 'divider' as const },
                    { key: 'delete', label: 'Xoá ca làm việc', danger: true },
                  ],
                  onClick: ({ key }) => {
                    if (key === 'edit') setEditing(row);
                    if (key === 'duplicate') setEditing(duplicateOf(row));
                    if (key === 'delete') setDeleteTarget(row);
                  },
                }}
              >
                {/*
                  Nút chữ trơn: thiết kế vẽ đúng ba chấm, không nền không viền.
                  `stopPropagation` vì cả DÒNG cũng bấm được — không chặn thì mở
                  menu xong biểu mẫu sửa bật lên theo.
                */}
                <IconButton
                  icon="more_vert"
                  size="sm"
                  variant="tertiary"
                  label={`Thao tác với ca ${row.name}`}
                  onClick={(event) => event.stopPropagation()}
                />
              </Dropdown>
            ),
          } as ColumnsType<Shift>[number],
        ]
      : []),
  ];

  const filtering = Boolean(query || branchId);

  return (
    <>
      <Card padding={20} className="sf-shift-catalog">
        {/*
          Tiêu đề và thanh công cụ CÙNG MỘT HÀNG: ô tìm kiếm chỉ lọc bảng ngay
          bên dưới nó, nên để chúng cạnh nhau là nói đúng phạm vi tác dụng. Hàng
          này `flex-wrap` để ở màn hẹp thanh công cụ tự xuống dòng thay vì đè lên
          tiêu đề.
        */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            marginBottom: 16,
          }}
        >
          {/* `title-md` (20px) chứ không `headline-md` (24px): đây là nhãn của
              một bảng, không phải tiêu đề của trang. */}
          <h2 className="sf-title-md">Danh sách ca làm việc</h2>
          <ShiftCatalogToolbar />
        </div>

        <DataTable<Shift>
          rowKey="id"
          data={visible}
          isLoading={shifts.isLoading}
          error={shifts.error}
          onRetry={() => void shifts.refetch()}
          columns={columns}
          /*
           * `tableLayout="fixed"` để bề rộng khai trong `columns` được TÔN
           * TRỌNG. Ở chế độ `auto`, Ant Design coi chúng là gợi ý rồi tự chia
           * lại: cột "Tên ca" bị bóp cho tên ca xuống hai dòng trong khi ba cột
           * hệ số (chỉ chứa "1.0") lại phình ra.
           */
          tableLayout="fixed"
          /*
           * `middle` chứ không `small`: `small` bóp đệm dọc còn 8px và dòng chỉ
           * cao 36px — bảng 12 cột ở mật độ đó đọc như một bảng tính. 12px giữ
           * dòng ở 44px, vẫn thấp hơn hẳn 74px của mặc định.
           */
          size="middle"
          /*
           * Con số tổng đã nằm ở chân bảng (`showTotal`), nên dòng đếm phía trên
           * chỉ còn phục vụ trình đọc màn hình — xem `srOnlyCount`.
           */
          srOnlyCount
          className="sf-table--split-footer"
          /*
           * Phân trang tại chỗ — không truyền `meta` vì endpoint trả cả danh mục
           * trong một lượt. Vẫn bật vì công ty nhiều chi nhánh dễ có ba bốn chục
           * ca, và một bảng 40 dòng không phân trang thì chân bảng trôi mất khỏi
           * màn hình.
           */
          pagination={{
            defaultPageSize: 10,
            showSizeChanger: true,
            pageSizeOptions: ['10', '20', '50'],
            locale: { items_per_page: 'mục mỗi trang' },
            showTotal: (total, range) =>
              `Hiển thị ${range[0]} đến ${range[1]} của ${total} kết quả`,
          }}
          onRow={(row) => ({
            onClick: () => {
              setSelectedId(row.id);
              if (canEdit) setEditing(row);
            },
            style: canEdit ? { cursor: 'pointer' } : undefined,
          })}
          rowClassName={(row) => (row.id === selectedId ? 'ant-table-row-selected' : '')}
          scroll={{ x: 1248 }}
          emptyIcon={filtering ? 'search_off' : 'schedule'}
          emptyTitle={filtering ? 'Không có ca nào khớp bộ lọc' : 'Chưa có ca làm việc nào'}
          emptyDescription={
            filtering
              ? 'Thử bỏ bớt từ khoá hoặc chọn lại chi nhánh. Ca áp dụng cho mọi phòng ban luôn hiện ở mọi chi nhánh.'
              : 'Tạo ít nhất một ca hành chính và đánh dấu là ca mặc định. Nhân viên không được phân ca cụ thể sẽ dùng ca này để tính công.'
          }
        />
      </Card>

      <ShiftFormDrawer shift={editing} onClose={closeForm} />

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
    </>
  );
}

/**
 * "08:00 - 17:30" hoặc "Linh hoạt".
 *
 * Dấu ca qua đêm được nơi gọi vẽ thành hậu tố "+1" cỡ nhỏ — một huy hiệu "Qua
 * đêm" đầy đủ đẩy ô này xuống hai dòng, còn "+1" là cách mọi phần mềm chấm công
 * nói cùng điều đó trong ba ký tự.
 */
function formatShiftHours(shift: Shift): string {
  if (shift.type === 'FLEXIBLE') return 'Linh hoạt';
  return `${shift.startTime ?? '—'} - ${shift.endTime ?? '—'}`;
}

/** "07:30 - 09:00", "từ 07:30", "tới 09:00", hoặc "Bất kỳ" khi bỏ trống cả hai. */
function formatWindow(from: string | null, to: string | null): string {
  if (from && to) return `${from} - ${to}`;
  if (from) return `từ ${from}`;
  if (to) return `tới ${to}`;
  return 'Bất kỳ';
}

/**
 * Hệ số hiện đúng một chữ số thập phân.
 *
 * Backend trả `Decimal(4,2)` — tuỳ đường serialise mà ra số hay ra chuỗi
 * `"2.00"`. Ép `Number` trước khi định dạng để cột không lẫn "2" với "2.00"
 * trên cùng một bảng.
 */
function formatFactor(value: number | string | null | undefined): string {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed.toFixed(1) : '—';
}

/**
 * Tông màu của chip ký hiệu — theo KHUNG GIỜ của ca.
 *
 * Thiết kế vẽ bốn ký hiệu bốn màu. Màu đó phải suy ra được từ dữ liệu, không
 * phải gán theo thứ tự dòng: lọc hay đổi trang là thứ tự đổi, và một ca sáng
 * hôm nay xanh lá mai vàng thì màu không còn nói gì. Lấy giờ bắt đầu làm nguồn
 * thì màu mang đúng một nghĩa — ca chạy vào buổi nào trong ngày.
 */
function symbolTone(shift: Shift): BadgeTone {
  if (shift.type === 'FLEXIBLE' || !shift.startTime) return 'neutral';
  const hour = Number(shift.startTime.slice(0, 2));
  if (shift.crossesMidnight || hour >= 18 || hour < 5) return 'violet';
  if (hour >= 12) return 'warning';
  if (hour < 7) return 'teal';
  return 'success';
}

/** Chú thích của chip ký hiệu — nói ra cái mà màu chỉ gợi ý. */
function symbolHint(shift: Shift): string {
  const tone = symbolTone(shift);
  const period =
    tone === 'violet'
      ? 'Ca đêm'
      : tone === 'warning'
        ? 'Ca chiều'
        : tone === 'teal'
          ? 'Ca sáng'
          : tone === 'success'
            ? 'Ca hành chính'
            : 'Ca linh hoạt';
  return `${period} — ký hiệu in trên bảng chấm công`;
}

/** Phạm vi áp dụng của ca: phòng ban nào, những thứ nào trong tuần. */
function describeScope(shift: Shift, names: Map<string, string>): string {
  const ids = shift.departmentIds ?? [];
  const scope =
    ids.length === 0
      ? 'Mọi phòng ban'
      : ids.map((id) => names.get(id) ?? 'Phòng ban đã xoá').join(', ');
  return `${scope} · ${describeWeekdays(shift.weekdayMask)}`;
}

/** Bitmask ngày trong tuần → "Mọi ngày" hoặc "T2 · T3 · T4". */
function describeWeekdays(mask: number): string {
  if (!mask) return 'Mọi ngày';
  return WEEKDAYS.filter((day) => (mask & day.mask) !== 0)
    .map((day) => day.label)
    .join(' · ');
}

/**
 * Ca đang ở đâu trong vòng đời hiệu lực của nó.
 *
 * Cột "Trạng thái" của thiết kế KHÔNG phải một cột trong cơ sở dữ liệu — `Shift`
 * không có trường trạng thái. Nó được suy ra từ cặp `effectiveFrom`/
 * `effectiveTo`, tức đúng thứ máy tính công dùng để chọn phiên bản ca cho một
 * ngày. Thêm một cột trạng thái lưu riêng sẽ mở ra khả năng nhãn nói một đằng,
 * lương tính một nẻo.
 */
function resolveStatus(
  shift: Shift,
  today: string,
  timezone?: string,
): { label: string; tone: BadgeTone; hint: string } {
  const from = workDateOf(shift.effectiveFrom, timezone);
  const to = shift.effectiveTo ? workDateOf(shift.effectiveTo, timezone) : null;
  const range = `Hiệu lực ${formatDay(shift.effectiveFrom, timezone)} → ${
    shift.effectiveTo ? formatDay(shift.effectiveTo, timezone) : 'không thời hạn'
  }`;

  if (from > today) return { label: 'Chưa hiệu lực', tone: 'warning', hint: range };
  if (to && to < today) return { label: 'Ngừng áp dụng', tone: 'neutral', hint: range };
  return { label: 'Đang áp dụng', tone: 'success', hint: range };
}

/**
 * Bản sao để tạo ca mới từ một ca có sẵn.
 *
 * Bỏ `id` và `code`: giữ `id` thì lưu sẽ GHI ĐÈ ca gốc, còn mã ca thì duy nhất
 * trong công ty nên chép sang cũng bị Backend từ chối. Người dùng buộc phải đặt
 * mã mới — đúng chỗ để họ nghĩ xem ca này khác ca gốc ở đâu.
 */
function duplicateOf(shift: Shift): Partial<Shift> {
  const { id: _id, code: _code, isDefault: _isDefault, ...rest } = shift;
  return { ...rest, name: `${shift.name} (bản sao)`, isDefault: false };
}
