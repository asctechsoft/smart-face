import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Alert, DatePicker, Input, Progress } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PageHeader } from '@/components/PageHeader';
import { FilterBar, FilterField } from '@/components/FilterBar';
import { DataTable } from '@/components/DataTable';
import { DepartmentTreeSelect } from '@/components/DepartmentTreeSelect';
import {
  Badge,
  Button,
  Icon,
  LinkButton,
  Select,
  StatCard,
  StatCardSkeleton,
} from '@/components/ui';
import { Can } from '@/lib/rbac/Can';
import { useAuth } from '@/lib/auth/auth-context';
import { useBranches, toSelectOptions } from '@/features/shared/org.api';
import { formatMinutes, formatRelativeDay, formatTime } from '@/lib/utils/date';
import { formatNumber, formatStandardDays } from '@/lib/utils/format';
import { dayjs } from '@/lib/utils/dayjs';
import { ExportAttendanceModal } from './ExportAttendanceModal';
import { useRecalculateSheets } from './use-recalculate-sheet';
import { CloseSheetsModal } from './CloseSheetsModal';
import {
  useAttendanceSummary,
  type AttendanceSummaryRow,
  type AttendanceSummaryStatus,
} from './attendance-sheets.api';

/**
 * Màn **Bảng công** — tổng hợp công của một THÁNG, mỗi dòng một NGƯỜI.
 *
 * ## Vì sao cửa vào là tháng, không phải danh sách bảng
 *
 * Một tháng được chia thành nhiều bảng chấm công theo nhóm phòng ban. Đó là đơn
 * vị TỔ CHỨC — nó quyết định ai thuộc kỳ này và ai chốt cái gì — nhưng không
 * phải đơn vị người dùng nghĩ tới. Kế toán mở màn hình để hỏi *"tháng 5 còn ai
 * chưa xong"*, không phải *"bảng tháng 5 của Kho vận còn ai chưa xong"*. Bắt họ
 * chọn bảng trước là bắt trả lời một câu hỏi mà chính họ không đặt ra.
 *
 * Các bảng không biến mất: chúng nằm sau breadcrumb "Bảng công" (danh sách bảng,
 * nơi lập và xoá bảng), và nằm trong hộp thoại chốt — vì chốt vẫn theo từng bảng.
 *
 * ## Ba cách đọc, ba câu hỏi
 *
 *  1. màn này (`/attendance`)                     — "tháng này ai chốt được".
 *  2. lưới người × ngày (`/attendance/:id`)       — "ngày nào của ai còn vướng".
 *  3. chi tiết một CBNV (`.../employees/:id`)     — "tháng này của người đó có gì".
 *
 * Gộp (1) và (2) vào một bảng thì mất cả hai — bảng đủ rộng để soi từng ngày sẽ
 * không liếc được, và bảng đủ gọn để liếc thì không sửa được gì.
 *
 * ## Số liệu do Backend gộp, không phải client cộng
 *
 * Hàng thẻ chỉ số nói về CẢ THÁNG ("256 nhân viên", "5.632 công chuẩn"). Cộng
 * từ dữ liệu lưới ở client chỉ ra được con số của 25 người trên trang đang mở,
 * và nó nhảy mỗi lần lật trang trong khi nhãn vẫn ghi "Tổng". Xem
 * `GET /admin/attendance-sheets/summary`.
 *
 * ## Ba cột công, ba nguồn — đặt cạnh nhau là toàn bộ mục đích của bảng
 *
 * | Cột | Nguồn | Nghĩa |
 * |---|---|---|
 * | Công chuẩn | `ShiftAssignment` | số ngày ĐƯỢC XẾP ca |
 * | Công thực tế | `AttendanceDaily` | công engine đã tính |
 * | Thiếu công | hiệu hai cột trên | phần chưa giải trình được |
 */
