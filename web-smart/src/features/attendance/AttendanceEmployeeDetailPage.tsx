import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { DatePicker, Tabs } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PageHeader } from '@/components/PageHeader';
import { DataTable } from '@/components/DataTable';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Icon,
  StatCard,
  StatCardSkeleton,
  dailyStatusTone,
  type BadgeTone,
} from '@/components/ui';
import { Can } from '@/lib/rbac/Can';
import { useAuth } from '@/lib/auth/auth-context';
import { DAILY_STATUS_LABEL } from '@/config/constants';
import { formatDateTime, formatMinutes, formatTime } from '@/lib/utils/date';
import { formatNumber, formatStandardDays } from '@/lib/utils/format';
import { dayjs } from '@/lib/utils/dayjs';
import { useShifts, type Shift } from '@/features/policy/policy.api';
import { CreateRequestOnBehalfModal } from '@/features/requests/CreateRequestOnBehalfModal';
import { ExportAttendanceModal } from './ExportAttendanceModal';
import { shiftHours } from './AttendanceCellDrawer';
import { eachDateString, eachDay } from './attendance-calendar';
import { useEmployeeAdjustments, type AttendanceAdjustment } from './attendance.api';
import {
  useAttendanceSheet,
  useAttendanceSheetBoard,
  useAttendanceSummary,
  type SheetRequest,
} from './attendance-sheets.api';

/**
 * Chi tiết bảng công của MỘT CBNV trong một kỳ — mở từ nút "Xem chi tiết" của
 * bảng tổng hợp.
 *
 * ## Ba tầng, đọc từ trên xuống
 *
 * Màn hình này là bước cuối của một mạch ba bước, và mỗi bước thu hẹp câu hỏi:
 *
 *  1. `/attendance/:id/summary` — "người nào chốt được" (một dòng một người).
 *  2. màn này                   — "tháng này của người đó có gì" (một dòng một ngày).
 *  3. drawer ô trên lưới        — "ngày đó ra con số ấy từ đâu" (từng lượt quẹt).
 *
 * Vì vậy ở đây KHÔNG lặp lại thông tin của bước 3: không có toạ độ, không có
 * ảnh chấm công, không có điểm AI. Chúng thuộc về một ngày cụ thể, và nhồi vào
 * bảng 31 dòng thì không dòng nào đọc được.
 *
 * ## Con số ở đâu ra
 *
 * Hàng thẻ chỉ số dùng đúng `GET .../summary?employeeId=` — cùng endpoint, cùng
 * công thức với dòng của người này trên bảng tổng hợp. Tính lại ở client sẽ có
 * ngày hai màn hình nói hai con số khác nhau về cùng một người, mà không có
 * cách nào biết bên nào đúng.
 *
 * Bảng theo ngày dùng `GET .../board?employeeId=` — lưới đã trả sẵn bốn nguồn
 * cho một lượt gọi (công đã tính, lịch ca, đơn từ, ngày lễ), và đó đúng là bốn
 * thứ cần để giải thích một dòng.
 *
 * ## Trạng thái từng ngày: ưu tiên bản ghi engine
 *
 * Có bản ghi công thì `daily.status` là nguồn — engine đã cân nhắc ca, đơn từ và
 * ngày lễ khi gán nó. Client chỉ đè lên đúng một trường hợp mà enum không diễn
 * đạt được: chấm một đầu, thiếu đầu kia. Không có bản ghi thì mới suy từ lịch ca
 * và ngày lễ, vì lúc đó không còn gì khác để dựa vào.
 */
