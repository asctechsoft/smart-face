import { useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Steps } from 'antd';
import { AuthShell } from '@/features/auth/AuthShell';
import { Button, Card, Field, Icon, PasswordInput, TextInput } from '@/components/ui';
import { useErrorToast } from '@/lib/errors/use-error-toast';
import { useBootstrapPlatform, type BootstrapResult } from './provisioning.api';

/**
 * Tạo tài khoản Quản trị nền tảng đầu tiên (mockup Figma `96:4`).
 *
 * ## Vì sao màn hình này công khai, và vì sao điều đó chấp nhận được
 *
 * Chưa có ai để đăng nhập, nên nó buộc phải công khai. Thứ giữ an toàn nằm ở
 * Backend: endpoint chỉ chạy được khi hệ thống chưa có tài khoản nền tảng nào,
 * mọi lần gọi sau đều trả `PLATFORM_ALREADY_BOOTSTRAPPED`.
 *
 * ⚠ Vẫn còn một cửa sổ rủi ro thật: giữa lúc triển khai và lúc chủ hệ thống bấm
 * tạo, bất kỳ ai biết đường dẫn đều tạo được tài khoản đó. Cách bịt là chạy
 * bootstrap NGAY trong quy trình triển khai, trước khi mở cổng ra Internet —
 * xem `docs/22`. Không có cách nào bịt bằng giao diện.
 *
 * ## Vì sao chia ba bước cho một biểu mẫu bốn ô
 *
 * Không phải để trông trang trọng. Bước 1 nói rõ đây là thao tác MỘT LẦN trước
 * khi người dùng gõ gì, và bước 3 buộc họ dừng lại đọc phần MFA thay vì đóng
 * tab ngay sau khi thấy "thành công" — tài khoản này là chìa khoá của cả hệ
 * thống, và nó chưa an toàn cho tới khi bật xác thực hai lớp.
 */
