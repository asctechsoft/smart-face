import { PageHeader } from '@/components/PageHeader';
import { Badge, Card, CardSkeleton, ErrorState, Icon } from '@/components/ui';
import { usePackages, type ServicePackage } from './provisioning.api';

/**
 * Khoá tính năng và nhãn hiển thị, theo thứ tự người mua so sánh chúng.
 *
 * Khoá phải TRÙNG với `SubscriptionPlan.features` phía Backend — đây là bảng
 * dịch mã sang tiếng người, không phải nơi định nghĩa tính năng. Một khoá mới
 * xuất hiện ở Backend mà chưa có ở đây thì rơi xuống mục "khác" bên dưới, không
 * biến mất.
 */
const FEATURE_LABELS: Record<string, string> = {
  appAccount: 'Tài khoản ứng dụng cho nhân viên',
  leaveApproval: 'Duyệt đơn nghỉ phép',
  advancedScheduling: 'Phân ca nâng cao',
  excelExport: 'Xuất Excel',
  advancedReport: 'Báo cáo nâng cao',
  apiIntegration: 'Tích hợp API',
  fullAuditLog: 'Nhật ký kiểm toán đầy đủ',
};

const LIMIT_LABELS: Array<{ key: keyof ServicePackage; label: string; unit?: string }> = [
  { key: 'maxEmployees', label: 'Nhân viên' },
  { key: 'maxDepartments', label: 'Phòng ban' },
  { key: 'maxShifts', label: 'Ca làm việc' },
  { key: 'maxAdminAccounts', label: 'Tài khoản quản trị' },
  { key: 'dataRetentionDays', label: 'Lưu dữ liệu', unit: 'ngày' },
];

/**
 * Gói dịch vụ Free / Plus / Max (mockup Figma `81:2`).
 *
 * ## `null` là "không giới hạn", KHÔNG phải "bằng 0"
 *
 * Phân biệt này quyết định gói Max có dùng được hay không. Backend hiểu `null`
 * là bỏ giới hạn (`PlanService.assertLimit` trả về ngay), nên giao diện cũng
 * phải hiển thị nó là "Không giới hạn" chứ không phải "0" — hiện "0" thì người
 * bán hàng đọc bảng này và tưởng gói cao cấp nhất chặn hết mọi thứ.
 *
 * ## Giới hạn được cưỡng chế ở Backend
 *
 * Bảng này chỉ để đọc. Việc chặn khi vượt hạn nằm ở tầng service
 * (`PLAN_LIMIT_EXCEEDED`) chứ không phải ở chỗ ẩn nút — `FR-ADM-PKG-03` yêu cầu
 * đúng điều đó, vì gọi thẳng API cũng không được vượt.
 */
export function PackagesPage() {
  const packages = usePackages();

  if (packages.isPending) {
    return (
      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  if (packages.isError || !packages.data) {
    return (
      <ErrorState
        description="Không đọc được danh mục gói dịch vụ từ máy chủ."
        onRetry={() => void packages.refetch()}
      />
    );
  }

  const plans = [...packages.data].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <PageHeader
        title="Gói dịch vụ"
        description="Giới hạn và tính năng của từng gói. Mọi giới hạn được cưỡng chế ở phía máy chủ."
      />

      <div
        style={{
          display: 'grid',
          gap: 16,
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        }}
      >
        {plans.map((plan) => (
          <PlanCard key={plan.id} plan={plan} />
        ))}
      </div>
    </div>
  );
}

function PlanCard({ plan }: { plan: ServicePackage }) {
  const features = (plan.features ?? {}) as Record<string, unknown>;
  const knownKeys = Object.keys(FEATURE_LABELS);
  const extraKeys = Object.keys(features).filter(
    (key) => !knownKeys.includes(key) && typeof features[key] === 'boolean',
  );

  return (
    <Card
      style={
        plan.isDefault
          ? { borderColor: 'var(--sf-primary)', boxShadow: 'var(--sf-shadow-md)' }
          : undefined
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span className="sf-title-lg">{plan.name}</span>
        {plan.isDefault ? <Badge tone="teal">Mặc định</Badge> : null}
        {!plan.isActive ? <Badge tone="neutral">Ngừng bán</Badge> : null}
      </div>

      {plan.description ? (
        <p className="sf-body-sm sf-text-muted" style={{ marginTop: 0 }}>
          {plan.description}
        </p>
      ) : null}

      <div className="sf-display-lg" style={{ color: 'var(--sf-primary)', marginBottom: 16 }}>
        {formatPrice(plan.priceMonthly)}
      </div>

      <div className="sf-label-md sf-text-muted" style={{ marginBottom: 4 }}>
        Giới hạn
      </div>
      <ul style={{ listStyle: 'none', margin: '0 0 16px', padding: 0, display: 'grid', gap: 4 }}>
        {LIMIT_LABELS.map(({ key, label, unit }) => (
          <li key={key} className="sf-body-sm" style={{ display: 'flex', gap: 8 }}>
            <span className="sf-text-muted" style={{ flex: 1 }}>
              {label}
            </span>
            <strong>{formatLimit(plan[key] as number | null, unit)}</strong>
          </li>
        ))}
      </ul>

      <div className="sf-label-md sf-text-muted" style={{ marginBottom: 4 }}>
        Tính năng
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
        {[...knownKeys, ...extraKeys].map((key) => (
          <FeatureRow key={key} label={FEATURE_LABELS[key] ?? key} on={features[key] === true} />
        ))}
      </ul>
    </Card>
  );
}

function FeatureRow({ label, on }: { label: string; on: boolean }) {
  return (
    <li className="sf-body-sm" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <Icon
        name={on ? 'check_circle' : 'remove'}
        size={18}
        color={on ? 'var(--sf-success)' : 'var(--sf-on-surface-muted)'}
      />
      <span className={on ? undefined : 'sf-text-muted'}>{label}</span>
    </li>
  );
}

/** `null` = không giới hạn. Xem docblock của trang — đây là chỗ dễ đọc nhầm nhất. */
function formatLimit(value: number | null, unit?: string): string {
  if (value === null || value === undefined) return 'Không giới hạn';
  return unit ? `${value.toLocaleString('vi-VN')} ${unit}` : value.toLocaleString('vi-VN');
}

function formatPrice(value: number | string | null): string {
  if (value === null || value === undefined) return 'Liên hệ';
  const amount = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(amount)) return 'Liên hệ';
  if (amount === 0) return 'Miễn phí';
  return `${amount.toLocaleString('vi-VN')} ₫/tháng`;
}
