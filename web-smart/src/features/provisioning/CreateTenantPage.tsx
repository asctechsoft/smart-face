import { useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Steps } from 'antd';
import { PageHeader } from '@/components/PageHeader';
import {
  Button,
  Card,
  Field,
  Icon,
  Select,
  TextInput,
  useToast,
} from '@/components/ui';
import { useErrorToast } from '@/lib/errors/use-error-toast';
import {
  usePackages,
  useProvisionTenant,
  type ProvisionTenantResult,
} from './provisioning.api';

interface FormState {
  name: string;
  code: string;
  domain: string;
  taxCode: string;
  planCode: string;
  directorName: string;
  directorEmail: string;
  directorPhone: string;
}

const EMPTY: FormState = {
  name: '',
  code: '',
  domain: '',
  taxCode: '',
  planCode: '',
  directorName: '',
  directorEmail: '',
  directorPhone: '',
};

/** Mã công ty đi vào MỌI mã nhân viên đã sinh, nên nó bất biến (`BR-04`). */
const CODE_PATTERN = /^[a-z0-9]{2,30}$/;

/**
 * Tạo công ty kèm tài khoản Tổng giám đốc (mockup Figma `69:60299`).
 *
 * ## Vì sao ba bước nhưng chỉ một lần gọi API
 *
 * Chia hai lần gọi (tạo công ty rồi tạo tài khoản) để lại được trạng thái nửa
 * vời: công ty tồn tại nhưng không ai đăng nhập được vào, và cũng không ai xoá
 * được vì xoá tenant là thao tác đặc quyền. Wizard chỉ ghi dữ liệu ở bước cuối,
 * trong một giao dịch duy nhất phía Backend.
 *
 * ## Mật khẩu tạm hiện đúng một lần
 *
 * Không lưu ở đâu và không đọc lại được. Màn hình nói rõ điều đó TRƯỚC khi hiện
 * mật khẩu, chứ không phải bằng một dòng chú thích nhỏ bên dưới — người dùng đã
 * đóng tab rồi thì lời cảnh báo đặt sau không cứu được gì.
 */
