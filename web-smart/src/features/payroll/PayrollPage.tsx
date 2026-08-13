import { useEffect, useState } from 'react';
import { App as AntApp, Button, DatePicker, Input, Modal, Segmented } from 'antd';
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
import { toUserMessage } from '@/lib/errors/api-error';
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
  const { message } = AntApp.useApp();
  const canClose = useCan('payroll.close');

  const periods = usePayrollPeriods();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [preCloseOpen, setPreCloseOpen] = useState(false);
  const [reopenTarget, setReopenTarget] = useState<PayrollPeriod | null>(null);
  const [exportJobId, setExportJobId] = useState<string | null>(null);

  const summary = usePayrollSummary(selectedId);
  const recalculate = useRecalculatePeriod();
  const reopen = useReopenPeriod();
  const closePeriod = useClosePeriod();
  const exportPayroll = useExportPayroll();
  const exportJob = useExportJob(exportJobId);

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
      message.success('Đã tải bảng lương.');
      setExportJobId(null);
    }
  }, [exportJob.data, message]);

  const selected = periods.data?.find((period) => period.id === selectedId) ?? null;
  const isClosed = selected?.status === 'CLOSED';

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
      render: (value: string | number) => (
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
      render: (value: number) => formatMinutes(value),
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
      render: (value: number) => (value > 0 ? `${value} lần` : <span className="sf-text-muted">—</span>),
    },
    {
      title: 'Nghỉ phép',
      dataIndex: 'leaveDays',
      key: 'leave',
      width: 110,
      align: 'right',
      render: (value: number) => (value > 0 ? `${formatNumber(value, 1)} ngày` : '—'),
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
              size="large"
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
              <Button type="primary" size="large" onClick={() => setCreateOpen(true)}>
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
                  <div style={{ padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
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
                  {formatDay(selected.startDate, timezone)} – {formatDay(selected.endDate, timezone)}
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
                    loading={recalculate.isPending}
                    onClick={async () => {
                      try {
                        await recalculate.mutateAsync(selected.id);
                        message.success('Đã đưa yêu cầu tính lại vào hàng đợi.');
                      } catch (caught) {
                        message.error(toUserMessage(caught));
                      }
                    }}
                  >
                    Tính lại kỳ
                  </Button>
                </Can>

                <Button
                  icon={<Icon name="download" size={20} />}
                  loading={exportPayroll.isPending || Boolean(exportJobId)}
                  onClick={async () => {
                    try {
                      const result = await exportPayroll.mutateAsync({ periodId: selected.id });
                      setExportJobId(result.jobId);
                      message.info('Đang tạo file. Hệ thống sẽ tự tải khi xong.');
                    } catch (caught) {
                      message.error(toUserMessage(caught));
                    }
                  }}
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
            data={summary.data?.rows}
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
            message.success(`Đã chốt ${selected.name}. Dữ liệu chấm công của kỳ đã bị khoá.`);
            setPreCloseOpen(false);
          } catch (caught) {
            message.error(toUserMessage(caught));
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
            message.success('Đã mở lại kỳ.');
            setReopenTarget(null);
          } catch (caught) {
            message.error(toUserMessage(caught));
          }
        }}
      />
    </>
  );
}

function CreatePeriodModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { message } = AntApp.useApp();
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
      okText="Tạo kỳ"
      cancelText="Huỷ bỏ"
      okButtonProps={{
        size: 'large',
        loading: create.isPending,
        disabled: !name.trim() || !range.from || !range.to,
      }}
      cancelButtonProps={{ size: 'large' }}
      onOk={async () => {
        try {
          await create.mutateAsync({
            name: name.trim(),
            startDate: range.from as string,
            endDate: range.to as string,
          });
          message.success('Đã tạo kỳ lương.');
          onClose();
        } catch (caught) {
          message.error(toUserMessage(caught));
        }
      }}
    >
      <div style={{ display: 'grid', gap: 16 }}>
        <div>
          <label className="sf-label-md" htmlFor="p-name" style={{ display: 'block', marginBottom: 4 }}>
            Tên kỳ
          </label>
          <Input
            id="p-name"
            size="large"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Tháng 08/2026"
          />
        </div>

        <div>
          <label className="sf-label-md" style={{ display: 'block', marginBottom: 4 }}>
            Khoảng ngày của kỳ
          </label>
          <DatePicker.RangePicker
            size="large"
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
