import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Button, DatePicker, Input, Pagination, Progress, Tooltip } from 'antd';
import { qk } from '@/lib/api/query-client';
import { PageHeader } from '@/components/PageHeader';
import { FilterBar, FilterField } from '@/components/FilterBar';
import { ApiErrorState } from '@/components/ApiErrorState';
import { ConfirmDialog, EmptyState, useToast } from '@/components/ui';
import { TableSkeleton } from '@/components/Skeleton';
import { Icon } from '@/components/Icon';
import { DepartmentTreeSelect } from '@/components/DepartmentTreeSelect';
import { Can, useCan } from '@/lib/rbac/Can';
import { useAuth } from '@/lib/auth/auth-context';
import { useErrorToast } from '@/lib/errors/use-error-toast';
import { formatMinutes, formatTime, toWorkDate } from '@/lib/utils/date';
import { formatStandardDays } from '@/lib/utils/format';
import { dayjs, toDayjs } from '@/lib/utils/dayjs';
import { useShifts, type Shift } from '@/features/policy/policy.api';
import { AttendanceCellDrawer, readDayCredit } from './AttendanceCellDrawer';
import { AddSheetMembersModal } from './AddSheetMembersModal';
import { AttendanceDetailDrawer } from './AttendanceDetailDrawer';
import { AdjustAttendanceModal } from './AdjustAttendanceModal';
import { ExportAttendanceModal } from './ExportAttendanceModal';
import { useExportJob, type AttendanceDaily } from './attendance.api';
import {
  useAttendanceSheet,
  useAttendanceSheetBoard,
  useCloseAttendanceSheet,
  useRecalculateAttendanceSheet,
  useRemoveSheetMembers,
  type AttendanceSheetEmployee,
  type SheetRequest,
} from './attendance-sheets.api';

/**
 * Chi tiết một bảng chấm công — FR-WEB-ATT-09.
 *
 * Bảng đọc theo DÒNG: mỗi dòng một người, mỗi cột một ngày — cùng hình dạng với
 * bảng phân ca, và cùng hình dạng với bảng công giấy mà kế toán đang dùng. Đây
 * là cách người rà công thật sự nhìn vấn đề ("tháng này ai thiếu công"), khác
 * hẳn danh sách phẳng theo ngày vốn chỉ trả lời được câu hỏi ngược lại.
 *
 * Mỗi ô có HAI tầng thông tin, cố ý xếp chồng chứ không gộp:
 *
 *  - Tầng trên: ca ĐƯỢC XẾP (kế hoạch), lấy từ bảng phân ca.
 *  - Tầng dưới: giờ chấm vào–ra THỰC TẾ, lấy từ bản ghi chấm công.
 *
 * Nền ô nói mức độ khớp giữa hai tầng đó. Gộp lại thành một con số thì mất đúng
 * thứ đang cần tìm: người có ca mà không chấm công, và người chấm công mà không
 * có ca.
 *
 * Phân trang theo NGƯỜI chứ không theo bản ghi — cắt trang giữa chừng một người
 * sẽ tách công của họ thành hai dòng rời rạc ở hai trang.
 */
