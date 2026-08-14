import { useEffect, useState } from 'react';
import { Alert, Input, Modal } from 'antd';
import { REASON_MIN_LENGTH } from '@/config/constants';

/**
 * Hộp thoại "xác nhận hai bước" cho thao tác nguy hiểm — docs/04 mục 12.4.
 *
 * Áp dụng cho: chốt kỳ lương, mở lại kỳ, huỷ công nghi vấn, chấm dứt hợp đồng,
 * thu hồi thiết bị. Những thao tác này đều ghi audit log kèm lý do (BR-08), nên
 * ô lý do không phải thủ tục hình thức — nó là bằng chứng khi có tranh chấp.
 *
 * `requireReason` bật thì nút xác nhận khoá cho tới khi đủ 10 ký tự — cùng
 * ngưỡng Backend cưỡng chế (BR-ADJ-02), để người dùng không gõ xong mới bị từ chối.
 */
export function ReasonDialog({
  open,
  title,
  description,
  warning,
  confirmText = 'Xác nhận',
  danger = false,
  requireReason = true,
  loading = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  warning?: string;
  confirmText?: string;
  danger?: boolean;
  requireReason?: boolean;
  loading?: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setReason('');
      setTouched(false);
    }
  }, [open]);

  const tooShort = requireReason && reason.trim().length < REASON_MIN_LENGTH;
  const showError = touched && tooShort;

  return (
    <Modal
      open={open}
      title={title}
      okText={confirmText}
      cancelText="Huỷ bỏ"
      okButtonProps={{ danger, disabled: tooShort, loading, size: 'large' }}
      cancelButtonProps={{ size: 'large' }}
      onOk={() => onConfirm(reason.trim())}
      onCancel={onCancel}
      destroyOnClose
      maskClosable={!loading}
      width={520}
    >
      {description ? (
        <p className="sf-body-md" style={{ marginTop: 0 }}>
          {description}
        </p>
      ) : null}

      {warning ? (
        <Alert type="warning" showIcon message={warning} style={{ marginBottom: 16 }} />
      ) : null}

      {requireReason ? (
        <div>
          <label className="sf-field__label" htmlFor="sf-reason" style={{ display: 'block', marginBottom: 4 }}>
            Lý do (bắt buộc)
          </label>
          <Input.TextArea
            id="sf-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            onBlur={() => setTouched(true)}
            rows={3}
            maxLength={1000}
            showCount
            placeholder={`Mô tả lý do, tối thiểu ${REASON_MIN_LENGTH} ký tự`}
            aria-invalid={showError}
            aria-describedby={showError ? 'sf-reason-err' : undefined}
            status={showError ? 'error' : undefined}
          />
          {showError ? (
            <p
              id="sf-reason-err"
              role="alert"
              className="sf-body-sm"
              style={{ color: 'var(--sf-error-700)', margin: '4px 0 0' }}
            >
              Lý do cần tối thiểu {REASON_MIN_LENGTH} ký tự. Nội dung này được ghi vào nhật ký kiểm
              toán.
            </p>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