export function AttendanceSummaryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { timezone } = useAuth();

  const [exportOpen, setExportOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);

  const branches = useBranches();

  const query = {
    // Bỏ trống = tháng hiện tại, do Backend quyết. Không tự điền `dayjs()` ở
    // đây: giờ máy người dùng có thể lệch, và "tháng này" phải là tháng theo
    // lịch công ty chứ không theo đồng hồ của cái máy đang mở trình duyệt.
    month: searchParams.get('month') ?? undefined,
    branchId: searchParams.get('branchId') ?? undefined,
    departmentId: searchParams.get('departmentId') ?? undefined,
    q: searchParams.get('q') ?? undefined,
    needsReviewOnly: searchParams.get('needsReview') === '1' ? true : undefined,
    page: Number(searchParams.get('page') ?? 1),
    pageSize: Number(searchParams.get('pageSize') ?? 20),
  };

  const summary = useAttendanceSummary(query);
  const totals = summary.data?.totals;
  const sheets = summary.data?.sheets ?? [];

  // Tính lại chạm tới MỌI bảng của tháng: đối soát đúng một bảng rồi báo "đã
  // cập nhật" là nói sai với người vừa nhìn con số của cả tháng.
  const recalc = useRecalculateSheets(sheets.map((sheet) => sheet.id));

  const openSheets = sheets.filter((sheet) => sheet.status !== 'CLOSED');
  const allClosed = sheets.length > 0 && openSheets.length === 0;

  function patchQuery(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(searchParams);
    Object.entries(patch).forEach(([key, value]) => {
      if (!value) next.delete(key);
      else next.set(key, value);
    });
    // Đổi bộ lọc thì quay về trang 1: giữ nguyên `page=8` sau khi lọc còn 24
    // dòng sẽ ra một bảng trống, và người dùng đọc nó là "không có ai".
    if (!('page' in patch)) next.delete('page');
    setSearchParams(next, { replace: true });
  }

  const columns: ColumnsType<AttendanceSummaryRow> = [
    {
      title: 'STT',
      key: 'index',
      width: 56,
      align: 'right',
      // Số thứ tự TRONG CẢ KỲ, không phải trong trang: dòng đầu trang 2 là số
      // 21, không phải số 1. Người rà công đọc số này để nói chuyện với nhau
      // ("dòng 137"), và nó phải trỏ về cùng một người ở mọi lần mở.
      render: (_, __, index) =>
        (summary.data ? (summary.data.meta.page - 1) * summary.data.meta.pageSize : 0) + index + 1,
    },
    {
      title: 'Mã NV',
      dataIndex: 'employeeCode',
      key: 'employeeCode',
      width: 104,
    },
    {
      title: 'Họ và tên',
      key: 'fullName',
      width: 176,
      render: (_, row) => <span style={{ fontWeight: 600 }}>{row.fullName}</span>,
    },
    {
      title: 'Phòng ban',
      key: 'department',
      width: 132,
      render: (_, row) => row.department?.name ?? '—',
    },
    {
      title: <ColumnTitle label="Công chuẩn" unit="ngày" />,
      key: 'standardDays',
      width: 104,
      align: 'right',
      render: (_, row) => formatStandardDays(row.standardDays),
    },
    {
      title: <ColumnTitle label="Công thực tế" unit="ngày" />,
      key: 'actualDays',
      width: 112,
      align: 'right',
      render: (_, row) => (
        <span style={{ fontWeight: 600 }}>{formatStandardDays(row.actualDays)}</span>
      ),
    },
    {
      title: <ColumnTitle label="OT" unit="giờ" />,
      key: 'otMinutes',
      width: 88,
      align: 'right',
      render: (_, row) => (row.otMinutes > 0 ? formatMinutes(row.otMinutes) : '—'),
    },
    {
      title: <ColumnTitle label="Đi muộn" unit="phút" />,
      key: 'lateMinutes',
      width: 92,
      align: 'right',
      render: (_, row) => <Deviation minutes={row.lateMinutes} />,
    },
    {
      title: <ColumnTitle label="Về sớm" unit="phút" />,
      key: 'earlyLeaveMinutes',
      width: 92,
      align: 'right',
      render: (_, row) => <Deviation minutes={row.earlyLeaveMinutes} />,
    },
    {
      title: <ColumnTitle label="Nghỉ phép" unit="ngày" />,
      key: 'leaveDays',
      width: 98,
      align: 'right',
      render: (_, row) => (row.leaveDays > 0 ? formatStandardDays(row.leaveDays) : '—'),
    },
    {
      title: <ColumnTitle label="Thiếu công" unit="ngày" />,
      key: 'missingDays',
      width: 104,
      align: 'right',
      render: (_, row) =>
        row.missingDays > 0 ? (
          <span style={{ fontWeight: 600, color: 'var(--sf-error-700)' }}>
            {formatStandardDays(row.missingDays)}
          </span>
        ) : (
          '—'
        ),
    },
    {
      title: 'Trạng thái',
      key: 'status',
      width: 132,
      render: (_, row) => {
        const label = STATUS_LABEL[row.status];
        return (
          <Badge tone={label.tone} soft>
            {label.text}
          </Badge>
        );
      },
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 148,
      render: (_, row) =>
        // Không có bảng thì không có màn chi tiết để mở — chi tiết nằm DƯỚI
        // bảng giữ người này. Dòng mồ côi (bảng vừa bị xoá) hiện dấu gạch thay
        // vì một liên kết dẫn tới trang lỗi.
        row.sheetId === null ? (
          <span className="sf-text-variant">—</span>
        ) : (
          /*
           * Sang màn CHI TIẾT của đúng người này, không mở drawer tại chỗ: thứ
           * cần xem tiếp là 31 ngày công của họ kèm lịch sử điều chỉnh, và
           * không hộp thoại nào nhét vừa chừng ấy vào cạnh bảng này.
           *
           * Đi bằng `employeeId` chứ không `?q=<mã NV>`: `q` khớp theo
           * `contains` nên mã "NV001" còn kéo về cả "NV0011" — bấm "Xem chi
           * tiết" của một người mà ra màn hình có hai người là một lỗi im lặng.
           */
          <Link
            to={`/attendance/${row.sheetId}/employees/${row.employeeId}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontWeight: 500,
              // Không cho ngắt dòng: "Xem chi" / "tiết" trên hai dòng làm dòng
              // bảng cao gấp rưỡi và mũi tên rơi xuống dưới chữ.
              whiteSpace: 'nowrap',
            }}
          >
            <Icon name="visibility" size={18} />
            Xem chi tiết
            <Icon name="chevron_right" size={18} />
          </Link>
        ),
    },
  ];

  const activeFilters = ['branchId', 'departmentId', 'q', 'needsReview'].filter((key) =>
    searchParams.get(key),
  ).length;

  // Nhãn tháng lấy từ phản hồi chứ không từ tham số URL: URL có thể trống (mặc
  // định "tháng này") hoặc là một ngày giữa tháng, còn `period.month` là tháng
  // Backend thật sự đã đọc.
  const periodLabel = summary.data ? dayjs(summary.data.period.month).format('MM/YYYY') : '';

  return (
    <>
      <PageHeader
        breadcrumb={
          <nav aria-label="Đường dẫn" className="sf-body-sm">
            {/*
              "Bảng công" dẫn tới DANH SÁCH BẢNG — nơi lập và xoá bảng chấm công.
              Đó là lối vào duy nhất tới các bảng, và đặt nó ở breadcrumb thay
              vì thêm một nút thứ tư trên hàng hành động: hàng đó dành cho việc
              làm với số liệu, không dành cho điều hướng.
            */}
            <Link to="/attendance/sheets">Bảng công</Link>
            <span className="sf-text-variant" style={{ margin: '0 8px' }}>
              /
            </span>
            <span className="sf-text-variant">Tổng hợp công</span>
          </nav>
        }
        title={periodLabel ? `Bảng công tháng ${periodLabel}` : 'Bảng công'}
        actions={
          <>
            {/*
              "Đối soát tự động" = tính lại công cả kỳ theo đúng luật đã cấu
              hình. Đứng đầu vì đây là việc làm TRƯỚC khi tin bất kỳ con số nào
              trên bảng — đơn duyệt ngược hay sửa giờ ca đều không tự kích hoạt
              tính lại.
            */}
            <Can do="attendance.sheet_manage">
              <Button
                variant="secondary"
                icon="autorenew"
                loading={recalc.running}
                onClick={recalc.start}
              >
                {recalc.running ? 'Đang đối soát…' : 'Đối soát tự động'}
              </Button>
            </Can>
            <Can do="attendance.export">
              <Button variant="secondary" icon="download" onClick={() => setExportOpen(true)}>
                Xuất Excel
              </Button>
            </Can>
            {/*
              Nút xanh lá DUY NHẤT của màn hình — biến thể `action` dành riêng
              cho thao tác chốt một quy trình (docs/20 mục 0.2). Chốt bảng là
              tuyên bố "đã rà xong", và nó bàn giao số liệu cho tính lương.
            */}
            <Can do="attendance.adjust">
              <Button
                variant="action"
                icon="lock"
                // Mọi bảng đã chốt thì không còn gì để chốt. Vô hiệu hoá chứ
                // không ẩn: nút biến mất làm người dùng đi tìm xem mình bấm
                // nhầm chỗ nào, còn nút xám kèm nhãn thì tự giải thích.
                disabled={sheets.length === 0 || allClosed}
                onClick={() => setCloseOpen(true)}
              >
                {allClosed ? 'Đã chốt cả tháng' : 'Chốt bảng công'}
              </Button>
            </Can>
          </>
        }
      />

      {/*
        Thanh tiến độ, không phải spinner trên nút: tính lại 250 người × 31 ngày
        mất hàng chục giây, và không thấy tiến độ thì người dùng bấm lại lần hai
        — mỗi lần là một job thật chạy song song trên cùng dữ liệu.
      */}
      {recalc.running ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={`Đang đối soát lại công của cả tháng · ${recalc.sheetCount} bảng`}
          description={
            <div style={{ maxWidth: 520 }}>
              <p className="sf-body-sm" style={{ margin: '0 0 8px' }}>
                Bảng sẽ tự làm mới khi xong. Số đang hiện là kết quả của lần tính trước.
              </p>
              <Progress percent={recalc.progress} size="small" />
            </div>
          }
        />
      ) : null}

      <FilterBar
        activeCount={activeFilters}
        onClear={() =>
          patchQuery({
            branchId: undefined,
            departmentId: undefined,
            q: undefined,
            needsReview: undefined,
          })
        }
        extra={<LastCalculated at={summary.data?.lastCalculatedAt ?? null} timezone={timezone} />}
      >
        <FilterField label="Kỳ" htmlFor="sum-month" width={170}>
          {/*
            Đổi tháng là đổi BỘ LỌC của chính màn hình này, không phải điều
            hướng đi đâu khác — mọi bảng của tháng được gộp lại nên không còn
            phải chọn bảng nào.
          */}
          <DatePicker
            id="sum-month"
            picker="month"
            allowClear={false}
            format="MM/YYYY"
            style={{ width: '100%' }}
            value={summary.data ? dayjs(summary.data.period.month) : null}
            onChange={(date) => patchQuery({ month: date?.format('YYYY-MM-01') })}
          />
        </FilterField>

        <FilterField label="Chi nhánh" htmlFor="sum-branch" width={200}>
          <Select
            id="sum-branch"
            options={toSelectOptions(branches.data, 'Tất cả chi nhánh')}
            value={query.branchId ?? ''}
            onChange={(event) => patchQuery({ branchId: event.target.value || undefined })}
          />
        </FilterField>

        <FilterField label="Phòng ban" htmlFor="sum-dept" width={220}>
          <DepartmentTreeSelect
            id="sum-dept"
            value={query.departmentId}
            onChange={(value) => patchQuery({ departmentId: value })}
            /*
              Chỉ phòng ban CÓ TRONG các bảng của tháng: lọc sang phòng khác
              chỉ ra bảng trống, vì tháng này chưa lập bảng cho phòng đó.

              Gộp phạm vi của mọi bảng chứ không của một bảng — màn hình đọc
              theo tháng, và tháng gồm tất cả chúng.
            */
            limitTo={[...new Set(sheets.flatMap((item) => item.departmentIds))]}
            placeholder="Tất cả phòng ban"
          />
        </FilterField>

        <FilterField label="Tìm nhân viên" htmlFor="sum-q" width={240}>
          <Input.Search
            id="sum-q"
            allowClear
            defaultValue={query.q}
            placeholder="Tên hoặc mã nhân viên"
            onSearch={(value) => patchQuery({ q: value || undefined })}
          />
        </FilterField>
      </FilterBar>

      <div className="sf-stat-row" style={{ marginBottom: 16 }}>
        {summary.isPending ? (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : (
          <>
            <StatCard
              icon="group"
              tone="neutral"
              label="Tổng nhân viên"
              value={formatNumber(totals?.employeeCount ?? 0)}
              hint="trong kỳ này"
            />
            <StatCard
              icon="task_alt"
              tone="success"
              label="Công chuẩn"
              value={formatStandardDays(totals?.standardDays ?? 0)}
              hint="ngày được xếp ca"
            />
            <StatCard
              icon="event_available"
              tone="primary"
              label="Công thực tế"
              value={formatStandardDays(totals?.actualDays ?? 0)}
              hint="công engine đã tính"
            />
            <StatCard
              icon="schedule"
              tone="primary"
              label="OT"
              value={formatMinutes(totals?.otMinutes ?? 0)}
              hint="chỉ OT đã duyệt trước"
            />
            {/*
              Thẻ này BẤM ĐƯỢC và lọc luôn bảng bên dưới — nó là con số duy nhất
              trên hàng thẻ tương ứng với một việc phải làm, và một con số cảnh
              báo không dẫn tới danh sách của nó là một con số không hành động được.
            */}
            <StatCard
              icon="warning"
              tone="warning"
              label="Cần đối soát"
              value={formatNumber(totals?.needsReviewCount ?? 0)}
              hint="còn vướng ít nhất 1 ngày"
              onClick={() => patchQuery({ needsReview: '1' })}
            />
          </>
        )}
      </div>

      {/*
        Cảnh báo đặt GIỮA hàng thẻ và bảng: nó là hệ quả trực tiếp của thẻ "Cần
        đối soát" ngay trên, và là việc phải làm trước khi chạm vào nút chốt.
        Chỉ hiện khi bảng CHƯA chốt — chốt xong thì đây không còn là việc đang mở.
      */}
      {summary.data && !allClosed && (totals?.needsReviewCount ?? 0) > 0 ? (
        <div className="sf-banner sf-banner--warning" style={{ marginBottom: 16 }}>
          <Icon name="warning" size={20} color="var(--sf-warning-700)" />
          <span className="sf-body-md" style={{ flex: 1 }}>
            <strong>{formatNumber(totals?.needsReviewCount ?? 0)} nhân viên</strong> cần đối soát
            trước khi chốt kỳ. Chốt khi còn dữ liệu thiếu thì bảng lương lấy đúng số liệu thiếu đó.
          </span>
          {query.needsReviewOnly ? (
            <Button
              variant="tertiary"
              size="sm"
              onClick={() => patchQuery({ needsReview: undefined })}
            >
              Xem tất cả
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => patchQuery({ needsReview: '1' })}>
              Xem danh sách
            </Button>
          )}
        </div>
      ) : null}

      {/*
        Ba trạng thái, ba câu khác nhau — và câu ở giữa là câu dễ mất nhất nếu
        chỉ hỏi "đã chốt hay chưa": tháng chốt DẦN từng bảng, nên "3/5 bảng đã
        chốt" là trạng thái bình thường suốt nửa cuối kỳ.
      */}
      {!summary.data ? null : sheets.length === 0 ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`Tháng ${periodLabel} chưa có bảng chấm công nào`}
          description="Không có bảng thì không có ai trong kỳ để rà. Lập bảng cho tháng này ở màn Danh sách bảng."
          action={
            <LinkButton to="/attendance/sheets" variant="secondary" size="sm">
              Danh sách bảng
            </LinkButton>
          }
        />
      ) : allClosed ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={`Toàn bộ ${sheets.length} bảng của tháng đã chốt`}
          description="Số liệu đã bàn giao cho tính lương. Vẫn tính lại được cho tới khi kỳ lương của tháng này chốt — mở lại từng bảng ở màn lưới nếu cần sửa thành viên."
        />
      ) : sheets.length > openSheets.length ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={`${sheets.length - openSheets.length}/${sheets.length} bảng của tháng đã chốt`}
          description="Người thuộc bảng đã chốt hiện trạng thái “Đã khoá”. Các bảng còn lại vẫn rà và sửa được như thường."
        />
      ) : null}

      <DataTable<AttendanceSummaryRow>
        rowKey="employeeId"
        /*
          Đệm ô 16px thay vì 24px mặc định. Bảng này có 13 cột — riêng phần đệm
          của bản mặc định đã chiếm 624px, đủ để đẩy ba cột cuối (Thiếu công,
          Trạng thái, Thao tác) ra ngoài khung trên màn 1600. Ba cột đó lại
          chính là phần người dùng cần đọc và bấm, nên chúng phải nằm trong tầm
          mắt chứ không nằm sau một thao tác cuộn ngang.
        */
        size="middle"
        data={summary.data?.rows}
        meta={summary.data?.meta}
        isLoading={summary.isLoading}
        error={summary.error}
        onRetry={() => void summary.refetch()}
        columns={columns}
        srOnlyCount
        onPageChange={(page, pageSize) =>
          patchQuery({ page: String(page), pageSize: String(pageSize) })
        }
        emptyIcon="event_busy"
        emptyTitle={
          query.needsReviewOnly
            ? 'Không còn ai cần đối soát'
            : 'Không có nhân viên nào khớp bộ lọc'
        }
        emptyDescription={
          query.needsReviewOnly
            ? 'Mọi ngày công của tháng này đã rõ ràng. Kỳ đã sẵn sàng để chốt.'
            : 'Kỳ chỉ chứa những người đã được đưa vào bảng chấm công lúc lập. Bỏ bớt bộ lọc, hoặc mở danh sách bảng để thêm CBNV.'
        }
        emptyAction={
          <LinkButton to="/attendance/sheets" variant="secondary">
            Danh sách bảng chấm công
          </LinkButton>
        }
      />

      <ExportAttendanceModal
        open={exportOpen}
        defaultFrom={summary.data?.period.from}
        defaultTo={summary.data?.period.to}
        onClose={() => setExportOpen(false)}
      />

      <CloseSheetsModal
        open={closeOpen}
        month={periodLabel}
        sheets={sheets}
        onClose={() => setCloseOpen(false)}
      />

    </>
  );
}

// =============================================================================
//  Mảnh nhỏ của bảng
// =============================================================================

/**
 * Tiêu đề cột hai dòng: tên ở trên, ĐƠN VỊ ở dưới.
 *
 * Bảng này đặt cạnh nhau ba đơn vị khác nhau — ngày, giờ, phút. Không in đơn vị
 * ra thì "30" ở cột Đi muộn đọc là 30 ngày, và "24h30" ở cột OT đọc là 24 ngày
 * rưỡi. Nhét đơn vị vào từng ô thay vì tiêu đề sẽ lặp nó 250 lần một trang.
 */
function ColumnTitle({ label, unit }: { label: string; unit: string }) {
  return (
    <span style={{ display: 'block', lineHeight: 1.3, whiteSpace: 'nowrap' }}>
      {label}
      <span className="sf-caption sf-text-variant" style={{ display: 'block', fontWeight: 400 }}>
        ({unit})
      </span>
    </span>
  );
}

/**
 * Phút đi muộn / về sớm.
 *
 * Số 0 hiện dấu gạch chứ không phải "0": một cột đầy số 0 làm mắt phải đọc từng
 * ô để tìm ô khác 0, mà đó chính là thứ duy nhất đáng tìm ở cột này.
 */
function Deviation({ minutes }: { minutes: number }) {
  if (minutes <= 0) return <span className="sf-text-variant">—</span>;
  return <span style={{ color: 'var(--sf-warning-800)' }}>{formatNumber(minutes)}</span>;
}

/** Nhãn + tông màu của bốn trạng thái dòng — xem `rowStatus` ở Backend. */
const STATUS_LABEL: Record<
  AttendanceSummaryStatus,
  { text: string; tone: 'success' | 'warning' | 'error' | 'neutral' }
> = {
  VALID: { text: 'Hợp lệ', tone: 'success' },
  NEEDS_REVIEW: { text: 'Cần đối soát', tone: 'warning' },
  MISSING_CHECK_OUT: { text: 'Thiếu check-out', tone: 'error' },
  LOCKED: { text: 'Đã khoá', tone: 'neutral' },
};

/**
 * "Cập nhật 08:30 hôm nay" — số trên bảng cũ tới mức nào.
 *
 * Đứng cạnh nút "Đối soát tự động" chứ không nằm ở chân trang: nó là thông tin
 * để quyết định CÓ BẤM nút đó hay không.
 */
function LastCalculated({ at, timezone }: { at: string | null; timezone?: string }) {
  if (!at) {
    return (
      <span className="sf-body-sm sf-text-variant">
        <Icon name="info" size={16} /> Kỳ này chưa có công nào được tính
      </span>
    );
  }

  return (
    <span
      className="sf-body-sm sf-text-variant"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
    >
      <Icon name="autorenew" size={16} />
      Cập nhật {formatTime(at, timezone)} {formatRelativeDay(at, timezone).toLowerCase()}
    </span>
  );
}
