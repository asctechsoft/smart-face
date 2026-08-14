import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Alert, Breadcrumb, Button, Tabs } from 'antd';
import { PageHeader } from '@/components/PageHeader';
import { DetailField, DetailGrid, DetailSection } from '@/components/DetailField';
import { StatusBadge, employeeStatusTone } from '@/components/StatusBadge';
import { ReasonDialog } from '@/components/ReasonDialog';
import { EmptyState } from '@/components/ui';
import { CardSkeleton } from '@/components/Skeleton';
import { Icon } from '@/components/Icon';
import { Can, useCan } from '@/lib/rbac/Can';
import { useAuth } from '@/lib/auth/auth-context';
import { EMPLOYEE_STATUS_LABEL, ROLE_LABEL } from '@/config/constants';
import { formatDateTime, formatDay, formatRelativeDay } from '@/lib/utils/date';
import { EmployeeFormDrawer } from './EmployeeFormDrawer';
import { EmployeeDevicesTab } from './detail/EmployeeDevicesTab';
import { EmployeeHistoryTab } from './detail/EmployeeHistoryTab';
import { useEmployee, useResetBiometric } from './employees.api';
import { ApiErrorState } from '@/components/ApiErrorState';
import { useToast } from '@/components/ui';
import { useErrorToast } from '@/lib/errors/use-error-toast';

/**
 * Hồ sơ nhân viên — docs/04 mục 8 (`FR-WEB-HR-01`, `FR-WEB-HR-02`).
 *
 * Màn hình này tồn tại để trả lời một câu hỏi cụ thể mà danh sách không trả lời
 * được: "vì sao người này không chấm công được hôm nay". Câu trả lời nằm rải ở
 * bốn chỗ — trạng thái hồ sơ, tài khoản đăng nhập, dữ liệu sinh trắc học, liên
 * kết thiết bị — nên cả bốn nằm cùng một trang thay vì mỗi thứ một nơi.
 *
 * Tab nằm trên URL (`?tab=`) để dán được đường dẫn thẳng tới đúng phần đang nói.
 */
