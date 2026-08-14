import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, DatePicker, Input, Pagination, Popover, Select, Tooltip } from 'antd';
import { PageHeader } from '@/components/PageHeader';
import { FilterBar, FilterField } from '@/components/FilterBar';
import { EmptyState } from '@/components/ui';
import { TableSkeleton } from '@/components/Skeleton';
import { Icon } from '@/components/Icon';
import { Can, useCan } from '@/lib/rbac/Can';
import { useAuth } from '@/lib/auth/auth-context';
import { firstDayOfMonth, lastDayOfMonth, toWorkDate } from '@/lib/utils/date';
import { toDayjs } from '@/lib/utils/dayjs';
import { useDepartments, toSelectOptions } from '@/features/shared/org.api';
import { useShifts, type Shift } from '@/features/policy/policy.api';
import { BulkAssignDrawer } from './BulkAssignDrawer';
import {
  useBulkAssignShifts,
  useClearShiftAssignments,
  useShiftBoard,
  type ShiftBoardEmployee,
} from './shifts.api';
import { ApiErrorState } from '@/components/ApiErrorState';
import { useToast } from '@/components/ui';
import { useErrorToast } from '@/lib/errors/use-error-toast';

/** Trần khoảng ngày do Backend đặt (`MAX_BOARD_DAYS`) — chặn sớm ở đây để báo lỗi tử tế hơn 422. */
const MAX_DAYS = 62;

/**
 * Lịch phân ca — docs/04 mục 8 (`FR-WEB-HR-03`, `FR-WEB-HR-04`).
 *
 * Bảng đọc theo DÒNG: mỗi dòng một người, mỗi cột một ngày. Đây là cách người
 * xếp ca thật sự nhìn vấn đề ("tuần này ai trực đêm"), khác hẳn danh sách bản
 * ghi phân ca vốn chỉ trả lời được câu hỏi ngược lại.
 *
 * Vì vậy phân trang theo NGƯỜI chứ không theo bản ghi — cắt trang giữa chừng
 * một người sẽ tách lịch của họ thành hai dòng rời rạc ở hai trang.
 *
 * Ngày lễ được tô nền riêng: xếp ca vào ngày lễ không sai về kỹ thuật (vẫn có
 * người trực Tết) nhưng luôn phải là quyết định có ý thức, vì hệ số OT ngày đó
 * là 300%.
 */
