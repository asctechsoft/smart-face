import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert } from 'antd';
import { useForm } from 'react-hook-form';
import { AuthShell, type AuthStep } from './AuthShell';
import { OtpInput } from './OtpInput';
import { Button, Field, Icon, PasswordInput, useToast } from '@/components/ui';
import { authApi, type MyProfile, type SessionTokens } from '@/lib/auth/auth.api';
import {
  changeFirebasePassword,
  currentFirebaseEmail,
  firebaseErrorMessage,
  reauthenticateAndGetIdToken,
} from '@/lib/auth/firebase';
import { useAuth } from '@/lib/auth/auth-context';
import { ApiError, toUserMessage } from '@/lib/errors/api-error';
import { ROLE_LABEL, SystemRole, type SystemRole as SystemRoleValue } from '@/config/constants';

interface FormValues {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

/** Ba chặng của luồng kích hoạt tài khoản — mockup Figma màn 2, 3, 4. */
type Stage = 'password' | 'phone' | 'done';

const STEP_LABELS = ['Đổi mật khẩu', 'Xác thực OTP', 'Hoàn tất'];

/**
 * Đổi mật khẩu, và — với tài khoản đăng nhập lần đầu — cả luồng kích hoạt.
 *
 * ## Một luồng, hai bộ câu chữ
 *
 * Cả hai đường vào — mật khẩu tạm do HR cấp (`mustChangePassword = true`) và
 * người tự vào từ menu tài khoản — đều chạy đủ ba chặng theo bản vẽ: đổi mật
 * khẩu → xác thực số điện thoại → hoàn tất. `mustChangePassword` chỉ còn chọn
 * câu chữ ("Kích hoạt tài khoản thành công" hay "Đổi mật khẩu thành công"),
 * không còn cắt bớt chặng nào.
 *
 * ## Trình tự BẮT BUỘC của chặng một, đảo là hỏng
 *
 *   1. Xác thực lại với Firebase (gõ lại mật khẩu cũ) → ID token mới
 *   2. `updatePassword` ở Firebase — nơi thật sự giữ mật khẩu
 *   3. `POST /auth/password/change` — Backend thu hồi mọi phiên cũ rồi cấp phiên mới
 *
 * Nếu gọi Backend trước bước 2, sẽ có một khoảng thời gian Backend tưởng mật
 * khẩu đã đổi trong khi mật khẩu thật vẫn là mật khẩu tạm — đúng thứ mà bước
 * bắt buộc đổi mật khẩu sinh ra để ngăn.
 *
 * ## Vì sao chặng hai chỉ tới được SAU chặng một
 *
 * `PasswordChangeGuard` ở Backend chặn mọi endpoint nghiệp vụ khi tài khoản còn
 * mật khẩu tạm — chỉ `password/change`, `logout` và `auth/me` đi qua. Nghĩa là
 * trong lúc đang ở chặng một, ta KHÔNG đọc được hồ sơ cá nhân, nên chưa biết
 * tên lẫn số điện thoại của chính người đang ngồi trước màn hình. Dải danh tính
 * ở chặng một vì thế chỉ có email (lấy từ phiên Firebase) và vai trò (nằm sẵn
 * trong JWT); tên đầy đủ và công ty xuất hiện từ chặng hai trở đi.
 */
export function ChangePasswordPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { mustChangePassword, applyTokens, roles } = useAuth();

