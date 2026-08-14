import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, DatePicker, Drawer, Select, Switch, Tag } from 'antd';
import { Controller, useForm } from 'react-hook-form';
import { Icon } from '@/components/Icon';
import { ROLE_LABEL, SystemRole } from '@/config/constants';
import { toUserMessage } from '@/lib/errors/api-error';
import { toWorkDate } from '@/lib/utils/date';
import { toDayjs } from '@/lib/utils/dayjs';
import { useDepartments, useBranches } from '@/features/shared/org.api';
import {
  useCreateEmployee,
  usePreviewCode,
  useUpdateEmployee,
  type CreateEmployeePayload,
  type Employee,
} from './employees.api';
import { Field, TextInput, useToast } from '@/components/ui';
import { useErrorToast } from '@/lib/errors/use-error-toast';

interface FormValues {
  fullName: string;
  phone: string;
  employeeCode: string;
  email: string;
  departmentId: string;
  branchId: string;
  position: string;
  contractType: string;
  joinedAt: string;
  roles: SystemRole[];
  managedDepartmentIds: string[];
  sendInvite: boolean;
}

const CONTRACT_TYPES = ['Chính thức', 'Thử việc', 'Thời vụ', 'Part-time'];

/**
 * Tạo / sửa hồ sơ nhân viên — docs/04 mục 8.1 (Luồng B).
 *
 * Bước "xem trước mã nhân viên" là điểm dễ bỏ sót nhất. `FR-WEB-HR-06` yêu cầu
 * hệ thống sinh mã tự động NHƯNG cho HR sửa trước khi lưu, vì mã là thứ nhân
 * viên đọc lên khi khiếu nại và xuất hiện trong mọi báo cáo. Sau lần chấm công
 * đầu tiên mã bị khoá (`codeLocked`) — lúc đó ô nhập chuyển sang chỉ đọc kèm
 * giải thích, thay vì im lặng từ chối khi bấm Lưu.
 */
