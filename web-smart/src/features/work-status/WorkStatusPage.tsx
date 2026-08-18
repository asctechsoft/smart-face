import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Badge, Button, DatePicker, Input, Pagination, Tooltip } from 'antd';
import { PageHeader } from '@/components/PageHeader';
import { FilterBar, FilterField } from '@/components/FilterBar';
import { ApiErrorState } from '@/components/ApiErrorState';
import { DepartmentTreeSelect } from '@/components/DepartmentTreeSelect';
import { EmptyState, useToast } from '@/components/ui';
import { TableSkeleton } from '@/components/Skeleton';
import { Icon } from '@/components/Icon';
import { Can, useCan } from '@/lib/rbac/Can';
import { useAuth } from '@/lib/auth/auth-context';
import { useErrorToast } from '@/lib/errors/use-error-toast';
import { formatMinutes, todayWorkDate, toWorkDate } from '@/lib/utils/date';
import { toDayjs } from '@/lib/utils/dayjs';
import { downloadFromUrl } from '@/lib/utils/download';
import { useExportJob } from '@/features/attendance/attendance.api';
import { AttendanceDetailDrawer } from '@/features/attendance/AttendanceDetailDrawer';
import { useApproveRequest, useRejectRequest } from '@/features/requests/requests.api';
import { ReasonDialog } from '@/components/ReasonDialog';
import { RemindEmployeesModal } from './RemindEmployeesModal';
import { TimelineAxis, WorkStatusTimeline } from './WorkStatusTimeline';
import { formatClock } from './work-status.format';
import {
  useExportWorkStatus,
  useInvalidateWorkStatus,
  useWorkStatusBoard,
  type WorkState,
  type WorkStatusRow,
} from './work-status.api';

/**
 * Theo dõi công việc trong ngày — lưới CBNV × dòng thời gian.
 *
 * ## Màn này khác bảng chấm công ở đâu
 *
 * Bảng chấm công là công cụ của KẾ TOÁN cuối tháng: mỗi dòng một người, mỗi cột
 * một NGÀY, trả lời "ai thiếu công". Màn này là công cụ của QUẢN LÝ lúc 10 giờ
 * sáng: mỗi dòng một người, trục ngang là GIỜ trong đúng một ngày, trả lời "bây
 * giờ ai đang ở đâu".
 *
 * Hai câu hỏi đó không dùng chung được một cái lưới. Nén một ngày vào một ô 62px
 * như bảng chấm công thì không còn chỗ nào để vẽ khoảng ra ngoài lúc 13:00–14:10
 * — mà chính khoảng đó mới là thứ người mở màn hình này đang tìm.
 *
 * ## Số liệu tự làm mới, nhưng chỉ khi đang xem hôm nay
 *
 * Dữ liệu của ngày đã qua không đổi nữa. Gọi lại API mỗi phút cho một ngày cố
 * định là tải thuần tuý, và nó làm bảng nháy ngay dưới tay người đang đọc.
 *
 * ## Phân loại trạng thái do BACKEND làm
 *
 * Client không suy lại "người này đang làm hay đang ra ngoài". Luật nằm ở
 * `work-status.rules.ts` và có bộ test riêng; một bản sao ở đây sẽ lệch, và ngày
 * nó lệch thì con số tổng đầu trang mâu thuẫn với chính những dòng bên dưới.
 */
