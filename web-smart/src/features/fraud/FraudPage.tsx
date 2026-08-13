import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { App as AntApp, Button, DatePicker, Modal, Radio, Input, Select } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PageHeader } from '@/components/PageHeader';
import { DataTable } from '@/components/DataTable';
import { FilterBar, FilterField } from '@/components/FilterBar';
import { EmployeeCell } from '@/components/EmployeeCell';
import { StatCard } from '@/components/StatCard';
import { StatCardSkeleton } from '@/components/Skeleton';
import { StatusBadge, severityTone } from '@/components/StatusBadge';
import { useCan } from '@/lib/rbac/Can';
import { useAuth } from '@/lib/auth/auth-context';
import {
  FRAUD_CODE_LABEL,
  FRAUD_SEVERITY_LABEL,
  REASON_MIN_LENGTH,
  DEFAULT_PAGE_SIZE,
} from '@/config/constants';
import { formatDateTime, firstDayOfMonth, todayWorkDate, toWorkDate } from '@/lib/utils/date';
import { toDayjs } from '@/lib/utils/dayjs';
import { formatNumber } from '@/lib/utils/format';
import { toUserMessage } from '@/lib/errors/api-error';
import { AttendanceDetailDrawer } from '@/features/attendance/AttendanceDetailDrawer';
import { useFraudFlags, useFraudStats, useReviewFlag, type FraudFlag, type FraudQuery } from './fraud.api';

const { RangePicker } = DatePicker;

type Decision = 'KEEP' | 'VOID' | 'ESCALATE';

/**
 * Dashboard cảnh báo gian lận — docs/06-anti-fraud.md mục 7, docs/04 mục 1.
 *
 * Mỗi cờ là một CÁO BUỘC chứ chưa phải kết luận: hệ thống phát hiện dấu hiệu,
 * con người ra quyết định (AF-23). Vì vậy màn hình này đặt bằng chứng lên trước
 * — bấm "Xem bằng chứng" mở đúng drawer chi tiết chấm công có ảnh, toạ độ và
 * điểm AI — rồi mới tới ba nút quyết định.
 */