export function EmployeeFormDrawer({
  open,
  mode,
  employee,
  onClose,
}: {
  open: boolean;
  mode: 'create' | 'edit';
  employee?: Employee;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const showError = useErrorToast();
  const departments = useDepartments();
  const branches = useBranches();

  const create = useCreateEmployee();
  const update = useUpdateEmployee();
  const previewCode = usePreviewCode();

  const [error, setError] = useState<string | null>(null);

  const {
    control,
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: {
      fullName: '',
      phone: '',
      employeeCode: '',
      email: '',
      departmentId: '',
      branchId: '',
      position: '',
      contractType: 'Chính thức',
      joinedAt: '',
      roles: [SystemRole.EMPLOYEE],
      managedDepartmentIds: [],
      sendInvite: true,
    },
  });

  useEffect(() => {
    if (!open) return;
    setError(null);

    reset({
      fullName: employee?.fullName ?? '',
      phone: employee?.phone ?? '',
      employeeCode: employee?.employeeCode ?? '',
      email: employee?.email ?? '',
      departmentId: employee?.departmentId ?? '',
      branchId: employee?.branchId ?? '',
      position: employee?.position ?? '',
      contractType: employee?.contractType ?? 'Chính thức',
      joinedAt: employee?.joinedAt ? employee.joinedAt.slice(0, 10) : '',
      roles: employee?.roles ?? [SystemRole.EMPLOYEE],
      managedDepartmentIds: employee?.managedDepartmentIds ?? [],
      sendInvite: true,
    });
  }, [open, employee, reset]);

  const fullName = watch('fullName');
  const roles = watch('roles');
  const isManager = roles?.includes(SystemRole.MANAGER);
  const codeLocked = mode === 'edit' && employee?.codeLocked;

  async function generateCode() {
    if (!fullName.trim()) {
      toast.warning('Nhập họ tên trước khi sinh mã');
      return;
    }
    try {
      const result = await previewCode.mutateAsync(fullName.trim());
      setValue('employeeCode', result.employeeCode, { shouldDirty: true });
    } catch (caught) {
      showError(caught);
    }
  }

  const onSubmit = handleSubmit(async (values) => {
    setError(null);

    const payload: CreateEmployeePayload = {
      fullName: values.fullName.trim(),
      phone: values.phone.trim(),
      ...(values.employeeCode ? { employeeCode: values.employeeCode.trim() } : {}),
      ...(values.email ? { email: values.email.trim() } : {}),
      ...(values.departmentId ? { departmentId: values.departmentId } : {}),
      ...(values.branchId ? { branchId: values.branchId } : {}),
      ...(values.position ? { position: values.position.trim() } : {}),
      ...(values.contractType ? { contractType: values.contractType } : {}),
      ...(values.joinedAt ? { joinedAt: values.joinedAt } : {}),
      roles: values.roles,
      // Chỉ gửi phạm vi phòng ban khi vai trò thật sự là MANAGER — gửi kèm ở vai
      // trò khác chỉ tạo dữ liệu rác mà `ScopeGuard` không bao giờ đọc tới.
      ...(isManager ? { managedDepartmentIds: values.managedDepartmentIds } : {}),
    };

    try {
      if (mode === 'create') {
        const created = await create.mutateAsync({ ...payload, sendInvite: values.sendInvite });
        toast.success(
          `Đã tạo hồ sơ ${values.fullName.trim()}`,
          values.sendInvite
            ? `Tin nhắn mời đã gửi tới ${values.phone}. Nhân viên tự hoàn tất đăng ký khuôn mặt trên ứng dụng.`
            : 'Chưa gửi lời mời — nhân viên chưa đăng nhập được cho tới khi bạn gửi.',
          // Vừa tạo xong thường là lúc cần xếp ca hoặc gán quyền cho người đó,
          // mà cả hai đều bắt đầu từ hồ sơ chi tiết.
          { label: 'Mở hồ sơ', onClick: () => navigate(`/employees/${created.id}`) },
        );
      } else if (employee) {
        await update.mutateAsync({ id: employee.id, ...payload });
        toast.success('Đã cập nhật hồ sơ');
      }
      onClose();
    } catch (caught) {
      setError(toUserMessage(caught));
    }
  });

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={560}
      destroyOnClose
      title={mode === 'create' ? 'Thêm nhân viên' : `Sửa hồ sơ · ${employee?.fullName ?? ''}`}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <Button size="large" onClick={onClose}>
            Huỷ bỏ
          </Button>
          <Button
            type="primary"
            size="large"
            loading={create.isPending || update.isPending}
            onClick={() => void onSubmit()}
          >
            {mode === 'create' ? 'Tạo hồ sơ' : 'Lưu thay đổi'}
          </Button>
        </div>
      }
    >
      <form onSubmit={onSubmit} noValidate style={{ display: 'grid', gap: 16 }}>
        {error ? <Alert type="error" showIcon message={error} role="alert" /> : null}

        <Field label="Họ và tên" error={errors.fullName?.message} htmlFor="emp-name" required>
          <TextInput
            id="emp-name"
            placeholder="Nguyễn Văn Đức"
            aria-invalid={Boolean(errors.fullName)}
            {...register('fullName', {
              required: 'Nhập họ và tên.',
              minLength: { value: 2, message: 'Họ tên quá ngắn.' },
            })}
          />
        </Field>

        <Field label="Số điện thoại" error={errors.phone?.message} htmlFor="emp-phone" required>
          <TextInput
            id="emp-phone"
            placeholder="0901234567"
            disabled={mode === 'edit'}
            aria-invalid={Boolean(errors.phone)}
            {...register('phone', {
              required: 'Nhập số điện thoại.',
              pattern: { value: /^[0-9+\s.-]{9,15}$/, message: 'Số điện thoại không hợp lệ.' },
            })}
          />
          {mode === 'edit' ? (
            <p className="sf-body-sm sf-text-variant" style={{ margin: '4px 0 0' }}>
              Số điện thoại gắn với tài khoản đăng nhập, đổi được ở mục quản trị hệ thống.
            </p>
          ) : null}
        </Field>

        <Field label="Mã nhân viên" error={errors.employeeCode?.message} htmlFor="emp-code">
          <div style={{ display: 'flex', gap: 8 }}>
            <TextInput
              id="emp-code"
              placeholder="Bỏ trống để hệ thống tự sinh"
              readOnly={codeLocked}
              {...register('employeeCode')}
            />
            {!codeLocked ? (
              <Button
                onClick={() => void generateCode()}
                loading={previewCode.isPending}
                icon={<Icon name="auto_awesome" size={18} />}
              >
                Sinh mã
              </Button>
            ) : null}
          </div>
          <p className="sf-body-sm sf-text-variant" style={{ margin: '4px 0 0' }}>
            {codeLocked
              ? 'Mã đã bị khoá sau lần chấm công đầu tiên và không đổi được nữa — nó đã nằm trong các bản ghi đã ghi.'
              : 'Sửa được cho tới khi nhân viên chấm công lần đầu.'}
          </p>
        </Field>

        <Field label="Email" error={errors.email?.message} htmlFor="emp-email">
          <TextInput
            id="emp-email"
            type="email"
            placeholder="ducnv@congty.vn"
            aria-invalid={Boolean(errors.email)}
            {...register('email', {
              pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: 'Email không hợp lệ.' },
            })}
          />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Field label="Phòng ban" htmlFor="emp-dept">
            <Controller
              control={control}
              name="departmentId"
              render={({ field }) => (
                <Select
                  {...field}
                  id="emp-dept"
                  allowClear
                  loading={departments.isLoading}
                  placeholder="Chọn phòng ban"
                  style={{ width: '100%' }}
                  options={(departments.data ?? []).map((item) => ({
                    value: item.id,
                    label: item.name,
                  }))}
                />
              )}
            />
          </Field>

          <Field label="Chi nhánh" htmlFor="emp-branch">
            <Controller
              control={control}
              name="branchId"
              render={({ field }) => (
                <Select
                  {...field}
                  id="emp-branch"
                  allowClear
                  loading={branches.isLoading}
                  placeholder="Chọn chi nhánh"
                  style={{ width: '100%' }}
                  options={(branches.data ?? []).map((item) => ({
                    value: item.id,
                    label: item.name,
                  }))}
                />
              )}
            />
          </Field>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Field label="Chức vụ" htmlFor="emp-position">
            <TextInput id="emp-position" placeholder="Nhân viên" {...register('position')} />
          </Field>

          <Field label="Loại hợp đồng" htmlFor="emp-contract">
            <Controller
              control={control}
              name="contractType"
              render={({ field }) => (
                <Select
                  {...field}
                  id="emp-contract"
                  style={{ width: '100%' }}
                  options={CONTRACT_TYPES.map((value) => ({ value, label: value }))}
                />
              )}
            />
          </Field>
        </div>

        <Field label="Ngày vào làm" htmlFor="emp-joined">
          <Controller
            control={control}
            name="joinedAt"
            render={({ field }) => (
              <DatePicker
                id="emp-joined"
                format="DD/MM/YYYY"
                style={{ width: '100%' }}
                value={toDayjs(field.value)}
                onChange={(date) => field.onChange(toWorkDate(date?.toDate()) ?? '')}
              />
            )}
          />
        </Field>

        <Field label="Vai trò trên hệ thống" htmlFor="emp-roles">
          <Controller
            control={control}
            name="roles"
            render={({ field }) => (
              <Select
                {...field}
                id="emp-roles"
                mode="multiple"
                style={{ width: '100%' }}
                options={[
                  SystemRole.EMPLOYEE,
                  SystemRole.MANAGER,
                  SystemRole.HR_PAYROLL,
                  SystemRole.COMPANY_ADMIN,
                ].map((role) => ({ value: role, label: ROLE_LABEL[role] }))}
              />
            )}
          />
        </Field>

        {/* FR-WEB-NOT-05: vai trò MANAGER phải kèm phạm vi phòng ban cụ thể. */}
        {isManager ? (
          <Field label="Phòng ban được quản lý" htmlFor="emp-scope">
            <Controller
              control={control}
              name="managedDepartmentIds"
              render={({ field }) => (
                <Select
                  {...field}
                  id="emp-scope"
                  mode="multiple"
                  style={{ width: '100%' }}
                  placeholder="Chọn các phòng ban người này quản lý"
                  loading={departments.isLoading}
                  options={(departments.data ?? []).map((item) => ({
                    value: item.id,
                    label: item.name,
                  }))}
                />
              )}
            />
            <Alert
              style={{ marginTop: 8 }}
              type="info"
              showIcon
              message="Quản lý chỉ xem được dữ liệu của các phòng ban chọn ở đây"
              description="Bỏ trống nghĩa là không xem được phòng ban nào — vai trò Quản lý bị giới hạn cả theo vai trò lẫn theo phạm vi."
            />
          </Field>
        ) : null}

        {mode === 'create' ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              padding: 12,
              background: 'var(--sf-neutral-100)',
              borderRadius: 12,
            }}
          >
            <div>
              <div className="sf-body-md" style={{ fontWeight: 600 }}>
                Gửi tin nhắn mời ngay
              </div>
              <div className="sf-body-sm sf-text-variant">
                Nhân viên nhận hướng dẫn tải ứng dụng và tự hoàn tất đăng ký khuôn mặt.
              </div>
            </div>
            <Controller
              control={control}
              name="sendInvite"
              render={({ field }) => (
                <Switch checked={field.value} onChange={field.onChange} aria-label="Gửi lời mời" />
              )}
            />
          </div>
        ) : null}

        {mode === 'edit' && employee ? (
          <div className="sf-body-sm sf-text-variant">
            Trạng thái hiện tại: <Tag>{employee.status}</Tag>
          </div>
        ) : null}
      </form>
    </Drawer>
  );
}