export function AttendanceEmployeeDetailPage() {
  const { id: sheetId = '', employeeId = '' } = useParams<{ id: string; employeeId: string }>();
  const navigate = useNavigate();
  const { timezone } = useAuth();

  const [exportOpen, setExportOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);

  const sheet = useAttendanceSheet(sheetId);
  const shifts = useShifts();

  const period = useMemo(() => {
    const month = sheet.data ? dayjs(sheet.data.periodMonth) : dayjs();
    return {
      month: month.format('YYYY-MM-01'),
      from: month.startOf('month').format('YYYY-MM-DD'),
      to: month.endOf('month').format('YYYY-MM-DD'),
      label: month.format('MM/YYYY'),
    };
  }, [sheet.data]);

  /*
   * `pageSize: 1` ở cả hai: bộ lọc đã thu về đúng một người, xin 25 dòng là xin
   * 24 dòng rỗng.
   *
   * Bảy thẻ chỉ số đọc từ tổng hợp THÁNG — cùng endpoint, cùng công thức với
   * dòng của người này ở màn "Bảng công". Tính lại ở đây sẽ có ngày hai màn
   * hình nói hai con số khác nhau về cùng một người.
   *
   * `enabled` gián tiếp qua `sheet.data`: chưa biết kỳ thì chưa hỏi được tháng
   * nào, và hỏi bằng tháng hiện tại sẽ chớp lên số liệu của một tháng khác.
   */
  const summary = useAttendanceSummary({
    month: sheet.data ? period.month : undefined,
    employeeId,
    pageSize: 1,
  });
  const board = useAttendanceSheetBoard({ sheetId, employeeId, pageSize: 1 });

  const adjustments = useEmployeeAdjustments(employeeId, period.from, period.to);

  const row = summary.data?.rows[0] ?? null;
  // Tra một lần: `ROW_STATUS[...]` trả `| undefined` vì `status` là chuỗi mở,
  // và một mã lạ từ Backend không được làm trắng cả thẻ nhân viên.
  const rowStatus = row ? (ROW_STATUS[row.status] ?? ROW_STATUS_FALLBACK) : null;
  const employee = board.data?.employees[0] ?? null;
  const employeeName = employee?.fullName ?? row?.fullName ?? '';

  const days = useMemo(
    () => eachDay(board.data?.from ?? period.from, board.data?.to ?? period.to),
    [board.data, period],
  );

  const shiftById = useMemo(
    () => new Map((shifts.data ?? []).map((shift) => [shift.id, shift])),
    [shifts.data],
  );

  const dailyByDate = useMemo(
    () => new Map((board.data?.dailies ?? []).map((daily) => [daily.workDate, daily])),
    [board.data],
  );

  const shiftIdsByDate = useMemo(() => {
    const index = new Map<string, string[]>();
    for (const assignment of board.data?.assignments ?? []) {
      const bucket = index.get(assignment.workDate);
      if (bucket) bucket.push(assignment.shiftId);
      else index.set(assignment.workDate, [assignment.shiftId]);
    }
    return index;
  }, [board.data]);

  /** Đơn trải ra từng ngày một lần, thay vì quét cả danh sách cho mỗi trong 31 dòng. */
  const requestsByDate = useMemo(() => {
    const index = new Map<string, SheetRequest[]>();
    for (const request of board.data?.requests ?? []) {
      for (const date of eachDateString(request.startDate, request.endDate)) {
        const bucket = index.get(date);
        if (bucket) bucket.push(request);
        else index.set(date, [request]);
      }
    }
    return index;
  }, [board.data]);

  const holidayByDate = useMemo(
    () => new Map((board.data?.holidays ?? []).map((holiday) => [holiday.date, holiday.name])),
    [board.data],
  );

  /** Ngày đã hiệu chỉnh — cột Ghi chú phải nói ra, nếu không con số trông như tự nhiên mà có. */
  const adjustedDates = useMemo(
    () => new Set((adjustments.data ?? []).map((item) => item.workDate)),
    [adjustments.data],
  );

  const rows: DayRow[] = useMemo(
    () =>
      days.map((day) => ({
        ...day,
        daily: dailyByDate.get(day.date) ?? null,
        shifts: (shiftIdsByDate.get(day.date) ?? [])
          .map((id) => shiftById.get(id))
          .filter((shift): shift is Shift => Boolean(shift))
          .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? '')),
        requests: requestsByDate.get(day.date) ?? [],
        holidayName: holidayByDate.get(day.date) ?? null,
        adjusted: adjustedDates.has(day.date),
      })),
    [days, dailyByDate, shiftIdsByDate, shiftById, requestsByDate, holidayByDate, adjustedDates],
  );

  /**
   * Ca thường trực của người này trong kỳ — ô "Ca làm việc" trên thẻ nhân viên.
   *
   * Lấy ca được xếp NHIỀU NGÀY NHẤT, không lấy ca của ngày đầu tiên: người trực
   * một hôm ca đêm rồi cả tháng ca hành chính sẽ bị dán nhãn "ca đêm" nếu ngày
   * đầu kỳ rơi trúng hôm đó. Có nhiều ca thì nói ra là có nhiều — giấu đi thì ô
   * này thành một lời khẳng định sai.
   */
  const shiftSummary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const ids of shiftIdsByDate.values()) {
      for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const top = ranked[0] ? shiftById.get(ranked[0][0]) : undefined;
    if (!top) return null;
    return {
      label: `${top.code} (${shiftHours(top)})`,
      others: ranked.length - 1,
    };
  }, [shiftIdsByDate, shiftById]);

  /**
   * Bất thường của kỳ, đếm theo NGÀY.
   *
   * Đếm ngày chứ không đếm phút: "2 lần đi muộn" và "339 phút đi muộn" trả lời
   * hai câu hỏi khác nhau, và câu người rà công hỏi trước là câu thứ nhất — một
   * người muộn 5 phút mỗi ngày suốt tháng là chuyện khác hẳn một người muộn
   * nguyên một buổi.
   */
  const anomalies = useMemo(() => {
    let lateDays = 0;
    let lateMinutes = 0;
    let earlyDays = 0;
    let earlyMinutes = 0;
    let missingPunchDays = 0;
    let absentDays = 0;

    for (const day of rows) {
      const daily = day.daily;

      /*
       * Ngày CÓ CA mà không có bản ghi công nào — hoặc engine đã kết luận vắng.
       *
       * Bỏ nhánh này ra thì một người vắng cả tháng hiện "Tổng hợp bất thường
       * (0)" ngay cạnh thẻ "Thiếu công 22 ngày", và khối bất thường nói ngược
       * lại chính hàng thẻ phía trên nó. Đây là trường hợp NẶNG NHẤT, không
       * phải trường hợp được miễn.
       */
      if (
        day.shifts.length > 0 &&
        (!daily || daily.status === 'ABSENT' || daily.status === 'MISSING_RECORD')
      ) {
        absentDays += 1;
      }

      if (!daily) continue;
      if (daily.lateMinutes > 0) {
        lateDays += 1;
        lateMinutes += daily.lateMinutes;
      }
      if (daily.earlyLeaveMinutes > 0) {
        earlyDays += 1;
        earlyMinutes += daily.earlyLeaveMinutes;
      }
      if (Boolean(daily.firstCheckInAt) !== Boolean(daily.lastCheckOutAt)) missingPunchDays += 1;
    }

    return {
      lateDays,
      lateMinutes,
      earlyDays,
      earlyMinutes,
      missingPunchDays,
      absentDays,
      leaveDays: row?.leaveDays ?? 0,
      /*
       * Tổng là số NGÀY có vấn đề, không phải số loại vấn đề: đó là khối lượng
       * việc còn phải xử lý, và là con số người dùng đối chiếu với bảng bên trên.
       *
       * Nghỉ phép KHÔNG vào tổng: nó có đơn, đã duyệt, và không phải việc phải
       * làm. Thẻ của nó ở đây chỉ để giải thích vì sao công thực tế thấp hơn
       * công chuẩn mà không có ngày nào bất thường.
       */
      total: lateDays + earlyDays + missingPunchDays + absentDays,
    };
  }, [rows, row]);

  const dayColumns: ColumnsType<DayRow> = [
    {
      title: 'Ngày',
      key: 'date',
      width: 88,
      render: (_, day) => dayjs(day.date).format('DD/MM'),
    },
    {
      title: 'Thứ',
      key: 'weekday',
      width: 64,
      render: (_, day) => (
        <span className={day.isWeekend ? 'sf-text-variant' : undefined}>{day.weekdayLabel}</span>
      ),
    },
    {
      title: 'Ca làm',
      key: 'shift',
      width: 96,
      render: (_, day) =>
        day.shifts.length > 0 ? (
          <span title={day.shifts.map((shift) => shift.name).join(', ')}>
            {day.shifts.map((shift) => shift.code).join(', ')}
          </span>
        ) : (
          <Muted />
        ),
    },
    {
      title: 'Check-in',
      key: 'checkIn',
      width: 96,
      align: 'center',
      render: (_, day) =>
        day.daily?.firstCheckInAt ? formatTime(day.daily.firstCheckInAt, timezone) : <Muted />,
    },
    {
      title: 'Check-out',
      key: 'checkOut',
      width: 100,
      align: 'center',
      render: (_, day) =>
        day.daily?.lastCheckOutAt ? formatTime(day.daily.lastCheckOutAt, timezone) : <Muted />,
    },
    {
      title: 'Giờ công',
      key: 'worked',
      width: 96,
      align: 'right',
      render: (_, day) =>
        day.daily && day.daily.workedMinutes > 0 ? (
          formatMinutes(day.daily.workedMinutes)
        ) : (
          <Muted />
        ),
    },
    {
      title: 'OT',
      key: 'ot',
      width: 80,
      align: 'right',
      render: (_, day) =>
        day.daily && day.daily.otMinutes > 0 ? formatMinutes(day.daily.otMinutes) : <Muted />,
    },
    {
      title: 'Đi muộn',
      key: 'late',
      width: 92,
      align: 'right',
      render: (_, day) => <Minutes value={day.daily?.lateMinutes ?? 0} tone="warning" />,
    },
    {
      title: 'Về sớm',
      key: 'early',
      width: 92,
      align: 'right',
      render: (_, day) => <Minutes value={day.daily?.earlyLeaveMinutes ?? 0} tone="primary" />,
    },
    {
      title: 'Trạng thái',
      key: 'status',
      width: 150,
      render: (_, day) => {
        const status = classifyDay(day);
        return (
          <Badge tone={status.tone} soft>
            {status.label}
          </Badge>
        );
      },
    },
    {
      title: 'Ghi chú',
      key: 'note',
      width: 190,
      render: (_, day) => {
        const note = dayNote(day);
        return note ? <span className="sf-body-sm">{note}</span> : <Muted />;
      },
    },
  ];

  const adjustmentColumns: ColumnsType<AttendanceAdjustment> = [
    {
      title: 'Ngày công',
      key: 'workDate',
      width: 110,
      render: (_, item) => dayjs(item.workDate).format('DD/MM/YYYY'),
    },
    {
      title: 'Loại',
      key: 'type',
      width: 140,
      render: (_, item) => (
        <Badge tone="neutral" soft>
          {ADJUST_TYPE_LABEL[item.adjustType] ?? item.adjustType}
        </Badge>
      ),
    },
    {
      title: 'Lý do',
      key: 'reason',
      render: (_, item) => item.reason,
    },
    {
      title: 'Người thực hiện',
      key: 'actor',
      width: 180,
      // Tên đã được Backend tra sẵn; rơi về id chỉ khi tài khoản đã bị xoá —
      // hiện một chuỗi id vẫn hơn hiện ô trống, vì nó còn tra ngược được.
      render: (_, item) => item.createdByName ?? item.createdByUserId,
    },
    {
      title: 'Thời điểm',
      key: 'createdAt',
      width: 160,
      render: (_, item) => formatDateTime(item.createdAt, timezone),
    },
  ];

  return (
    <>
      <div style={{ marginBottom: 8 }}>
        <Link
          to={`/attendance?month=${period.month}`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 500 }}
        >
          <Icon name="arrow_back" size={18} />
          Quay lại bảng công
        </Link>
      </div>

      <PageHeader
        breadcrumb={
          <nav aria-label="Đường dẫn" className="sf-body-sm">
            <Link to="/attendance/sheets">Bảng công</Link>
            <Separator />
            <Link to={`/attendance?month=${period.month}`}>Tháng {period.label}</Link>
            <Separator />
            <span className="sf-text-variant">{employeeName || '…'}</span>
          </nav>
        }
        title="Chi tiết bảng công"
        actions={
          <>
            <Can do="attendance.export">
              <Button variant="secondary" icon="download" onClick={() => setExportOpen(true)}>
                Xuất chi tiết
              </Button>
            </Can>
            {/*
              Đơn "bổ sung công" chứ không phải hiệu chỉnh công tại chỗ: hiệu
              chỉnh sửa thẳng bảng công và KHÔNG trừ quỹ phép, nên dùng nó cho
              một ngày nghỉ có đơn sẽ làm số dư phép cuối năm lệch mà không truy
              được từ đâu. Hiệu chỉnh vẫn nằm ở drawer từng ngày trên lưới, nơi
              người dùng đang nhìn đúng một ngày.
            */}
            <Can do="request.create_on_behalf">
              <Button variant="secondary" icon="mail" onClick={() => setRequestOpen(true)}>
                Gửi yêu cầu bổ sung
              </Button>
            </Can>
          </>
        }
      />

      <Card padding={20} style={{ marginBottom: 16 }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 24,
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0 }}>
            <Avatar name={employeeName} size={64} />
            <div style={{ minWidth: 0 }}>
              <h2 className="sf-headline-md" style={{ margin: '0 0 8px' }}>
                {employeeName || 'Đang tải…'}
              </h2>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 32 }}>
                <Fact label="Mã nhân viên" value={row?.employeeCode ?? employee?.employeeCode} />
                <Fact label="Phòng ban" value={row?.department?.name} />
                <Fact
                  label="Ca làm việc"
                  value={
                    shiftSummary
                      ? `${shiftSummary.label}${shiftSummary.others > 0 ? ` +${shiftSummary.others} ca khác` : ''}`
                      : undefined
                  }
                />
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 24 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label className="sf-field__label" htmlFor="detail-month">
                Tháng
              </label>
              {/*
                Đổi tháng ở đây là rời khỏi màn chi tiết: chi tiết luôn thuộc về
                MỘT kỳ, và kỳ khác thì người này có thể nằm ở bảng khác. Đưa về
                màn "Bảng công" của tháng vừa chọn — nơi bấm tiếp vào họ được.
              */}
              <DatePicker
                id="detail-month"
                picker="month"
                allowClear={false}
                format="MM/YYYY"
                style={{ width: 160 }}
                value={sheet.data ? dayjs(sheet.data.periodMonth) : null}
                onChange={(date) =>
                  date ? navigate(`/attendance?month=${date.format('YYYY-MM-01')}`) : undefined
                }
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="sf-field__label">Trạng thái</span>
              {rowStatus ? (
                <span>
                  <Badge tone={rowStatus.tone} soft>
                    {rowStatus.label}
                  </Badge>
                </span>
              ) : (
                <span className="sf-skeleton" style={{ width: 110, height: 24 }} />
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* `--seven` khoá cứng bảy cột: mặc định `auto-fit` chỉ nhét được sáu thẻ
          ở 1920 rồi bỏ thẻ thứ bảy đứng một mình ở hàng dưới. */}
      <div className="sf-stat-row sf-stat-row--seven" style={{ marginBottom: 16 }}>
        {summary.isPending ? (
          Array.from({ length: 7 }, (_, index) => <StatCardSkeleton key={index} />)
        ) : (
          <>
            <StatCard
              icon="event_available"
              tone="success"
              label="Công chuẩn"
              value={formatStandardDays(row?.standardDays ?? 0)}
              hint="ngày"
            />
            <StatCard
              icon="task_alt"
              tone="success"
              label="Công thực tế"
              value={formatStandardDays(row?.actualDays ?? 0)}
              hint="ngày"
            />
            <StatCard
              icon="schedule"
              tone="primary"
              label="OT"
              value={formatMinutes(row?.otMinutes ?? 0)}
              hint="đã duyệt trước"
            />
            <StatCard
              icon="running_with_errors"
              tone="warning"
              label="Đi muộn"
              value={formatNumber(row?.lateMinutes ?? 0)}
              hint="phút"
            />
            <StatCard
              icon="logout"
              tone="primary"
              label="Về sớm"
              value={formatNumber(row?.earlyLeaveMinutes ?? 0)}
              hint="phút"
            />
            <StatCard
              icon="work_off"
              tone="neutral"
              label="Nghỉ phép"
              value={formatStandardDays(row?.leaveDays ?? 0)}
              hint="ngày"
            />
            <StatCard
              icon="event_busy"
              tone={row && row.missingDays > 0 ? 'error' : 'neutral'}
              label="Thiếu công"
              value={formatStandardDays(row?.missingDays ?? 0)}
              hint="ngày"
            />
          </>
        )}
      </div>

      <Tabs
        defaultActiveKey="days"
        items={[
          {
            key: 'days',
            label: 'Chi tiết theo ngày',
            children: (
              <>
                <DataTable<DayRow>
                  rowKey="date"
                  data={board.data ? rows : undefined}
                  isLoading={board.isLoading}
                  error={board.error}
                  onRetry={() => void board.refetch()}
                  columns={dayColumns}
                  pagination={false}
                  size="middle"
                  srOnlyCount
                  emptyIcon="event_busy"
                  emptyTitle="Kỳ này chưa có ngày công nào"
                  emptyDescription="Bảng chấm công của tháng chưa được tính, hoặc CBNV này chưa thuộc bảng. Chạy Đối soát tự động ở màn tổng hợp rồi mở lại."
                />
                <Legend />
              </>
            ),
          },
          {
            key: 'adjustments',
            label: `Lịch sử điều chỉnh${adjustments.data?.length ? ` (${adjustments.data.length})` : ''}`,
            children: (
              <DataTable<AttendanceAdjustment>
                rowKey="id"
                data={adjustments.data}
                isLoading={adjustments.isLoading}
                error={adjustments.error}
                onRetry={() => void adjustments.refetch()}
                columns={adjustmentColumns}
                pagination={false}
                size="middle"
                srOnlyCount
                emptyIcon="history"
                emptyTitle="Kỳ này chưa có lượt hiệu chỉnh nào"
                emptyDescription="Mọi con số trong tháng đều do engine tính từ lượt chấm công thật, chưa có ai sửa tay. Hiệu chỉnh được thực hiện từ drawer của từng ngày trên lưới người × ngày."
              />
            ),
          },
        ]}
      />

      <Card padding={20} style={{ marginTop: 16 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            marginBottom: 16,
          }}
        >
          <h2 className="sf-headline-md" style={{ margin: 0 }}>
            {/*
              Chưa có dữ liệu thì KHÔNG in số 0: "Tổng hợp bất thường (0)" trong
              lúc đang tải đọc như một kết luận đã có — người dùng liếc qua rồi
              đi tiếp, và bỏ sót đúng thứ màn hình này sinh ra để chỉ cho họ.
            */}
            Tổng hợp bất thường{board.data ? ` (${anomalies.total})` : ''}
          </h2>
          {/*
            Đơn từ của người này, không phải hàng đợi chung: mở ra một danh sách
            toàn công ty rồi bắt người dùng tự tìm lại đúng người họ vừa xem là
            trả họ về đúng chỗ họ vừa rời đi.
          */}
          <Link
            to={`/requests?q=${encodeURIComponent(row?.employeeCode ?? '')}`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 500 }}
          >
            Xem đơn của CBNV này
            <Icon name="chevron_right" size={18} />
          </Link>
        </div>

        <div className="sf-stat-row">
          {!board.data ? (
            Array.from({ length: 5 }, (_, index) => <StatCardSkeleton key={index} />)
          ) : (
            <>
              <AnomalyCard
                icon="running_with_errors"
                tone="warning"
                label="Đi muộn"
                value={anomalies.lateDays}
                unit="ngày"
                detail={
                  anomalies.lateMinutes > 0
                    ? `Tổng ${formatNumber(anomalies.lateMinutes)} phút`
                    : undefined
                }
              />
              <AnomalyCard
                icon="logout"
                tone="primary"
                label="Về sớm"
                value={anomalies.earlyDays}
                unit="ngày"
                detail={
                  anomalies.earlyMinutes > 0
                    ? `Tổng ${formatNumber(anomalies.earlyMinutes)} phút`
                    : undefined
                }
              />
              <AnomalyCard
                icon="event_busy"
                tone="error"
                label="Thiếu check-in/out"
                value={anomalies.missingPunchDays}
                unit="ngày"
                detail={anomalies.missingPunchDays > 0 ? 'Cần bổ sung công' : undefined}
              />
              <AnomalyCard
                icon="person_off"
                tone="error"
                label="Vắng mặt"
                value={anomalies.absentDays}
                unit="ngày"
                detail={anomalies.absentDays > 0 ? 'Có ca nhưng không chấm công' : undefined}
              />
              <AnomalyCard
                icon="work_off"
                tone="neutral"
                label="Nghỉ phép"
                value={anomalies.leaveDays}
                unit="ngày"
                detail="Theo đơn đã duyệt"
              />
            </>
          )}
        </div>
      </Card>

      <ExportAttendanceModal
        open={exportOpen}
        defaultFrom={period.from}
        defaultTo={period.to}
        employee={
          employeeId && employeeName ? { id: employeeId, fullName: employeeName } : undefined
        }
        onClose={() => setExportOpen(false)}
      />

      <CreateRequestOnBehalfModal
        open={requestOpen}
        employee={
          employeeId && employeeName ? { id: employeeId, fullName: employeeName } : undefined
        }
        onClose={() => setRequestOpen(false)}
      />
    </>
  );
}

