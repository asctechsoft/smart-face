import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Alert } from 'antd';
import { useForm } from 'react-hook-form';
import { AuthShell } from './AuthShell';
import { authApi, isTwoFactorChallenge, type SessionTokens } from '@/lib/auth/auth.api';
import { firebaseErrorMessage, signInAndGetIdToken, firebaseSignOut } from '@/lib/auth/firebase';
import { useAuth } from '@/lib/auth/auth-context';
import { NetworkError, toUserMessage, type NetworkFailureKind } from '@/lib/errors/api-error';
import { isFirebaseConfigured, missingFirebaseKeys } from '@/config/env';
import { TwoFactorStep } from './TwoFactorStep';
import { Button, Field, PasswordInput, TextInput } from '@/components/ui';

interface LoginForm {
  email: string;
  password: string;
}

/**
 * Câu cho trường hợp gọi Backend mà không nhận được phản hồi nào.
 *
 * Không dùng chung câu của `toUserError`: lời khuyên "tải lại trang để xem kết
 * quả" hợp lý ở mọi màn khác, nhưng ở đây thì vô nghĩa — chưa vào được thì chưa
 * có gì để xem. Điều người dùng cần biết là bấm lại có phải gõ lại gì không.
 */
const LOGIN_NO_ANSWER: Record<NetworkFailureKind, string> = {
  TIMEOUT:
    'Máy chủ đã nhận yêu cầu nhưng trả lời quá chậm. Bấm Đăng nhập lần nữa — mật khẩu vẫn còn trong ô.',
  UNREACHABLE: 'Không kết nối được máy chủ. Kiểm tra đường truyền rồi thử lại.',
  BAD_RESPONSE: 'Máy chủ trả về phản hồi không đọc được. Bấm Đăng nhập lần nữa.',
};