  /*
   * Chốt "đây có phải luồng kích hoạt không" một lần lúc gắn component.
   *
   * Không đọc `mustChangePassword` trực tiếp ở mỗi lần vẽ lại: ngay khi chặng
   * một xong, cờ đó tắt, và mọi câu chữ trên màn hình sẽ đổi giữa chừng.
   *
   * ⚠ Cờ này giờ chỉ còn quyết định CÂU CHỮ, không quyết định LUỒNG. Cả hai
   * đường vào đều chạy đủ ba chặng — xem `onPasswordChanged`.
   */
  const [activation] = useState(mustChangePassword);
  const [stage, setStage] = useState<Stage>('password');
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);

  const steps: AuthStep[] = STEP_LABELS.map((label, index) => {
    const order: Stage[] = ['password', 'phone', 'done'];
    const currentIndex = order.indexOf(stage);
    return {
      label,
      state: index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'todo',
    };
  });

  /* Hồ sơ chỉ đọc được sau chặng một — xem chú thích ở đầu tệp. */
  useEffect(() => {
    if (stage === 'password') return;
    authApi
      .myProfile()
      .then(setProfile)
      .catch(() => setProfile(null));
  }, [stage]);

  /*
   * Cả hai đường vào đều đi tiếp sang chặng xác thực số điện thoại.
   *
   * Bản trước đưa người tự vào đổi mật khẩu về thẳng trang chủ, nên thanh ba
   * bước phải giấu đi ở nhánh đó — vẽ "2. Xác thực OTP → 3. Hoàn tất" cho một
   * luồng dừng ở bước một là hứa hai bước không bao giờ chạy. Chủ sản phẩm chọn
   * hướng ngược lại: cho nhánh tự nguyện chạy đủ ba bước, để mọi người đổi mật
   * khẩu đều đi qua cùng một đường và thanh bước luôn nói đúng sự thật.
   *
   * Chặng hai vẫn bỏ qua được. Người đã bật xác thực 2 lớp từ trước, ngay khi
   * bấm "Gửi mã xác thực", nhận `AUTH_2FA_ALREADY_ENABLED` và được đưa thẳng
   * sang chặng ba — không có tin nhắn nào bị gửi và không phải nhập lại OTP.
   * Họ vẫn phải bấm nút đó một lần: `MyProfile` không trả về trạng thái 2 lớp
   * nên màn hình không biết trước, và tự gọi `2fa/setup` lúc vào chặng sẽ bắn
   * một tin nhắn SMS mà người dùng không yêu cầu.
   */
  const onPasswordChanged = () => setStage('phone');

  if (stage === 'done') {
    return (
      <AuthShell
        title={activation ? 'Kích hoạt tài khoản thành công' : 'Đổi mật khẩu thành công'}
        subtitle={
          twoFactorEnabled
            ? 'Mật khẩu và số điện thoại của bạn đã được xác thực.'
            : 'Mật khẩu đã được cập nhật. Số điện thoại sẽ xác thực khi bạn thực hiện thao tác nhạy cảm.'
        }
        steps={steps}
      >
        <DoneStage
          activation={activation}
          profile={profile}
          roles={profile?.roles ?? roles}
          onEnter={() => navigate('/')}
        />
      </AuthShell>
    );
  }

  if (stage === 'phone') {
    return (
      <AuthShell
        title="Xác thực số điện thoại"
        subtitle="Chúng tôi sẽ gửi mã xác thực 6 số đến số điện thoại đã đăng ký."
        steps={steps}
      >
        <PhoneStage
          profile={profile}
          onVerified={() => {
            setTwoFactorEnabled(true);
            setStage('done');
          }}
          onSkip={() => setStage('done')}
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Đổi mật khẩu"
      subtitle={
        activation
          ? 'Để bảo vệ tài khoản, vui lòng thiết lập mật khẩu mới trước khi tiếp tục.'
          : 'Đổi mật khẩu sẽ đăng xuất mọi thiết bị khác đang mở phiên của bạn.'
      }
      steps={steps}
    >
      <PasswordStage
        roles={roles}
        applyTokens={applyTokens}
        toast={toast}
        onDone={onPasswordChanged}
      />
    </AuthShell>
  );
}

// ===========================================================================
//  Chặng 1 — đổi mật khẩu
// ===========================================================================

/**
 * Điều kiện mật khẩu, hiện ngay dưới ô nhập và đổi màu trong lúc gõ.
 *
 * Ba dòng này khớp CHÍNH XÁC với `PasswordService.assertStrong` ở Backend, và
 * cả hai cùng lấy từ bản vẽ màn đổi mật khẩu. Trước đây hai bên lệch nhau —
 * Backend bắt 12 ký tự không quy tắc thành phần, bản vẽ ghi 8 ký tự có quy tắc
 * — và chủ sản phẩm đã chọn kéo Backend về theo bản vẽ.
 *
 * ⚠ Nếu sau này đổi `PasswordService`, phải đổi cả ở đây. Hai bên lệch nhau là
 * hỏng theo cách tệ nhất có thể: người dùng thấy đủ ba dấu tích xanh, bấm gửi,
 * Firebase ĐỔI MẬT KHẨU XONG, rồi Backend mới trả `AUTH_PASSWORD_TOO_WEAK` —
 * họ mất luôn cả mật khẩu cũ lẫn đường đăng nhập. Xem thứ tự bắt buộc ở
 * docblock đầu tệp.
 *
 * `\p{Ll}` / `\p{Lu}` chứ không phải `[a-z]` / `[A-Z]`, vì `[a-z]` không khớp
 * `ầ` — `Cầuvồng1` sẽ bị báo là thiếu chữ thường.
 */