// =============================================================================
//  Phân loại một ngày
// =============================================================================

interface DayRow {
  date: string;
  dayOfMonth: number;
  weekdayLabel: string;
  isWeekend: boolean;
  daily: import('./attendance.api').AttendanceDaily | null;
  shifts: Shift[];
  requests: SheetRequest[];
  holidayName: string | null;
  adjusted: boolean;
}

/**
 * Nhãn trạng thái của một dòng ngày.
 *
 * Thứ tự quyết định, và mỗi nhánh có lý do:
 *
 *  1. **Chấm một đầu** — `DailyStatus` không có giá trị nào diễn đạt được "có
 *     giờ vào, không có giờ ra". Engine gán ngày đó là `INSUFFICIENT` (thiếu
 *     giờ), đúng về số nhưng sai về VIỆC PHẢI LÀM: thiếu giờ thì phải quyết trừ
 *     hay bù, còn thiếu một đầu thì chỉ cần bổ sung giờ. Đây là nhánh duy nhất
 *     client được phép đè lên engine.
 *  2. **Có bản ghi** — dùng thẳng `daily.status` qua `DAILY_STATUS_LABEL`. Engine
 *     đã cân nhắc ca, đơn từ và ngày lễ khi gán, nên suy lại ở client chỉ tạo ra
 *     một luật thứ hai để lệch.
 *  3. **Không có bản ghi** — mới suy từ ngày lễ → đơn từ → có ca hay không.
 *     "Có ca mà không có bản ghi nào" là trường hợp đáng báo động nhất của cả
 *     bảng, và nó phải khác hẳn "hôm đó vốn không phải đi làm".
 */