export function FraudPage() {
  const { timezone } = useAuth();
  const { message } = AntApp.useApp();
  const canReview = useCan('fraud.review');
  const [searchParams, setSearchParams] = useSearchParams();

  const [evidence, setEvidence] = useState<{ employeeId: string; workDate: string; name: string } | null>(
    null,
  );
  const [reviewTarget, setReviewTarget] = useState<FraudFlag | null>(null);

  const review = useReviewFlag();

  const query: FraudQuery = useMemo(
    () => ({
      page: Number(searchParams.get('page') ?? 1),
      pageSize: Number(searchParams.get('pageSize') ?? DEFAULT_PAGE_SIZE),
      from: searchParams.get('from') ?? firstDayOfMonth(timezone),
      to: searchParams.get('to') ?? todayWorkDate(timezone),
      code: searchParams.get('code') ?? undefined,
      severity: searchParams.get('severity') ?? undefined,
      reviewed: searchParams.get('reviewed') === 'true' ? true : searchParams.get('reviewed') === 'false' ? false : undefined,
    }),
    [searchParams, timezone],
  );

  const flags = useFraudFlags(query);
  const stats = useFraudStats({ from: query.from, to: query.to });

  function patchQuery(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(searchParams);
    Object.entries(patch).forEach(([key, value]) => {
      if (!value) next.delete(key);
      else next.set(key, value);
    });
    if (!('page' in patch)) next.delete('page');
    setSearchParams(next, { replace: true });
  }

  const columns: ColumnsType<FraudFlag> = [
    {
      title: 'Nhân viên',
      key: 'employee',
      fixed: 'left',
      width: 240,
      render: (_, row) => <EmployeeCell employee={row.employee} />,
    },
    {
      title: 'Dấu hiệu',
      dataIndex: 'code',
      key: 'code',
      width: 240,
      render: (value: string) => FRAUD_CODE_LABEL[value] ?? value,
    },
    {
      title: 'Mức độ',
      dataIndex: 'severity',
      key: 'severity',
      width: 130,
      render: (value: string) => (
        <StatusBadge tone={severityTone(value)}>
          {FRAUD_SEVERITY_LABEL[value] ?? value}
        </StatusBadge>
      ),
    },
    {
      title: 'Điểm rủi ro',
      dataIndex: 'score',
      key: 'score',
      width: 110,
      align: 'right',
      render: (value: number) => <span style={{ fontWeight: 600 }}>{value}</span>,
    },
    {
      title: 'Phát hiện lúc',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (value: string) => formatDateTime(value, timezone),
    },
    {
      title: 'Xử lý',
      key: 'review',
      width: 200,
      render: (_, row) =>
        row.reviewedAt ? (
          <div>
            <StatusBadge tone={row.reviewDecision === 'VOID' ? 'error' : 'success'} soft>
              {row.reviewDecision === 'VOID'
                ? 'Đã huỷ công'
                : row.reviewDecision === 'ESCALATE'
                  ? 'Đã chuyển cấp trên'
                  : 'Giữ nguyên công'}
            </StatusBadge>
            <div className="sf-caption">{formatDateTime(row.reviewedAt, timezone)}</div>
          </div>
        ) : (
          <StatusBadge tone="warning">Chưa xử lý</StatusBadge>
        ),
    },
    {
      title: '',
      key: 'actions',
      fixed: 'right',
      width: 220,
      render: (_, row) => (
        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            size="small"
            disabled={!row.attendanceLog}
            onClick={() =>
              row.attendanceLog &&
              setEvidence({
                employeeId: row.employeeId,
                workDate: row.attendanceLog.workDate,
                name: row.employee?.fullName ?? 'Nhân viên',
              })
            }
          >
            Xem bằng chứng
          </Button>
          {canReview && !row.reviewedAt ? (
            <Button size="small" type="primary" onClick={() => setReviewTarget(row)}>
              Quyết định
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  const activeFilters = ['code', 'severity', 'reviewed'].filter((key) => searchParams.get(key)).length;

  return (
    <>
      <PageHeader
        title="Cảnh báo gian lận"
        description="Hệ thống phát hiện dấu hiệu bất thường; quyết định giữ hay huỷ công thuộc về con người. Mỗi quyết định được ghi vào nhật ký kiểm toán."
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 16,
          marginBottom: 24,
        }}
      >
        {stats.isLoading ? (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : (
          <>
            <StatCard label="Tổng cảnh báo trong kỳ" value={formatNumber(stats.data?.total)} icon="flag" />
            <StatCard
              label="Chưa xử lý"
              value={formatNumber(stats.data?.pending)}
              tone={stats.data?.pending ? 'error' : 'teal'}
              icon="pending_actions"
              hint="Cần quyết định trước khi chốt kỳ lương"
            />
            <StatCard
              label="Mức độ cao"
              value={formatNumber(stats.data?.high)}
              tone="warning"
              icon="priority_high"
            />
          </>
        )}
      </div>

      <FilterBar activeCount={activeFilters} onClear={() => setSearchParams({}, { replace: true })}>
        <FilterField label="Khoảng ngày" width={260}>
          <RangePicker
            format="DD/MM/YYYY"
            allowClear={false}
            value={[toDayjs(query.from), toDayjs(query.to)]}
            onChange={(dates) =>
              patchQuery({
                from: toWorkDate(dates?.[0]?.toDate()),
                to: toWorkDate(dates?.[1]?.toDate()),
              })
            }
            style={{ width: '100%' }}
          />
        </FilterField>

        <FilterField label="Dấu hiệu" htmlFor="f-code" width={240}>
          <Select
            id="f-code"
            value={query.code ?? ''}
            options={[
              { value: '', label: 'Tất cả dấu hiệu' },
              ...Object.entries(FRAUD_CODE_LABEL).map(([value, label]) => ({ value, label })),
            ]}
            onChange={(value) => patchQuery({ code: value })}
            style={{ width: '100%' }}
          />
        </FilterField>

        <FilterField label="Mức độ" htmlFor="f-sev" width={150}>
          <Select
            id="f-sev"
            value={query.severity ?? ''}
            options={[
              { value: '', label: 'Tất cả' },
              { value: 'HIGH', label: 'Cao' },
              { value: 'MEDIUM', label: 'Trung bình' },
              { value: 'LOW', label: 'Thấp' },
            ]}
            onChange={(value) => patchQuery({ severity: value })}
            style={{ width: '100%' }}
          />
        </FilterField>

        <FilterField label="Trạng thái xử lý" htmlFor="f-rev" width={170}>
          <Select
            id="f-rev"
            value={searchParams.get('reviewed') ?? ''}
            options={[
              { value: '', label: 'Tất cả' },
              { value: 'false', label: 'Chưa xử lý' },
              { value: 'true', label: 'Đã xử lý' },
            ]}
            onChange={(value) => patchQuery({ reviewed: value })}
            style={{ width: '100%' }}
          />
        </FilterField>
      </FilterBar>

      <DataTable<FraudFlag>
        rowKey="id"
        data={flags.data?.items}
        meta={flags.data?.meta}
        isLoading={flags.isLoading}
        error={flags.error}
        onRetry={() => void flags.refetch()}
        onPageChange={(page, pageSize) =>
          patchQuery({ page: String(page), pageSize: String(pageSize) })
        }
        columns={columns}
        emptyIcon="verified_user"
        emptyTitle="Không có cảnh báo nào trong khoảng này"
        emptyDescription="Mọi lượt chấm công đều vượt qua các chốt kiểm về vị trí, thiết bị, đồng hồ và nhận diện khuôn mặt."
      />

      <AttendanceDetailDrawer
        open={Boolean(evidence)}
        employeeId={evidence?.employeeId ?? null}
        workDate={evidence?.workDate ?? null}
        employeeName={evidence?.name ?? ''}
        onClose={() => setEvidence(null)}
      />

      <ReviewFlagModal
        flag={reviewTarget}
        loading={review.isPending}
        onClose={() => setReviewTarget(null)}
        onSubmit={async (decision, reason) => {
          if (!reviewTarget) return;
          try {
            await review.mutateAsync({ id: reviewTarget.id, decision, reason });
            message.success(
              decision === 'VOID'
                ? 'Đã huỷ công của lượt chấm công này và tính lại bảng công.'
                : 'Đã ghi nhận quyết định.',
            );
            setReviewTarget(null);
          } catch (caught) {
            message.error(toUserMessage(caught));
          }
        }}
      />
    </>
  );
}

function ReviewFlagModal({
  flag,
  loading,
  onClose,
  onSubmit,
}: {
  flag: FraudFlag | null;
  loading: boolean;
  onClose: () => void;
  onSubmit: (decision: Decision, reason: string) => void | Promise<void>;
}) {
  const [decision, setDecision] = useState<Decision>('KEEP');
  const [reason, setReason] = useState('');

  const reasonOk = reason.trim().length >= REASON_MIN_LENGTH;

  return (
    <Modal
      open={Boolean(flag)}
      onCancel={onClose}
      onOk={() => void onSubmit(decision, reason.trim())}
      title="Quyết định về cảnh báo"
      okText="Ghi nhận quyết định"
      cancelText="Để sau"
      okButtonProps={{ disabled: !reasonOk, loading, danger: decision === 'VOID', size: 'large' }}
      cancelButtonProps={{ size: 'large' }}
      afterOpenChange={(open) => {
        if (open) {
          setDecision('KEEP');
          setReason('');
        }
      }}
      width={560}
      destroyOnClose
    >
      {flag ? (
        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ background: 'var(--sf-neutral-100)', borderRadius: 12, padding: 12 }}>
            <div className="sf-body-md" style={{ fontWeight: 600 }}>
              {FRAUD_CODE_LABEL[flag.code] ?? flag.code}
            </div>
            <div className="sf-body-sm sf-text-variant">
              {flag.employee?.fullName ?? 'Không xác định'} · điểm rủi ro {flag.score}
            </div>
          </div>

          <div>
            <label className="sf-label-md" style={{ display: 'block', marginBottom: 8 }}>
              Quyết định
            </label>
            <Radio.Group
              value={decision}
              onChange={(event) => setDecision(event.target.value as Decision)}
              style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
            >
              <Radio value="KEEP">
                Giữ nguyên công
                <div className="sf-body-sm sf-text-variant">
                  Cảnh báo là báo động giả — VD sai số GPS trong toà nhà cao tầng.
                </div>
              </Radio>
              <Radio value="VOID">
                Huỷ công của lượt này
                <div className="sf-body-sm sf-text-variant">
                  Lượt chấm công bị loại khỏi phép tính công. Bản ghi gốc vẫn giữ để đối chiếu.
                </div>
              </Radio>
              <Radio value="ESCALATE">
                Chuyển cấp trên xem xét
                <div className="sf-body-sm sf-text-variant">
                  Chưa đủ căn cứ để kết luận, cần người có thẩm quyền cao hơn quyết định.
                </div>
              </Radio>
            </Radio.Group>
          </div>

          <div>
            <label className="sf-label-md" htmlFor="fr-reason" style={{ display: 'block', marginBottom: 4 }}>
              Lý do (bắt buộc)
            </label>
            <Input.TextArea
              id="fr-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              maxLength={1000}
              showCount
              placeholder="VD: Đã xác minh với quản lý trực tiếp, nhân viên có mặt tại văn phòng. Sai lệch do GPS trong tầng hầm."
              status={reason.length > 0 && !reasonOk ? 'error' : undefined}
            />
            <p className="sf-body-sm sf-text-variant" style={{ margin: '4px 0 0' }}>
              Tối thiểu {REASON_MIN_LENGTH} ký tự. Nhân viên có quyền xem lý do nếu khiếu nại.
            </p>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
