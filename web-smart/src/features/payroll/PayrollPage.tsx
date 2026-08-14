import { useEffect, useState } from 'react';
import { Button, DatePicker, Input, Modal, Segmented } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PageHeader, SectionTitle } from '@/components/PageHeader';
import { DataTable } from '@/components/DataTable';
import { EmployeeCell } from '@/components/EmployeeCell';
import { StatusBadge, periodStatusTone } from '@/components/StatusBadge';
import { ReasonDialog } from '@/components/ReasonDialog';
import { EmptyState } from '@/components/EmptyState';
import { CardSkeleton } from '@/components/Skeleton';
import { Icon } from '@/components/Icon';
import { Can, useCan } from '@/lib/rbac/Can';
import { useAuth } from '@/lib/auth/auth-context';
import { PERIOD_STATUS_LABEL } from '@/config/constants';
import { formatDay, formatMinutes, toWorkDate } from '@/lib/utils/date';
import { toDayjs } from '@/lib/utils/dayjs';
import { formatNumber, formatStandardDays } from '@/lib/utils/format';
import { downloadFromUrl } from '@/lib/utils/download';
import { useExportJob } from '@/features/attendance/attendance.api';
import {
  useClosePeriod,
  useCreatePeriod,
  useExportPayroll,
  usePayrollPeriods,
  usePayrollSummary,
  useRecalculatePeriod,
  useReopenPeriod,
  type PayrollPeriod,
  type PayrollSummaryRow,
} from './payroll.api';
import { PreCloseReportModal } from './PreCloseReportModal';
import { useToast } from '@/components/ui';
import { useErrorToast } from '@/lib/errors/use-error-toast';

/**
 * Tính công & kỳ lương — docs/04 mục 7 (`FR-WEB-PAY-01..08`).
 *
 * Vòng đời kỳ (mục 7.1) là thứ chi phối toàn bộ màn hình:
 *
 *   MỞ / ĐANG RÀ SOÁT → chấm công được, sửa công được, duyệt đơn được
 *   ĐÃ CHỐT           → KHOÁ hoàn toàn
 *
 * Nút "Chốt kỳ" không bao giờ chốt thẳng: nó luôn mở báo cáo tiền chốt trước
 * (mục 7.2 bước 3, "không được bỏ qua").
 */