function classifyDay(day: DayRow): { label: string; tone: BadgeTone } {
  const daily = day.daily;

  if (daily) {
    const hasIn = Boolean(daily.firstCheckInAt);
    const hasOut = Boolean(daily.lastCheckOutAt);
    if (hasIn && !hasOut) return { label: 'Thiếu check-out', tone: 'error' };
    if (!hasIn && hasOut) return { label: 'Thiếu check-in', tone: 'error' };

    return {
      label: DAILY_STATUS_LABEL[daily.status] ?? daily.status,
      tone: dailyStatusTone(daily.status),
    };
  }

  if (day.holidayName) return { label: 'Ngày lễ', tone: 'success' };

  const effective = day.requests.find((request) => request.status !== 'PENDING');
  if (effective) return { label: effective.requestTypeName, tone: 'teal' };

  if (day.shifts.length > 0) return { label: 'Không chấm công', tone: 'error' };

  return { label: 'Ngày nghỉ', tone: 'neutral' };
}

/**
 * Cột Ghi chú — nói VÌ SAO dòng này khác thường, không lặp lại cột Trạng thái.
 *
 * Đơn chờ duyệt được nêu riêng: nó CHƯA vào công (engine chỉ tính đơn đã hiệu
 * lực), nên người rà thấy ngày vắng mà không biết đã có đơn nằm chờ sẽ đi hỏi
 * lại nhân viên một câu đã có câu trả lời.
 */
