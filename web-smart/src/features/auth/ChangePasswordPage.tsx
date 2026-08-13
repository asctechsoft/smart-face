import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, App as AntApp } from 'antd';
import { useForm } from 'react-hook-form';
import { AuthShell } from './AuthShell';
import { Button, Field, PasswordInput } from '@/components/ui';
import { authApi } from '@/lib/auth/auth.api';
import {
  changeFirebasePassword,
  firebaseErrorMessage,
  reauthenticateAndGetIdToken,
} from '@/lib/auth/firebase';
import { useAuth } from '@/lib/auth/auth-context';
import { toUserMessage } from '@/lib/errors/api-error';

interface FormValues {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

/**
 * Đổi mật khẩu.
 *
 * Dùng cho cả hai tình huống: bắt buộc sau khi đăng nhập lần đầu bằng mật khẩu
 * tạm (`mustChangePassword`), và người dùng chủ động đổi.
 *
 * Trình tự BẮT BUỘC, đảo là hỏng:
 *
 *   1. Xác thực lại với Firebase (gõ lại mật khẩu cũ) → ID token mới
 *   2. `updatePassword` ở Firebase — nơi thật sự giữ mật khẩu
 *   3. `POST /auth/password/change` — Backend thu hồi mọi phiên cũ rồi cấp phiên mới
 *
 * Nếu gọi Backend trước bước 2, sẽ có một khoảng thời gian Backend tưởng mật
 * khẩu đã đổi trong khi mật khẩu thật vẫn là mật khẩu tạm — đúng thứ mà bước
 * bắt buộc đổi mật khẩu sinh ra để ngăn.
 */
export function ChangePasswordPage() {
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const { mustChangePassword, applyTokens } = useAuth();

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormValues>();

  const newPassword = watch('newPassword');

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    setSubmitting(true);

    try {
      await reauthenticateAndGetIdToken(values.currentPassword);
      const freshIdToken = await changeFirebasePassword(values.newPassword);

      const result = await authApi.changePassword({
        firebaseIdToken: freshIdToken,
        newPassword: values.newPassword,
      });

      await applyTokens(result);
      message.success(
        result.revokedSessions > 0
          ? `Đã đổi mật khẩu và thu hồi ${result.revokedSessions} phiên đăng nhập khác.`
          : 'Đã đổi mật khẩu.',
      );
      navigate('/dashboard', { replace: true });
    } catch (caught) {
      setError(
        (caught as { code?: string })?.code?.startsWith('auth/')
          ? firebaseErrorMessage(caught)
          : toUserMessage(caught),
      );
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <AuthShell
      title="Đổi mật khẩu"
      subtitle={
        mustChangePassword
          ? 'Đây là lần đăng nhập đầu tiên. Đặt mật khẩu riêng trước khi vào hệ thống.'
          : 'Đổi mật khẩu sẽ đăng xuất mọi thiết bị khác đang mở phiên của bạn.'
      }
    >
      <form onSubmit={onSubmit} noValidate style={{ display: 'grid', gap: 16 }}>
        {error ? <Alert type="error" showIcon message={error} role="alert" /> : null}

        {mustChangePassword ? (
          <Alert
            type="info"
            showIcon
            message="Mật khẩu tạm chỉ dùng được một lần"
            description="Bạn chưa vào được chức năng nào cho tới khi hoàn tất bước này."
          />
        ) : null}

        <Field
          label="Mật khẩu hiện tại"
          htmlFor="current"
          error={errors.currentPassword?.message}
          required
        >
          <PasswordInput
            id="current"
            autoComplete="current-password"
            aria-invalid={Boolean(errors.currentPassword)}
            {...register('currentPassword', { required: 'Nhập mật khẩu hiện tại.' })}
          />
        </Field>

        <Field
          label="Mật khẩu mới"
          htmlFor="new"
          error={errors.newPassword?.message}
          hint="Tối thiểu 8 ký tự, gồm cả chữ và số."
          required
        >
          <PasswordInput
            id="new"
            autoComplete="new-password"
            aria-invalid={Boolean(errors.newPassword)}
            {...register('newPassword', {
              required: 'Nhập mật khẩu mới.',
              minLength: { value: 8, message: 'Mật khẩu cần tối thiểu 8 ký tự.' },
              pattern: {
                value: /^(?=.*[A-Za-z])(?=.*\d).+$/,
                message: 'Mật khẩu phải có cả chữ và số.',
              },
            })}
          />
        </Field>

        <Field
          label="Nhập lại mật khẩu mới"
          htmlFor="confirm"
          error={errors.confirmPassword?.message}
          required
        >
          <PasswordInput
            id="confirm"
            autoComplete="new-password"
            aria-invalid={Boolean(errors.confirmPassword)}
            {...register('confirmPassword', {
              required: 'Nhập lại mật khẩu mới.',
              validate: (value) => value === newPassword || 'Hai mật khẩu không khớp.',
            })}
          />
        </Field>

        <Button size="lg" type="submit" loading={submitting} block>
          Đổi mật khẩu
        </Button>
      </form>
    </AuthShell>
  );
}
