import { useMemo, useState } from 'react';
import { Alert, DatePicker, Input, Modal, Select, Switch } from 'antd';
import { REASON_MIN_LENGTH } from '@/config/constants';
import { toDayjs } from '@/lib/utils/dayjs';
import { useEmployeeList } from '@/features/employees/employees.api';
import { useCreateRequestOnBehalf, useRequestTypes } from './requests.api';
import { Field, useToast } from '@/components/ui';
import { useErrorToast } from '@/lib/errors/use-error-toast';

/**
 * HR / Quản lý tạo đơn THAY MẶT nhân viên — `FR-WEB-REQ-09`.
 *
 * ## Vì sao màn này tồn tại
 *
 * Nhân viên nghỉ ốm đột xuất, nộp đơn giấy, hoặc chưa cài ứng dụng thì đơn không
 * bao giờ vào hệ thống. Trước đây HR chữa bằng Hiệu chỉnh công — nhưng hiệu
 * chỉnh công sửa BẢNG CÔNG, nó KHÔNG trừ ngày phép. Cuối năm số dư phép lệch
 * khỏi thực tế mà không truy được từ đâu.
 *
 * ## Hai ô lý do, không phải một
 *
 * `reason` là lời khai của NHÂN VIÊN ("Việc gia đình") — nó đi vào nội dung đơn
 * và người duyệt đọc nó để ra quyết định. `onBehalfReason` trả lời câu hỏi khác
 * hẳn, dành cho người đọc nhật ký kiểm toán sáu tháng sau: vì sao đơn này không
 * do chính nhân viên gửi?
 *
 * Gộp hai ô làm một thì mất một trong hai thông tin, và thông tin mất đi luôn là
 * cái thứ hai — cái duy nhất giải thích được vì sao có một đơn không ai ký.
 */
export function CreateRequestOnBehalfModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const showError = useErrorToast();
  const create = useCreateRequestOnBehalf();

  const requestTypes = useRequestTypes();
  // Chỉ tải khi hộp thoại mở — trang bên dưới không cần danh sách này.
  const employees = useEmployeeList(open ? { pageSize: 200, status: 'ACTIVE' } : { pageSize: 1 });

  const [employeeId, setEmployeeId] = useState<string | undefined>();
  const [requestTypeCode, setRequestTypeCode] = useState<string | undefined>();
  const [range, setRange] = useState<{ from?: string; to?: string }>({});
  const [isHalfDay, setIsHalfDay] = useState(false);
  const [reason, setReason] = useState('');
  const [onBehalfReason, setOnBehalfReason] = useState('');

  const selectedType = useMemo(
    () => requestTypes.data?.find((type) => type.code === requestTypeCode) ?? null,
    [requestTypes.data, requestTypeCode],
  );

  const reasonOk = reason.trim().length > 0;
  const onBehalfOk = onBehalfReason.trim().length >= REASON_MIN_LENGTH;
  const canSubmit =
    Boolean(employeeId && requestTypeCode && range.from && range.to) && reasonOk && onBehalfOk;

  function reset() {
    setEmployeeId(undefined);
    setRequestTypeCode(undefined);
    setRange({});
    setIsHalfDay(false);
    setReason('');
    setOnBehalfReason('');
  }

  return (
    <Modal
      open={open}
      title="Tạo đơn thay mặt nhân viên"
      okText="Tạo đơn"
      cancelText="Huỷ bỏ"
      okButtonProps={{ loading: create.isPending, disabled: !canSubmit }}
      width={640}
      destroyOnClose
      afterOpenChange={(isOpen) => {
        if (isOpen) reset();
      }}
      onCancel={onClose}
      onOk={async () => {
        if (!employeeId || !requestTypeCode || !range.from || !range.to) return;
        try {
          await create.mutateAsync({
            employeeId,
            requestTypeCode,
            // Kèm offset múi giờ: gửi `2026-08-10T00:00:00` trần thì máy chủ hiểu
            // là giờ UTC, thành 07:00 sáng giờ Việt Nam — đơn nghỉ cả ngày biến
            // thành nghỉ từ 7 giờ, và ngày cuối lệch sang hôm sau.
            startAt: `${range.from}T00:00:00+07:00`,
            endAt: `${range.to}T23:59:59+07:00`,
            isHalfDay,
            reason: reason.trim(),
            onBehalfReason: onBehalfReason.trim(),
          });
          toast.success(
            'Đã tạo đơn và gửi đi duyệt',
            'Đơn nằm ở hàng chờ của người duyệt như mọi đơn khác. Màn chi tiết ghi rõ đơn này do bạn nhập hộ.',
          );
          onClose();
        } catch (caught) {
          showError(caught);
        }
      }}
    >
      <div style={{ display: 'grid', gap: 16 }}>
        <Alert
          type="info"
          showIcon
          message="Đơn vẫn đi qua luồng duyệt bình thường"
          description="Bạn nhập hộ, không phải duyệt hộ. Đơn vào trạng thái Chờ duyệt và người duyệt sẽ nhìn thấy đây là đơn do bạn nhập thay nhân viên."
        />

        <Field label="Nhân viên" htmlFor="ob-emp" required>
          <Select
            id="ob-emp"
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

        <Field label="Loại đơn" htmlFor="ob-type" required>
          <Select
            id="ob-type"
            style={{ width: '100%' }}
            placeholder="Chọn loại đơn"
            loading={requestTypes.isLoading}
            value={requestTypeCode}
            onChange={(value) => {
              setRequestTypeCode(value);
              setIsHalfDay(false);
            }}
            options={(requestTypes.data ?? []).map((type) => ({
              value: type.code,
              label: type.name,
            }))}
          />
          {selectedType?.deductFrom === 'ANNUAL_LEAVE' ? (
            <p className="sf-body-sm sf-text-variant" style={{ margin: '4px 0 0' }}>
              Loại đơn này trừ vào quỹ phép năm. Hệ thống sẽ từ chối nếu nhân viên không còn đủ
              phép.
            </p>
          ) : null}
          {selectedType?.requiresAttachment ? (
            <p className="sf-body-sm" style={{ margin: '4px 0 0', color: 'var(--sf-warning-800)' }}>
              Loại đơn này bắt buộc có minh chứng. Tạo xong hãy mở đơn và đính kèm file trước khi
              người duyệt xử lý.
            </p>
          ) : null}
        </Field>

        <Field label="Khoảng thời gian nghỉ" required>
          <DatePicker.RangePicker
            format="DD/MM/YYYY"
            style={{ width: '100%' }}
            value={[toDayjs(range.from), toDayjs(range.to)]}
            onChange={(dates) =>
              setRange({
                from: dates?.[0]?.format('YYYY-MM-DD'),
                to: dates?.[1]?.format('YYYY-MM-DD'),
              })
            }
          />
        </Field>

        {selectedType?.unit === 'HALF_DAY' || selectedType?.unit === 'DAY' ? (
          <Field label="Nghỉ nửa ngày" htmlFor="ob-half">
            <Switch id="ob-half" checked={isHalfDay} onChange={setIsHalfDay} />
          </Field>
        ) : null}

        <Field label="Lý do nghỉ của nhân viên" htmlFor="ob-reason" required>
          <Input.TextArea
            id="ob-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            maxLength={500}
            showCount
            placeholder="VD: Việc gia đình"
          />
          <p className="sf-body-sm sf-text-variant" style={{ margin: '4px 0 0' }}>
            Chép đúng lý do nhân viên khai. Người duyệt đọc dòng này để ra quyết định.
          </p>
        </Field>

        <Field label="Vì sao bạn nhập hộ" htmlFor="ob-note" required>
          <Input.TextArea
            id="ob-note"
            value={onBehalfReason}
            onChange={(event) => setOnBehalfReason(event.target.value)}
            rows={2}
            maxLength={500}
            showCount
            placeholder="VD: Nhân viên nộp đơn giấy ngày 12/08, chưa cài ứng dụng."
            status={onBehalfReason.length > 0 && !onBehalfOk ? 'error' : undefined}
            aria-invalid={onBehalfReason.length > 0 && !onBehalfOk}
          />
          <p className="sf-body-sm sf-text-variant" style={{ margin: '4px 0 0' }}>
            Tối thiểu {REASON_MIN_LENGTH} ký tự, được ghi vào nhật ký kiểm toán và hiện trên màn chi
            tiết đơn.
          </p>
        </Field>
      </div>
    </Modal>
  );
}
