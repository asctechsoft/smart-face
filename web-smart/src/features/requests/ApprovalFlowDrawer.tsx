import { useEffect, useState } from 'react';
import { Alert, Button, Drawer, InputNumber, Select, Switch } from 'antd';
import { Icon } from '@/components/Icon';
import {
  APPROVER_ROLE_LABEL,
  useReplaceApprovalFlow,
  type ApprovalFlowStep,
  type RequestTypeConfig,
} from './request-config.api';
import { useToast } from '@/components/ui';
import { useErrorToast } from '@/lib/errors/use-error-toast';

/**
 * Cấu hình luồng duyệt của một loại đơn — docs/04 mục 4.1 (`FR-WEB-REQ-05`).
 *
 * ```
 * Loại đơn: Xin nghỉ phép
 *   ├─ Cấp 1: Quản lý trực tiếp   [bắt buộc]
 *   └─ Cấp 2: HR                  [bắt buộc nếu > 3 ngày]
 * ```
 *
 * Thứ tự cấp KHÔNG cho người dùng gõ tay: nó được đánh lại theo vị trí trong
 * danh sách mỗi lần thêm/xoá/di chuyển. Backend từ chối luồng có thứ tự trùng
 * hoặc nhảy cóc (`REQ_FLOW_INVALID`) vì bước duyệt tìm cấp kế tiếp theo số liền
 * kề — một khoảng trống làm đơn dừng lại giữa chừng và không ai duyệt tiếp được.
 */