function dayNote(day: DayRow): string | null {
  const parts: string[] = [];

  if (day.holidayName) parts.push(day.holidayName);

  for (const request of day.requests) {
    parts.push(
      request.status === 'PENDING'
        ? `${request.requestTypeName} · chờ duyệt`
        : `${request.requestTypeName} · đã duyệt`,
    );
  }

  if (day.adjusted) parts.push('Đã hiệu chỉnh');
  if (day.daily?.hasFraudFlag) parts.push('Có cờ nghi vấn');

  return parts.length > 0 ? parts.join(' · ') : null;
}

const ADJUST_TYPE_LABEL: Record<string, string> = {
  ADD: 'Bổ sung bản ghi',
  MODIFY_TIME: 'Sửa giờ',
  VOID: 'Huỷ bản ghi',
};

/** Mã trạng thái lạ (Backend thêm giá trị mới) vẫn phải hiện ra một thứ đọc được. */
const ROW_STATUS_FALLBACK = { label: 'Không xác định', tone: 'neutral' as BadgeTone };

/** Nhãn trạng thái CẢ KỲ của người này — cùng bảng với bảng tổng hợp. */
const ROW_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  VALID: { label: 'Hợp lệ', tone: 'success' },
  NEEDS_REVIEW: { label: 'Cần đối soát', tone: 'warning' },
  MISSING_CHECK_OUT: { label: 'Thiếu check-out', tone: 'error' },
  LOCKED: { label: 'Đã khoá', tone: 'neutral' },
};

