import { useEffect, useState } from 'react';
import { Alert, Button, Input } from 'antd';
import { authApi, type SessionTokens } from '@/lib/auth/auth.api';
import { toUserMessage } from '@/lib/errors/api-error';

const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Bước hai của đăng nhập — nhập mã OTP gửi qua SMS.
 *
 * Ô nhập nhận cả mã 6 số lẫn mã dự phòng (dài hơn), nên không ép `maxLength=6`:
 * người mất điện thoại chỉ còn mã dự phòng để vào, chặn họ ở đây là khoá luôn
 * tài khoản.
 */
export function TwoFactorStep({
  twoFactorToken,
  onVerified,
  onCancel,
}: {
  twoFactorToken: string;
  onVerified: (tokens: SessionTokens) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);

  // Đếm ngược nút gửi lại. Backend cũng cưỡng chế giãn cách
  // (`AUTH_OTP_RESEND_TOO_SOON`); đồng hồ ở đây chỉ để người dùng khỏi bấm vào
  // một nút chắc chắn sẽ báo lỗi.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function submit() {
    if (code.trim().length < 6) {
      setError('Nhập mã gồm 6 số hoặc một mã dự phòng.');
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      const tokens = await authApi.verifyTwoFactor({ twoFactorToken, code: code.trim() });
      await onVerified(tokens);
    } catch (caught) {
      setError(toUserMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  async function resend() {
    setError(null);
    try {
      await authApi.resendTwoFactor(twoFactorToken);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (caught) {
      setError(toUserMessage(caught));
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {error ? <Alert type="error" showIcon message={error} role="alert" /> : null}

      <div>
        <label
          className="sf-field__label"
          htmlFor="otp"
          style={{ display: 'block', marginBottom: 4 }}
        >
          Mã xác thực
        </label>
        <Input
          id="otp"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          onPressEnter={() => void submit()}
          placeholder="123456"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          style={{ letterSpacing: '4px', fontSize: 20, fontWeight: 600 }}
          aria-invalid={Boolean(error)}
        />
        <p className="sf-body-sm sf-text-variant" style={{ margin: '4px 0 0' }}>
          Mất điện thoại? Nhập một mã dự phòng đã lưu — mỗi mã chỉ dùng được một lần.
        </p>
      </div>

      <Button type="primary" size="large" block loading={submitting} onClick={() => void submit()}>
        Xác nhận
      </Button>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Button type="link" onClick={onCancel} style={{ paddingInline: 0 }}>
          Quay lại đăng nhập
        </Button>
        <Button
          type="link"
          disabled={cooldown > 0}
          onClick={() => void resend()}
          style={{ paddingInline: 0 }}
        >
          {cooldown > 0 ? `Gửi lại sau ${cooldown}s` : 'Gửi lại mã'}
        </Button>
      </div>
    </div>
  );
}
