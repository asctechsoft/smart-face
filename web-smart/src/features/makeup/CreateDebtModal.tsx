import { useState } from 'react';
import { Alert, DatePicker, Input, InputNumber, Modal, Select } from 'antd';
import { REASON_MIN_LENGTH } from '@/config/constants';
import { formatMinutes, toWorkDate, todayWorkDate } from '@/lib/utils/date';
import { toDayjs } from '@/lib/utils/dayjs';
import { useAuth } from '@/lib/auth/auth-context';
import { useEmployeeList } from '@/features/employees/employees.api';
import { useCreateMakeupDebt } from './makeup.api';
import { Field, useToast } from '@/components/ui';
import { useErrorToast } from '@/lib/errors/use-error-toast';

/**
 * Ghi nhận một khoản nợ công — docs/04 mục 5.1.
 *
 * Nợ công thường do engine tính công tự sinh khi nhân viên thiếu giờ so với ca.
 * Đường nhập tay này phục vụ hai tình huống có thật: thoả thuận riêng giữa quản
 * lý và nhân viên, và dữ liệu chuyển từ hệ thống cũ sang lúc mới triển khai.
 *
 * Số phút nhập theo GIỜ + PHÚT chứ không phải một ô "phút": người dùng nghĩ
 * bằng "thiếu 3 tiếng 20", và bắt họ tự nhân ra 200 là mời gọi lỗi gõ nhầm ở
 * một con số đi thẳng vào bảng lương.
 */
export function CreateDebtModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { timezone } = useAuth();
  const toast = useToast();
  const showError = useErrorToast();
  const create = useCreateMakeupDebt();

  const [employeeId, setEmployeeId] = useState<string | undefined>();
  const [debtWorkDate, setDebtWorkDate] = useState<string>(todayWorkDate(timezone));
  const [hours, setHours] = useState(0);
  const [minutes, setMinutes] = useState(0);
  const [dueDate, setDueDate] = useState<string | undefined>();
  const [reason, setReason] = useState('');

  // Danh sách nhân viên để chọn. Chỉ tải khi hộp thoại mở — trang bên dưới không
  // cần dữ liệu này và nó là một truy vấn phân trang thật sự.
  const employees = useEmployeeList({ pageSize: 100, status: 'ACTIVE' });

  const totalMinutes = hours * 60 + minutes;
  const canSubmit =
    Boolean(employeeId) && totalMinutes > 0 && reason.trim().length >= REASON_MIN_LENGTH;

  function reset() {
    setEmployeeId(undefined);
    setDebtWorkDate(todayWorkDate(timezone));
    setHours(0);
    setMinutes(0);
    setDueDate(undefined);
    setReason('');
  }

  return (
    <Modal
      open={open}
      title="Ghi nhận nợ công"
      okText="Ghi nhận"
      cancelText="Huỷ bỏ"
      okButtonProps={{ size: 'large', loading: create.isPending, disabled: !canSubmit }}
      cancelButtonProps={{ size: 'large' }}
      width={560}
      destroyOnClose
      afterOpenChange={(isOpen) => {
        if (isOpen) reset();
      }}
      onCancel={onClose}
      onOk={async () => {
        if (!employeeId) return;
        try {
          await create.mutateAsync({
            employeeId,
            debtWorkDate,
            debtMinutes: totalMinutes,
            ...(dueDate ? { dueDate } : {}),
            reason: reason.trim(),
          });
          toast.success('Đã ghi nhận khoản nợ công và thông báo cho nhân viên');
          onClose();
        } catch (caught) {
          showError(caught);
        }
      }}
    >
      <div style={{ display: 'grid', gap: 16 }}>
        <Field label="Nhân viên" htmlFor="md-emp" required>
          <Select
            id="md-emp"
            showSearch
            optionFilterProp="label"
            style={{ width: '100%' }}
            placeholder="Tìm theo tên hoặc mã nhân viên"
            loading={employees.isLoading}
            value={employeeId}
            onChange={setEmployeeId}
            options={(employees.data?.items ?? []).map((employee) => ({
              value: employee.id,
              label: `${employee.fullName} · ${employee.employeeCode}`,
            }))}
          />
        </Field>

        <Field label="Ngày phát sinh nợ" htmlFor="md-date" required>
          <DatePicker
            id="md-date"
            allowClear={false}
            format="DD/MM/YYYY"
            style={{ width: '100%' }}
            value={toDayjs(debtWorkDate)}
            onChange={(date) => setDebtWorkDate(toWorkDate(date?.toDate()) ?? debtWorkDate)}
          />
        </Field>

        <Field label="Số giờ còn thiếu" required>
          <div style={{ display: 'flex', gap: 12 }}>
            <InputNumber
              min={0}
              max={24}
              addonAfter="giờ"
              style={{ width: '100%' }}
              value={hours}
              onChange={(value) => setHours(value ?? 0)}
              aria-label="Số giờ còn thiếu"
            />
            <InputNumber
              min={0}
              max={59}
              addonAfter="phút"
              style={{ width: '100%' }}
              value={minutes}
              onChange={(value) => setMinutes(value ?? 0)}
              aria-label="Số phút còn thiếu"
            />
          </div>
          {totalMinutes > 0 ? (
            <p className="sf-body-sm sf-text-variant" style={{ margin: '4px 0 0' }}>
              Tổng {formatMinutes(totalMinutes)} — nhân viên phải làm bù đủ số này.
            </p>
          ) : null}
        </Field>

        <Field label="Hạn làm bù" htmlFor="md-due">
          <DatePicker
            id="md-due"
            format="DD/MM/YYYY"
            style={{ width: '100%' }}
            value={toDayjs(dueDate)}
            onChange={(date) => setDueDate(toWorkDate(date?.toDate()))}
          />
          <p className="sf-body-sm sf-text-variant" style={{ margin: '4px 0 0' }}>
            Bỏ trống thì hệ thống tính theo chính sách công ty, đếm từ ngày phát sinh nợ.
          </p>
        </Field>

        <Field label="Lý do" htmlFor="md-reason" required>
          <Input.TextArea
            id="md-reason"
            rows={3}
            maxLength={1000}
            showCount
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={`Vì sao phát sinh khoản nợ này, tối thiểu ${REASON_MIN_LENGTH} ký tự`}
          />
        </Field>

        <Alert
          type="info"
          showIcon
          message="Nhân viên nhận được thông báo ngay"
          description="Nội dung gồm số giờ còn thiếu, ngày phát sinh và hạn làm bù — để họ chủ động sắp lịch thay vì phát hiện khi bảng lương đã chốt."
        />
      </div>
    </Modal>
  );
}