// =============================================================================
//  Mảnh nhỏ
// =============================================================================

function Separator() {
  return (
    <span className="sf-text-variant" style={{ margin: '0 8px' }}>
      /
    </span>
  );
}

function Fact({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div className="sf-body-sm sf-text-variant">{label}</div>
      <div style={{ fontWeight: 600 }}>{value || '—'}</div>
    </div>
  );
}

/** Ô trống của bảng. Dấu gạch chứ không chuỗi rỗng — ô trắng đọc như lỗi hiển thị. */
function Muted() {
  return <span className="sf-text-variant">—</span>;
}

/**
 * Số phút lệch giờ. Bằng 0 thì hiện dấu gạch.
 *
 * Một cột đầy số 0 buộc mắt đọc từng ô để tìm ô khác 0, mà đó là thứ duy nhất
 * đáng tìm ở cột này.
 */
function Minutes({ value, tone }: { value: number; tone: 'warning' | 'primary' }) {
  if (value <= 0) return <Muted />;
  const color = tone === 'warning' ? 'var(--sf-warning-800)' : 'var(--sf-blue-700)';
  return <span style={{ color }}>{formatNumber(value)} phút</span>;
}

/**
 * Chú thích màu, đặt NGAY DƯỚI bảng.
 *
 * Sáu tông trên bảng là sáu ý nghĩa, và badge có chữ nên tự đọc được — chú thích
 * ở đây để đọc theo NHÓM: liếc một cái là biết màu nào cần xử lý. Danh sách này
 * phải khớp với `classifyDay`; thêm nhánh ở đó mà quên ở đây là để lại một màu
 * không ai giải thích.
 */