export function EmployeeDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { timezone } = useAuth();
  const toast = useToast();
  const showError = useErrorToast();
  const canEdit = useCan('employee.edit');

  const [searchParams, setSearchParams] = useSearchParams();
  const [editOpen, setEditOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  const employee = useEmployee(id);
  const resetBiometric = useResetBiometric();

  const tab = searchParams.get('tab') ?? 'profile';

  function changeTab(key: string) {
    const next = new URLSearchParams(searchParams);
    next.set('tab', key);
    setSearchParams(next, { replace: true });
  }

  if (employee.isLoading) return <CardSkeleton />;

  if (employee.error) {
    return (
      <ApiErrorState
        error={employee.error}
        onRetry={() => void employee.refetch()}
        fallbackDescription="Không đọc được hồ sơ nhân viên này."
      />
    );
  }

  const data = employee.data;
  if (!data) {
    return (
      <EmptyState
        icon="person_off"
        title="Không tìm thấy hồ sơ nhân viên"
        description="Hồ sơ có thể đã bị xoá, hoặc không thuộc phạm vi phòng ban bạn quản lý."
        action={
          <Button type="primary" onClick={() => navigate('/employees')}>
            Về danh sách nhân viên
          </Button>
        }
      />
    );
  }

  const faceCount = data.faceProfiles?.length ?? 0;
  const hasFingerprint = (data.biometricKeys?.length ?? 0) > 0;

  return (
    <>
      <PageHeader
        breadcrumb={
          <Breadcrumb
            items={[
              { title: <Link to="/employees">Nhân viên</Link> },
              { title: data.fullName },
            ]}
          />
        }
        title={data.fullName}
        description={
          <>
            {data.employeeCode} · {data.department?.name ?? 'Chưa phân phòng ban'}
            {data.position ? ` · ${data.position}` : ''}
          </>
        }
        actions={
          <>
            <Can do="biometric.reset">
              <Button
                icon={<Icon name="face_retouching_off" size={20} />}
                onClick={() => setResetOpen(true)}
                disabled={faceCount === 0 && !hasFingerprint}
              >
                Đặt lại sinh trắc học
              </Button>
            </Can>
            {canEdit ? (
              <Button
                type="primary"
                icon={<Icon name="edit" size={20} />}
                onClick={() => setEditOpen(true)}
              >
                Sửa hồ sơ
              </Button>
            ) : null}
          </>
        }
      />

      {data.status === 'TERMINATED' ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="Hồ sơ đã chấm dứt hợp đồng"
          description={`Ngày chấm dứt ${formatDay(data.terminatedAt, timezone)}. Tài khoản không đăng nhập được và dữ liệu sinh trắc học đã bị vô hiệu. Bản ghi chấm công vẫn được giữ làm chứng từ.`}
        />
      ) : null}

      <Tabs
        activeKey={tab}
        onChange={changeTab}
        destroyInactiveTabPane
        items={[
          {
            key: 'profile',
            label: 'Hồ sơ',
            children: (
              <div style={{ display: 'grid', gap: 32 }}>
                <DetailSection title="Thông tin nhân sự">
                  <DetailGrid columns={3}>
                    <DetailField label="Mã nhân viên">{data.employeeCode}</DetailField>
                    <DetailField label="Số điện thoại">{data.phone}</DetailField>
                    <DetailField label="Email">{data.email ?? '—'}</DetailField>
                    <DetailField label="Phòng ban">{data.department?.name ?? '—'}</DetailField>
                    <DetailField label="Chi nhánh">{data.branch?.name ?? '—'}</DetailField>
                    <DetailField label="Chức vụ">{data.position ?? '—'}</DetailField>
                    <DetailField label="Loại hợp đồng">{data.contractType ?? '—'}</DetailField>
                    <DetailField label="Ngày vào làm">
                      {formatDay(data.joinedAt, timezone)}
                    </DetailField>
                    <DetailField label="Trạng thái">
                      <StatusBadge tone={employeeStatusTone(data.status)}>
                        {EMPLOYEE_STATUS_LABEL[data.status] ?? data.status}
                      </StatusBadge>
                    </DetailField>
                  </DetailGrid>
                </DetailSection>

                <DetailSection title="Quyền hạn">
                  <DetailGrid columns={2}>
                    <DetailField label="Vai trò trên hệ thống">
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {data.roles.map((role) => (
                          <StatusBadge key={role} tone={role === 'EMPLOYEE' ? 'neutral' : 'teal'} soft>
                            {ROLE_LABEL[role] ?? role}
                          </StatusBadge>
                        ))}
                      </div>
                    </DetailField>
                    <DetailField
                      label="Phòng ban được quản lý"
                      hint={
                        data.roles.includes('MANAGER') && data.managedDepartmentIds.length === 0
                          ? 'Vai trò Quản lý mà chưa gán phòng ban nào — người này đăng nhập vào sẽ không thấy dữ liệu nhân viên nào.'
                          : undefined
                      }
                    >
                      {data.managedDepartmentIds.length > 0
                        ? `${data.managedDepartmentIds.length} phòng ban`
                        : '—'}
                    </DetailField>
                  </DetailGrid>
                </DetailSection>

                <DetailSection title="Tài khoản & sinh trắc học">
                  <DetailGrid columns={3}>
                    <DetailField label="Đăng nhập lần cuối">
                      {data.user?.lastLoginAt
                        ? formatDateTime(data.user.lastLoginAt, timezone)
                        : 'Chưa đăng nhập lần nào'}
                    </DetailField>
                    <DetailField label="Tình trạng tài khoản">
                      {data.user?.isBlocked ? (
                        <StatusBadge tone="error">Đang bị khoá</StatusBadge>
                      ) : data.user ? (
                        <StatusBadge tone="success" soft>
                          Hoạt động
                        </StatusBadge>
                      ) : (
                        'Chưa cấp tài khoản'
                      )}
                    </DetailField>
                    <DetailField
                      label="Khuôn mặt đã đăng ký"
                      hint={
                        faceCount === 0
                          ? 'Chưa đăng ký thì không chấm công bằng khuôn mặt được — đây là nguyên nhân phổ biến nhất của "tôi không chấm công được".'
                          : undefined
                      }
                    >
                      {faceCount > 0 ? `${faceCount} góc mặt` : 'Chưa đăng ký'}
                    </DetailField>
                    <DetailField label="Vân tay">
                      {hasFingerprint ? 'Đã đăng ký' : 'Chưa đăng ký'}
                    </DetailField>
                    <DetailField label="Hồ sơ tạo lúc">
                      {formatRelativeDay(data.createdAt, timezone)}
                    </DetailField>
                  </DetailGrid>
                </DetailSection>
              </div>
            ),
          },
          {
            key: 'devices',
            label: 'Thiết bị',
            children: <EmployeeDevicesTab employeeId={id} employeeName={data.fullName} />,
          },
          {
            key: 'history',
            label: 'Lịch sử thay đổi',
            children: <EmployeeHistoryTab employeeId={id} />,
          },
        ]}
      />

      <EmployeeFormDrawer
        open={editOpen}
        mode="edit"
        employee={data}
        onClose={() => setEditOpen(false)}
      />

      <ReasonDialog
        open={resetOpen}
        title="Đặt lại dữ liệu sinh trắc học"
        description={`${data.fullName} · ${data.employeeCode}`}
        warning="Nhân viên sẽ KHÔNG chấm công được cho tới khi đăng ký lại khuôn mặt trên ứng dụng. Dữ liệu cũ bị vô hiệu hoá chứ không xoá — nó vẫn là bằng chứng đối chiếu cho các lượt đã chấm."
        confirmText="Đặt lại"
        danger
        loading={resetBiometric.isPending}
        onCancel={() => setResetOpen(false)}
        onConfirm={async (reason) => {
          try {
            await resetBiometric.mutateAsync({ id, reason });
            toast.success(
              'Đã đặt lại sinh trắc học',
              `${data.fullName} nhận được thông báo và cần đăng ký lại khuôn mặt trước ca làm tiếp theo.`,
            );
            setResetOpen(false);
          } catch (caught) {
            showError(caught);
          }
        }}
      />
    </>
  );
}
