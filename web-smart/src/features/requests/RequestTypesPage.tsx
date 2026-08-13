import { useState } from 'react';
import { Alert, App as AntApp, Button, Switch } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PageHeader } from '@/components/PageHeader';
import { DataTable } from '@/components/DataTable';
import { StatusBadge } from '@/components/StatusBadge';
import { Icon } from '@/components/Icon';
import { Can, useCan } from '@/lib/rbac/Can';
import { toUserMessage } from '@/lib/errors/api-error';
import { ApprovalFlowDrawer } from './ApprovalFlowDrawer';
import { RequestTypeFormModal } from './RequestTypeFormModal';
import {
  APPROVER_ROLE_LABEL,
  DEDUCT_FROM_LABEL,
  REQUEST_UNIT_LABEL,
  useRequestTypeConfigs,
  useUpdateRequestType,
  type RequestTypeConfig,
} from './request-config.api';

/**
 * Cấu hình loại đơn & luồng duyệt — docs/04 mục 4.1 (`FR-WEB-REQ-05`).
 *
 * Hai thứ nằm chung một bảng vì chúng là một quyết định: "đơn nghỉ phép" chỉ có
 * nghĩa khi biết ai duyệt nó. Tách ra hai màn thì người cấu hình phải nhớ quay
 * lại màn thứ hai, và loại đơn không có luồng sẽ âm thầm rơi về mặc định một cấp.
 *
 * Cột "Luồng duyệt" hiển thị chuỗi các cấp ngay trên dòng chứ không giấu sau nút
 * bấm — đây là thông tin người ta mở màn hình này để xem.
 */