export function AttendanceSheetPage() {
  const { id: sheetId = '' } = useParams<{ id: string }>();
  const { timezone } = useAuth();
  const toast = useToast();
  const showError = useErrorToast();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  // Tổ chức bảng (thêm/bớt người) là quyền của Quản lý; chốt bảng và hiệu chỉnh
  // công thì không — hai việc sau chạm vào số liệu bàn giao cho tính lương.
  const canManage = useCan('attendance.sheet');

  const [addMembersOpen, setAddMembersOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  /** Ô đang mở. Giữ cả nhân viên lẫn ngày vì drawer cần cả hai để tra dữ liệu. */
  const [openCell, setOpenCell] = useState<{
    employee: AttendanceSheetEmployee;
    date: string;
  } | null>(null);
  /** Bước tiếp theo sau khi đóng drawer ô — xem lượt thô, hoặc hiệu chỉnh. */
  const [logsFor, setLogsFor] = useState<{ employee: AttendanceSheetEmployee; date: string } | null>(
    null,
  );
  const [adjustTarget, setAdjustTarget] = useState<AttendanceDaily | null>(null);

  const sheet = useAttendanceSheet(sheetId);
  const shifts = useShifts();
  const removeMembers = useRemoveSheetMembers();
  const closeSheet = useCloseAttendanceSheet();
  const recalculate = useRecalculateAttendanceSheet();

  /** Job tính lại đang chạy. `null` = không có lượt cập nhật nào đang chờ. */
  const [recalcJobId, setRecalcJobId] = useState<string | null>(null);
  const recalcJob = useExportJob(recalcJobId);
  const recalcRunning =
    recalculate.isPending ||
    (recalcJobId !== null && recalcJob.data?.status !== 'COMPLETED' && recalcJob.data?.status !== 'FAILED');

  /** Kỳ của bảng — mọi bộ lọc ngày phải nằm trong đây, Backend cũng từ chối nếu ra ngoài. */
  const period = useMemo(() => {
    const month = sheet.data ? dayjs(sheet.data.periodMonth) : dayjs();
    return {
      from: month.startOf('month').format('YYYY-MM-DD'),
      to: month.endOf('month').format('YYYY-MM-DD'),
    };
  }, [sheet.data]);

  const query = useMemo(
    () => ({
      sheetId,
      from: clampToPeriod(searchParams.get('from') ?? period.from, period),
      to: clampToPeriod(searchParams.get('to') ?? period.to, period),
      departmentId: searchParams.get('departmentId') ?? undefined,
      q: searchParams.get('q') ?? undefined,
      page: Number(searchParams.get('page') ?? 1),
      pageSize: Number(searchParams.get('pageSize') ?? 25),
    }),
    [searchParams, sheetId, period],
  );

  const board = useAttendanceSheetBoard(query);

  const days = useMemo(() => eachDay(query.from, query.to), [query.from, query.to]);

  const holidayByDate = useMemo(
    () => new Map((board.data?.holidays ?? []).map((holiday) => [holiday.date, holiday.name])),
    [board.data],
  );

  const shiftById = useMemo(
    () => new Map((shifts.data ?? []).map((shift) => [shift.id, shift])),
    [shifts.data],
  );

  /** `employeeId|workDate` → danh sách ca của ô. Tra ô phải là O(1), không quét mảng. */
  const shiftIndex = useMemo(() => {
    const index = new Map<string, string[]>();
    for (const assignment of board.data?.assignments ?? []) {
      const key = cellKey(assignment.employeeId, assignment.workDate);
      const bucket = index.get(key);
      if (bucket) bucket.push(assignment.shiftId);
      else index.set(key, [assignment.shiftId]);
    }
    return index;
  }, [board.data]);

  const dailyIndex = useMemo(() => {
    const index = new Map<string, AttendanceDaily>();
    for (const daily of board.data?.dailies ?? []) {
      index.set(cellKey(daily.employeeId, daily.workDate), daily);
    }
    return index;
  }, [board.data]);

  /**
   * `employeeId|workDate` → đơn từ phủ lên ô.
   *
   * Trải đơn ra từng ngày một lần ở đây thay vì quét cả danh sách đơn cho mỗi
   * trong 775 ô. Một đơn nghỉ 5 ngày sẽ nằm ở 5 khoá — đúng ý nghĩa "đơn này
   * chạm vào ngày này".
   */
  const requestIndex = useMemo(() => {
    const index = new Map<string, SheetRequest[]>();
    for (const request of board.data?.requests ?? []) {
      for (const date of eachDateString(request.startDate, request.endDate)) {
        const key = cellKey(request.employeeId, date);
        const bucket = index.get(key);
        if (bucket) bucket.push(request);
        else index.set(key, [request]);
      }
    }
    return index;
  }, [board.data]);

  // Qua `useMemo` chứ không `?? []` trực tiếp: mảng rỗng dựng lại mỗi lần render
  // sẽ làm hai `useMemo` bên dưới (tổng dòng, đếm ô thiếu) tính lại toàn bộ lưới
  // sau mỗi lần gõ phím vào ô tìm kiếm.
  const employees = useMemo(() => board.data?.employees ?? [], [board.data]);
  const allSelected = employees.length > 0 && selectedIds.length === employees.length;
  const isClosed = sheet.data?.status === 'CLOSED';

  /** Tổng của từng dòng, tính trên ĐÚNG khoảng ngày đang hiển thị, không phải cả tháng. */
  const totals = useMemo(() => {
    const map = new Map<
      string,
      { standardDays: number; workedMinutes: number; lateMinutes: number; otMinutes: number }
    >();
    for (const employee of employees) {
      map.set(employee.id, { standardDays: 0, workedMinutes: 0, lateMinutes: 0, otMinutes: 0 });
    }
    for (const day of days) {
      for (const employee of employees) {
        const daily = dailyIndex.get(cellKey(employee.id, day.date));
        if (!daily) continue;
        const total = map.get(employee.id);
        if (!total) continue;
        total.standardDays += Number(daily.standardDays) || 0;
        total.workedMinutes += daily.workedMinutes;
        total.lateMinutes += daily.lateMinutes;
        total.otMinutes += daily.otMinutes;
      }
    }
    return map;
  }, [employees, days, dailyIndex]);

  /**
   * Số ô có ca nhưng không có lượt chấm công nào, tính tới hôm nay.
   *
   * Ngày trong tương lai không tính: cả tháng chưa tới thì ô nào cũng "thiếu",
   * và một cảnh báo luôn bật là một cảnh báo không ai đọc.
   */
  const missingCells = useMemo(() => {
    const today = dayjs().format('YYYY-MM-DD');
    let count = 0;
    for (const day of days) {
      if (day.date > today) continue;
      for (const employee of employees) {
        const key = cellKey(employee.id, day.date);
        if (!shiftIndex.has(key)) continue;
        const daily = dailyIndex.get(key);
        if (!daily?.firstCheckInAt && (requestIndex.get(key) ?? []).length === 0) count += 1;
      }
    }
    return count;
  }, [days, employees, shiftIndex, dailyIndex, requestIndex]);

  /**
   * Job tính lại kết thúc thì mới làm mới lưới.
   *
   * Không làm mới ngay lúc bấm nút: khi request trả về, job mới chỉ vừa được
   * nhận và số liệu chưa đổi — tải lại lúc đó chỉ lấy về đúng những con số cũ
   * rồi đứng im, và người dùng kết luận nút không hoạt động.
   *
   * Quét cả nhánh `attendance` chứ không chỉ `refetch()` lưới: tính lại chạm vào
   * `AttendanceDaily`, cùng nguồn với drawer chi tiết ô và danh sách lượt chấm
   * công đang mở bên cạnh.
   */
  useEffect(() => {
    const status = recalcJob.data?.status;
    if (!recalcJobId || (status !== 'COMPLETED' && status !== 'FAILED')) return;

    if (status === 'COMPLETED') {
      toast.success(
        'Đã cập nhật bảng công',
        'Số liệu trên lưới là kết quả tính mới nhất. Ngày thuộc kỳ lương đã chốt được giữ nguyên.',
      );
      void queryClient.invalidateQueries({ queryKey: qk.attendance });
    } else {
      toast.error(
        'Cập nhật bảng công thất bại',
        recalcJob.data?.error ?? recalcJob.data?.errorMessage ?? undefined,
      );
    }
    setRecalcJobId(null);
  }, [recalcJob.data, recalcJobId, toast, queryClient]);

  async function startRecalculate() {
    try {
      const started = await recalculate.mutateAsync(sheetId);
      setRecalcJobId(started.jobId);
    } catch (caught) {
      showError(caught);
    }
  }

  function patchQuery(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(searchParams);
    Object.entries(patch).forEach(([key, value]) => {
      if (!value) next.delete(key);
      else next.set(key, value);
    });
    if (!('page' in patch)) next.delete('page');
    setSearchParams(next, { replace: true });
  }

  function shiftsOfCell(employeeId: string, date: string): Shift[] {
    return (shiftIndex.get(cellKey(employeeId, date)) ?? [])
      .map((id) => shiftById.get(id))
      .filter((item): item is Shift => Boolean(item))
      .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''));
  }

  /**
   * Phân loại MỘT LẦN cho mọi ô, dùng chung cho cả lưới lẫn dashboard.
   *
   * Trước đây mỗi ô tự phân loại lúc render. Dashboard đếm lại bằng một vòng lặp
   * thứ hai sẽ là bản sao thứ hai của cùng một luật — và ngày nó lệch đi, con số
   * trên đầu trang mâu thuẫn với chính những ô màu ngay bên dưới, mà không có
   * cách nào biết bên nào đúng.
   */
  const cellTones = useMemo(() => {
    const today = dayjs().format('YYYY-MM-DD');
    const tones = new Map<string, CellTone>();

    for (const employee of employees) {
      for (const day of days) {
        const key = cellKey(employee.id, day.date);
        tones.set(
          key,
          classifyCell({
            daily: dailyIndex.get(key) ?? null,
            requests: requestIndex.get(key) ?? [],
            hasShift: (shiftIndex.get(key) ?? []).length > 0,
            holiday: holidayByDate.has(day.date),
            isWeekend: day.isWeekend,
            isFuture: day.date > today,
          }),
        );
      }
    }
    return tones;
  }, [employees, days, dailyIndex, requestIndex, shiftIndex, holidayByDate]);

  const toneCounts = useMemo(() => {
    const counts = new Map<CellTone, number>();
    for (const tone of cellTones.values()) counts.set(tone, (counts.get(tone) ?? 0) + 1);
    return counts;
  }, [cellTones]);

  async function removeSelectedMembers() {
    try {
      const result = await removeMembers.mutateAsync({ id: sheetId, employeeIds: selectedIds });
      toast.success(
        `Đã bỏ ${result.removed} CBNV khỏi bảng`,
        'Công của họ vẫn còn nguyên trong hệ thống.',
      );
      setSelectedIds([]);
      setRemoveOpen(false);
    } catch (caught) {
      showError(caught);
    }
  }

  async function toggleClosed() {
    try {
      await closeSheet.mutateAsync({ id: sheetId, reopen: isClosed });
      toast.success(isClosed ? 'Đã mở lại bảng' : 'Đã chốt bảng chấm công');
      setCloseOpen(false);
    } catch (caught) {
      showError(caught);
    }
  }

  /**
   * Dựng đối tượng ngày công cho hộp thoại hiệu chỉnh.
   *
   * Ngày chưa có bản ghi công nào vẫn phải hiệu chỉnh được — đó chính là trường
   * hợp "quên chấm công cả ngày", và là lý do phổ biến nhất để mở hộp thoại này.
   * Hộp thoại chỉ cần `employeeId` + `workDate` để tạo bản ghi bổ sung.
   */
  function adjustTargetFor(employee: AttendanceSheetEmployee, date: string): AttendanceDaily {
    const daily = dailyIndex.get(cellKey(employee.id, date));
    const employeeRef = {
      id: employee.id,
      fullName: employee.fullName,
      employeeCode: employee.employeeCode,
      department: employee.department,
    };
    if (daily) return { ...daily, employee: employeeRef };

    return {
      id: `${employee.id}|${date}`,
      employeeId: employee.id,
      workDate: date,
      shiftId: null,
      firstCheckInAt: null,
      lastCheckOutAt: null,
      workedMinutes: 0,
      breakMinutes: 0,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      otMinutes: 0,
      makeupMinutes: 0,
      standardDays: 0,
      status: 'MISSING_RECORD',
      hasFraudFlag: false,
      appliedRequestIds: [],
      calculatedAt: new Date().toISOString(),
      employee: employeeRef,
    };
  }

  const activeFilters = ['departmentId', 'q'].filter((key) => searchParams.get(key)).length;

  return (
    <>
      <PageHeader
        title={sheet.data?.name ?? 'Bảng chấm công'}
        description={
          sheet.data
            ? `Kỳ ${dayjs(sheet.data.periodMonth).format('MM/YYYY')} · ${sheet.data.memberCount} CBNV · thành viên và lịch ca lấy từ ${
                sheet.data.shiftScheduleIds.length > 0
                  ? 'bảng phân ca của tháng'
                  : 'danh sách phòng ban'
              }.`
            : 'Đang tải bảng chấm công…'
        }
        actions={
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Link to="/attendance">
              <Button icon={<Icon name="arrow_back" size={20} />}>Danh sách bảng</Button>
            </Link>
            {/*
              Đứng ngay sau "Danh sách bảng" chứ không lẫn vào cụm sửa dữ liệu:
              đây là việc người rà công làm ĐẦU TIÊN mỗi lần mở bảng, trước khi
              tin vào bất kỳ con số nào trên lưới.

              Quyền `attendance.sheet` (có Quản lý) chứ không `attendance.adjust`:
              tính lại không sửa gì thủ công, nó chỉ chạy lại đúng luật đã cấu
              hình trên dữ liệu đã có.
            */}
            <Can do="attendance.sheet">
              <Button
                icon={<Icon name="refresh" size={20} />}
                loading={recalcRunning}
                onClick={() => void startRecalculate()}
              >
                {recalcRunning ? 'Đang cập nhật…' : 'Cập nhật bảng công'}
              </Button>
            </Can>
            <Can do="attendance.export">
              <Button icon={<Icon name="download" size={20} />} onClick={() => setExportOpen(true)}>
                Xuất Excel
              </Button>
            </Can>
            <Can do="attendance.sheet">
              <Button
                icon={<Icon name="person_add" size={20} />}
                disabled={isClosed}
                onClick={() => setAddMembersOpen(true)}
              >
                Thêm CBNV
              </Button>
            </Can>
            <Can do="attendance.sheet">
              <Button
                danger
                disabled={isClosed || selectedIds.length === 0}
                icon={<Icon name="person_remove" size={20} />}
                onClick={() => setRemoveOpen(true)}
              >
                Bỏ khỏi bảng{selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}
              </Button>
            </Can>
            <Can do="attendance.adjust">
              <Button
                type={isClosed ? 'default' : 'primary'}
                icon={<Icon name={isClosed ? 'lock_open' : 'lock'} size={20} />}
                onClick={() => setCloseOpen(true)}
              >
                {isClosed ? 'Mở lại bảng' : 'Chốt bảng'}
              </Button>
            </Can>
          </div>
        }
      />

      {/*
        Thanh tiến độ, không phải một cái spinner trên nút.

        Tính lại 50 người × 31 ngày mất hàng chục giây. Không hiện tiến độ thì
        người dùng bấm lại lần hai, rồi lần ba — mỗi lần là một job thật chạy
        song song trên cùng dữ liệu.
      */}
      {recalcRunning ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="Đang tính lại công của cả kỳ"
          description={
            <div style={{ maxWidth: 520 }}>
              <p className="sf-body-sm" style={{ margin: '0 0 8px' }}>
                Lưới sẽ tự làm mới khi xong. Bạn vẫn xem được bảng trong lúc chờ — số đang hiện là
                kết quả của lần tính trước.
              </p>
              <Progress percent={recalcJob.data?.progress ?? 0} size="small" />
            </div>
          }
        />
      ) : null}

      {isClosed ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="Bảng đã chốt"
          description="Không thêm/bớt được CBNV nữa. Số liệu công vẫn tính lại được cho tới khi kỳ lương của tháng này chốt."
        />
      ) : null}

      <FilterBar
        activeCount={activeFilters}
        onClear={() => patchQuery({ departmentId: undefined, q: undefined })}
      >
        <FilterField label="Từ ngày" htmlFor="ab-from" width={160}>
          <DatePicker
            id="ab-from"
            allowClear={false}
            format="DD/MM/YYYY"
            style={{ width: '100%' }}
            value={toDayjs(query.from)}
            // Ngoài kỳ của bảng thì Backend từ chối — chặn ngay trên lịch để
            // người dùng không phải thử rồi mới biết luật.
            disabledDate={(date) => {
              const value = date.format('YYYY-MM-DD');
              return value < period.from || value > period.to;
            }}
            onChange={(date) => patchQuery({ from: toWorkDate(date?.toDate()) })}
          />
        </FilterField>

        <FilterField label="Đến ngày" htmlFor="ab-to" width={160}>
          <DatePicker
            id="ab-to"
            allowClear={false}
            format="DD/MM/YYYY"
            style={{ width: '100%' }}
            value={toDayjs(query.to)}
            disabledDate={(date) => {
              const value = date.format('YYYY-MM-DD');
              return value < period.from || value > period.to;
            }}
            onChange={(date) => patchQuery({ to: toWorkDate(date?.toDate()) })}
          />
        </FilterField>

        <FilterField label="Phòng ban" htmlFor="ab-dept" width={220}>
          <DepartmentTreeSelect
            id="ab-dept"
            value={query.departmentId}
            onChange={(value) => patchQuery({ departmentId: value })}
            // Chỉ các phòng ban đã chọn lúc lập bảng và cấp dưới của chúng —
            // lọc sang phòng khác chỉ ra bảng trống, vì thành viên của bảng
            // không có ai ở đó.
            limitTo={sheet.data?.departmentIds}
            placeholder="Tất cả phòng ban trong bảng"
          />
        </FilterField>

        <FilterField label="Tìm nhân viên" htmlFor="ab-q" width={220}>
          <Input.Search
            id="ab-q"
            allowClear
            defaultValue={query.q}
            placeholder="Tên hoặc mã nhân viên"
            onSearch={(value) => patchQuery({ q: value || undefined })}
          />
        </FilterField>
      </FilterBar>

      {missingCells > 0 ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`${missingCells} ngày có ca nhưng chưa có lượt chấm công nào`}
          description="Đây là những ô cần rà trước khi chốt: hoặc bổ sung công bằng Hiệu chỉnh, hoặc xác nhận đúng là vắng. Ngày trong tương lai không tính vào con số này."
        />
      ) : null}

      {board.isLoading && !board.data ? (
        <TableSkeleton columns={8} />
      ) : board.error ? (
        <ApiErrorState error={board.error} onRetry={() => void board.refetch()} />
      ) : employees.length === 0 ? (
        <EmptyState
          icon="event_busy"
          title="Bảng này chưa có CBNV nào khớp bộ lọc"
          description="Bảng chỉ chứa những người được đưa vào lúc lập. Bỏ bớt bộ lọc, hoặc dùng Thêm CBNV để đưa thêm người vào bảng."
          action={
            canManage && !isClosed ? (
              <Button type="primary" onClick={() => setAddMembersOpen(true)}>
                Thêm CBNV
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <BoardSummary
            counts={toneCounts}
            employeeCount={employees.length}
            dayCount={days.length}
          />

          <div
            style={{
              overflowX: 'auto',
              background: 'var(--sf-surface)',
              border: '1px solid var(--sf-outline-variant)',
              borderRadius: 12,
            }}
          >
            <table
              className="sf-attendance-board"
              style={{ borderCollapse: 'collapse', width: '100%' }}
            >
              <caption className="sf-visually-hidden">
                Bảng chấm công từ {query.from} đến {query.to}
              </caption>
              <thead>
                <tr>
                  <th
                    scope="col"
                    style={{
                      ...headerCellStyle,
                      position: 'sticky',
                      left: 0,
                      zIndex: 3,
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
                          minWidth: 62,
                          background: holiday
                            ? 'var(--sf-warning-100)'
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

                  <th
                    scope="col"
                    style={{
                      ...headerCellStyle,
                      position: 'sticky',
                      right: 0,
                      zIndex: 3,
                      minWidth: 150,
                      borderLeft: '2px solid var(--sf-outline-variant)',
                    }}
                  >
                    Tổng kỳ
                  </th>
                </tr>
              </thead>

              <tbody>
                {employees.map((employee) => {
                  const total = totals.get(employee.id);
                  return (
                    <tr key={employee.id}>
                      <th
                        scope="row"
                        style={{
                          ...bodyCellStyle,
                          position: 'sticky',
                          left: 0,
                          zIndex: 2,
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
                        const key = cellKey(employee.id, day.date);
                        return (
                          <td key={day.date} style={{ ...bodyCellStyle, padding: 0 }}>
                            <AttendanceCell
                              employee={employee}
                              date={day.date}
                              tone={cellTones.get(key) ?? 'idle'}
                              shifts={shiftsOfCell(employee.id, day.date)}
                              daily={dailyIndex.get(key) ?? null}
                              requests={requestIndex.get(key) ?? []}
                              timezone={timezone}
                              onOpen={() => setOpenCell({ employee, date: day.date })}
                            />
                          </td>
                        );
                      })}

                      <td
                        style={{
                          ...bodyCellStyle,
                          position: 'sticky',
                          right: 0,
                          zIndex: 1,
                          background: 'var(--sf-surface)',
                          borderLeft: '2px solid var(--sf-outline-variant)',
                        }}
                      >
                        <span style={{ display: 'block', fontWeight: 600 }}>
                          {formatStandardDays(total?.standardDays ?? 0)} công
                        </span>
                        <span className="sf-caption sf-text-variant">
                          {formatMinutes(total?.workedMinutes ?? 0)}
                          {total && total.lateMinutes > 0
                            ? ` · muộn ${formatMinutes(total.lateMinutes)}`
                            : ''}
                          {total && total.otMinutes > 0
                            ? ` · OT ${formatMinutes(total.otMinutes)}`
                            : ''}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Chú thích đã lên trên cùng dashboard — dưới lưới chỉ còn phân trang. */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: 16,
              marginTop: 16,
              flexWrap: 'wrap',
            }}
          >
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

      <AttendanceCellDrawer
        open={Boolean(openCell)}
        employee={openCell?.employee ?? null}
        date={openCell?.date ?? null}
        daily={openCell ? (dailyIndex.get(cellKey(openCell.employee.id, openCell.date)) ?? null) : null}
        shifts={openCell ? shiftsOfCell(openCell.employee.id, openCell.date) : []}
        requests={openCell ? (requestIndex.get(cellKey(openCell.employee.id, openCell.date)) ?? []) : []}
        holidayName={openCell ? holidayByDate.get(openCell.date) : undefined}
        onClose={() => setOpenCell(null)}
        // Đóng drawer này TRƯỚC khi mở drawer kia. Chồng hai lớp drawer lên nhau
        // thì phím Esc đóng nhầm lớp và bẫy focus của antd đánh nhau.
        onViewLogs={() => {
          setLogsFor(openCell);
          setOpenCell(null);
        }}
        onAdjust={() => {
          if (openCell) setAdjustTarget(adjustTargetFor(openCell.employee, openCell.date));
          setOpenCell(null);
        }}
      />

      <AttendanceDetailDrawer
        open={Boolean(logsFor)}
        employeeId={logsFor?.employee.id ?? null}
        workDate={logsFor?.date ?? null}
        employeeName={logsFor?.employee.fullName ?? ''}
        onClose={() => setLogsFor(null)}
      />

      <AdjustAttendanceModal
        open={Boolean(adjustTarget)}
        daily={adjustTarget}
        onClose={() => setAdjustTarget(null)}
      />

      <AddSheetMembersModal
        open={addMembersOpen}
        sheetId={sheetId}
        existingIds={employees.map((employee) => employee.id)}
        onClose={() => setAddMembersOpen(false)}
      />

      <ExportAttendanceModal
        open={exportOpen}
        defaultFrom={query.from}
        defaultTo={query.to}
        onClose={() => setExportOpen(false)}
      />

      <ConfirmDialog
        open={removeOpen}
        title={`Bỏ ${selectedIds.length} CBNV khỏi bảng?`}
        message="Họ chỉ ra khỏi phạm vi rà soát của bảng này. Công đã tính và bản ghi chấm công của họ không bị đụng tới, và họ lập được vào bảng khác của cùng tháng."
        confirmText="Bỏ khỏi bảng"
        danger
        loading={removeMembers.isPending}
        onCancel={() => setRemoveOpen(false)}
        onConfirm={() => void removeSelectedMembers()}
      />

      <ConfirmDialog
        open={closeOpen}
        title={isClosed ? 'Mở lại bảng chấm công?' : 'Chốt bảng chấm công?'}
        message={
          isClosed
            ? 'Bảng quay lại trạng thái rà soát và sửa được thành viên. Nếu kỳ lương của tháng này đã chốt thì hệ thống sẽ từ chối.'
            : `Tuyên bố đã rà xong ${sheet.data?.memberCount ?? 0} CBNV của kỳ này. Sau khi chốt, không thêm/bớt được CBNV nữa — mở lại bảng nếu cần sửa.`
        }
        confirmText={isClosed ? 'Mở lại bảng' : 'Chốt bảng'}
        loading={closeSheet.isPending}
        onCancel={() => setCloseOpen(false)}
        onConfirm={() => void toggleClosed()}
      />
    </>
  );
}

// =============================================================================
//  Ô của lưới
// =============================================================================

/** Nền ô nói mức khớp giữa ca được xếp và giờ chấm thực tế. */
type CellTone = 'full' | 'partial' | 'missing' | 'leave' | 'holiday' | 'weekend' | 'idle';

const TONE_STYLE: Record<CellTone, { background: string; label: string }> = {
  full: { background: 'var(--sf-success-50)', label: 'Đủ công' },
  partial: { background: 'var(--sf-warning-50)', label: 'Thiếu công' },
  missing: { background: 'var(--sf-error-50)', label: 'Không chấm công' },
  // Nghỉ CÓ lương đã tô "Đủ công" — nhãn này chỉ còn cho nghỉ không tính công,
  // và phải nói ra điều đó, nếu không hai loại nghỉ trông giống hệt nhau.
  leave: { background: 'var(--sf-teal-50)', label: 'Nghỉ không tính công' },
  holiday: { background: 'var(--sf-warning-100)', label: 'Ngày lễ' },
  weekend: { background: 'var(--sf-neutral-100)', label: 'Cuối tuần' },
  idle: { background: 'transparent', label: 'Không có ca' },
};

/**
 * Cuối tuần KHÔNG có ca và KHÔNG có ai đi làm — ngày đó không phát sinh gì.
 *
 * Tách thành vị từ riêng vì hai chỗ cùng cần nó: phân loại nền ô, và quyết định
 * có nói tới đơn từ trên ô hay không. Hai chỗ lệch nhau thì ô hiện nền "cuối
 * tuần" mà vẫn đóng dấu ĐƠN, đọc như một mâu thuẫn.
 *
 * Ngày lễ nằm ngoài: lễ rơi vào thứ Bảy vẫn phải hiện là lễ, vì hệ số OT của
 * ngày đó là 300% và người trực Tết cần nhìn thấy điều đó.
 */
function isIdleWeekend(input: {
  hasShift: boolean;
  holiday: boolean;
  isWeekend: boolean;
  worked: boolean;
}): boolean {
  return input.isWeekend && !input.hasShift && !input.holiday && !input.worked;
}

/** Người này có thật sự đi làm ngày đó không — có lượt chấm hoặc có giờ làm. */
function didWork(daily: AttendanceDaily | null): boolean {
  if (!daily) return false;
  return daily.workedMinutes > 0 || daily.firstCheckInAt !== null;
}

/**
 * Phân loại một ô.
 *
 * Nền ô trả lời ĐÚNG MỘT câu hỏi: **ngày này đủ công chưa?** Vì đó là câu người
 * rà công quét cả bảng để tìm, và một kênh màu chỉ chuyển tải được một câu hỏi.
 *
 * Hệ quả: nghỉ phép có lương nguyên ngày tô **đủ công**, không tô màu "nghỉ theo
 * đơn". Nó đúng là đủ công — công hưởng lương bằng đủ một ngày công của ca.
 * Thông tin "ngày này nghỉ theo đơn" không mất đi: ô vẫn đóng dấu ĐƠN, nhãn cho
 * trình đọc màn hình vẫn nói số đơn liên quan, và chi tiết ô liệt kê từng đơn.
 * Dùng màu để nói *nguồn gốc* của công thì mất chỗ để nói *đủ hay thiếu* — mà
 * thiếu công mới là thứ phải sửa trước khi chốt.
 *
 * Vì vậy `leave` giờ chỉ còn dành cho nghỉ **không** tính công (nghỉ không
 * lương): 0 công nhưng có lý do chính đáng, khác hẳn vắng mặt không phép.
 *
 * Hai nhánh giữ nguyên vị trí ưu tiên vì chúng nói về LOẠI NGÀY chứ không về
 * mức công: ngày lễ (hệ số OT riêng, phải thấy được) và cuối tuần không ca.
 *
 * Cuối tuần không ca vẫn đứng TRƯỚC mọi nhánh nghỉ phép: một đơn nghỉ từ thứ Hai
 * tới Chủ nhật phủ lên cả hai ngày cuối tuần, mà hai ngày đó vốn đã không đi làm.
 */
function classifyCell(input: {
  daily: AttendanceDaily | null;
  requests: SheetRequest[];
  hasShift: boolean;
  holiday: boolean;
  isWeekend: boolean;
  isFuture: boolean;
}): CellTone {
  const { daily, requests, hasShift, holiday, isWeekend, isFuture } = input;
  const worked = didWork(daily);

  if (isIdleWeekend({ hasShift, holiday, isWeekend, worked })) return 'weekend';

  if (daily) {
    const standardDays = Number(daily.standardDays) || 0;

    // Mốc "đủ" là NGÀY CÔNG CỦA CA, không phải hằng số 1: ca nửa ngày
    // (`workDayCredit = 0.5`) thì 0.5 công đã là đủ. So với 1 sẽ tô vàng "thiếu
    // công" cho mọi ngày làm đủ của ca đó, suốt cả tháng.
    //
    // Không so với `cap` (= ngày công × hệ số ngày): đi làm Chủ nhật được 2 công
    // nhưng làm đủ ca Chủ nhật thì vẫn là đủ, không phải "vượt mức".
    const fullCredit = readDayCredit(daily)?.dayCredit ?? 1;

    if (fullCredit > 0 && standardDays >= fullCredit) return holiday ? 'holiday' : 'full';
    if (standardDays > 0 || worked) return 'partial';

    // Tới đây là 0 công. Có đơn thì vẫn không phải vắng mặt vô cớ.
    if (daily.status === 'ON_LEAVE') return 'leave';
  }

  if (requests.some((request) => request.status === 'APPROVED')) return 'leave';
  if (holiday) return 'holiday';

  // Không còn nhánh `isWeekend` nào ở đây, và đó là đúng: mọi cuối tuần không ca
  // đã thoát ở `isIdleWeekend` phía trên. Cuối tuần CÓ ca mà không ai chấm công
  // thì rơi xuống `missing` như ngày thường — người được xếp trực thứ Bảy mà
  // vắng là chuyện phải thấy, không phải chuyện bỏ qua vì hôm đó là cuối tuần.
  //
  // Ngày mai chưa ai chấm công được. Tô đỏ cả nửa tháng còn lại là biến cảnh báo
  // thành nhiễu, và người dùng học cách bỏ qua màu đỏ trên bảng này.
  if (!hasShift || isFuture) return 'idle';
  return 'missing';
}

function AttendanceCell({
  employee,
  date,
  shifts,
  daily,
  requests,
  tone,
  timezone,
  onOpen,
}: {
  employee: AttendanceSheetEmployee;
  date: string;
  shifts: Shift[];
  daily: AttendanceDaily | null;
  requests: SheetRequest[];
  /** Đã phân loại ở tầng trên — xem `cellTones`. */
  tone: CellTone;
  timezone: string;
  onOpen: () => void;
}) {
  /**
   * Ô cuối tuần không ca thì KHÔNG nhắc tới đơn.
   *
   * Đơn nghỉ dài ngày phủ luôn cả thứ Bảy và Chủ nhật, nên không lọc thì mỗi
   * đơn một tuần lại đóng dấu ĐƠN lên hai ô mà ngày đó vốn không đi làm. Đơn
   * vẫn còn nguyên trong chi tiết ô — bấm vào vẫn tra được, chỉ là không chiếm
   * chỗ trên lưới.
   *
   * Suy từ `tone` chứ không gọi lại `isIdleWeekend`: nền "Cuối tuần" giờ CHỈ
   * sinh ra từ đúng vị từ đó, nên hai chỗ không thể lệch nhau.
   */
  const showRequests = requests.length > 0 && tone !== 'weekend';

  const shiftMark = shifts.length > 0 ? shifts.map(shiftSymbol).join('+') : null;
  const checkIn = daily?.firstCheckInAt ? formatTime(daily.firstCheckInAt, timezone) : null;
  const checkOut = daily?.lastCheckOutAt ? formatTime(daily.lastCheckOutAt, timezone) : null;

  /**
   * Nhãn cho trình đọc màn hình — docs/16 mục 14.2 điều 1: màu nền KHÔNG được là
   * kênh thông tin duy nhất. Người dùng bàn phím nghe được đúng những gì người
   * dùng chuột nhìn thấy qua màu.
   */
  const label = [
    employee.fullName,
    `ngày ${date}`,
    shiftMark ? `ca ${shifts.map((shift) => shift.name).join(', ')}` : 'không có ca',
    checkIn || checkOut ? `chấm ${checkIn ?? '—'} đến ${checkOut ?? '—'}` : 'không có lượt chấm công',
    TONE_STYLE[tone].label,
    showRequests ? `${requests.length} đơn liên quan` : '',
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <button
      type="button"
      aria-label={`${label}. Bấm để xem chi tiết.`}
      onClick={onOpen}
      style={{
        display: 'block',
        width: '100%',
        minHeight: 62,
        border: 'none',
        borderRadius: 0,
        padding: '6px 4px',
        cursor: 'pointer',
        font: 'inherit',
        textAlign: 'center',
        background: TONE_STYLE[tone].background,
      }}
    >
      {shiftMark ? (
        <span
          style={{
            display: 'inline-block',
            minWidth: 26,
            paddingInline: 5,
            borderRadius: 6,
            fontSize: 11,
            lineHeight: '18px',
            fontWeight: 600,
            background: 'var(--sf-teal-700)',
            color: '#FFFFFF',
          }}
        >
          {shiftMark}
        </span>
      ) : (
        // Ghim mực như phần giờ bên dưới: ô này nằm trên nền tone sáng cố định,
        // mà `sf-text-muted` lật thành màu nhạt khi bật chế độ tối.
        <span style={{ fontSize: 11, lineHeight: '18px', color: 'var(--sf-neutral-600)' }}>—</span>
      )}

      {/* Giờ vào và giờ ra xếp DỌC: cột rộng 62px, hai mốc "08:02–17:31" nằm
          ngang sẽ bóp chữ tới mức không đọc được hoặc kéo giãn cả bảng. */}
      <span
        style={{
          display: 'block',
          fontSize: 11,
          lineHeight: '15px',
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--sf-neutral-700)',
        }}
      >
        {checkIn ?? '·'}
      </span>
      <span
        style={{
          display: 'block',
          fontSize: 11,
          lineHeight: '15px',
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--sf-neutral-700)',
        }}
      >
        {checkOut ?? '·'}
      </span>

      {showRequests ? (
        <span
          aria-hidden="true"
          title="Có đơn từ liên quan"
          style={{
            display: 'block',
            fontSize: 10,
            lineHeight: '12px',
            fontWeight: 600,
            color: 'var(--sf-teal-800)',
          }}
        >
          ĐƠN
        </span>
      ) : null}
    </button>
  );
}

/** Ký hiệu ca in trên bảng công. Dùng `symbol` do HR khai; chưa khai thì viết tắt tên ca. */
function shiftSymbol(shift: Shift): string {
  if (shift.symbol) return shift.symbol;
  const words = shift.name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 1) return (words[0] as string).slice(0, 2).toUpperCase();
  return words
    .slice(0, 2)
    .map((word) => word[0] ?? '')
    .join('')
    .toUpperCase();
}

/**
 * Thứ tự các ô thống kê — theo mức độ CẦN XỬ LÝ, không theo bảng chữ cái.
 *
 * Bốn loại đầu là những thứ người rà công phải làm gì đó với chúng; ba loại sau
 * là bối cảnh (ngày không có nghĩa vụ làm việc). `idle` không có mặt: nó là
 * "không có ca hoặc ngày chưa tới" — sự vắng mặt của thông tin, không phải một
 * tình trạng để báo cáo, và nó sẽ là ô lớn nhất bảng nếu đưa vào.
 */
const SUMMARY_TONES: { tone: CellTone; icon: string }[] = [
  { tone: 'missing', icon: 'error' },
  { tone: 'partial', icon: 'schedule' },
  { tone: 'full', icon: 'check_circle' },
  { tone: 'leave', icon: 'event_busy' },
  { tone: 'holiday', icon: 'celebration' },
  { tone: 'weekend', icon: 'weekend' },
];

/**
 * Dashboard tình hình chấm công — cũng chính là chú thích màu của lưới.
 *
 * Gộp hai thứ làm một là chủ ý: một bảng chú thích tách rời chỉ nói "màu này
 * nghĩa là gì", còn đây trả lời luôn "và đang có bao nhiêu ô như vậy". Người mở
 * bảng nắm được tình hình trước khi cuộn tới ô đầu tiên.
 *
 * Đặt TRÊN lưới vì lưới cuộn ngang và dài — chú thích nằm dưới thì phải cuộn
 * qua hết bảng mới đọc được thứ cần biết để đọc chính bảng đó.
 *
 * Đây là KPI row, KHÔNG phải biểu đồ: sáu con số rời rạc không có trục chung
 * nào để so, và một biểu đồ cột ở đây chỉ thêm mực chứ không thêm nghĩa.
 *
 * Màu KHÔNG đứng một mình (docs/16 mục 14.2 điều 1): mỗi ô có ô màu + biểu
 * tượng + nhãn chữ + con số. Con số mặc màu chữ thường, không mặc màu trạng
 * thái — màu là việc của ô vuông bên cạnh.
 */
function BoardSummary({
  counts,
  employeeCount,
  dayCount,
}: {
  counts: Map<CellTone, number>;
  employeeCount: number;
  dayCount: number;
}) {
  const graded = SUMMARY_TONES.reduce((sum, item) => sum + (counts.get(item.tone) ?? 0), 0);

  return (
    <section
      aria-label="Tình hình chấm công của bảng"
      style={{
        background: 'var(--sf-surface)',
        border: '1px solid var(--sf-outline-variant)',
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 12,
        }}
      >
        <span className="sf-label-md">Tình hình chấm công · cũng là chú thích nền ô</span>
        {/*
          Nói rõ đang đếm trên cái gì. Lưới phân trang theo người, nên con số này
          là của TRANG ĐANG XEM — để trống phạm vi thì người dùng đọc thành "cả
          bảng" và yên tâm sai.
        */}
        <span className="sf-body-sm sf-text-variant">
          {employeeCount} CBNV × {dayCount} ngày đang hiển thị
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 12,
        }}
      >
        {SUMMARY_TONES.map(({ tone, icon }) => {
          const count = counts.get(tone) ?? 0;
          const share = graded > 0 ? Math.round((count / graded) * 100) : 0;

          return (
            <div
              key={tone}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                padding: 12,
                borderRadius: 10,
                border: '1px solid var(--sf-outline-variant)',
                // Nền chính là màu ô trên lưới — đó là thứ biến thống kê này
                // thành chú thích mà không cần một bảng chú thích thứ hai.
                background: TONE_STYLE[tone].background,
                /*
                 * Mực ghim vào nấc RAMP cố định, KHÔNG dùng `--sf-on-surface`.
                 *
                 * Nền tone là màu sáng cố định — khối `prefers-color-scheme: dark`
                 * ở tokens.css không định nghĩa lại `--sf-success-50` và các bạn
                 * của nó, trong khi `--sf-on-surface` thì có (lật thành gần
                 * trắng). Dùng token ngữ nghĩa ở đây thì ngày bật chế độ tối lên
                 * là chữ trắng trên nền sáng — biến mất hoàn toàn.
                 *
                 * Nền không đổi theo theme thì chữ trên nó cũng không được đổi.
                 * Các ô của lưới bên dưới đã ghim mực theo đúng cách này.
                 */
                color: 'var(--sf-neutral-900)',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name={icon} size={16} color="var(--sf-neutral-600)" />
                <span className="sf-body-sm" style={{ fontWeight: 600 }}>
                  {TONE_STYLE[tone].label}
                </span>
              </span>

              <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span
                  style={{
                    fontSize: 26,
                    lineHeight: '32px',
                    fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {count}
                </span>
                <span className="sf-caption" style={{ color: 'var(--sf-neutral-600)' }}>
                  ngày{count > 0 ? ` · ${share}%` : ''}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// =============================================================================
//  Tiện ích ngày
// =============================================================================

function cellKey(employeeId: string, date: string): string {
  return `${employeeId}|${date}`;
}

/** Giữ mốc ngày trong kỳ của bảng — URL cũ hoặc kỳ khác đều không kéo bảng ra ngoài tháng. */
function clampToPeriod(value: string, period: { from: string; to: string }): string {
  if (value < period.from) return period.from;
  if (value > period.to) return period.to;
  return value;
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

/** Các ngày `YYYY-MM-DD` mà một đơn phủ lên, hai đầu bao gồm. */
function eachDateString(from: string, to: string): string[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return [];

  const dates: string[] = [];
  for (let time = start; time <= end; time += 86_400_000) {
    dates.push(new Date(time).toISOString().slice(0, 10));
  }
  return dates;
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