function Legend() {
  const items: { tone: BadgeTone; label: string }[] = [
    { tone: 'success', label: 'Đủ công / Ngày lễ' },
    { tone: 'warning', label: 'Đi muộn / Về sớm / Thiếu giờ' },
    { tone: 'error', label: 'Vắng / Thiếu check-in, check-out' },
    { tone: 'teal', label: 'Nghỉ theo đơn' },
    { tone: 'neutral', label: 'Ngày nghỉ' },
  ];

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 20,
        padding: '12px 16px',
        marginTop: 12,
        background: 'var(--sf-surface)',
        border: '1px solid var(--sf-outline-variant)',
        borderRadius: 12,
      }}
    >
      {items.map((item) => (
        <span
          key={item.tone}
          className="sf-body-sm"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
        >
          <span
            aria-hidden
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: LEGEND_DOT[item.tone],
            }}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

const LEGEND_DOT: Record<BadgeTone, string> = {
  success: 'var(--sf-success-600)',
  warning: 'var(--sf-warning-600)',
  error: 'var(--sf-error-600)',
  teal: 'var(--sf-blue-600)',
  violet: 'var(--sf-violet-600)',
  neutral: 'var(--sf-neutral-400)',
};

/** Thẻ của khối "Tổng hợp bất thường" — con số + đơn vị + một dòng bổ nghĩa. */
function AnomalyCard({
  icon,
  tone,
  label,
  value,
  unit,
  detail,
}: {
  icon: string;
  tone: 'warning' | 'primary' | 'error' | 'neutral';
  label: string;
  value: number;
  unit: string;
  detail?: string;
}) {
  return (
    <StatCard
      icon={icon}
      // Không có bất thường thì KHÔNG tô màu cảnh báo: một thẻ đỏ ghi số 0 dạy
      // người dùng bỏ qua màu đỏ, và lần sau nó thật thì họ cũng bỏ qua nốt.
      tone={value > 0 ? tone : 'neutral'}
      label={label}
      value={formatNumber(value)}
      suffix={unit}
      hint={value > 0 ? detail : 'Không có'}
    />
  );
}