const MIN_LENGTH = 8;

function passwordRules(value: string) {
  return [
    {
      label: `Tối thiểu ${MIN_LENGTH} ký tự`,
      met: value.length >= MIN_LENGTH,
    },
    {
      label: 'Có chữ hoa, chữ thường',
      met: /\p{Ll}/u.test(value) && /\p{Lu}/u.test(value),
    },
    {
      label: 'Có ít nhất 1 số hoặc ký tự đặc biệt',
      met: /\p{N}/u.test(value) || /[^\p{L}\p{N}]/u.test(value),
    },
  ];
}

/**
 * Những thứ Backend cũng từ chối nhưng KHÔNG nằm trong ba dòng của bản vẽ.
 *
 * Bản vẽ chỉ liệt kê ba điều kiện, nên hai luật còn lại của `PasswordService`
 * không có chỗ trên màn hình. Nhưng chúng vẫn phải được kiểm TRƯỚC khi gửi:
 * một mật khẩu chứa phần đầu email thoả cả ba dấu tích, và nếu để Backend bắt
 * thì Firebase đã đổi mật khẩu mất rồi.
 *
 * Danh sách mật khẩu phổ biến thì để nguyên bên Backend — chép nó sang đây là
 * tạo ra một bản sao thứ hai sẽ lệch, và nó cũng không phải thứ người dùng gõ
 * nhầm vào một cách tình cờ.
 */
function passwordBlocker(value: string, email: string | null): string | null {
  const localPart = email?.split('@')[0]?.toLowerCase() ?? '';
  if (localPart.length >= 3 && value.toLowerCase().includes(localPart)) {
    return 'Mật khẩu không được chứa phần đầu địa chỉ email.';
  }
  if (value.length > 128) {
    return 'Mật khẩu không được dài quá 128 ký tự.';
  }
  return null;
}