/**
 * Đăng nhập — docs/08 mục 2, docs/13.
 *
 * Chỉ hỏi email + mật khẩu. Luồng đầy đủ:
 *
 *   1. Firebase kiểm mật khẩu           → trả ID token
 *   2. `POST /auth/session`             → Backend đổi lấy phiên
 *   3a. Tài khoản bật 2 lớp             → nhập OTP gửi qua SMS
 *   3b. Đăng nhập lần đầu               → buộc đổi mật khẩu
 *   3c. Còn lại                         → vào thẳng
 *
 * **Vì sao không hỏi tên miền công ty.** Quan hệ tài khoản–công ty là 1–1
 * (`UserAccount.companyId`), và email là duy nhất toàn dự án Firebase. Sau khi
 * Firebase xác nhận danh tính, Backend đã biết chắc tài khoản thuộc công ty
 * nào — tên miền do người dùng gõ chỉ là phép đối chiếu với chính dữ liệu ta
 * đang có. Bỏ nó đi làm đường vào chặt hơn chứ không lỏng hơn: không còn đầu
 * vào nào từ client tham gia vào việc chọn công ty.
 *
 * **Firebase không phải là lớp thứ hai.** Nó luôn là nơi kiểm mật khẩu, cho mọi
 * tài khoản — Backend không lưu mật khẩu dưới bất kỳ dạng nào. Xác thực 2 lớp là
 * OTP qua SMS do Backend điều phối, chạy SAU khi Firebase đã xác nhận xong.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { applyTokens } = useAuth();

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [challenge, setChallenge] = useState<{ token: string; maskedPhone?: string } | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({ defaultValues: { email: '', password: '' } });

  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/dashboard';

  async function finishLogin(tokens: SessionTokens) {
    await applyTokens(tokens);
    navigate(tokens.nextStep === 'CHANGE_PASSWORD' ? '/doi-mat-khau' : redirectTo, {
      replace: true,
    });
  }

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    setSubmitting(true);

    try {
      const firebaseIdToken = await signInAndGetIdToken(values.email.trim(), values.password);
      const result = await authApi.createSession({ firebaseIdToken });

      if (isTwoFactorChallenge(result)) {
        setChallenge({ token: result.twoFactorToken, maskedPhone: result.maskedPhone });
        return;
      }

      await finishLogin(result);
    } catch (caught) {
      const noAnswer = caught instanceof NetworkError;

      // Firebase đã xác nhận danh tính nhưng Backend TỪ CHỐI (tài khoản chưa
      // được cấp hồ sơ, công ty bị tạm ngưng) → phải huỷ luôn phiên Firebase.
      // Để lại thì lần sau `currentUser` vẫn tồn tại và luồng xác thực lại hiểu
      // nhầm là người dùng đang đăng nhập hợp lệ.
      //
      // Nhưng KHÔNG huỷ khi chỉ là không nhận được câu trả lời. Backend chưa từ
      // chối ai cả — nó còn có thể đã tạo phiên xong. Đăng xuất Firebase ở đây
      // là tự tay vứt bỏ một danh tính vẫn còn hiệu lực, để rồi bắt người dùng
      // gõ lại mật khẩu cho một việc họ vừa làm đúng.
      if (!noAnswer) {
        await firebaseSignOut();
      }

      setError(
        (caught as { code?: string })?.code?.startsWith('auth/')
          ? firebaseErrorMessage(caught)
          : noAnswer
            ? LOGIN_NO_ANSWER[(caught as NetworkError).kind]
            : toUserMessage(caught),
      );
    } finally {
      setSubmitting(false);
    }
  });

  if (challenge) {
    return (
      <AuthShell
        title="Xác thực 2 lớp"
        subtitle={
          challenge.maskedPhone
            ? `Nhập mã 6 số vừa gửi tới ${challenge.maskedPhone}.`
            : 'Nhập mã 6 số vừa gửi tới số điện thoại đã đăng ký.'
        }
      >
        <TwoFactorStep
          twoFactorToken={challenge.token}
          onVerified={finishLogin}
          onCancel={() => {
            setChallenge(null);
            void firebaseSignOut();
          }}
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Đăng nhập"
      subtitle="Tài khoản do bộ phận nhân sự của công ty cấp."
      footer={
        <p className="sf-body-sm sf-text-variant" style={{ margin: 0 }}>
          Quên mật khẩu hoặc chưa nhận được tài khoản? Liên hệ bộ phận nhân sự — chỉ HR mới cấp và
          đặt lại được tài khoản.
        </p>
      }
    >
      <form onSubmit={onSubmit} noValidate style={{ display: 'grid', gap: 16 }}>
        {/*
          Thiếu cấu hình là lỗi của người triển khai, không phải của người đang
          đăng nhập — nên nói thẳng thiếu biến nào và sửa ở đâu, thay vì để họ gõ
          mật khẩu rồi nhận một lỗi khó hiểu từ trong SDK.
        */}
        {!isFirebaseConfigured ? (
          <Alert
            type="error"
            showIcon
            role="alert"
            message="Chưa cấu hình Firebase — chưa đăng nhập được"
            description={
              <div>
                <p style={{ margin: '0 0 8px' }}>
                  Thiếu biến môi trường: <strong>{missingFirebaseKeys.join(', ')}</strong>
                </p>
                <p style={{ margin: 0 }}>
                  Mở <code>web-smart/.env</code>, điền cấu hình Firebase rồi khởi động lại máy chủ
                  phát triển.
                </p>
              </div>
            }
          />
        ) : null}

        {error ? (
          <Alert
            type="error"
            showIcon
            message={error}
            role="alert"
            closable
            onClose={() => setError(null)}
          />
        ) : null}

        <Field label="Email" htmlFor="email" error={errors.email?.message} required>
          <TextInput
            id="email"
            type="email"
            placeholder="ten.ban@congty.vn"
            autoComplete="username"
            autoFocus
            icon="mail"
            aria-invalid={Boolean(errors.email)}
            {...register('email', {
              required: 'Nhập email đăng nhập.',
              pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: 'Email không hợp lệ.' },
            })}
          />
        </Field>

        <Field label="Mật khẩu" htmlFor="password" error={errors.password?.message} required>
          <PasswordInput
            id="password"
            autoComplete="current-password"
            placeholder="Nhập mật khẩu"
            aria-invalid={Boolean(errors.password)}
            {...register('password', { required: 'Nhập mật khẩu.' })}
          />
        </Field>

        <Button size="lg" type="submit" loading={submitting} disabled={!isFirebaseConfigured} block>
          Đăng nhập
        </Button>
      </form>
    </AuthShell>
  );
}