export function WorkStatusPage() {
  const { timezone } = useAuth();
  const toast = useToast();
  const showError = useErrorToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const canApprove = useCan('request.approve');

  const today = todayWorkDate(timezone);

  const query = useMemo(
    () => ({
      date: searchParams.get('date') ?? today,
      departmentId: searchParams.get('departmentId') ?? undefined,
      q: searchParams.get('q') ?? undefined,
      state: (searchParams.get('state') as WorkState | null) ?? undefined,
      page: Number(searchParams.get('page') ?? 1),
      pageSize: Number(searchParams.get('pageSize') ?? 25),
    }),
    [searchParams, today],
  );

  const isToday = query.date === today;
  const board = useWorkStatusBoard(query, { live: isToday });

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [remindOpen, setRemindOpen] = useState(false);
  const [logsFor, setLogsFor] = useState<{ employeeId: string; name: string } | null>(null);
  const [rejectTarget, setRejectTarget] = useState<{ id: string; name: string } | null>(null);

  const approve = useApproveRequest();
  const reject = useRejectRequest();
  const invalidateBoard = useInvalidateWorkStatus();

  const rows = useMemo(() => board.data?.rows ?? [], [board.data]);

  // Đổi ngày hoặc đổi bộ lọc thì bỏ chọn. Giữ lại lựa chọn cũ sẽ dẫn tới việc
  // gửi nhắc nhở cho những người không còn hiện trên màn hình — người bấm nút
  // không có cách nào biết mình vừa gửi cho ai.
  useEffect(() => {
    setSelectedIds([]);
  }, [query.date, query.departmentId, query.q, query.state]);

  function patchQuery(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(searchParams);
    Object.entries(patch).forEach(([key, value]) => {
      if (!value) next.delete(key);
      else next.set(key, value);
    });
    if (!('page' in patch)) next.delete('page');
    setSearchParams(next, { replace: true });
  }

  // ---------------------------------------------------------------------------
  //  Xuất Excel
  // ---------------------------------------------------------------------------

  const startExport = useExportWorkStatus();
  const [exportJobId, setExportJobId] = useState<string | null>(null);
  const exportJob = useExportJob(exportJobId);
  const exporting =
    startExport.isPending ||
    (exportJobId !== null &&
      exportJob.data?.status !== 'COMPLETED' &&
      exportJob.data?.status !== 'FAILED');

  useEffect(() => {
    const status = exportJob.data?.status;
    if (!exportJobId || (status !== 'COMPLETED' && status !== 'FAILED')) return;

    if (status === 'COMPLETED' && exportJob.data?.downloadUrl) {
      downloadFromUrl(exportJob.data.downloadUrl, `theo-doi-cong-viec-${query.date}.xlsx`);
      toast.success('Đã tải file theo dõi công việc');
    } else if (status === 'FAILED') {
      toast.error('Không xuất được file', exportJob.data?.error ?? undefined);
    }
    setExportJobId(null);
  }, [exportJob.data, exportJobId, query.date, toast]);

  async function runExport() {
    try {
      // Xuất đúng thứ đang xem: cùng ngày, cùng phòng ban. Mở một hộp thoại hỏi
      // lại từ đầu sẽ để người dùng chọn ra một phạm vi khác với cái họ vừa rà.
      const started = await startExport.mutateAsync({
        date: query.date,
        departmentIds: query.departmentId ? [query.departmentId] : undefined,
      });
      setExportJobId(started.jobId);
    } catch (caught) {
      showError(caught);
    }
  }

  // ---------------------------------------------------------------------------
  //  Duyệt nhanh đơn ra ngoài
  // ---------------------------------------------------------------------------

  async function approveRequest(requestId: string) {
    try {
      await approve.mutateAsync({ id: requestId });
      toast.success('Đã duyệt đơn', 'Trạng thái trên lưới cập nhật ngay.');
      invalidateBoard();
    } catch (caught) {
      showError(caught);
    }
  }

  async function rejectRequest(reason: string) {
    if (!rejectTarget) return;
    try {
      await reject.mutateAsync({ id: rejectTarget.id, reason });
      toast.success('Đã từ chối đơn');
      setRejectTarget(null);
      invalidateBoard();
    } catch (caught) {
      showError(caught);
    }
  }

  // ---------------------------------------------------------------------------

  const selectedEmployees = rows
    .filter((row) => selectedIds.includes(row.employee.id))
    .map((row) => row.employee);

  const activeFilters = ['departmentId', 'q', 'state'].filter((key) =>
    searchParams.get(key),
  ).length;

  const window = board.data?.window ?? { fromMinutes: 7 * 60, toMinutes: 19 * 60 };
  const nowMinutes = board.data?.isToday ? (board.data?.nowMinutes ?? null) : null;

  return (
    <>
      <PageHeader
        title="Theo dõi công việc"
        description={
          board.data
            ? `Ngày ${board.data.workDate}${board.data.holiday ? ` · ${board.data.holiday.name}` : ''} · ${board.data.summaryScope} CBNV trong phạm vi${
                isToday ? ' · tự làm mới mỗi phút' : ''
              }.`
            : 'Đang tải tình hình làm việc…'
        }
        actions={
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            {isToday ? (
              <Tooltip title={`Số liệu tính tới ${formatClock(board.data?.nowMinutes ?? 0)}`}>
                <span
                  className="sf-body-sm"
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <Badge status="processing" />
                  Đang theo dõi trực tiếp
                </span>
              </Tooltip>
            ) : null}

            <Button
              icon={<Icon name="refresh" size={20} />}
              loading={board.isFetching}
              onClick={() => void board.refetch()}
            >
              Làm mới
            </Button>

            <Can do="attendance.export">
              <Button
                icon={<Icon name="download" size={20} />}
                loading={exporting}
                onClick={() => void runExport()}
              >
                {exporting ? 'Đang dựng file…' : 'Xuất Excel'}
              </Button>
            </Can>

            <Can do="notification.send">
              <Button
                type="primary"
                icon={<Icon name="notifications_active" size={20} />}
                disabled={selectedIds.length === 0}
                onClick={() => setRemindOpen(true)}
              >
                Nhắc chấm công{selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}
              </Button>
            </Can>
          </div>
        }
      />

      <FilterBar
        activeCount={activeFilters}
        onClear={() => patchQuery({ departmentId: undefined, q: undefined, state: undefined })}
      >
        <FilterField label="Ngày" htmlFor="ws-date" width={170}>
          <DatePicker
            id="ws-date"
            allowClear={false}
            format="DD/MM/YYYY"
            style={{ width: '100%' }}
            value={toDayjs(query.date)}
            onChange={(date) => patchQuery({ date: toWorkDate(date?.toDate()) })}
          />
        </FilterField>

        <FilterField label="Phòng ban" htmlFor="ws-dept" width={220}>
          <DepartmentTreeSelect
            id="ws-dept"
            value={query.departmentId}
            onChange={(value) => patchQuery({ departmentId: value })}
            placeholder="Tất cả phòng ban"
          />
        </FilterField>

        <FilterField label="Tìm nhân viên" htmlFor="ws-q" width={220}>
          <Input.Search
            id="ws-q"
            allowClear
            defaultValue={query.q}
            placeholder="Tên hoặc mã nhân viên"
            onSearch={(value) => patchQuery({ q: value || undefined })}
          />
        </FilterField>
      </FilterBar>

      {board.data?.scopeTruncated ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`Phạm vi có ${board.data.scopeTotal} CBNV, màn hình chỉ theo dõi được ${board.data.summaryScope} người đầu`}
          description="Mọi con số trên trang này chỉ tính trên phần đã tải. Lọc theo phòng ban để có bức tranh đầy đủ."
        />
      ) : null}

      {board.isLoading && !board.data ? (
        <TableSkeleton columns={5} />
      ) : board.error ? (
        <ApiErrorState error={board.error} onRetry={() => void board.refetch()} />
      ) : (
        <>
          {board.data ? (
            <StateSummary
              counts={board.data.summary}
              scope={board.data.summaryScope}
              active={query.state}
              onPick={(state) =>
                patchQuery({ state: state === query.state ? undefined : state })
              }
            />
          ) : null}

          {rows.length === 0 ? (
            <EmptyState
              icon="badge"
              title={
                query.state
                  ? 'Không có ai ở trạng thái này'
                  : 'Không có CBNV nào khớp bộ lọc'
              }
              description={
                query.state
                  ? 'Bấm lại ô thống kê đang chọn để bỏ lọc và xem toàn bộ danh sách.'
                  : 'Bỏ bớt bộ lọc phòng ban hoặc ô tìm kiếm để xem thêm người.'
              }
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
                {/*
                  `minWidth` là NGƯỠNG BẮT ĐẦU CUỘN, không phải bề ngang mong muốn.

                  Vùng nội dung của layout = min(viewport − 256px sidenav, 1440px)
                  − 48px padding: 1062px ở màn 1366, 976px ở màn 1280. Đặt ngưỡng
                  1080 như trước là ép cuộn ngang trên gần như mọi laptop.

                  210 + 190 (hai cột dính) + 480 (bề ngang tối thiểu của trục giờ)
                  = 880. Dưới ngưỡng đó mới cuộn — và lúc đó cuộn là đúng, vì bóp
                  trục hẹp hơn nữa thì các mốc giờ không còn phân biệt được.
                */}
                <table
                  style={{ borderCollapse: 'collapse', width: '100%', minWidth: 880 }}
                >
                  <caption className="sf-visually-hidden">
                    Trạng thái làm việc ngày {board.data?.workDate} theo từng nhân viên
                  </caption>

                  {/*
                    Chiều rộng cột khai TƯỜNG MINH, không để bảng tự chia.

                    Mọi thứ trong cột giữa (thanh ca, thanh đã làm, vạch quẹt thẻ,
                    nhãn giờ) đều `position: absolute`, nên chiều rộng NỘI TẠI của
                    nó bằng 0. `table-layout: auto` chia phần dư theo nội dung, nên
                    hai cột dính hai bên nuốt sạch bề ngang và cột giữa co về 0 —
                    cả dòng thời gian biến mất, chỉ còn một vạch mảnh.

                    `width: '100%'` trên cột giữa biến nó thành cột THAM LAM: hai
                    cột kia lấy đúng phần cố định của mình, phần còn lại về hết đây.

                    Hai cột dính giữ ở mức VỪA ĐỦ cho nội dung dài nhất của chúng
                    ("Nguyễn Văn Đức" và "Chưa đến (quá giờ)" kèm biểu tượng), chứ
                    không rộng rãi: mỗi pixel lấy thêm ở đây là một pixel bớt đi
                    của trục giờ — thứ duy nhất trên màn hình này cần bề ngang.
                  */}
                  <colgroup>
                    <col style={{ width: 210 }} />
                    <col style={{ width: '100%' }} />
                    <col style={{ width: 190 }} />
                  </colgroup>

                  <thead>
                    <tr>
                      <th scope="col" style={{ ...headerCell, ...stickyLeft, minWidth: 210 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <input
                            type="checkbox"
                            checked={
                              rows.length > 0 && selectedIds.length === rows.length
                            }
                            aria-label="Chọn tất cả nhân viên đang hiển thị"
                            onChange={(event) =>
                              setSelectedIds(
                                event.target.checked
                                  ? rows.map((row) => row.employee.id)
                                  : [],
                              )
                            }
                          />
                          Nhân viên
                        </label>
                      </th>

                      <th scope="col" style={{ ...headerCell, ...timelineCell, textAlign: 'left' }}>
                        {/* Trục giờ nằm TRONG ô tiêu đề của chính cột nó phục vụ:
                            đặt ở một dải riêng phía trên bảng thì hai thứ lệch
                            nhau vài pixel ngay khi cột trái đổi bề rộng. */}
                        <TimelineAxis window={window} />
                      </th>

                      <th
                        scope="col"
                        style={{
                          ...headerCell,
                          ...stickyRight,
                          minWidth: 190,
                          textAlign: 'left',
                        }}
                      >
                        Trạng thái
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {rows.map((row) => (
                      <WorkStatusRowView
                        key={row.employee.id}
                        row={row}
                        window={window}
                        nowMinutes={nowMinutes}
                        selected={selectedIds.includes(row.employee.id)}
                        canApprove={canApprove}
                        approving={approve.isPending}
                        onToggle={(checked) =>
                          setSelectedIds((previous) =>
                            checked
                              ? [...previous, row.employee.id]
                              : previous.filter((id) => id !== row.employee.id),
                          )
                        }
                        onOpenLogs={() =>
                          setLogsFor({
                            employeeId: row.employee.id,
                            name: row.employee.fullName,
                          })
                        }
                        onApprove={(requestId) => void approveRequest(requestId)}
                        onReject={(requestId) =>
                          setRejectTarget({ id: requestId, name: row.employee.fullName })
                        }
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  marginTop: 16,
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
        </>
      )}

      <RemindEmployeesModal
        open={remindOpen}
        workDate={query.date}
        employees={selectedEmployees}
        onClose={() => setRemindOpen(false)}
      />

      <AttendanceDetailDrawer
        open={Boolean(logsFor)}
        employeeId={logsFor?.employeeId ?? null}
        workDate={logsFor ? query.date : null}
        employeeName={logsFor?.name ?? ''}
        onClose={() => setLogsFor(null)}
      />

      <ReasonDialog
        open={Boolean(rejectTarget)}
        title={`Từ chối đơn của ${rejectTarget?.name ?? ''}?`}
        description="Nhân viên nhận được thông báo kèm đúng lý do bạn ghi ở đây."
        confirmText="Từ chối đơn"
        danger
        loading={reject.isPending}
        onCancel={() => setRejectTarget(null)}
        onConfirm={(reason) => void rejectRequest(reason)}
      />
    </>
  );
}

// =============================================================================
//  Một dòng
// =============================================================================

function WorkStatusRowView({
  row,
  window,
  nowMinutes,
  selected,
  canApprove,
  approving,
  onToggle,
  onOpenLogs,
  onApprove,
  onReject,
}: {
  row: WorkStatusRow;
  window: { fromMinutes: number; toMinutes: number };
  nowMinutes: number | null;
  selected: boolean;
  canApprove: boolean;
  approving: boolean;
  onToggle: (checked: boolean) => void;
  onOpenLogs: () => void;
  onApprove: (requestId: string) => void;
  onReject: (requestId: string) => void;
}) {
  const tone = STATE_TONE[row.state];

  /**
   * Đơn ĐANG CHỜ DUYỆT chạm vào ngày này.
   *
   * Chỉ đơn chờ duyệt mới có nút — đơn đã duyệt thì không còn việc gì để làm ở
   * đây, và một nút bấm vào không thay đổi gì sẽ dạy người dùng bỏ qua nó.
   */
  const pending = row.requests.filter((request) => request.status === 'PENDING');

  return (
    <tr>
      <th scope="row" style={{ ...bodyCell, ...stickyLeft, textAlign: 'left', fontWeight: 400 }}>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <input
            type="checkbox"
            checked={selected}
            aria-label={`Chọn ${row.employee.fullName}`}
            style={{ marginTop: 4 }}
            onChange={(event) => onToggle(event.target.checked)}
          />
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontWeight: 600 }}>{row.employee.fullName}</span>
            <span className="sf-caption sf-text-variant" style={{ display: 'block' }}>
              {row.employee.employeeCode}
              {row.employee.department ? ` · ${row.employee.department.name}` : ''}
            </span>
            <span className="sf-caption sf-text-variant" style={{ display: 'block' }}>
              {row.shifts.length > 0
                ? row.shifts
                    .map(
                      (shift) =>
                        `${shift.symbol ?? shift.code} ${shift.startTime ?? '?'}–${shift.endTime ?? '?'}`,
                    )
                    .join(' + ')
                : 'Không có ca'}
            </span>
          </span>
        </label>
      </th>

      <td style={{ ...bodyCell, ...timelineCell }}>
        <button
          type="button"
          onClick={onOpenLogs}
          title="Xem các lượt chấm công thô của ngày này"
          style={{
            display: 'block',
            width: '100%',
            padding: 0,
            border: 'none',
            background: 'none',
            cursor: 'pointer',
            font: 'inherit',
          }}
        >
          <WorkStatusTimeline
            window={window}
            shiftWindows={row.shiftWindows}
            breakWindows={row.breakWindows}
            requests={row.requests}
            marks={row.marks}
            outsideIntervals={row.outsideIntervals}
            firstCheckInMinutes={row.firstCheckInMinutes}
            lastCheckOutMinutes={row.lastCheckOutMinutes}
            state={row.state}
            nowMinutes={nowMinutes}
            label={describeRow(row)}
          />
        </button>
      </td>

      <td style={{ ...bodyCell, ...stickyRight }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          {/* Chấm màu + biểu tượng + chữ. Màu KHÔNG bao giờ là kênh duy nhất —
              docs/16 mục 14.2 điều 1. */}
          <Icon name={tone.icon} size={16} color={tone.color} />
          <span style={{ fontWeight: 600, color: tone.color }}>{row.stateLabel}</span>
        </span>

        <span className="sf-caption sf-text-variant" style={{ display: 'block' }}>
          {row.firstCheckInMinutes !== null
            ? `${formatClock(row.firstCheckInMinutes)}–${
                row.lastCheckOutMinutes !== null ? formatClock(row.lastCheckOutMinutes) : '…'
              }`
            : 'chưa có lượt chấm'}
          {row.workedMinutes > 0 ? ` · ${formatMinutes(row.workedMinutes)}` : ''}
        </span>

        {/* Chỉ hiện những sai lệch KHÁC KHÔNG. Một dòng "muộn 0 phút · OT 0 phút"
            trên mọi dòng của bảng là mực không mang thông tin. */}
        {row.lateMinutes > 0 || row.earlyLeaveMinutes > 0 || row.otMinutes > 0 ? (
          <span className="sf-caption" style={{ display: 'block', color: 'var(--sf-warning-800)' }}>
            {[
              row.lateMinutes > 0 ? `muộn ${formatMinutes(row.lateMinutes)}` : null,
              row.earlyLeaveMinutes > 0 ? `về sớm ${formatMinutes(row.earlyLeaveMinutes)}` : null,
              row.otMinutes > 0 ? `OT ${formatMinutes(row.otMinutes)}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        ) : null}

        {row.hasFraudFlag ? (
          <span className="sf-caption" style={{ display: 'block', color: 'var(--sf-error-700)' }}>
            <Icon name="flag" size={14} /> Có cờ nghi vấn
          </span>
        ) : null}

        {pending.length > 0 ? (
          <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <span className="sf-caption" style={{ width: '100%', color: 'var(--sf-teal-800)' }}>
              {pending.map((request) => request.typeName).join(', ')} · chờ duyệt
            </span>
            {canApprove && pending[0] ? (
              <>
                <Button
                  size="small"
                  type="primary"
                  loading={approving}
                  onClick={() => onApprove(pending[0]!.id)}
                >
                  Duyệt
                </Button>
                <Button size="small" danger onClick={() => onReject(pending[0]!.id)}>
                  Từ chối
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </td>
    </tr>
  );
}

/**
 * Câu mô tả dòng cho trình đọc màn hình.
 *
 * Dòng thời gian là hình ảnh thuần tuý; không có câu này thì người dùng bàn phím
 * chỉ nghe được tên và trạng thái, mất sạch phần diễn biến — mà diễn biến mới là
 * nội dung của cả màn hình.
 */
function describeRow(row: WorkStatusRow): string {
  const parts = [
    row.employee.fullName,
    row.shifts.length > 0
      ? `ca ${row.shifts.map((shift) => shift.name).join(', ')}`
      : 'không có ca',
    row.firstCheckInMinutes !== null
      ? `chấm vào ${formatClock(row.firstCheckInMinutes)}`
      : 'chưa chấm vào',
    row.lastCheckOutMinutes !== null ? `chấm ra ${formatClock(row.lastCheckOutMinutes)}` : '',
    row.outsideSinceMinutes !== null
      ? `đang ở ngoài từ ${formatClock(row.outsideSinceMinutes)}`
      : '',
    row.requests.length > 0
      ? row.requests
          .map(
            (request) =>
              `${request.typeName}${request.status === 'PENDING' ? ' chờ duyệt' : ' đã duyệt'}`,
          )
          .join(', ')
      : '',
    row.stateLabel,
  ];
  return parts.filter(Boolean).join(', ');
}

// =============================================================================
//  Dải thống kê — cũng là bộ lọc
// =============================================================================

/**
 * Trạng thái LUÔN có ô, kể cả khi bằng 0.
 *
 * Bốn cái đầu là việc phải xử lý, ba cái sau là tình hình bình thường. Ô biến
 * mất khi về 0 nghe có vẻ gọn hơn, nhưng nó phá mất thứ quan trọng nhất của một
 * dải thống kê mở suốt ngày: vị trí cố định. Người dùng học được "ô thứ hai là
 * số người vắng" và liếc đúng chỗ đó, chứ không đọc lại nhãn mỗi lần.
 */
const PINNED_STATES: WorkState[] = [
  'LATE_NOT_ARRIVED',
  'ABSENT',
  'MISSING_CHECKOUT',
  'OUTSIDE',
  'WORKING',
  'DONE',
  'NOT_ARRIVED',
  'ON_LEAVE',
];

/**
 * Ba trạng thái chỉ hiện khi thật sự có người.
 *
 * Chúng là BỐI CẢNH chứ không phải tình hình cần theo dõi: ngày thường không có
 * ai công tác thì một ô "Công tác 0" chỉ chiếm chỗ của những ô đang có số.
 */
const OPTIONAL_STATES: WorkState[] = ['BUSINESS_TRIP', 'HOLIDAY', 'NO_SHIFT'];

const STATE_TONE: Record<WorkState, { icon: string; color: string; background: string }> = {
  LATE_NOT_ARRIVED: {
    icon: 'running_with_errors',
    color: 'var(--sf-error-700)',
    background: 'var(--sf-error-50)',
  },
  ABSENT: { icon: 'person_off', color: 'var(--sf-error-700)', background: 'var(--sf-error-50)' },
  MISSING_CHECKOUT: {
    icon: 'logout',
    color: 'var(--sf-warning-800)',
    background: 'var(--sf-warning-50)',
  },
  OUTSIDE: {
    icon: 'directions_walk',
    color: 'var(--sf-warning-800)',
    background: 'var(--sf-warning-50)',
  },
  WORKING: { icon: 'work', color: 'var(--sf-teal-700)', background: 'var(--sf-teal-50)' },
  DONE: {
    icon: 'check_circle',
    color: 'var(--sf-success-700)',
    background: 'var(--sf-success-50)',
  },
  NOT_ARRIVED: {
    icon: 'schedule',
    color: 'var(--sf-neutral-700)',
    background: 'var(--sf-neutral-100)',
  },
  ON_LEAVE: { icon: 'event_busy', color: 'var(--sf-teal-800)', background: 'var(--sf-teal-50)' },
  BUSINESS_TRIP: {
    icon: 'flight_takeoff',
    color: 'var(--sf-teal-800)',
    background: 'var(--sf-teal-50)',
  },
  HOLIDAY: {
    icon: 'celebration',
    color: 'var(--sf-warning-800)',
    background: 'var(--sf-warning-100)',
  },
  NO_SHIFT: {
    icon: 'do_not_disturb_on',
    color: 'var(--sf-neutral-600)',
    background: 'var(--sf-neutral-100)',
  },
};

const STATE_LABEL: Record<WorkState, string> = {
  LATE_NOT_ARRIVED: 'Chưa đến (quá giờ)',
  ABSENT: 'Vắng',
  MISSING_CHECKOUT: 'Quên chấm ra',
  OUTSIDE: 'Đang ra ngoài',
  WORKING: 'Đang làm',
  DONE: 'Đã về',
  NOT_ARRIVED: 'Chưa đến',
  BUSINESS_TRIP: 'Công tác',
  ON_LEAVE: 'Nghỉ theo đơn',
  HOLIDAY: 'Ngày lễ',
  NO_SHIFT: 'Không có ca',
};

/**
 * Dải thống kê ở đầu trang — đồng thời là bộ lọc và là chú thích màu.
 *
 * Gộp ba vai trò vào một hàng là chủ ý: một bảng chú thích rời chỉ nói "màu này
 * nghĩa là gì", còn đây trả lời luôn "đang có bao nhiêu người như vậy" và "bấm
 * vào để chỉ xem những người đó". Người mở màn hình nắm được tình hình trước khi
 * cuộn tới dòng đầu tiên.
 *
 * Con số mặc màu chữ thường, không mặc màu trạng thái — màu là việc của ô nền và
 * của biểu tượng bên cạnh.
 */
function StateSummary({
  counts,
  scope,
  active,
  onPick,
}: {
  counts: Record<WorkState, number>;
  scope: number;
  active: WorkState | undefined;
  onPick: (state: WorkState) => void;
}) {
  const shown = [
    ...PINNED_STATES,
    ...OPTIONAL_STATES.filter((state) => (counts[state] ?? 0) > 0),
  ];

  return (
    <section
      aria-label="Tình hình làm việc trong ngày"
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
        <span className="sf-label-md">Tình hình hôm nay · bấm một ô để lọc</span>
        <span className="sf-body-sm sf-text-variant">
          Đếm trên toàn bộ {scope} CBNV khớp bộ lọc, không chỉ trang đang xem
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 12,
        }}
      >
        {shown.map((state) => {
          const tone = STATE_TONE[state];
          const count = counts[state] ?? 0;
          const isActive = active === state;

          return (
            <button
              key={state}
              type="button"
              aria-pressed={isActive}
              onClick={() => onPick(state)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                borderRadius: 10,
                cursor: 'pointer',
                textAlign: 'left',
                font: 'inherit',
                background: tone.background,
                // Ô đang lọc có viền đậm CHỨ KHÔNG đổi nền: đổi nền sẽ phá vai
                // trò chú thích màu của chính dải này.
                border: isActive
                  ? '2px solid var(--sf-teal-700)'
                  : '1px solid var(--sf-outline-variant)',
                // Bù lại đúng 1px viền dày thêm, để ô đang chọn không nhích to
                // hơn hàng xóm và làm cả dải xô lệch.
                padding: isActive ? 11 : 12,
                // Nền tone là màu sáng cố định, không đổi theo chế độ tối — nên
                // mực trên nó cũng phải ghim vào nấc ramp cố định, không dùng
                // `--sf-on-surface` (token đó lật thành gần trắng ở chế độ tối).
                color: 'var(--sf-neutral-900)',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name={tone.icon} size={16} color={tone.color} />
                <span className="sf-body-sm" style={{ fontWeight: 600 }}>
                  {STATE_LABEL[state]}
                </span>
              </span>
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
            </button>
          );
        })}
      </div>
    </section>
  );
}

// =============================================================================
//  Kiểu ô
// =============================================================================

const headerCell: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid var(--sf-outline-variant)',
  background: 'var(--sf-surface)',
  fontSize: 12,
  lineHeight: '16px',
  textAlign: 'center',
  whiteSpace: 'nowrap',
};

const bodyCell: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid var(--sf-outline-variant)',
  fontSize: 14,
  verticalAlign: 'middle',
  background: 'var(--sf-surface)',
};

/**
 * Máng của cột dòng thời gian — rộng hơn hẳn bên phải, và có lý do.
 *
 * Mốc cuối của trục rơi đúng mép phải (Backend làm tròn khoảng lên giờ tròn), nên
 * nhãn "18:00" phải nép hẳn vào trong để không tràn sang cột Trạng thái. Nép vào
 * rồi thì nó nằm sát mép, và ngay cạnh đó là đường viền 2px của cột dính — hai
 * thứ đậm chạm nhau đọc rất chật.
 *
 * 24px là khoảng thở đó. Phải đặt Y HỆT nhau ở ô tiêu đề và ô thân: trục giờ và
 * các thanh chia chung một hệ toạ độ, lệch padding một pixel là mọi nhãn giờ trỏ
 * sai chỗ trên toàn bảng.
 */
const timelineCell: React.CSSProperties = {
  padding: '8px 24px 8px 12px',
};

const stickyLeft: React.CSSProperties = {
  position: 'sticky',
  left: 0,
  zIndex: 2,
  background: 'var(--sf-surface)',
};

const stickyRight: React.CSSProperties = {
  position: 'sticky',
  right: 0,
  zIndex: 2,
  background: 'var(--sf-surface)',
  borderLeft: '2px solid var(--sf-outline-variant)',
};
