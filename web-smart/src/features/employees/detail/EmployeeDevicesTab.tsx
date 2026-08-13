import { useState } from 'react';
import { Alert, App as AntApp, Button } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DataTable } from '@/components/DataTable';
import { StatusBadge } from '@/components/StatusBadge';
import { ReasonDialog } from '@/components/ReasonDialog';
import { Can } from '@/lib/rbac/Can';
import { useAuth } from '@/lib/auth/auth-context';
import { formatDateTime, formatRelativeDay } from '@/lib/utils/date';
import { toUserMessage } from '@/lib/errors/api-error';
import { useEmployeeDevices, useRevokeDevice, type DeviceBinding } from '../employees.api';

/**
 * Thiết bị đã liên kết — docs/04 mục 11.2 (`FR-WEB-INV-06`).
 *
 * Bảng cố ý hiển thị cả liên kết ĐÃ THU HỒI. "Máy cũ bị thu hồi lúc 14:03 ngày
 * 12/08" là dữ kiện quyết định khi điều tra nghi vấn chấm công hộ; lọc đi thì
 * lịch sử chỉ còn một dòng và không giải thích được vì sao hôm đó hệ thống ghi
 * nhận hai thiết bị.
 *
 * `BR-11` — mỗi tài khoản chỉ MỘT thiết bị hoạt động tại một thời điểm. Thấy hai
 * dòng cùng hoạt động là dấu hiệu chốt thiết bị đang bị vô hiệu, nên màn hình
 * cảnh báo thẳng thay vì hiển thị như bình thường.
 */
export function EmployeeDevicesTab({
  employeeId,
  employeeName,
}: {
  employeeId: string;
  employeeName: string;
}) {
  const { timezone } = useAuth();
  const { message } = AntApp.useApp();

  const devices = useEmployeeDevices(employeeId);
  const revoke = useRevokeDevice();
  const [target, setTarget] = useState<DeviceBinding | null>(null);

  const columns: ColumnsType<DeviceBinding> = [
    {
      title: 'Thiết bị',
      key: 'device',
      width: 240,
      render: (_, row) => (
        <div>
          <div className="sf-body-md" style={{ fontWeight: 600 }}>
            {row.deviceModel ?? 'Không rõ model'}
          </div>
          <div className="sf-body-sm sf-text-variant">ID {row.deviceId.slice(0, 12)}…</div>
        </div>
      ),
    },
    {
      title: 'Hệ điều hành',
      key: 'os',
      width: 160,
      render: (_, row) =>
        row.osName ? `${row.osName} ${row.osVersion ?? ''}`.trim() : '—',
    },
    {
      title: 'Phiên bản app',
      dataIndex: 'appVersion',
      key: 'appVersion',
      width: 130,
      render: (value: string | null) => value ?? '—',
    },
    {
      title: 'Liên kết lúc',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 170,
      render: (value: string) => formatDateTime(value, timezone),
    },
    {
      title: 'Hoạt động lần cuối',
      dataIndex: 'lastSeenAt',
      key: 'lastSeenAt',
      width: 160,
      render: (value: string | null) => (value ? formatRelativeDay(value, timezone) : '—'),
    },
    {
      title: 'Trạng thái',
      key: 'status',
      width: 200,
      render: (_, row) => {
        if (!row.isActive) {
          return (
            <div>
              <StatusBadge tone="neutral">Đã thu hồi</StatusBadge>
              <div className="sf-body-sm sf-text-variant">
                {row.revokedAt ? formatDateTime(row.revokedAt, timezone) : ''}
                {row.revokedReason ? ` · ${row.revokedReason}` : ''}
              </div>
            </div>
          );
        }
        return (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <StatusBadge tone="success">Đang liên kết</StatusBadge>
            {/* AF-14: máy đã root vô hiệu hoá phần lớn chốt chống giả mạo. */}
            {row.isRooted ? <StatusBadge tone="error">Đã root</StatusBadge> : null}
          </div>
        );
      },
    },
    {
      title: '',
      key: 'actions',
      fixed: 'right',
      width: 120,
      render: (_, row) =>
        row.isActive ? (
          <Can do="device.revoke">
            <Button size="small" danger onClick={() => setTarget(row)}>
              Thu hồi
            </Button>
          </Can>
        ) : null,
    },
  ];

  const activeCount = devices.data?.activeCount ?? 0;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {activeCount > 1 ? (
        <Alert
          type="error"
          showIcon
          message={`Tài khoản này đang liên kết ${activeCount} thiết bị cùng lúc`}
          description="Chính sách BR-11 chỉ cho phép một thiết bị hoạt động tại một thời điểm. Thu hồi các thiết bị nhân viên không còn dùng và kiểm tra lại nhật ký chấm công của những ngày gần đây."
        />
      ) : null}

      <DataTable<DeviceBinding>
        rowKey="id"
        data={devices.data?.devices}
        isLoading={devices.isLoading}
        error={devices.error}
        onRetry={() => void devices.refetch()}
        columns={columns}
        pagination={false}
        emptyIcon="smartphone"
        emptyTitle="Chưa có thiết bị nào được liên kết"
        emptyDescription="Liên kết được tạo ở lần đăng nhập đầu tiên trên ứng dụng. Nhân viên chưa kích hoạt tài khoản thì mục này còn trống."
      />

      <ReasonDialog
        open={Boolean(target)}
        title="Thu hồi liên kết thiết bị"
        description={
          target ? `${employeeName} · ${target.deviceModel ?? target.deviceId.slice(0, 12)}` : undefined
        }
        warning="Toàn bộ phiên đăng nhập của nhân viên bị huỷ ngay. Họ phải đăng nhập lại và liên kết thiết bị mới trước khi chấm công được."
        confirmText="Thu hồi"
        danger
        loading={revoke.isPending}
        onCancel={() => setTarget(null)}
        onConfirm={async (reason) => {
          if (!target) return;
          try {
            await revoke.mutateAsync({ employeeId, bindingId: target.id, reason });
            message.success('Đã thu hồi liên kết thiết bị.');
            setTarget(null);
          } catch (caught) {
            message.error(toUserMessage(caught));
          }
        }}
      />
    </div>
  );
}