export function PlatformBootstrapPage() {
  const navigate = useNavigate();
  const showError = useErrorToast();
  const bootstrap = useBootstrapPlatform();

  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', password: '', confirm: '' });
  const [result, setResult] = useState<BootstrapResult | null>(null);

  const set =
    (key: keyof typeof form) =>
    (event: ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const passwordMismatch = form.confirm.length > 0 && form.confirm !== form.password;
  const canSubmit =
    form.fullName.trim().length >= 2 &&
    /.+@.+\..+/.test(form.email) &&
    form.phone.trim().length >= 9 &&
    form.password.length >= 8 &&
    !passwordMismatch;

  const submit = () => {
    bootstrap.mutate(
      {
        fullName: form.fullName.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim(),
        password: form.password,
      },
      {
        onSuccess: (data) => {
          setResult(data);
          setStep(2);
        },
        onError: showError,
      },
    );
  };

  return (
    <AuthShell
      title="Khởi tạo nền tảng SmartFace"
      subtitle="Tạo tài khoản Quản trị nền tảng đầu tiên"
    >
      <Steps
        size="small"
        current={step}
        items={[
          { title: 'Giới thiệu' },
          { title: 'Tài khoản' },
          { title: 'Hoàn tất' },
        ]}
        style={{ marginBottom: 24 }}
      />

      {step === 0 ? (
        <div style={{ display: 'grid', gap: 16 }}>
          <Alert
            type="warning"
            showIcon
            message="Thao tác này chỉ chạy được MỘT LẦN"
            description="Sau khi tài khoản quản trị nền tảng đầu tiên được tạo, trang này sẽ không dùng được nữa. Nếu hệ thống đã có quản trị viên, hãy đăng nhập bình thường."
          />
          <Card>
            <div className="sf-title-sm" style={{ marginBottom: 8 }}>
              Tài khoản này làm được gì
            </div>
            <ul className="sf-body-sm" style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 4 }}>
              <li>Tạo công ty và tài khoản Tổng giám đốc cho từng khách hàng.</li>
              <li>Định nghĩa gói dịch vụ và giới hạn theo gói.</li>
              <li>Vận hành AI Server, hàng đợi và cấu hình hệ thống.</li>
              <li>
                <strong>Không</strong> tự động xem được dữ liệu của công ty nào — muốn xem phải mở
                phiên hỗ trợ có mã phiếu và lý do.
              </li>
            </ul>
          </Card>
          <Button variant="primary" block onClick={() => setStep(1)}>
            Bắt đầu
          </Button>
        </div>
      ) : null}

      {step === 1 ? (
        <form
          style={{ display: 'grid', gap: 16 }}
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) submit();
          }}
        >
          <Field label="Họ và tên" htmlFor="bs-name" required>
            <TextInput
              id="bs-name"
              value={form.fullName}
              onChange={set('fullName')}
              autoComplete="name"
              autoFocus
            />
          </Field>

          <Field
            label="Email"
            htmlFor="bs-email"
            required
            hint="Dùng để đăng nhập và nhận cảnh báo hệ thống."
          >
            <TextInput
              id="bs-email"
              type="email"
              value={form.email}
              onChange={set('email')}
              autoComplete="username"
            />
          </Field>

          <Field label="Số điện thoại" htmlFor="bs-phone" required>
            <TextInput
              id="bs-phone"
              value={form.phone}
              onChange={set('phone')}
              autoComplete="tel"
            />
          </Field>

          <Field
            label="Mật khẩu"
            htmlFor="bs-password"
            required
            hint="Tối thiểu 8 ký tự, có chữ hoa, chữ thường, số và ký tự đặc biệt."
          >
            <PasswordInput
              id="bs-password"
              value={form.password}
              onChange={set('password')}
              autoComplete="new-password"
            />
          </Field>

          <Field
            label="Nhập lại mật khẩu"
            htmlFor="bs-confirm"
            required
            error={passwordMismatch ? 'Hai lần nhập chưa khớp nhau.' : undefined}
          >
            <PasswordInput
              id="bs-confirm"
              value={form.confirm}
              onChange={set('confirm')}
              autoComplete="new-password"
              aria-invalid={passwordMismatch}
            />
          </Field>

          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="tertiary" onClick={() => setStep(0)} type="button">
              Quay lại
            </Button>
            <Button
              variant="primary"
              type="submit"
              block
              disabled={!canSubmit}
              loading={bootstrap.isPending}
            >
              Tạo tài khoản quản trị
            </Button>
          </div>
        </form>
      ) : null}

      {step === 2 && result ? (
        <div style={{ display: 'grid', gap: 16 }}>
          <Card style={{ background: 'var(--sf-success-tint)', borderColor: 'var(--sf-success)' }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <Icon name="check_circle" size={24} color="var(--sf-success)" />
              <div>
                <div className="sf-title-sm">Đã tạo tài khoản quản trị nền tảng</div>
                <div className="sf-body-sm sf-text-muted">
                  {result.fullName} · {result.email}
                </div>
              </div>
            </div>
          </Card>

          {result.mfaRequired ? (
            <Alert
              type="warning"
              showIcon
              message="Bật xác thực hai lớp ngay sau khi đăng nhập"
              description="Tài khoản nền tảng bắt buộc có MFA. Cho tới khi bật, đây là một tài khoản duy nhất nắm quyền cao nhất hệ thống và chỉ được bảo vệ bằng mật khẩu."
            />
          ) : null}

          <Alert
            type="info"
            showIcon
            message={`Đăng nhập với tên miền "${result.loginDomain}"`}
            description="Tài khoản nền tảng không thuộc công ty nào, nên phải chọn đúng tên miền này ở màn hình đăng nhập."
          />

          <Button variant="primary" block onClick={() => navigate('/login')}>
            Tới trang đăng nhập
          </Button>
        </div>
      ) : null}
    </AuthShell>
  );
}
