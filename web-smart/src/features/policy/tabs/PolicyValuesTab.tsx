import { useEffect, useState } from 'react';
import { Alert, InputNumber, Select, Switch } from 'antd';
import { CardSkeleton } from '@/components/Skeleton';
import { ReasonDialog } from '@/components/ReasonDialog';
import { SectionTitle } from '@/components/PageHeader';
import { ApiErrorState } from '@/components/ApiErrorState';
import { useCan } from '@/lib/rbac/Can';
import { POLICY_FIELDS, usePolicies, useUpdatePolicies, type PolicyValues } from '../policy.api';
import { useToast } from '@/components/ui';
import { useErrorToast } from '@/lib/errors/use-error-toast';

/**
 * Chỉnh giá trị chính sách.
 *
 * Lưu có kèm hộp thoại lý do, không phải để làm khó: đổi hệ số OT hay bước làm
 * tròn ảnh hưởng thẳng vào lương của toàn công ty ở kỳ tiếp theo. Sáu tháng sau
 * khi có người hỏi "vì sao tháng 8 ai cũng ít hơn nửa công", nhật ký kiểm toán
 * là thứ duy nhất trả lời được.
 */
export function PolicyValuesTab() {
  const toast = useToast();
  const showError = useErrorToast();
  const canEdit = useCan('policy.edit');
  const policies = usePolicies();
  const update = useUpdatePolicies();

  const [draft, setDraft] = useState<PolicyValues>({});
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (policies.data) setDraft(policies.data);
  }, [policies.data]);

  const changedKeys = Object.keys(draft).filter(
    (key) => JSON.stringify(draft[key]) !== JSON.stringify(policies.data?.[key]),
  );

  if (policies.isLoading) return <CardSkeleton height={400} />;
  if (policies.error) {
    return (
      <ApiErrorState error={policies.error} onRetry={() => void policies.refetch()} />
    );
  }

  return (
    <div style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 32 }}>
      {!canEdit ? (
        <Alert
          type="info"
          showIcon
          message="Bạn đang xem ở chế độ chỉ đọc"
          description="Chỉ Admin công ty được sửa chính sách. Liên hệ Admin nếu cần thay đổi."
        />
      ) : null}

      {POLICY_FIELDS.map((group) => (
        <section key={group.group}>
          <SectionTitle>{group.group}</SectionTitle>

          <div className="sf-card" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {group.items.map((field) => (
              <div
                key={field.key}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: 24,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <label className="sf-body-md" htmlFor={field.key} style={{ fontWeight: 600 }}>
                    {field.label}
                  </label>
                  {'hint' in field && field.hint ? (
                    <p className="sf-body-sm sf-text-variant" style={{ margin: '2px 0 0' }}>
                      {field.hint}
                    </p>
                  ) : null}
                </div>

                <div style={{ flexShrink: 0, minWidth: 200 }}>
                  {field.type === 'boolean' ? (
                    <Switch
                      id={field.key}
                      disabled={!canEdit}
                      checked={Boolean(draft[field.key])}
                      onChange={(checked) => setDraft((prev) => ({ ...prev, [field.key]: checked }))}
                      aria-label={field.label}
                    />
                  ) : field.type === 'select' ? (
                    <Select
                      id={field.key}
                      disabled={!canEdit}
                      value={draft[field.key] as string}
                      style={{ width: '100%' }}
                      options={[...field.options]}
                      onChange={(value) => setDraft((prev) => ({ ...prev, [field.key]: value }))}
                    />
                  ) : (
                    <InputNumber
                      id={field.key}
                      disabled={!canEdit}
                      value={draft[field.key] as number}
                      style={{ width: '100%' }}
                      step={'step' in field ? field.step : 1}
                      min={0}
                      addonAfter={'suffix' in field ? field.suffix : undefined}
                      onChange={(value) => setDraft((prev) => ({ ...prev, [field.key]: value }))}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      {canEdit && changedKeys.length > 0 ? (
        <div className="sf-bulk-bar sf-on-dark" aria-live="polite">
          <span className="sf-body-md">Đã thay đổi {changedKeys.length} thiết lập</span>
          <span className="sf-bulk-divider" aria-hidden="true" />
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            style={{
              background: 'none',
              border: 'none',
              color: '#FFFFFF',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            Lưu thay đổi
          </button>
          <button
            type="button"
            onClick={() => setDraft(policies.data ?? {})}
            style={{
              marginLeft: 'auto',
              background: 'none',
              border: 'none',
              color: '#FFFFFF',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Khôi phục
          </button>
        </div>
      ) : null}

      <ReasonDialog
        open={confirmOpen}
        title="Lưu thay đổi chính sách"
        description={`${changedKeys.length} thiết lập sẽ được áp dụng cho các phép tính công từ thời điểm này trở đi.`}
        warning="Thay đổi KHÔNG tự tính lại các kỳ đã chốt. Muốn áp dụng cho kỳ cũ phải mở lại kỳ và chạy tính lại."
        confirmText="Lưu chính sách"
        loading={update.isPending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={async (reason) => {
          const patch = Object.fromEntries(changedKeys.map((key) => [key, draft[key]]));
          try {
            await update.mutateAsync({ policies: patch, reason });
            toast.success('Đã lưu chính sách');
            setConfirmOpen(false);
          } catch (caught) {
            showError(caught);
          }
        }}
      />
    </div>
  );
}