export function ShiftSchedulePage() {
  const { timezone } = useAuth();
  const toast = useToast();
  const showError = useErrorToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [assignOpen, setAssignOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const canAssign = useCan('shift.assign');

  const departments = useDepartments();
  const shifts = useShifts();
  const assignShifts = useBulkAssignShifts();
  const clearShifts = useClearShiftAssignments();

  const query = useMemo(
    () => ({
      from: searchParams.get('from') ?? firstDayOfMonth(timezone),
      to: searchParams.get('to') ?? lastDayOfMonth(timezone),
      departmentId: searchParams.get('departmentId') ?? undefined,
      q: searchParams.get('q') ?? undefined,
      page: Number(searchParams.get('page') ?? 1),
      pageSize: Number(searchParams.get('pageSize') ?? 25),
    }),
    [searchParams, timezone],
  );

  const board = useShiftBoard(query);

  const days = useMemo(() => eachDay(query.from, query.to), [query.from, query.to]);
  const holidayByDate = useMemo(
    () => new Map((board.data?.holidays ?? []).map((holiday) => [holiday.date, holiday.name])),
    [board.data],
  );
  const shiftById = useMemo(
    () => new Map((shifts.data ?? []).map((shift) => [shift.id, shift])),
    [shifts.data],
  );

  /** `employeeId|workDate` → shiftId. Tra ô trong bảng phải là O(1), không phải quét mảng. */
  const cellIndex = useMemo(() => {
    const index = new Map<string, string>();
    for (const assignment of board.data?.assignments ?? []) {
      index.set(`${assignment.employeeId}|${assignment.workDate}`, assignment.shiftId);
    }
    return index;
  }, [board.data]);

  function patchQuery(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(searchParams);
    Object.entries(patch).forEach(([key, value]) => {
      if (!value) next.delete(key);
      else next.set(key, value);
    });
    if (!('page' in patch)) next.delete('page');
    setSearchParams(next, { replace: true });
  }

  function changeRange(from?: string, to?: string) {
    const nextFrom = from ?? query.from;
    const nextTo = to ?? query.to;
    if (eachDay(nextFrom, nextTo).length > MAX_DAYS) {
      toast.warning(
        `Khoảng ngày tối đa ${MAX_DAYS} ngày`,
        'Chọn khoảng ngắn hơn — lịch dài hơn hai tháng thì bảng quá rộng để đọc.',
      );
      return;
    }
    patchQuery({ from: nextFrom, to: nextTo });
  }

  const employees = board.data?.employees ?? [];
  const allSelected = employees.length > 0 && selectedIds.length === employees.length;

  /**
   * Đổi ca của một người trong một ngày.
   *
   * Dùng lại chính endpoint phân ca hàng loạt với `from = to = ngày đó` và đúng
   * một nhân viên — không cần endpoint riêng, và quan trọng hơn là đi qua cùng
   * một đường ghi nên cùng chịu kiểm tra phạm vi phòng ban và cùng ghi audit log.
   */
  async function assignOne(employee: ShiftBoardEmployee, date: string, shiftId: string) {
    try {
      await assignShifts.mutateAsync({
        employeeIds: [employee.id],
        shiftId,
        from: date,
        to: date,
      });
      toast.success(`Đã đổi ca của ${employee.fullName}`, `Ngày ${date}.`);
    } catch (caught) {
      showError(caught);
    }
  }

  async function clearOne(employee: ShiftBoardEmployee, date: string) {
    try {
      await clearShifts.mutateAsync({ employeeIds: [employee.id], from: date, to: date });
      toast.success(
        `Đã xoá phân ca ngày ${date}`,
        `${employee.fullName} quay về ca mặc định của công ty trong ngày này.`,
      );
    } catch (caught) {
      showError(caught);
    }
  }

  const activeFilters = ['departmentId', 'q'].filter((key) => searchParams.get(key)).length;

  return (
    <>
      <PageHeader
        title="Phân ca"
        description="Lịch ca theo người và theo ngày. Nhân viên không được phân ca cụ thể sẽ tính công theo ca mặc định của công ty."
        actions={
          <Can do="shift.assign">
            <Button
              type="primary"
              icon={<Icon name="event_repeat" size={20} />}
              onClick={() => setAssignOpen(true)}
            >
              Phân ca hàng loạt
            </Button>
          </Can>
        }
      />

      <FilterBar
        activeCount={activeFilters}
        onClear={() => patchQuery({ departmentId: undefined, q: undefined })}
      >
        <FilterField label="Từ ngày" htmlFor="sb-from" width={160}>
          <DatePicker
            id="sb-from"
            allowClear={false}
            format="DD/MM/YYYY"
            style={{ width: '100%' }}
            value={toDayjs(query.from)}
            onChange={(date) => changeRange(toWorkDate(date?.toDate()), undefined)}
          />
        </FilterField>

        <FilterField label="Đến ngày" htmlFor="sb-to" width={160}>
          <DatePicker
            id="sb-to"
            allowClear={false}
            format="DD/MM/YYYY"
            style={{ width: '100%' }}
            value={toDayjs(query.to)}
            onChange={(date) => changeRange(undefined, toWorkDate(date?.toDate()))}
          />
        </FilterField>

        <FilterField label="Phòng ban" htmlFor="sb-dept" width={200}>
          <Select
            id="sb-dept"
            value={query.departmentId ?? ''}
            loading={departments.isLoading}
            options={toSelectOptions(departments.data, 'Tất cả phòng ban')}
            onChange={(value) => patchQuery({ departmentId: value })}
            style={{ width: '100%' }}
          />
        </FilterField>

        <FilterField label="Tìm nhân viên" htmlFor="sb-q" width={220}>
          <Input.Search
            id="sb-q"
            allowClear
            defaultValue={query.q}
            placeholder="Tên hoặc mã nhân viên"
            onSearch={(value) => patchQuery({ q: value || undefined })}
          />
        </FilterField>
      </FilterBar>

      {board.isLoading && !board.data ? (
        <TableSkeleton columns={8} />
      ) : board.error ? (
        <ApiErrorState error={board.error} onRetry={() => void board.refetch()} />
      ) : employees.length === 0 ? (
        <EmptyState
          icon="event_busy"
          title="Không có nhân viên nào khớp bộ lọc"
          description="Chỉ nhân viên đang làm việc hoặc chờ kích hoạt mới xếp ca được. Thử bỏ bớt bộ lọc phòng ban."
        />
      ) : (
        <>
          <div
            style={{
              overflowX: 'auto',
              background: 'var(--sf-surface)',
              border: '1px solid var(--sf-outline-variant)',
              borderRadius: 12,
            }}
          >
            <table className="sf-shift-board" style={{ borderCollapse: 'collapse', width: '100%' }}>
              <caption className="sf-visually-hidden">
                Lịch phân ca từ {query.from} đến {query.to}
              </caption>
              <thead>
                <tr>
                  <th
                    scope="col"
                    style={{
                      ...headerCellStyle,
                      position: 'sticky',
                      left: 0,
                      zIndex: 2,
                      minWidth: 240,
                      textAlign: 'left',
                    }}
                  >
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={allSelected}
                        aria-label="Chọn tất cả nhân viên đang hiển thị"
                        onChange={(event) =>
                          setSelectedIds(
                            event.target.checked ? employees.map((employee) => employee.id) : [],
                          )
                        }
                      />
                      Nhân viên
                    </label>
                  </th>
                  {days.map((day) => {
                    const holiday = holidayByDate.get(day.date);
                    return (
                      <th
                        key={day.date}
                        scope="col"
                        style={{
                          ...headerCellStyle,
                          minWidth: 44,
                          background: holiday
                            ? 'var(--sf-warning-100, #FFF4E5)'
                            : day.isWeekend
                              ? 'var(--sf-neutral-100)'
                              : undefined,
                        }}
                      >
                        <Tooltip title={holiday ?? undefined}>
                          <span style={{ display: 'block' }}>
                            <span className="sf-caption" style={{ display: 'block' }}>
                              {day.weekdayLabel}
                            </span>
                            <span style={{ fontWeight: 600 }}>{day.dayOfMonth}</span>
                          </span>
                        </Tooltip>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {employees.map((employee) => (
                  <tr key={employee.id}>
                    <th
                      scope="row"
                      style={{
                        ...bodyCellStyle,
                        position: 'sticky',
                        left: 0,
                        zIndex: 1,
                        background: 'var(--sf-surface)',
                        textAlign: 'left',
                        fontWeight: 400,
                      }}
                    >
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(employee.id)}
                          aria-label={`Chọn ${employee.fullName}`}
                          onChange={(event) =>
                            setSelectedIds((prev) =>
                              event.target.checked
                                ? [...prev, employee.id]
                                : prev.filter((id) => id !== employee.id),
                            )
                          }
                        />
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: 'block', fontWeight: 600 }}>
                            {employee.fullName}
                          </span>
                          <span className="sf-body-sm sf-text-variant">
                            {employee.department?.name ?? employee.employeeCode}
                          </span>
                        </span>
                      </label>
                    </th>

                    {days.map((day) => {
                      const shiftId = cellIndex.get(`${employee.id}|${day.date}`);
                      const shift = shiftId ? shiftById.get(shiftId) : undefined;
                      const holiday = holidayByDate.get(day.date);

                      return (
                        <td
                          key={day.date}
                          style={{
                            ...bodyCellStyle,
                            textAlign: 'center',
                            background: holiday
                              ? 'var(--sf-warning-100, #FFF4E5)'
                              : day.isWeekend
                                ? 'var(--sf-neutral-100)'
                                : undefined,
                          }}
                        >
                          <ShiftCell
                            shift={shift}
                            employee={employee}
                            date={day.date}
                            shifts={shifts.data ?? []}
                            editable={canAssign}
                            onAssign={(nextShiftId) =>
                              void assignOne(employee, day.date, nextShiftId)
                            }
                            onClear={() => void clearOne(employee, day.date)}
                            busy={assignShifts.isPending || clearShifts.isPending}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              marginTop: 16,
              flexWrap: 'wrap',
            }}
          >
            <ShiftLegend shifts={shifts.data ?? []} />

            <Pagination
              current={board.data?.meta.page ?? 1}
              pageSize={board.data?.meta.pageSize ?? 25}
              total={board.data?.meta.total ?? 0}
              showSizeChanger
              pageSizeOptions={['25', '50', '100']}
              showTotal={(total, range) => `${range[0]}–${range[1]} trên ${total} nhân viên`}
              onChange={(page, pageSize) =>
                patchQuery({ page: String(page), pageSize: String(pageSize) })
              }
            />
          </div>
        </>
      )}

      <BulkAssignDrawer
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        defaultRange={{ from: query.from, to: query.to }}
        preselectedIds={selectedIds}
        employees={employees}
        onDone={() => setSelectedIds([])}
      />
    </>
  );
}

/**
 * Một ô lịch — bấm được để đổi ca của ĐÚNG người đó, ĐÚNG ngày đó.
 *
 * Trên một lưới lịch, phản xạ đầu tiên của người dùng là bấm vào ô. Trước đây ô
 * chỉ là chữ tĩnh, và cách duy nhất để sửa lịch một người trong một ngày là mở
 * drawer phân ca hàng loạt rồi khai lại cả ba chiều (ai, ca nào, ngày nào) —
 * cho một thao tác mà toàn bộ ngữ cảnh đã nằm sẵn dưới con trỏ.
 *
 * Người không có quyền xếp ca thấy ô tĩnh như cũ, không phải một nút bấm vào
 * rồi nhận 403.
 */
function ShiftCell({
  shift,
  employee,
  date,
  shifts,
  editable,
  busy,
  onAssign,
  onClear,
}: {
  shift: Shift | undefined;
  employee: ShiftBoardEmployee;
  date: string;
  shifts: Shift[];
  editable: boolean;
  busy: boolean;
  onAssign: (shiftId: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);

  const description = shift
    ? `${shift.name} · ${shiftHours(shift)}`
    : 'Chưa phân ca — tính công theo ca mặc định của công ty';
  const cellLabel = `${employee.fullName}, ngày ${date}: ${description}`;

  const mark = shift ? (
    <span
      style={{
        display: 'inline-block',
        minWidth: 28,
        paddingInline: 6,
        borderRadius: 6,
        fontSize: 12,
        lineHeight: '20px',
        fontWeight: 600,
        background: shift.crossesMidnight ? 'var(--sf-teal-900, #0F3D33)' : 'var(--sf-teal-700)',
        color: '#FFFFFF',
      }}
    >
      {abbreviate(shift.name)}
    </span>
  ) : (
    // Dấu "—" thay cho dấu chấm giữa: chấm giữa vừa mờ vừa không mang nghĩa gì,
    // người dùng đọc thành nhiễu chứ không thành "ô này còn trống".
    <span className="sf-text-muted">—</span>
  );

  if (!editable) {
    return (
      <Tooltip title={description}>
        <span aria-label={cellLabel}>{mark}</span>
      </Tooltip>
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement="bottom"
      title={`${employee.fullName} · ${date}`}
      content={
        <div style={{ display: 'grid', gap: 4, minWidth: 220 }}>
          {shifts.map((option) => (
            <Button
              key={option.id}
              size="small"
              type={option.id === shift?.id ? 'primary' : 'text'}
              disabled={busy}
              style={{ justifyContent: 'flex-start', textAlign: 'left' }}
              onClick={() => {
                setOpen(false);
                onAssign(option.id);
              }}
            >
              {option.name} · {shiftHours(option)}
            </Button>
          ))}

          {shift ? (
            <>
              <div
                style={{ height: 1, background: 'var(--sf-outline-variant)', margin: '4px 0' }}
              />
              <Button
                size="small"
                type="text"
                danger
                disabled={busy}
                style={{ justifyContent: 'flex-start' }}
                onClick={() => {
                  setOpen(false);
                  onClear();
                }}
              >
                Xoá phân ca ngày này
              </Button>
            </>
          ) : null}
        </div>
      }
    >
      <button
        type="button"
        aria-label={`${cellLabel}. Bấm để đổi ca.`}
        style={{
          border: 'none',
          background: 'none',
          padding: 4,
          borderRadius: 6,
          cursor: busy ? 'progress' : 'pointer',
          font: 'inherit',
        }}
      >
        {mark}
      </button>
    </Popover>
  );
}

/** "08:00–17:30", "22:00–06:00 (qua đêm)", "Linh hoạt". */
function shiftHours(shift: Shift): string {
  if (shift.type === 'FLEXIBLE') return 'linh hoạt';
  return `${shift.startTime ?? '—'}–${shift.endTime ?? '—'}${shift.crossesMidnight ? ' (qua đêm)' : ''}`;
}

function ShiftLegend({ shifts }: { shifts: Shift[] }) {
  if (shifts.length === 0) return <span />;

  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
      <span className="sf-label-md">Chú thích:</span>
      {shifts.map((shift) => (
        <span key={shift.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            aria-hidden="true"
            style={{
              display: 'inline-block',
              minWidth: 28,
              textAlign: 'center',
              paddingInline: 6,
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              background: shift.crossesMidnight
                ? 'var(--sf-teal-900, #0F3D33)'
                : 'var(--sf-teal-700)',
              color: '#FFFFFF',
            }}
          >
            {abbreviate(shift.name)}
          </span>
          <span className="sf-body-sm">{shift.name}</span>
        </span>
      ))}
    </div>
  );
}

/** "Hành chính" → "HC", "Ca đêm" → "CĐ". Ô lịch rộng 44px, tên đầy đủ không vừa. */
function abbreviate(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 1) return (words[0] as string).slice(0, 2).toUpperCase();
  return words
    .slice(0, 2)
    .map((word) => word[0] ?? '')
    .join('')
    .toUpperCase();
}

const WEEKDAY_LABELS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

interface BoardDay {
  date: string;
  dayOfMonth: number;
  weekdayLabel: string;
  isWeekend: boolean;
}

/**
 * Dãy ngày của bảng.
 *
 * Dựng bằng `Date.UTC` chứ không phải `new Date(chuỗi)` rồi cộng ngày theo giờ
 * địa phương: máy người dùng ở múi giờ âm sẽ cho ra ngày lùi một đơn vị, và cả
 * bảng lệch một cột so với dữ liệu Backend trả về.
 */
function eachDay(from: string, to: string): BoardDay[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return [];

  const days: BoardDay[] = [];
  for (let time = start; time <= end; time += 86_400_000) {
    const date = new Date(time);
    const weekday = date.getUTCDay();
    days.push({
      date: date.toISOString().slice(0, 10),
      dayOfMonth: date.getUTCDate(),
      weekdayLabel: WEEKDAY_LABELS[weekday] as string,
      isWeekend: weekday === 0 || weekday === 6,
    });
  }
  return days;
}

const headerCellStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid var(--sf-outline-variant)',
  background: 'var(--sf-surface)',
  fontSize: 12,
  lineHeight: '16px',
  textAlign: 'center',
  whiteSpace: 'nowrap',
};

const bodyCellStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid var(--sf-outline-variant)',
  fontSize: 14,
  whiteSpace: 'nowrap',
};
