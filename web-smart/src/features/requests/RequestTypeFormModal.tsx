import { useState } from 'react';
import { Alert, Input, InputNumber, Modal, Select, Switch } from 'antd';
import {
  DEDUCT_FROM_LABEL,
  REQUEST_UNIT_LABEL,
  useCreateRequestType,
  useUpdateRequestType,
  type RequestTypeConfig,
  type UpsertRequestTypePayload,
} from './request-config.api';
import { Field, useToast } from '@/components/ui';
import { useErrorToast } from '@/lib/errors/use-error-toast';

/**
 * Tạo / sửa một loại đơn — docs/04 mục 4.
 *
 * Mã loại đơn bị KHOÁ sau khi đã có đơn phát sinh. Mã nằm trong báo cáo và các
 * file Excel đã xuất của những kỳ trước; đổi nó là làm những bản đó không đối
 * chiếu lại được với hệ thống. Ô nhập chuyển sang chỉ đọc kèm giải thích, thay
 * vì để người dùng gõ xong mới nhận lỗi lúc bấm Lưu.
 */
export function RequestTypeFormModal({
  target,
  onClose,
}: {
  target: RequestTypeConfig | 'create' | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const showError = useErrorToast();
  const create = useCreateRequestType();
  const update = useUpdateRequestType();

  const existing = target === 'create' || target === null ? null : target;
  const [draft, setDraft] = useState<Partial<UpsertRequestTypePayload>>({});

  const value: UpsertRequestTypePayload = {
    code: draft.code ?? existing?.code ?? '',
    name: draft.name ?? existing?.name ?? '',
    deductFrom: draft.deductFrom ?? existing?.deductFrom ?? 'NONE',
    unit: draft.unit ?? existing?.unit ?? 'DAY',
    requiresAttachment: draft.requiresAttachment ?? existing?.requiresAttachment ?? false,
    requiresPreApproval: draft.requiresPreApproval ?? existing?.requiresPreApproval ?? false,
    maxDaysPerRequest: draft.maxDaysPerRequest ?? existing?.maxDaysPerRequest ?? undefined,
    isActive: draft.isActive ?? existing?.isActive ?? true,
  };

  const codeLocked = Boolean(existing && existing.requestCount > 0);
  const codeValid = /^[A-Z][A-Z0-9_]*$/.test(value.code);
  const canSubmit = value.name.trim().length > 0 && codeValid;

  function patch(next: Partial<UpsertRequestTypePayload>) {
    setDraft((prev) => ({ ...prev, ...next }));
  }

  return (
    <Modal
      open={target !== null}
      title={existing ? `Sửa loại đơn · ${existing.name}` : 'Thêm loại đơn'}
      okText={existing ? 'Lưu thay đổi' : 'Tạo loại đơn'}
      cancelText="Huỷ bỏ"
      okButtonProps={{
        loading: create.isPending || update.isPending,
        disabled: !canSubmit,
      }}
      width={600}
      destroyOnClose
      afterOpenChange={(open) => {
        if (open) setDraft({});
      }}
      onCancel={onClose}
      onOk={async () => {
        try {
          const payload: UpsertRequestTypePayload = {
            ...value,
            code: value.code.trim(),
            name: value.name.trim(),
          };

          if (existing) {
            await update.mutateAsync({ id: existing.id, ...payload });
            toast.success('Đã cập nhật loại đơn');
          } else {
            await create.mutateAsync(payload);
            toast.success('Đã tạo loại đơn', 'Cấu hình luồng duyệt ở nút "Luồng duyệt".');
          }
          onClose();
        } catch (caught) {
          showError(caught);
        }
      }}
    >
      <div style={{ display: 'grid', gap: 16 }}>
        <Field label="Tên hiển thị" htmlFor="rt-name" required>
          <Input
            id="rt-name"
            placeholder="Xin nghỉ phép"
            value={value.name}
            onChange={(event) => patch({ name: event.target.value })}
          />
        </Field>

        <Field label="Mã loại đơn" htmlFor="rt-code" required>
          <Input
            id="rt-code"
            placeholder="ANNUAL_LEAVE"
            readOnly={codeLocked}
            status={value.code && !codeValid ? 'error' : undefined}
            value={value.code}
            onChange={(event) => patch({ code: event.target.value.toUpperCase() })}
            style={{ fontFamily: 'monospace' }}
          />
          <p className="sf-body-sm sf-text-variant" style={{ margin: '4px 0 0' }}>
            {codeLocked
              ? `Đã có ${existing?.requestCount} đơn phát sinh nên mã bị khoá — nó đã nằm trong các báo cáo đã xuất. Đổi tên hiển thị thay vì đổi mã.`
              : 'Viết hoa không dấu, dùng gạch dưới. Mã dùng trong báo cáo và không đổi được sau khi có đơn phát sinh.'}
          </p>
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Field label="Đơn vị tính" htmlFor="rt-unit">
            <Select
              id="rt-unit"
              style={{ width: '100%' }}
              value={value.unit}
              onChange={(unit) => patch({ unit })}
              options={Object.entries(REQUEST_UNIT_LABEL).map(([key, label]) => ({
                value: key,
                label,
              }))}
            />
          </Field>

          <Field label="Trừ vào quỹ nào" htmlFor="rt-deduct">
            <Select
              id="rt-deduct"
              style={{ width: '100%' }}
              value={value.deductFrom}
              onChange={(deductFrom) => patch({ deductFrom })}
              options={Object.entries(DEDUCT_FROM_LABEL).map(([key, label]) => ({
                value: key,
                label,
              }))}
            />
          </Field>
        </div>

        <Field label="Số ngày tối đa mỗi đơn" htmlFor="rt-max">
          <InputNumber
            id="rt-max"
            min={1}
            style={{ width: '100%' }}
            placeholder="Bỏ trống = không giới hạn"
            value={value.maxDaysPerRequest ?? undefined}
            onChange={(days) => patch({ maxDaysPerRequest: days ?? undefined })}
          />
        </Field>

        <ToggleRow
          title="Bắt buộc có file minh chứng"
          description="Bật cho đơn nghỉ ốm hoặc nghỉ việc riêng cần giấy tờ. Nhân viên không đính kèm sẽ không gửi được đơn."
          checked={Boolean(value.requiresAttachment)}
          onChange={(requiresAttachment) => patch({ requiresAttachment })}
        />

        <ToggleRow
          title="Phải duyệt TRƯỚC khi phát sinh"
          description="Dùng cho đăng ký tăng ca: không duyệt trước thì mọi giờ ở lại muộn đều thành chi phí ngoài dự toán."
          checked={Boolean(value.requiresPreApproval)}
          onChange={(requiresPreApproval) => patch({ requiresPreApproval })}
        />

        {value.deductFrom === 'ANNUAL_LEAVE' ? (
          <Alert
            type="info"
            showIcon
            message="Loại đơn này trừ vào phép năm"
            description="Số dư phép lấy từ chính sách ở Chính sách công ty → Phép năm. Chưa cấu hình chính sách thì mọi đơn loại này bị chặn vì không đủ số dư."
          />
        ) : null}
      </div>
    </Modal>
  );
}

function ToggleRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 16,
        padding: 12,
        background: 'var(--sf-neutral-100)',
        borderRadius: 12,
      }}
    >
      <div>
        <div className="sf-body-md" style={{ fontWeight: 600 }}>
          {title}
        </div>
        <div className="sf-body-sm sf-text-variant">{description}</div>
      </div>
      <Switch checked={checked} onChange={onChange} aria-label={title} />
    </div>
  );
}