export function RequestTypesPage() {
  const { message } = AntApp.useApp();
  const canEdit = useCan('request.configure');

  const types = useRequestTypeConfigs();
  const update = useUpdateRequestType();

  const [formTarget, setFormTarget] = useState<RequestTypeConfig | 'create' | null>(null);
  const [flowTarget, setFlowTarget] = useState<RequestTypeConfig | null>(null);

  async function toggleActive(row: RequestTypeConfig, isActive: boolean) {
    try {
      await update.mutateAsync({
        id: row.id,
        code: row.code,
        name: row.name,
        deductFrom: row.deductFrom,
        unit: row.unit,
        requiresAttachment: row.requiresAttachment,
        requiresPreApproval: row.requiresPreApproval,
        ...(row.maxDaysPerRequest != null ? { maxDaysPerRequest: row.maxDaysPerRequest } : {}),
        isActive,
      });
      message.success(
        isActive
          ? `Đã bật lại loại đơn "${row.name}".`
          : `Đã tắt "${row.name}". Nhân viên không tạo đơn loại này nữa; đơn đang chờ duyệt vẫn xử lý bình thường.`,
      );
    } catch (caught) {
      message.error(toUserMessage(caught));
    }
  }

  const columns: ColumnsType<RequestTypeConfig> = [
    {
      title: 'Loại đơn',
      key: 'name',
      fixed: 'left',
      width: 240,
      render: (_, row) => (
        <div>
          <div className="sf-body-md" style={{ fontWeight: 600 }}>
            {row.name}
          </div>
          <div className="sf-body-sm sf-text-variant" style={{ fontFamily: 'monospace' }}>
            {row.code}
          </div>
        </div>
      ),
    },
    {
      title: 'Đơn vị',
      dataIndex: 'unit',
      key: 'unit',
      width: 120,
      render: (value: string) => REQUEST_UNIT_LABEL[value] ?? value,
    },
    {
      title: 'Trừ vào quỹ',
      dataIndex: 'deductFrom',
      key: 'deductFrom',
      width: 170,
      render: (value: string) => DEDUCT_FROM_LABEL[value] ?? value,
    },
    {
      title: 'Ràng buộc',
      key: 'constraints',
      width: 220,
      render: (_, row) => {
        const tags = [
          ...(row.requiresAttachment ? ['Bắt buộc minh chứng'] : []),
          ...(row.requiresPreApproval ? ['Phải duyệt trước'] : []),
          ...(row.maxDaysPerRequest != null ? [`Tối đa ${row.maxDaysPerRequest} ngày/đơn`] : []),
        ];
        if (tags.length === 0) return <span className="sf-text-muted">Không</span>;

        return (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {tags.map((tag) => (
              <StatusBadge key={tag} tone="neutral" soft>
                {tag}
              </StatusBadge>
            ))}
          </div>
        );
      },
    },
    {
      title: 'Luồng duyệt',
      key: 'flow',
      width: 340,
      render: (_, row) => {
        if (row.steps.length === 0) {
          return (
            <span className="sf-body-sm">
              Mặc định: 1 cấp · {APPROVER_ROLE_LABEL.DIRECT_MANAGER}
            </span>
          );
        }

        return (
          <div style={{ display: 'grid', gap: 2 }}>
            {row.steps.map((step) => (
              <div key={step.order} className="sf-body-sm">
                <span className="sf-text-variant">Cấp {step.order}: </span>
                {APPROVER_ROLE_LABEL[step.approverRole] ?? step.approverRole}
                {step.minDays != null || step.maxDays != null ? (
                  <span className="sf-text-variant">
                    {' '}
                    ({conditionLabel(step.minDays, step.maxDays)})
                  </span>
                ) : null}
                {!step.isRequired ? <span className="sf-text-variant"> · không bắt buộc</span> : null}
              </div>
            ))}
          </div>
        );
      },
    },
    {
      title: 'Đơn đã phát sinh',
      dataIndex: 'requestCount',
      key: 'requestCount',
      width: 140,
      align: 'right',
    },
    {
      title: 'Đang bật',
      key: 'isActive',
      width: 110,
      render: (_, row) =>
        canEdit ? (
          <Switch
            checked={row.isActive}
            loading={update.isPending}
            onChange={(checked) => void toggleActive(row, checked)}
            aria-label={`Bật/tắt loại đơn ${row.name}`}
          />
        ) : (
          <StatusBadge tone={row.isActive ? 'success' : 'neutral'}>
            {row.isActive ? 'Bật' : 'Tắt'}
          </StatusBadge>
        ),
    },
    ...(canEdit
      ? [
          {
            title: '',
            key: 'actions',
            fixed: 'right' as const,
            width: 190,
            render: (_: unknown, row: RequestTypeConfig) => (
              <div style={{ display: 'flex', gap: 8 }}>
                <Button size="small" onClick={() => setFormTarget(row)}>
                  Sửa
                </Button>
                <Button size="small" type="primary" ghost onClick={() => setFlowTarget(row)}>
                  Luồng duyệt
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title="Loại đơn & luồng duyệt"
        description="Định nghĩa các loại đơn nhân viên gửi được và ai phải duyệt chúng. Đơn đang chờ duyệt luôn chạy hết luồng của lúc nó được gửi."
        actions={
          <Can do="request.configure">
            <Button
              type="primary"
              size="large"
              icon={<Icon name="add" size={20} />}
              onClick={() => setFormTarget('create')}
            >
              Thêm loại đơn
            </Button>
          </Can>
        }
      />

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Đổi luồng duyệt không áp ngược lên đơn đang chờ"
        description="Đơn đã gửi giữ nguyên các cấp duyệt sinh lúc gửi. Nếu áp luồng mới lên chúng thì đơn đã qua cấp 1 sẽ phải quay lại, hoặc tệ hơn là được duyệt xong trong khi cấp mới thêm chưa ai xem."
      />

      <DataTable<RequestTypeConfig>
        rowKey="id"
        data={types.data}
        isLoading={types.isLoading}
        error={types.error}
        onRetry={() => void types.refetch()}
        columns={columns}
        pagination={false}
        emptyIcon="assignment"
        emptyTitle="Chưa có loại đơn nào"
        emptyDescription="Chưa khai loại đơn thì nhân viên không gửi được đơn nào từ ứng dụng. Bắt đầu với Nghỉ phép, Xin ra ngoài và Bổ sung công."
        emptyAction={
          canEdit ? (
            <Button type="primary" size="large" onClick={() => setFormTarget('create')}>
              Thêm loại đơn
            </Button>
          ) : undefined
        }
      />

      <RequestTypeFormModal
        target={formTarget}
        onClose={() => setFormTarget(null)}
      />

      <ApprovalFlowDrawer requestType={flowTarget} onClose={() => setFlowTarget(null)} />
    </>
  );
}

function conditionLabel(minDays: number | null, maxDays: number | null): string {
  if (minDays != null && maxDays != null) return `đơn từ ${minDays} đến ${maxDays} ngày`;
  if (minDays != null) return `đơn từ ${minDays} ngày trở lên`;
  return `đơn không quá ${maxDays} ngày`;
}