export function ApprovalFlowDrawer({
  requestType,
  onClose,
}: {
  requestType: RequestTypeConfig | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const showError = useErrorToast();
  const replace = useReplaceApprovalFlow();

  const [steps, setSteps] = useState<ApprovalFlowStep[]>([]);

  useEffect(() => {
    if (requestType) setSteps(requestType.steps);
  }, [requestType]);

  /** Đánh lại `order` theo vị trí — nguồn sự thật là THỨ TỰ MẢNG, không phải số đã lưu. */
  function normalize(next: ApprovalFlowStep[]): ApprovalFlowStep[] {
    return next.map((step, index) => ({ ...step, order: index + 1 }));
  }

  function addStep() {
    setSteps((prev) =>
      normalize([
        ...prev,
        {
          order: prev.length + 1,
          approverRole: 'DIRECT_MANAGER',
          isRequired: true,
          minDays: null,
          maxDays: null,
        },
      ]),
    );
  }

  function patchStep(index: number, patch: Partial<ApprovalFlowStep>) {
    setSteps((prev) =>
      normalize(prev.map((step, position) => (position === index ? { ...step, ...patch } : step))),
    );
  }

  function removeStep(index: number) {
    setSteps((prev) => normalize(prev.filter((_, position) => position !== index)));
  }

  function move(index: number, direction: -1 | 1) {
    setSteps((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved as ApprovalFlowStep);
      return normalize(next);
    });
  }

  const hasRequired = steps.length === 0 || steps.some((step) => step.isRequired);
  const invalidThreshold = steps.some(
    (step) => step.minDays != null && step.maxDays != null && step.minDays > step.maxDays,
  );

  return (
    <Drawer
      open={Boolean(requestType)}
      onClose={onClose}
      width={620}
      destroyOnClose
      title={`Luồng duyệt · ${requestType?.name ?? ''}`}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <Button onClick={onClose}>Huỷ bỏ</Button>
          <Button
            type="primary"
            loading={replace.isPending}
            disabled={!hasRequired || invalidThreshold}
            onClick={async () => {
              if (!requestType) return;
              try {
                await replace.mutateAsync({ id: requestType.id, steps });
                toast.success('Đã lưu luồng duyệt', 'Đơn đang chờ duyệt giữ nguyên luồng cũ.');
                onClose();
              } catch (caught) {
                showError(caught);
              }
            }}
          >
            Lưu luồng duyệt
          </Button>
        </div>
      }
    >
      <div style={{ display: 'grid', gap: 16 }}>
        {steps.length === 0 ? (
          <Alert
            type="warning"
            showIcon
            message="Chưa cấu hình cấp duyệt nào"
            description="Loại đơn không có luồng riêng sẽ dùng mặc định: một cấp Quản lý trực tiếp. Với đơn ảnh hưởng bảng lương (bổ sung công, tăng ca) thì mặc định này thường là chưa đủ."
          />
        ) : null}

        {!hasRequired ? (
          <Alert
            type="error"
            showIcon
            role="alert"
            message="Phải có ít nhất một cấp bắt buộc"
            description="Luồng toàn cấp không bắt buộc nghĩa là đơn gửi lên tự đủ điều kiện duyệt — tức là bỏ hẳn chốt phê duyệt trong khi giao diện vẫn hiện ra như đang có luồng."
          />
        ) : null}

        {steps.map((step, index) => (
          <div
            key={`${step.order}-${index}`}
            style={{
              display: 'grid',
              gap: 12,
              padding: 16,
              border: '1px solid var(--sf-outline-variant)',
              borderRadius: 12,
              background: 'var(--sf-surface)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 className="sf-title-sm" style={{ margin: 0 }}>
                Cấp {step.order}
              </h3>
              <div style={{ display: 'flex', gap: 4 }}>
                <Button
                  size="small"
                  type="text"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  aria-label={`Đưa cấp ${step.order} lên trên`}
                  icon={<Icon name="arrow_upward" size={18} />}
                />
                <Button
                  size="small"
                  type="text"
                  disabled={index === steps.length - 1}
                  onClick={() => move(index, 1)}
                  aria-label={`Đưa cấp ${step.order} xuống dưới`}
                  icon={<Icon name="arrow_downward" size={18} />}
                />
                <Button
                  size="small"
                  type="text"
                  danger
                  onClick={() => removeStep(index)}
                  aria-label={`Xoá cấp ${step.order}`}
                  icon={<Icon name="delete" size={18} />}
                />
              </div>
            </div>

            <div>
              <label className="sf-field__label" style={{ display: 'block', marginBottom: 4 }}>
                Người duyệt
              </label>
              <Select
                style={{ width: '100%' }}
                value={step.approverRole}
                onChange={(approverRole) => patchStep(index, { approverRole })}
                options={Object.entries(APPROVER_ROLE_LABEL).map(([key, label]) => ({
                  value: key,
                  label,
                }))}
              />
              {step.approverRole === 'DIRECT_MANAGER' ? (
                <p className="sf-body-sm sf-text-variant" style={{ margin: '4px 0 0' }}>
                  Phân giải theo trưởng phòng ban của người gửi đơn. Phòng ban chưa gán trưởng phòng
                  thì đơn sẽ không có người duyệt cụ thể ở cấp này.
                </p>
              ) : null}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label className="sf-field__label" style={{ display: 'block', marginBottom: 4 }}>
                  Chỉ áp dụng khi đơn từ
                </label>
                <InputNumber
                  min={0}
                  addonAfter="ngày trở lên"
                  style={{ width: '100%' }}
                  placeholder="Mọi đơn"
                  value={step.minDays ?? undefined}
                  onChange={(minDays) => patchStep(index, { minDays: minDays ?? null })}
                />
              </div>
              <div>
                <label className="sf-field__label" style={{ display: 'block', marginBottom: 4 }}>
                  Và không quá
                </label>
                <InputNumber
                  min={0}
                  addonAfter="ngày"
                  style={{ width: '100%' }}
                  placeholder="Không giới hạn"
                  value={step.maxDays ?? undefined}
                  onChange={(maxDays) => patchStep(index, { maxDays: maxDays ?? null })}
                />
              </div>
            </div>

            {step.minDays != null && step.maxDays != null && step.minDays > step.maxDays ? (
              <Alert
                type="error"
                showIcon
                role="alert"
                message={`Ngưỡng tối thiểu ${step.minDays} lớn hơn tối đa ${step.maxDays} — không đơn nào khớp cấp này.`}
              />
            ) : null}

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
              }}
            >
              <div>
                <div className="sf-body-md" style={{ fontWeight: 600 }}>
                  Bắt buộc duyệt
                </div>
                <div className="sf-body-sm sf-text-variant">
                  Đơn chỉ chuyển sang ĐÃ DUYỆT khi tất cả các cấp bắt buộc đã duyệt (BR-APV-01).
                </div>
              </div>
              <Switch
                checked={step.isRequired}
                onChange={(isRequired) => patchStep(index, { isRequired })}
                aria-label={`Cấp ${step.order} bắt buộc`}
              />
            </div>
          </div>
        ))}

        <Button icon={<Icon name="add" size={20} />} onClick={addStep}>
          Thêm cấp duyệt
        </Button>

        <Alert
          type="info"
          showIcon
          message="Quy tắc luôn áp dụng, không cấu hình được"
          description={
            <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
              <li>Bất kỳ cấp nào từ chối thì đơn bị TỪ CHỐI ngay, các cấp sau không phải xử lý.</li>
              <li>Người duyệt không được duyệt đơn của chính mình.</li>
              <li>Sau khi duyệt, hệ thống tự tính lại công cho khoảng thời gian của đơn.</li>
            </ul>
          }
        />
      </div>
    </Drawer>
  );
}