function PasswordStage({
  roles,
  applyTokens,
  toast,
  onDone,
}: {
  roles: SystemRoleValue[];
  applyTokens: (tokens: SessionTokens) => Promise<void>;
  toast: ReturnType<typeof useToast>;
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const email = currentFirebaseEmail();

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormValues>();

  const newPassword = watch('newPassword') ?? '';
  const rules = passwordRules(newPassword);

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
      toast.success(
        'Đã đổi mật khẩu',
        result.revokedSessions > 0
          ? `Đã thu hồi ${result.revokedSessions} phiên đăng nhập khác trên các thiết bị cũ.`
          : undefined,
      );
      onDone();
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
    <form onSubmit={onSubmit} noValidate style={{ display: 'grid', gap: 16 }}>
      {error ? <Alert type="error" showIcon message={error} role="alert" /> : null}

      <IdentityStrip name={email} roles={roles} />

      {/*
        Không có khối "Mật khẩu tạm chỉ dùng được một lần" ở đây — bản vẽ đi
        thẳng từ dải danh tính xuống ô nhập. Nó vốn nói lại đúng thứ mà phụ đề
        ("vui lòng thiết lập mật khẩu mới trước khi tiếp tục") và dải xanh cuối
        biểu mẫu đã nói; ba lời nhắc chồng lên nhau đẩy nút chính xuống dưới mép
        màn hình trên laptop 13 inch.
      */}

      {/*
        Không có dấu `*` sau nhãn, đúng bản vẽ. Cả ba ô đều bắt buộc, nên ba dấu
        sao giống hệt nhau không phân biệt được ô nào với ô nào — chúng chỉ thêm
        ba vệt đỏ vào một màn mà màu đỏ đang được dành riêng cho lỗi thật.
        `aria-required` giữ lại đúng thông tin đó cho trình đọc màn hình.
      */}
      <Field label="Mật khẩu hiện tại" htmlFor="current" error={errors.currentPassword?.message}>
        <PasswordInput
          id="current"
          autoComplete="current-password"
          aria-required
          aria-invalid={Boolean(errors.currentPassword)}
          {...register('currentPassword', { required: 'Nhập mật khẩu hiện tại.' })}
        />
      </Field>

      <div style={{ display: 'grid', gap: 12 }}>
        <Field label="Mật khẩu mới" htmlFor="new" error={errors.newPassword?.message}>
          <PasswordInput
            id="new"
            autoComplete="new-password"
            aria-required
            aria-invalid={Boolean(errors.newPassword)}
            {...register('newPassword', {
              required: 'Nhập mật khẩu mới.',
              validate: (value) => {
                if (!passwordRules(value).every((rule) => rule.met)) {
                  return 'Mật khẩu chưa đạt các điều kiện bên dưới.';
                }
                return passwordBlocker(value, email) ?? true;
              },
            })}
          />
        </Field>

        {/*
          Dấu tích ĐẶC (`fill`), không phải vòng tròn viền: bản vẽ vẽ một đĩa
          xanh lá đặc có dấu tích trắng khoét bên trong. Chữ giữ màu tối thay vì
          chuyển xanh lá — bốn dòng xanh lá liền nhau đọc như một khối cảnh báo,
          còn ở đây chúng chỉ là danh sách đã hoàn thành.
        */}
        <ul className="sf-rule-list">
          {rules.map((rule) => (
            <li key={rule.label} data-met={rule.met}>
              <Icon
                name={rule.met ? 'check_circle' : 'radio_button_unchecked'}
                size={20}
                fill={rule.met}
                color={rule.met ? 'var(--sf-success-600)' : 'var(--sf-on-surface-muted)'}
              />
              {rule.label}
            </li>
          ))}
        </ul>
      </div>

      <Field
        label="Xác nhận mật khẩu mới"
        htmlFor="confirm"
        error={errors.confirmPassword?.message}
      >
        <PasswordInput
          id="confirm"
          autoComplete="new-password"
          aria-required
          aria-invalid={Boolean(errors.confirmPassword)}
          {...register('confirmPassword', {
            required: 'Nhập lại mật khẩu mới.',
            validate: (value) => value === newPassword || 'Hai mật khẩu không khớp.',
          })}
        />
      </Field>

      {/*
        "& tiếp tục" ở CẢ HAI nhánh: từ khi nhánh tự nguyện cũng chạy đủ ba
        bước, bấm nút này không còn là kết thúc ở đường nào nữa. Nhãn "Đổi mật
        khẩu" trơn sẽ nói rằng xong việc, rồi màn hình lại nhảy sang bước hai.
      */}
      <Button size="md" type="submit" loading={submitting} block>
        Cập nhật mật khẩu &amp; tiếp tục
      </Button>

      {/*
        Dòng chú thích TRẦN, không phải `sf-banner--info`.

        Bản vẽ để nó là chữ xám trên nền thẻ. Một hộp xanh nhạt ở đây tạo ra
        mảng màu thứ hai ngay dưới nút chính — hai khối xanh chồng nhau làm nút
        mất đi vị thế là thứ duy nhất đáng bấm trên màn hình.
      */}
      <p className="sf-auth-note">
        <Icon name="lock" size={18} fill color="var(--sf-on-surface-variant)" />
        Sau khi cập nhật, hệ thống sẽ gửi OTP để xác thực số điện thoại.
      </p>
    </form>
  );
}

// ===========================================================================
//  Chặng 2 — xác thực số điện thoại
// ===========================================================================

const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Bật xác thực hai lớp cho số điện thoại đã có trong hồ sơ.
 *
 * Hai lời gọi, đúng thứ tự Backend đặt ra: `2fa/setup` gửi OTP tới số vừa khai
 * nhưng CHƯA ghi số vào tài khoản, `2fa/enable` mới ghi — sau khi người dùng
 * chứng minh được là tin nhắn tới đúng máy của họ.
 *
 * ## Vì sao bỏ qua được
 *
 * Bản vẽ có "Bỏ qua, xác thực sau", và điều đó đúng với hệ thống: xác thực hai
 * lớp không bắt buộc, còn tài khoản thì đã dùng được ngay sau khi đổi mật khẩu.
 * Chặn người dùng ở đây vì một chiếc điện thoại đang hết pin là chặn họ khỏi
 * chính công việc mà HR vừa cấp tài khoản để làm.
 */