export function CreateTenantPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const showError = useErrorToast();

  const packages = usePackages();
  const provision = useProvisionTenant();

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [result, setResult] = useState<ProvisionTenantResult | null>(null);
  const [passwordSeen, setPasswordSeen] = useState(false);

  const set =
    (key: keyof FormState) =>
    (event: ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const codeInvalid = form.code.length > 0 && !CODE_PATTERN.test(form.code);
  const companyReady =
    form.name.trim().length >= 2 && CODE_PATTERN.test(form.code) && form.domain.trim().length >= 3;
  const directorReady =
    form.directorName.trim().length >= 2 &&
    /.+@.+\..+/.test(form.directorEmail) &&
    form.directorPhone.trim().length >= 9;

  const submit = () => {
    provision.mutate(
      {
        company: {
          name: form.name.trim(),
          code: form.code.trim().toLowerCase(),
          domain: form.domain.trim().toLowerCase(),
          taxCode: form.taxCode.trim() || undefined,
          planCode: form.planCode || undefined,
        },
        director: {
          fullName: form.directorName.trim(),
          email: form.directorEmail.trim().toLowerCase(),
          phone: form.directorPhone.trim(),
        },
      },
      {
        onSuccess: (data) => {
          setResult(data);
          setStep(2);
          toast.success(`Đã tạo công ty ${data.company.name}`);
        },
        onError: showError,
      },
    );
  };

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 760 }}>
      <PageHeader
        title="Tạo công ty mới"
        description="Tạo công ty và tài khoản Tổng giám đốc trong một lần."
      />

      <Steps
        size="small"
        current={step}
        items={[{ title: 'Thông tin công ty' }, { title: 'Tổng giám đốc' }, { title: 'Bàn giao' }]}
      />

      {step === 0 ? (
        <Card>
          <div style={{ display: 'grid', gap: 16 }}>
            <Field label="Tên công ty" htmlFor="t-name" required>
              <TextInput id="t-name" value={form.name} onChange={set('name')} autoFocus />
            </Field>

            <Field
              label="Mã công ty"
              htmlFor="t-code"
              required
              error={codeInvalid ? 'Chỉ chữ thường và số, 2–30 ký tự.' : undefined}
              hint="BẤT BIẾN sau khi tạo — mã này đi vào mọi mã nhân viên đã sinh (BR-04)."
            >
              <TextInput
                id="t-code"
                value={form.code}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, code: event.target.value.toLowerCase() }))
                }
                placeholder="amobilab"
                aria-invalid={codeInvalid}
              />
            </Field>

            <Field
              label="Tên miền đăng nhập"
              htmlFor="t-domain"
              required
              hint="Nhân viên gõ tên miền này ở màn hình đăng nhập để chọn đúng công ty."
            >
              <TextInput
                id="t-domain"
                value={form.domain}
                onChange={set('domain')}
                placeholder="amobilab.com"
              />
            </Field>

            <Field label="Mã số thuế" htmlFor="t-tax">
              <TextInput id="t-tax" value={form.taxCode} onChange={set('taxCode')} />
            </Field>

            <Field label="Gói dịch vụ" htmlFor="t-plan" hint="Bỏ trống để dùng gói mặc định.">
              <Select
                id="t-plan"
                value={form.planCode}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, planCode: event.target.value }))
                }
                options={[
                  { value: '', label: 'Gói mặc định' },
                  ...(packages.data ?? []).map((plan) => ({
                    value: plan.code,
                    label: plan.name,
                  })),
                ]}
              />
            </Field>

            <Button variant="primary" disabled={!companyReady} onClick={() => setStep(1)}>
              Tiếp tục
            </Button>
          </div>
        </Card>
      ) : null}

      {step === 1 ? (
        <Card>
          <div style={{ display: 'grid', gap: 16 }}>
            <Alert
              type="info"
              showIcon
              message="Người này là Owner đầu tiên của công ty"
              description="Tổng giám đốc nhận toàn quyền cấu hình và là người duy nhất chỉ định được Owner khác. Không thể gỡ Owner cuối cùng (BR-15)."
            />

            <Field label="Họ và tên" htmlFor="d-name" required>
              <TextInput
                id="d-name"
                value={form.directorName}
                onChange={set('directorName')}
                autoFocus
              />
            </Field>

            <Field label="Email" htmlFor="d-email" required>
              <TextInput
                id="d-email"
                type="email"
                value={form.directorEmail}
                onChange={set('directorEmail')}
              />
            </Field>

            <Field label="Số điện thoại" htmlFor="d-phone" required>
              <TextInput id="d-phone" value={form.directorPhone} onChange={set('directorPhone')} />
            </Field>

            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="tertiary" onClick={() => setStep(0)}>
                Quay lại
              </Button>
              <Button
                variant="primary"
                disabled={!directorReady}
                loading={provision.isPending}
                onClick={submit}
              >
                Tạo công ty và tài khoản
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {step === 2 && result ? (
        <div style={{ display: 'grid', gap: 16 }}>
          <Card style={{ background: 'var(--sf-success-tint)', borderColor: 'var(--sf-success)' }}>
            <div style={{ display: 'flex', gap: 12 }}>
              <Icon name="check_circle" size={24} color="var(--sf-success)" />
              <div>
                <div className="sf-title-sm">Đã tạo {result.company.name}</div>
                <div className="sf-body-sm sf-text-muted">
                  Mã {result.company.code} · Tên miền {result.company.domain} · Gói{' '}
                  {result.company.planCode ?? 'mặc định'}
                </div>
              </div>
            </div>
          </Card>

          <Alert
            type="warning"
            showIcon
            message="Mật khẩu tạm chỉ hiện MỘT LẦN"
            description="Không lưu ở đâu và không đọc lại được. Gửi cho Tổng giám đốc ngay bây giờ; mất thì phải dùng luồng đặt lại mật khẩu."
          />

          <Card>
            <div className="sf-label-md sf-text-muted">Tài khoản Tổng giám đốc</div>
            <div className="sf-body-md" style={{ marginBottom: 12 }}>
              {result.director.fullName} · {result.director.email}
            </div>

            <div className="sf-label-md sf-text-muted">Mật khẩu tạm</div>
            {passwordSeen ? (
              <code
                style={{
                  display: 'block',
                  fontSize: 18,
                  letterSpacing: 1,
                  padding: '8px 12px',
                  background: 'var(--sf-surface-container-low)',
                  borderRadius: 8,
                  userSelect: 'all',
                }}
              >
                {result.temporaryPassword}
              </code>
            ) : (
              <Button variant="secondary" icon="visibility" onClick={() => setPasswordSeen(true)}>
                Hiện mật khẩu tạm
              </Button>
            )}
          </Card>

          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="primary" onClick={() => navigate('/system/tenants')}>
              Về danh sách công ty
            </Button>
            <Button
              variant="tertiary"
              onClick={() => {
                setForm(EMPTY);
                setResult(null);
                setPasswordSeen(false);
                setStep(0);
              }}
            >
              Tạo công ty khác
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