export function PayrollPage() {
  const { timezone } = useAuth();
  const toast = useToast();
  const showError = useErrorToast();
  const canClose = useCan('payroll.close');

  const periods = usePayrollPeriods();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [preCloseOpen, setPreCloseOpen] = useState(false);
  const [reopenTarget, setReopenTarget] = useState<PayrollPeriod | null>(null);
  const [exportJobId, setExportJobId] = useState<string | null>(null);

  const [recalcJobId, setRecalcJobId] = useState<string | null>(null);

  const summary = usePayrollSummary(selectedId);
  const recalculate = useRecalculatePeriod();
  const reopen = useReopenPeriod();
  const closePeriod = useClosePeriod();
  const exportPayroll = useExportPayroll();
  const exportJob = useExportJob(exportJobId);
  const recalcJob = useExportJob(recalcJobId);

  // Chọn sẵn kỳ mới nhất khi vào trang — người dùng gần như luôn muốn xem kỳ
  // đang chạy, không phải một danh sách chờ họ bấm.
  useEffect(() => {
    if (!selectedId && periods.data && periods.data.length > 0) {
      setSelectedId(periods.data[0]?.id ?? null);
    }
  }, [periods.data, selectedId]);

  useEffect(() => {
    if (exportJob.data?.status === 'COMPLETED' && exportJob.data.downloadUrl) {
      downloadFromUrl(exportJob.data.downloadUrl, 'bang-luong.xlsx');
      toast.success('Đã tải bảng lương');
      setExportJobId(null);
      return;
    }
    if (exportJob.data?.status === 'FAILED') {
      toast.error(
        'Không tạo được file Excel',
        exportJob.data.errorMessage ?? 'Máy chủ báo lỗi khi dựng file. Thử lại sau ít phút.',
      );
      setExportJobId(null);
    }
  }, [exportJob.data, toast]);

  /**
   * Theo dõi job tính lại kỳ.
   *
   * Đây là chỗ trước đây đứt gãy: màn hình bắn yêu cầu tính lại rồi báo "đã đưa
   * vào hàng đợi" và quên luôn — bảng công không bao giờ tự nạp lại, nên kế toán
   * không có cách nào biết đã tính xong hay chưa ngoài việc F5 thử vài lần.
   */
  useEffect(() => {
    if (!recalcJob.data) return;

    if (recalcJob.data.status === 'COMPLETED') {
      setRecalcJobId(null);
      void summary.refetch();
      toast.success('Đã tính lại xong', 'Bảng công tổng hợp bên dưới vừa được nạp lại.');
      return;
    }

    if (recalcJob.data.status === 'FAILED') {
      setRecalcJobId(null);
      toast.error(
        'Tính lại kỳ thất bại',
        recalcJob.data.errorMessage ??
          'Máy chủ dừng giữa chừng. Số liệu cũ được giữ nguyên, chưa có gì bị ghi đè.',
      );
    }
    // `summary` đổi tham chiếu mỗi lần render nên không đưa vào deps — chỉ cần
    // chạy khi trạng thái job đổi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recalcJob.data, toast]);

  const selected = periods.data?.find((period) => period.id === selectedId) ?? null;
  const isClosed = selected?.status === 'CLOSED';

  const recalcRunning = Boolean(recalcJobId);
  const recalcPercent = recalcJob.data?.progress ?? 0;

  /**
   * Xuất file bàn giao cho bộ phận lương — docs/04 mục 7.2 bước 6.
   *
   * Tách thành hàm vì gọi từ hai chỗ: nút "Xuất Excel" trên thanh công cụ, và
   * nút hành động trong thông báo sau khi chốt kỳ. Xuất chạy bất đồng bộ qua
   * hàng đợi nên chỉ nhận `jobId`; `useEffect` bên trên theo dõi job và tự tải
   * file khi xong.
   */
  async function exportForHandover(periodId: string) {
    try {
      const result = await exportPayroll.mutateAsync({ periodId });
      setExportJobId(result.jobId);
      // `queued: false` = máy chủ nhận yêu cầu nhưng không có dịch vụ nền để
      // dựng file. Báo "đang tạo file" ở đây rồi một giây sau báo lỗi thì tệ hơn
      // là im lặng để hiệu ứng theo dõi job nói đúng một câu.
      if (result.queued) {
        toast.success(
          'Đang tạo file',
          'Hệ thống sẽ tự tải xuống khi xong, bạn không cần chờ ở đây.',
        );
      }
    } catch (caught) {
      showError(caught);
    }
  }

  const columns: ColumnsType<PayrollSummaryRow> = [
    {
      title: 'Nhân viên',
      key: 'employee',
      fixed: 'left',
      width: 240,
      render: (_, row) => <EmployeeCell employee={row.employee} />,
    },
    {
      title: 'Công chuẩn',
      dataIndex: 'standardDays',
      key: 'standardDays',
      width: 110,
      align: 'right',
      render: (value: number) => (
        <span style={{ fontWeight: 700 }}>{formatStandardDays(value)}</span>
      ),
    },
    {
      title: 'Giờ làm',
      dataIndex: 'workedMinutes',
      key: 'worked',
      width: 110,
      align: 'right',
      render: (value: number) => formatMinutes(value),
    },
    {
      title: 'OT',
      dataIndex: 'otMinutes',
      key: 'ot',
      width: 100,
      align: 'right',
      // Ba loại OT có hệ số khác nhau (docs/04 mục 7.3). Cột hiển thị tổng, chi
      // tiết đưa vào tooltip thay vì ba cột nữa — bảng đã 9 cột rồi.
      render: (value: number, row) =>
        value > 0 ? (
          <span
            title={`Ngày thường ${formatMinutes(row.otMinutesNormal)} · Cuối tuần ${formatMinutes(
              row.otMinutesWeekend,
            )} · Ngày lễ ${formatMinutes(row.otMinutesHoliday)}`}
          >
            {formatMinutes(value)}
          </span>
        ) : (
          <span className="sf-text-muted">—</span>
        ),
    },
    {
      title: 'Làm bù',
      dataIndex: 'makeupMinutes',
      key: 'makeup',
      width: 100,
      align: 'right',
      render: (value: number) => formatMinutes(value),
    },
    {
      title: 'Số lần muộn',
      dataIndex: 'lateCount',
      key: 'lateCount',
      width: 120,
      align: 'right',
      render: (value: number, row) =>
        value > 0 ? (
          <span style={{ color: 'var(--sf-warning-800)', fontWeight: 600 }}>
            {value} lần · {formatMinutes(row.lateMinutesTotal)}
          </span>
        ) : (
          <span className="sf-text-muted">—</span>
        ),
    },
    {
      title: 'Về sớm',
      dataIndex: 'earlyLeaveCount',
      key: 'early',
      width: 100,
      align: 'right',
      render: (value: number) =>
        value > 0 ? `${value} lần` : <span className="sf-text-muted">—</span>,
    },
    {
      title: 'Nghỉ phép',
      dataIndex: 'leaveDays',
      key: 'leave',
      width: 110,
      align: 'right',
      render: (value: number) =>
        value > 0 ? `${formatNumber(value, 1)} ngày` : <span className="sf-text-muted">—</span>,
    },
    {
      title: 'Vắng',
      dataIndex: 'absentDays',
      key: 'absent',
      width: 100,
      align: 'right',
      render: (value: number) =>
        value > 0 ? (
          <span style={{ color: 'var(--sf-error-700)', fontWeight: 600 }}>{value} ngày</span>
        ) : (
          <span className="sf-text-muted">—</span>
        ),
    },
    {
      title: 'Thiếu bản ghi',
      dataIndex: 'missingRecordDays',
      key: 'missing',
      width: 120,
      align: 'right',
      // Chấm vào mà không chấm ra. Đây là thứ chặn chốt kỳ (mục 7.2 bước 3), nên
      // phải nhìn thấy ngay trên bảng chứ không đợi tới lúc bấm Chốt mới biết.
      render: (value: number) =>
        value > 0 ? (
          <span style={{ color: 'var(--sf-warning-800)', fontWeight: 600 }}>{value} ngày</span>
        ) : (
          <span className="sf-text-muted">—</span>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Kỳ lương"
        description="Bảng công tổng hợp theo kỳ. Kỳ đã chốt được khoá hoàn toàn — không chấm công, không sửa công, không duyệt đơn vào kỳ."
        actions={
          <Can do="payroll.close">
            <Button
              type="primary"
              icon={<Icon name="add" size={20} />}
              onClick={() => setCreateOpen(true)}
            >
              Tạo kỳ mới
            </Button>
          </Can>
        }
      />

      {periods.isLoading ? (
        <CardSkeleton height={120} />
      ) : !periods.data || periods.data.length === 0 ? (
        <EmptyState
          icon="receipt_long"
          title="Chưa có kỳ lương nào"
          description="Tạo kỳ lương đầu tiên (thường là theo tháng) để bắt đầu tổng hợp bảng công và chốt số liệu bàn giao cho bộ phận lương."
          action={
            <Can do="payroll.close">
              <Button type="primary" onClick={() => setCreateOpen(true)}>
                Tạo kỳ lương
              </Button>
            </Can>
          }
        />
      ) : (
        <>
          <div style={{ marginBottom: 24, overflowX: 'auto' }}>
            <Segmented
              value={selectedId ?? undefined}
              onChange={(value) => setSelectedId(String(value))}
              options={periods.data.map((period) => ({
                value: period.id,
                label: (
                  <div
                    style={{ padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 8 }}
                  >
                    <span>{period.name}</span>
                    <StatusBadge tone={periodStatusTone(period.status)} soft>
                      {PERIOD_STATUS_LABEL[period.status] ?? period.status}
                    </StatusBadge>
                  </div>
                ),
              }))}
            />
          </div>

          {selected ? (
            <div
              className="sf-card"
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 16,
                marginBottom: 24,
              }}
            >
              <div style={{ flex: 1, minWidth: 220 }}>
                <div className="sf-title-sm">{selected.name}</div>
                <div className="sf-body-sm sf-text-variant">
                  {formatDay(selected.startDate, timezone)} –{' '}
                  {formatDay(selected.endDate, timezone)}
                  {selected.closedAt
                    ? ` · chốt ngày ${formatDay(selected.closedAt, timezone)}`
                    : ''}
                </div>
                {selected.reopenReason ? (
                  <div className="sf-body-sm" style={{ color: 'var(--sf-warning-800)' }}>
                    Đã mở lại: {selected.reopenReason}
                  </div>
                ) : null}
              </div>

              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <Can do="payroll.calculate">
                  <Button
                    icon={<Icon name="calculate" size={20} />}
                    disabled={isClosed}
                    loading={recalculate.isPending || recalcRunning}
                    onClick={async () => {
                      try {
                        const result = await recalculate.mutateAsync(selected.id);
                        setRecalcJobId(result.jobId);
                        toast.success(
                          'Đang tính lại bảng công',
                          'Bạn có thể làm việc khác — bảng bên dưới sẽ tự nạp lại khi tính xong.',
                        );
                      } catch (caught) {
                        showError(caught);
                      }
                    }}
                  >
                    {recalcRunning ? `Đang tính… ${recalcPercent}%` : 'Tính lại kỳ'}
                  </Button>
                </Can>

                <Button
                  icon={<Icon name="download" size={20} />}
                  loading={exportPayroll.isPending || Boolean(exportJobId)}
                  onClick={() => void exportForHandover(selected.id)}
                >
                  Xuất Excel
                </Button>

                {canClose ? (
                  isClosed ? (
                    <Button danger onClick={() => setReopenTarget(selected)}>
                      Mở lại kỳ
                    </Button>
                  ) : (
                    <Button
                      type="primary"
                      icon={<Icon name="lock" size={20} />}
                      onClick={() => setPreCloseOpen(true)}
                    >
                      Chốt kỳ
                    </Button>
                  )
                ) : null}
              </div>
            </div>
          ) : null}

          <SectionTitle
            extra={
              summary.data?.fromSnapshot ? (
                <span className="sf-body-sm sf-text-variant">
                  Đọc từ bản chốt bất biến — số liệu không đổi kể cả khi dữ liệu gốc thay đổi
                </span>
              ) : null
            }
          >
            Bảng công tổng hợp
          </SectionTitle>

          <DataTable<PayrollSummaryRow>
            rowKey="employeeId"
            data={summary.data?.items}
            isLoading={summary.isLoading}
            error={summary.error}
            onRetry={() => void summary.refetch()}
            columns={columns}
            emptyIcon="calculate"
            emptyTitle="Kỳ này chưa có số liệu"
            emptyDescription="Bấm Tính lại kỳ để chạy engine tính công trên toàn bộ bản ghi chấm công trong khoảng ngày của kỳ."
            pagination={false}
          />
        </>
      )}

      {/* Tạo kỳ mới */}
      <CreatePeriodModal open={createOpen} onClose={() => setCreateOpen(false)} />

      {/* Báo cáo tiền chốt — bắt buộc trước khi chốt (mục 7.2 bước 3) */}
      <PreCloseReportModal
        open={preCloseOpen}
        period={selected}
        onClose={() => setPreCloseOpen(false)}
        onConfirm={async (reason, force) => {
          if (!selected) return;
          try {
            await closePeriod.mutateAsync({ periodId: selected.id, reason, force });
            toast.success(
              `Đã chốt ${selected.name}`,
              'Dữ liệu chấm công của kỳ đã khoá — không chấm, không sửa, không duyệt đơn vào kỳ này nữa.',
              // Bước kế tiếp thật sự của kế toán là bàn giao file cho bộ phận
              // lương (docs/04 mục 7.2 bước 6), nên đặt ngay đây thay vì bắt họ
              // tìm lại nút Xuất Excel.
              {
                label: 'Xuất Excel bàn giao',
                onClick: () => void exportForHandover(selected.id),
              },
            );
            setPreCloseOpen(false);
          } catch (caught) {
            showError(caught);
          }
        }}
        closing={closePeriod.isPending}
      />

      {/* Mở lại kỳ — thao tác đặc quyền, bắt buộc lý do (BR-07) */}
      <ReasonDialog
        open={Boolean(reopenTarget)}
        title="Mở lại kỳ lương đã chốt"
        description={reopenTarget?.name}
        warning="Mở lại kỳ cho phép sửa dữ liệu đã bàn giao cho bộ phận lương. Thao tác được ghi vào nhật ký kiểm toán kèm tên bạn và lý do dưới đây."
        confirmText="Mở lại kỳ"
        danger
        loading={reopen.isPending}
        onCancel={() => setReopenTarget(null)}
        onConfirm={async (reason) => {
          if (!reopenTarget) return;
          try {
            await reopen.mutateAsync({ periodId: reopenTarget.id, reason });
            toast.success('Đã mở lại kỳ');
            setReopenTarget(null);
          } catch (caught) {
            showError(caught);
          }
        }}
      />
    </>
  );
}

function CreatePeriodModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const showError = useErrorToast();
  const create = useCreatePeriod();
  const [name, setName] = useState('');
  const [range, setRange] = useState<{ from?: string; to?: string }>({});

  useEffect(() => {
    if (open) {
      setName('');
      setRange({});
    }
  }, [open]);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title="Tạo kỳ lương"
      okText="Tạo"
      cancelText="Huỷ bỏ"
      okButtonProps={{
        loading: create.isPending,
        disabled: !name.trim() || !range.from || !range.to,
      }}
      onOk={async () => {
        try {
          await create.mutateAsync({
            name: name.trim(),
            startDate: range.from as string,
            endDate: range.to as string,
          });
          toast.success('Đã tạo kỳ lương');
          onClose();
        } catch (caught) {
          showError(caught);
        }
      }}
    >
      <div style={{ display: 'grid', gap: 16 }}>
        <div>
          <label
            className="sf-field__label"
            htmlFor="p-name"
            style={{ display: 'block', marginBottom: 4 }}
          >
            Tên kỳ
          </label>
          <Input
            id="p-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Tháng 08/2026"
          />
        </div>

        <div>
          <label className="sf-field__label" style={{ display: 'block', marginBottom: 4 }}>
            Khoảng ngày của kỳ
          </label>
          <DatePicker.RangePicker
            format="DD/MM/YYYY"
            style={{ width: '100%' }}
            value={[toDayjs(range.from), toDayjs(range.to)]}
            onChange={(dates) =>
              setRange({
                from: toWorkDate(dates?.[0]?.toDate()),
                to: toWorkDate(dates?.[1]?.toDate()),
              })
            }
          />
          <p className="sf-body-sm sf-text-variant" style={{ margin: '4px 0 0' }}>
            Kỳ không được chồng lấn với kỳ đã có — hệ thống sẽ từ chối nếu trùng khoảng ngày.
          </p>
        </div>
      </div>
    </Modal>
  );
}