function PhoneStage({
  profile,
  onVerified,
  onSkip,
}: {
  profile: MyProfile | null;
  onVerified: () => void;
  onSkip: () => void;
}) {
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const phone = profile?.phone ?? '';

  const send = async () => {
    if (!phone) return;
    setError(null);
    setSending(true);
    try {
      await authApi.setupTwoFactor(phone);
      setSent(true);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (caught) {
      // Đã bật từ trước (đăng nhập lại giữa chừng, hoặc HR bật hộ) thì không có
      // gì để làm ở màn này nữa — đi tiếp thay vì bắt người dùng đọc một lỗi mô
      // tả một trạng thái vốn đã đúng.
      if (caught instanceof ApiError && caught.is('AUTH_2FA_ALREADY_ENABLED')) {
        onVerified();
        return;
      }
      setError(toUserMessage(caught));
    } finally {
      setSending(false);
    }
  };

  const verify = async (value: string) => {
    setError(null);
    setVerifying(true);
    try {
      await authApi.enableTwoFactor(value);
      onVerified();
    } catch (caught) {
      setError(toUserMessage(caught));
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {error ? <Alert type="error" showIcon message={error} role="alert" /> : null}

      <IdentityStrip
        name={profile?.fullName ?? null}
        roles={profile?.roles ?? []}
        company={profile?.company.name}
      />

      <p className="sf-auth-phone">{phone ? maskPhone(phone) : '—'}</p>

      {!phone ? (
        <Alert
          type="warning"
          showIcon
          message="Hồ sơ của bạn chưa có số điện thoại"
          description="Nhờ Kế toán/HR bổ sung số điện thoại vào hồ sơ, sau đó bật xác thực 2 lớp trong phần Tài khoản."
        />
      ) : null}

      <Button
        size="md"
        block
        // Sau khi mã đã bay đi, nút chính của màn là "Xác thực", không phải
        // "Gửi lại" — hai nút cùng tô đậm thì không nút nào còn là nút chính.
        variant={sent ? 'secondary' : 'primary'}
        loading={sending}
        disabled={!phone || cooldown > 0}
        onClick={() => void send()}
      >
        {cooldown > 0 ? `Gửi lại sau ${cooldown}s` : sent ? 'Gửi lại mã' : 'Gửi mã xác thực'}
      </Button>

      <p className="sf-body-sm sf-text-variant" style={{ margin: 0, textAlign: 'center' }}>
        {sent
          ? 'Nhập mã 6 số vừa gửi tới số điện thoại trên.'
          : 'Nhấn “Gửi mã xác thực” để nhận mã OTP gồm 6 số.'}
      </p>

      <OtpInput value={code} onChange={setCode} onComplete={verify} disabled={!sent || verifying} />

      <Button
        size="md"
        block
        loading={verifying}
        disabled={!sent || code.length < 6}
        onClick={() => void verify(code)}
      >
        Xác thực &amp; tiếp tục
      </Button>

      <div style={{ textAlign: 'center' }}>
        <button type="button" className="sf-link-button" onClick={onSkip}>
          Bỏ qua, xác thực sau →
        </button>
        <p className="sf-body-sm sf-text-variant" style={{ margin: '4px 0 0' }}>
          Một số thao tác nhạy cảm sẽ yêu cầu xác thực OTP.
        </p>
      </div>

      <div className="sf-banner sf-banner--info">
        <Icon name="schedule" size={20} color="var(--sf-primary)" />
        <span className="sf-body-sm" style={{ flex: 1 }}>
          Mã OTP có hiệu lực trong 5 phút và chỉ sử dụng được một lần.
        </span>
      </div>
    </div>
  );
}

/** `0986222333` → `+84 9•• ••• 333`. Đủ để nhận ra máy của mình, không đủ để người bên cạnh chép lại. */
function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  const national = digits.startsWith('84') ? digits.slice(2) : digits.replace(/^0/, '');
  if (national.length < 4) return phone;
  return `+84 ${national[0]}•• ••• ${national.slice(-3)}`;
}

// ===========================================================================
//  Chặng 3 — hoàn tất
// ===========================================================================

/**
 * Những gì tài khoản này mở được, nói bằng việc chứ không bằng tên quyền.
 *
 * "Bảng công & đối soát" nói được nhiều hơn `payroll.read` với đúng người đang
 * đọc màn hình này — họ vừa nhận tài khoản và đang muốn biết mình làm được gì,
 * không phải đang tra cứu ma trận phân quyền.
 */
const ROLE_CAPABILITIES: Record<SystemRoleValue, string[]> = {
  SYSTEM_ADMIN: [
    'Quản trị nền tảng và các công ty',
    'Phiên hỗ trợ có thời hạn',
    'Nhật ký hệ thống',
  ],
  COMPANY_ADMIN: [
    'Toàn bộ hệ thống của công ty',
    'Duyệt chốt kỳ công và đơn nghỉ phép',
    'Chính sách, phân quyền và cấu hình',
  ],
  HR_PAYROLL: ['Bảng công & đối soát', 'Nhân sự, ca làm & phân ca', 'Báo cáo & xuất Excel'],
  MANAGER: [
    'Chấm công của phòng ban được giao',
    'Duyệt đơn của nhân viên trong phạm vi',
    'Báo cáo theo phòng ban',
  ],
  EMPLOYEE: ['Chấm công cá nhân', 'Gửi đơn và theo dõi trạng thái', 'Bảng công của chính mình'],
};

function DoneStage({
  activation,
  profile,
  roles,
  onEnter,
}: {
  /**
   * Chỉ đổi câu chữ.
   *
   * "Quyền truy cập đã sẵn sàng" đúng với người vừa được HR cấp tài khoản và
   * đang muốn biết mình làm được gì. Nói câu đó với người đã dùng hệ thống hàng
   * tháng, vừa tự đổi mật khẩu, thì nghe như quyền của họ vừa bị đụng vào.
   */
  activation: boolean;
  profile: MyProfile | null;
  roles: SystemRoleValue[];
  onEnter: () => void;
}) {
  /*
   * Vai trò cao nhất quyết định danh sách. Một người vừa là Kế toán/HR vừa là
   * Quản lý thì liệt kê cả hai bộ sẽ ra một danh sách chín dòng trùng lặp —
   * dài hơn mà nói được ít hơn.
   */
  const primary =
    (
      [
        SystemRole.SYSTEM_ADMIN,
        SystemRole.COMPANY_ADMIN,
        SystemRole.HR_PAYROLL,
        SystemRole.MANAGER,
      ] as const
    ).find((role) => roles.includes(role)) ?? SystemRole.EMPLOYEE;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <span className="sf-auth-success" aria-hidden="true">
        <Icon name="check" size={32} />
      </span>

      <IdentityStrip
        name={profile?.fullName ?? currentFirebaseEmail()}
        roles={profile?.roles ?? roles}
        company={profile?.company.name}
      />

      <section className="sf-card" style={{ padding: 16 }}>
        <h2 className="sf-title-sm" style={{ margin: '0 0 10px' }}>
          {activation ? 'Quyền truy cập đã sẵn sàng' : 'Quyền truy cập giữ nguyên'}
        </h2>
        <ul className="sf-rule-list">
          {ROLE_CAPABILITIES[primary].map((item) => (
            <li key={item} data-met="true">
              <Icon name="check_circle" size={18} color="var(--sf-success-700)" />
              {item}
            </li>
          ))}
        </ul>
      </section>

      <div className="sf-banner sf-banner--info">
        <Icon name="shield" size={20} color="var(--sf-primary)" />
        <span className="sf-body-sm" style={{ flex: 1 }}>
          Quyền truy cập được thiết lập theo tài khoản của bạn.
        </span>
      </div>

      <Button size="md" variant="action" iconAfter="arrow_forward" block onClick={onEnter}>
        {activation ? 'Vào hệ thống' : 'Quay lại làm việc'}
      </Button>
    </div>
  );
}

// ===========================================================================
//  Dùng chung
// ===========================================================================

/**
 * Dải "Nguyễn Thị Mai · Kế toán/HR · Công ty TNHH ABC" ở đầu ba màn.
 *
 * Ảnh đại diện là một đĩa tròn xanh nhạt có glyph người bên trong, không phải
 * icon `account_circle` viền mảnh: ở bản vẽ nó là vật thể đặc duy nhất trong
 * dải, và chính khối đặc đó neo cả dòng chữ vào bên trái.
 */
function IdentityStrip({
  name,
  roles,
  company,
}: {
  name: string | null;
  roles: SystemRoleValue[];
  company?: string;
}) {
  const roleText = roles.map((role) => ROLE_LABEL[role]).join(', ');
  const parts = [roleText, company].filter(Boolean) as string[];

  return (
    <div className="sf-identity">
      <span className="sf-identity__avatar" aria-hidden="true">
        <Icon name="person" size={20} fill />
      </span>
      <span className="sf-identity__name">{name ?? 'Tài khoản của bạn'}</span>
      {parts.map((part) => (
        <span key={part} className="sf-identity__part">
          <span className="sf-identity__sep" aria-hidden="true">
            ·
          </span>
          {part}
        </span>
      ))}
    </div>
  );
}
