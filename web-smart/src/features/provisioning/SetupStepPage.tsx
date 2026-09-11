import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { useShifts, useUpsertBranch } from '@/features/policy/policy.api';
import { useBranches, useDepartments } from '@/features/shared/org.api';
import { useAuth } from '@/lib/auth/auth-context';
import { useErrorToast } from '@/lib/errors/use-error-toast';
import {
  Button,
  CardSkeleton,
  Checkbox,
  ErrorState,
  Field,
  Icon,
  LinkButton,
  Select,
  TextInput,
  useToast,
} from '@/components/ui';
import { SetupAccountantStep } from './SetupAccountantStep';
import { SetupDepartmentsStep } from './SetupDepartmentsStep';
import { SetupShiftsStep } from './SetupShiftsStep';
import { SetupStepper } from './SetupStepper';
import {
  SETUP_STEP_KEYS,
  useCompanyProfile,
  useCompleteSetupStep,
  useSetupState,
  useUpdateCompanyProfile,
  type SetupStepKey,
} from './provisioning.api';

/**
 * Một bước của wizard thiết lập — mockup Figma `69:254`, `67:77`, `67:78`, `67:76`.
 *
 * ## Vì sao có màn riêng cho từng bước
 *
 * Bản trước chỉ có màn tổng quan, và mỗi bước là một đường dẫn ném người dùng
 * sang màn cấu hình bình thường (`/policy?tab=shifts`). Ở đó họ mất hết ngữ
 * cảnh: không còn thanh bước, không biết còn mấy bước, và không có đường quay
 * lại ngoài nút Back của trình duyệt. Nhiều người dừng luôn ở đó.
 *
 * Màn này giữ ngữ cảnh — thanh bước ở trên, nút "Lưu & tiếp tục" ở dưới — còn
 * phần RUỘT thì nhúng lại chính các màn cấu hình đã có (`DepartmentsTab`,
 * `ShiftCatalogTab`). Không chép lại form: một biểu mẫu ca làm việc bản wizard và một
 * bản chính thức sẽ lệch nhau ngay lần sửa đầu tiên.
 */
export function SetupStepPage() {
  const { step } = useParams<{ step: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const showError = useErrorToast();

  const state = useSetupState();
  const complete = useCompleteSetupStep();

  const key = SETUP_STEP_KEYS.find((candidate) => candidate === step);
  if (!key) return <Navigate to="/thiet-lap" replace />;

  if (state.isPending) return <CardSkeleton height={520} />;
  if (state.isError || !state.data) {
    return (
      <ErrorState
        title="Chưa tải được tiến độ thiết lập"
        description="Không đọc được trạng thái wizard từ máy chủ. Thử lại sau ít phút."
        onRetry={() => void state.refetch()}
      />
    );
  }

  const { steps } = state.data;
  const index = SETUP_STEP_KEYS.indexOf(key);
  const current = steps.find((row) => row.key === key);
  const previous = index > 0 ? SETUP_STEP_KEYS[index - 1] : null;
  const next = index < SETUP_STEP_KEYS.length - 1 ? SETUP_STEP_KEYS[index + 1] : null;

  /*
   * Bàn giao là bước duy nhất bị khoá thật: không có phòng ban, ca làm việc và
   * người nhận thì không có gì để bàn giao. Backend kiểm lại điều này chứ không
   * tin giao diện.
   */
  const prerequisitesDone = steps.filter((row) => row.key !== 'handover').every((row) => row.done);
  const handoverLocked = !prerequisitesDone;

  if (key === 'handover' && handoverLocked) {
    return <Navigate to="/thiet-lap" replace />;
  }

  const meta = STEP_CONTENT[key];

  const saveAndContinue = () => {
    complete.mutate(key, {
      onSuccess: (updated) => {
        if (updated.completedAt) {
          toast.success(
            'Đã hoàn tất thiết lập ban đầu',
            'Kế toán/HR đã có thể thêm nhân viên và bắt đầu chấm công.',
          );
          navigate('/dashboard');
          return;
        }
        toast.success(`Đã xong: ${current?.label ?? meta.title}`);
        navigate(next ? `/thiet-lap/${next}` : '/thiet-lap');
      },
      onError: showError,
    });
  };

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link to="/thiet-lap" className="sf-back-link">
            <Icon name="arrow_back" size={18} /> Quay lại thiết lập ban đầu
          </Link>
        }
        title={meta.title}
        description={
          <>
            <strong>
              Bước {index + 1}/{SETUP_STEP_KEYS.length}
            </strong>
            {' · '}
            {meta.description}
          </>
        }
      />

      <SetupStepper steps={steps} current={key} locked={handoverLocked ? ['handover'] : []} />

      {meta.aside ? (
        <div className="sf-detail-layout" style={{ marginTop: 20 }}>
          <div style={{ minWidth: 0 }}>{meta.body}</div>
          <div style={{ minWidth: 0, display: 'grid', gap: 16, alignContent: 'start' }}>
            {meta.aside}
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 20 }}>{meta.body}</div>
      )}

      <footer className="sf-wizard-footer">
        {previous ? (
          <LinkButton to={`/thiet-lap/${previous}`} variant="tertiary" icon="arrow_back">
            {meta.backLabel}
          </LinkButton>
        ) : (
          <LinkButton to="/thiet-lap" variant="tertiary" icon="arrow_back">
            {meta.backLabel}
          </LinkButton>
        )}

        <div style={{ display: 'flex', gap: 12, marginLeft: 'auto' }}>
          {/*
            KHÔNG có nút "Lưu nháp" như mockup.

            Ruột của mỗi bước là các màn cấu hình thật, và chúng lưu ngay khi
            bấm Lưu trong chính chúng — không có bản nháp nào để giữ. Một nút
            "Lưu nháp" ở đây sẽ không làm gì, hoặc tệ hơn, khiến người dùng
            tưởng những gì họ vừa gõ đã được cất đi.
          */}
          <Button
            variant={key === 'handover' ? 'action' : 'primary'}
            icon={key === 'handover' ? 'handshake' : undefined}
            iconAfter={key === 'handover' ? undefined : 'arrow_forward'}
            loading={complete.isPending}
            onClick={saveAndContinue}
          >
            {meta.nextLabel}
          </Button>
        </div>
      </footer>
    </>
  );
}

// ===========================================================================
//  Nội dung từng bước
// ===========================================================================

interface StepContent {
  title: string;
  description: string;
  /** Nhãn nút lùi — bản vẽ gọi tên đích đến chứ không viết chung chung "Quay lại". */
  backLabel: string;
  /** Nhãn nút tiến — cũng gọi tên việc kế tiếp, để người dùng biết mình đi đâu. */
  nextLabel: string;
  body: ReactNode;
  /**
   * Cột phải. Bỏ trống khi chính bước đó đã chia đôi màn hình theo bản vẽ —
   * ép thêm một cột thứ ba vào bước phòng ban chỉ làm cả ba cột cùng hẹp.
   */
  aside?: ReactNode;
}

const STEP_CONTENT: Record<SetupStepKey, StepContent> = {
  companyInfo: {
    title: 'Thiết lập thông tin công ty',
    description: 'Cung cấp thông tin nền tảng để khởi tạo hệ thống SmartFace.',
    backLabel: 'Quay lại thiết lập ban đầu',
    nextLabel: 'Lưu & tiếp tục tạo phòng ban',
    body: <CompanyForm />,
    aside: <CompanyAside />,
  },
  departments: {
    title: 'Thiết lập danh mục phòng ban',
    description: 'Xây dựng cơ cấu tổ chức ban đầu cho công ty.',
    backLabel: 'Quay lại thông tin công ty',
    nextLabel: 'Tiếp tục tạo ca làm việc',
    body: <SetupDepartmentsStep />,
  },
  shifts: {
    title: 'Thiết lập ca làm việc',
    description: 'Thiết lập ca chuẩn, khung giờ chấm công và hệ số ngày công.',
    backLabel: 'Quay lại phòng ban',
    nextLabel: 'Lưu & tiếp tục tạo tài khoản',
    body: <SetupShiftsStep />,
  },
  accountantAccount: {
    title: 'Tạo tài khoản Kế toán/HR',
    description: 'Mời người phụ trách vận hành vào hệ thống.',
    backLabel: 'Quay lại ca làm việc',
    nextLabel: 'Đã tạo xong, tiếp tục bàn giao',
    body: <SetupAccountantStep />,
    aside: <AccountantAside />,
  },
  handover: {
    title: 'Bàn giao vận hành',
    description: 'Kiểm tra cấu hình và bàn giao cho Kế toán/HR.',
    backLabel: 'Quay lại chỉnh sửa',
    nextLabel: 'Bàn giao & vào Tổng quan',
    body: <HandoverSummary />,
    aside: (
      <InfoPanel
        title="Sau khi bàn giao"
        items={[
          'Kế toán/HR thêm nhân viên và quản lý hồ sơ nhân sự.',
          'Kế toán/HR tạo tài khoản ứng dụng cho nhân viên.',
          'Kế toán/HR phân ca và tổng hợp bảng công hằng tháng.',
          'Giám đốc vẫn theo dõi toàn hệ thống và là người duyệt chốt kỳ công.',
        ]}
      />
    ),
  },
};

// ===========================================================================
//  Bước 1 — thông tin công ty
// ===========================================================================

const TIMEZONES = [
  { value: 'Asia/Ho_Chi_Minh', label: '(GMT+07:00) Hồ Chí Minh · Hà Nội' },
  { value: 'Asia/Bangkok', label: '(GMT+07:00) Bangkok' },
  { value: 'Asia/Singapore', label: '(GMT+08:00) Singapore' },
  { value: 'Asia/Tokyo', label: '(GMT+09:00) Tokyo' },
];

/** Thứ 2 → Chủ nhật, chỉ số trùng với quy ước `weekdayMask` của ca làm việc. */
const WEEKDAYS = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];

/**
 * Biểu mẫu bước 1 — bản vẽ gộp 4 nhóm: pháp lý, liên hệ & đăng nhập, trụ sở
 * mặc định, quy định làm việc.
 *
 * ## Trụ sở nằm chung biểu mẫu nhưng lưu ở HAI nơi
 *
 * Tên công ty / tên miền / múi giờ thuộc bảng `Company`; tên và địa chỉ văn
 * phòng thuộc bảng `Branch`. Bản vẽ đặt chúng cạnh nhau vì với người dùng đây
 * là một tờ khai duy nhất, và đó là cách đúng — nhưng nút Lưu phải gọi hai
 * endpoint. Gọi tuần tự và chỉ báo thành công khi CẢ HAI xong: báo "đã lưu"
 * trong lúc một nửa còn đang bay là cách nhanh nhất để mất niềm tin.
 */
function CompanyForm() {
  const { refreshSession } = useAuth();
  const toast = useToast();
  const showError = useErrorToast();

  const profile = useCompanyProfile();
  const branches = useBranches();
  const update = useUpdateCompanyProfile();
  const upsertBranch = useUpsertBranch();

  /* Trụ sở mặc định = chi nhánh đầu tiên. Chưa có thì lần lưu này tạo mới. */
  const headOffice = branches.data?.[0] ?? null;

  const [form, setForm] = useState({
    name: '',
    domain: '',
    taxCode: '',
    timezone: '',
    branchName: '',
    branchAddress: '',
  });

  /*
   * Nạp giá trị vào form MỘT LẦN, khi dữ liệu về.
   *
   * Không đồng bộ ở mọi lần `profile.data` đổi: mutation ghi lại cache sau khi
   * lưu, và nếu form theo dõi cache thì mỗi lần lưu là mọi ô đang gõ dở bị ghi
   * đè bằng giá trị vừa gửi đi.
   */
  useEffect(() => {
    if (!profile.data) return;
    setForm((prev) =>
      prev.name || prev.domain
        ? prev
        : {
            name: profile.data.name,
            domain: profile.data.domain,
            taxCode: profile.data.taxCode ?? '',
            timezone: profile.data.timezone,
            branchName: '',
            branchAddress: '',
          },
    );
  }, [profile.data]);

  /* Chi nhánh về sau hồ sơ công ty, nên nạp riêng — vẫn chỉ một lần. */
  useEffect(() => {
    if (!headOffice) return;
    setForm((prev) =>
      prev.branchName
        ? prev
        : { ...prev, branchName: headOffice.name, branchAddress: headOffice.address ?? '' },
    );
  }, [headOffice]);

  if (profile.isPending) return <CardSkeleton height={360} />;
  if (profile.isError || !profile.data) {
    return (
      <ErrorState
        title="Chưa đọc được thông tin công ty"
        description="Không tải được hồ sơ công ty từ máy chủ. Thử lại sau ít phút."
        onRetry={() => void profile.refetch()}
      />
    );
  }

  const patch = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const saving = update.isPending || upsertBranch.isPending;

  const submit = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    try {
      await update.mutateAsync({
        name: form.name,
        domain: form.domain,
        taxCode: form.taxCode,
        timezone: form.timezone,
      });

      if (form.branchName.trim()) {
        await upsertBranch.mutateAsync({
          id: headOffice?.id,
          name: form.branchName.trim(),
          address: form.branchAddress.trim() || undefined,
        });
      }

      toast.success('Đã lưu thông tin công ty');
      // Tên công ty trên thanh tiêu đề nằm trong `AuthProvider`, không trong
      // cache của react-query — xem chú thích ở `provisioning.api`.
      void refreshSession();
    } catch (error) {
      showError(error);
    }
  };

  return (
    <section className="sf-card" style={{ padding: 20 }}>
      <form onSubmit={submit}>
        <fieldset className="sf-form-section" style={{ border: 0, margin: 0, padding: 0 }}>
          <legend className="sf-title-md sf-form-section__title">Thông tin pháp lý</legend>

          <div className="sf-form-grid">
            <Field label="Tên công ty" required>
              {(field) => <TextInput {...field} value={form.name} onChange={patch('name')} required />}
            </Field>

            <Field
              label="Mã công ty"
              hint="Không đổi được — mã này nằm trong mọi mã nhân viên đã sinh (BR-04)."
            >
              {(field) => <TextInput {...field} value={profile.data.code} disabled readOnly />}
            </Field>

            <Field label="Mã số thuế">
              {(field) => <TextInput {...field} value={form.taxCode} onChange={patch('taxCode')} />}
            </Field>
          </div>
        </fieldset>

        <fieldset className="sf-form-section" style={{ border: 0, margin: 0, padding: 0 }}>
          <legend className="sf-title-md sf-form-section__title">
            Thông tin liên hệ &amp; đăng nhập
          </legend>

          <div className="sf-form-grid">
            <Field
              label="Tên miền đăng nhập"
              hint="Nhân viên gõ tên miền này ở màn hình đăng nhập. Phải duy nhất trên toàn hệ thống."
              required
            >
              {(field) => (
                <TextInput {...field} value={form.domain} onChange={patch('domain')} required />
              )}
            </Field>
          </div>
        </fieldset>

        <fieldset className="sf-form-section" style={{ border: 0, margin: 0, padding: 0 }}>
          <legend className="sf-title-md sf-form-section__title">Trụ sở mặc định</legend>

          <div className="sf-form-grid">
            <Field label="Tên văn phòng">
              {(field) => (
                <TextInput
                  {...field}
                  value={form.branchName}
                  onChange={patch('branchName')}
                  placeholder="Văn phòng chính"
                />
              )}
            </Field>

            <Field label="Địa chỉ">
              {(field) => (
                <TextInput
                  {...field}
                  value={form.branchAddress}
                  onChange={patch('branchAddress')}
                />
              )}
            </Field>

            <Field
              label="Múi giờ"
              hint="Mọi mốc giờ chấm công quy đổi theo múi giờ này, không theo giờ máy của nhân viên."
              required
            >
              {(field) => (
                <Select
                  {...field}
                  options={TIMEZONES}
                  value={form.timezone}
                  onChange={patch('timezone')}
                />
              )}
            </Field>
          </div>
        </fieldset>

        <fieldset className="sf-form-section" style={{ border: 0, margin: 0, padding: 0 }}>
          <legend className="sf-title-md sf-form-section__title">Quy định làm việc cơ bản</legend>

          {/*
            Bảy ô tick này CHỈ ĐỌC, và cố tình hiện ra thay vì giấu đi.

            Ngày làm việc trong tuần hiện nằm ở `weekdayMask` của từng ca, không
            phải một thiết lập cấp công ty — đổi nó là đổi cách tính công của
            mọi ca đang chạy. Hiện trạng thái thật ở đây trả lời đúng câu người
            xem bản vẽ sẽ hỏi ("ngày làm việc khai ở đâu?") và chỉ họ sang chỗ
            khai thật, thay vì cho một ô tick không nối vào gì.
          */}
          <div className="sf-field">
            {/* Không dùng `Field`: nó sinh một `<label for>` trỏ vào một ô nhập
                duy nhất, còn đây là BẢY ô — nhãn sẽ trỏ vào hư không. */}
            <span className="sf-field__label">Ngày làm việc trong tuần</span>
            <div className="sf-weekdays">
              {WEEKDAYS.map((day, index) => (
                <Checkbox key={day} checked={index < 5} disabled readOnly>
                  {day}
                </Checkbox>
              ))}
            </div>
            <p className="sf-field__hint" style={{ margin: 0 }}>
              Đang cố định Thứ 2 – Thứ 6. Khai chi tiết theo từng ca ở bước Ca làm việc.
            </p>
          </div>
        </fieldset>

        <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
          <Button type="submit" variant="primary" icon="save" loading={saving}>
            Lưu thông tin công ty
          </Button>
        </div>
      </form>
    </section>
  );
}

function CompanyAside() {
  const profile = useCompanyProfile();
  const branches = useBranches();

  const checks = [
    { label: 'Tên công ty', done: Boolean(profile.data?.name) },
    { label: 'Tên miền đăng nhập', done: Boolean(profile.data?.domain) },
    { label: 'Múi giờ', done: Boolean(profile.data?.timezone) },
    { label: 'Mã số thuế', done: Boolean(profile.data?.taxCode) },
    { label: 'Địa điểm trụ sở mặc định', done: Boolean(branches.data?.length) },
  ];

  return (
    <>
      <section className="sf-card sf-panel" style={{ padding: 0 }}>
        <header className="sf-panel__head">
          <h2 className="sf-title-md">Kiểm tra thiết lập</h2>
        </header>
        <ul className="sf-check-list">
          {checks.map((check) => (
            <li key={check.label}>
              <Icon
                name={check.done ? 'check_circle' : 'radio_button_unchecked'}
                size={20}
                color={check.done ? 'var(--sf-success-700)' : 'var(--sf-on-surface-muted)'}
              />
              <span style={{ flex: 1 }}>{check.label}</span>
              <span className="sf-body-sm sf-text-variant">
                {check.done ? 'Đã có' : 'Chưa khai'}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <InfoPanel
        title="Sau khi lưu"
        items={[
          'Tạo phòng ban đầu tiên để dựng sơ đồ tổ chức.',
          'Tạo ca làm việc để thiết lập khung giờ chấm công cho nhân viên.',
          'Mời Kế toán/HR nhận bàn giao vận hành hằng ngày.',
        ]}
      />

      {/*
        Ba trường của mockup không có ở form: TÊN VIẾT TẮT, LOGO, SĐT CÔNG TY.
        Bảng `Company` chưa có cột cho chúng. Nói thẳng ra đây thay vì im lặng
        bỏ đi — người xem đối chiếu với bản vẽ sẽ tự hỏi vì sao thiếu.
      */}
      <InfoPanel
        title="Chưa có trong bản này"
        items={[
          'Tên viết tắt, logo và số điện thoại công ty chưa có chỗ lưu trong cơ sở dữ liệu.',
          'Email quản trị đọc từ tài khoản đang đăng nhập, không khai lại ở đây.',
        ]}
      />

      <div className="sf-banner sf-banner--info">
        <Icon name="lock" size={20} color="var(--sf-primary)" />
        <span className="sf-body-sm" style={{ flex: 1 }}>
          Thông tin công ty được ghi nhận vào audit log.
        </span>
      </div>
    </>
  );
}

// ===========================================================================
//  Bước 4 — cột phải của màn tạo tài khoản Kế toán/HR
// ===========================================================================

function AccountantAside() {
  return (
    <>
      <InfoPanel
        title="Quyền của Kế toán/HR"
        items={[
          'Quản lý hồ sơ nhân sự và tạo tài khoản ứng dụng cho nhân viên.',
          'Hiệu chỉnh chấm công, xử lý đơn bổ sung công.',
          'Tổng hợp, xuất bảng công và gửi đề nghị chốt kỳ.',
        ]}
      />
      {/*
        Ranh giới #1 của `docs/08` §1.1, nói ra ngay lúc trao quyền — đây là
        thời điểm duy nhất người giao quyền thật sự đọc nó.
      */}
      <InfoPanel
        tone="warning"
        title="Kế toán/HR KHÔNG có quyền"
        items={[
          'Duyệt chốt kỳ công — họ gửi đề nghị, Giám đốc duyệt. Một người không làm cả hai bước.',
          'Đổi chính sách công ty, luồng duyệt và phân quyền.',
          'Phân ca — quyền này mặc định thuộc Giám đốc.',
        ]}
      />

      <div className="sf-banner sf-banner--success">
        <Icon name="key" size={20} color="var(--sf-success-700)" />
        <span className="sf-body-sm" style={{ flex: 1 }}>
          Mật khẩu khởi tạo do hệ thống sinh và gửi cho người được mời; họ buộc phải đổi ở lần
          đăng nhập đầu.
        </span>
      </div>
    </>
  );
}

// ===========================================================================
//  Bước 5 — bàn giao
// ===========================================================================

/**
 * Tóm tắt cấu hình trước khi bàn giao.
 *
 * Đọc lại từng nguồn thật (`/company/profile`, chi nhánh, phòng ban, ca làm
 * việc) thay vì tin vào các cờ `done` của wizard: cờ nói "ai đó đã bấm xong
 * bước này", còn người sắp bàn giao cần biết "hiện có bao nhiêu phòng ban". Hai
 * câu đó lệch nhau ngay khi có người xoá phòng ban sau khi tích xong bước.
 */
function HandoverSummary() {
  const profile = useCompanyProfile();
  const branches = useBranches();
  const departments = useDepartments();
  const shifts = useShifts();
  const setup = useSetupState();

  const accountantDone = setup.data?.steps.find((step) => step.key === 'accountantAccount')?.done;

  const rows: { label: string; value: string }[] = [
    { label: 'Công ty', value: profile.data?.name ?? '—' },
    { label: 'Tên miền đăng nhập', value: profile.data?.domain ?? '—' },
    { label: 'Múi giờ', value: profile.data?.timezone ?? '—' },
    { label: 'Địa điểm làm việc', value: branches.data?.[0]?.name ?? 'Chưa khai' },
    {
      label: 'Phòng ban',
      value: departments.data ? `${departments.data.length} phòng ban` : '—',
    },
    {
      label: 'Ca làm việc',
      value: shifts.data ? `${shifts.data.length} ca làm việc` : '—',
    },
    {
      label: 'Tài khoản Kế toán/HR',
      value: accountantDone ? 'Đã tạo' : 'Chưa xác nhận',
    },
    { label: 'Trạng thái', value: 'Sẵn sàng bàn giao' },
  ];

  return (
    <>
      <div className="sf-banner sf-banner--success" style={{ marginBottom: 16 }}>
        <Icon name="check_circle" size={22} color="var(--sf-success-700)" />
        <span className="sf-body-md" style={{ flex: 1 }}>
          <strong>Thiết lập ban đầu đã hoàn tất.</strong> Hệ thống đã sẵn sàng để bàn giao cho Kế
          toán/HR quản lý nhân sự và vận hành hằng ngày.
        </span>
      </div>

      <section className="sf-card sf-panel" style={{ padding: 0 }}>
        <header className="sf-panel__head">
          <h2 className="sf-title-md">Tóm tắt cấu hình</h2>
        </header>
        <div style={{ padding: '4px 20px 16px' }}>
          <dl className="sf-summary-list">
            {rows.map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <div className="sf-banner sf-banner--info" style={{ marginTop: 16 }}>
        <Icon name="shield" size={20} color="var(--sf-primary)" />
        <span className="sf-body-sm" style={{ flex: 1 }}>
          <strong>Ranh giới vai trò:</strong> Tổng giám đốc vẫn theo dõi toàn hệ thống và là người
          duyệt cuối của đơn nghỉ phép cùng đề nghị chốt kỳ công.
        </span>
      </div>
    </>
  );
}

// ===========================================================================
//  Khối phụ dùng chung
// ===========================================================================

function InfoPanel({
  title,
  items,
  tone = 'neutral',
}: {
  title: string;
  items: string[];
  tone?: 'neutral' | 'warning';
}) {
  return (
    <section className="sf-card sf-panel" style={{ padding: 0 }}>
      <header className="sf-panel__head">
        <h2 className="sf-title-md">{title}</h2>
      </header>
      <ul className="sf-check-list">
        {items.map((item) => (
          <li key={item}>
            <Icon
              name={tone === 'warning' ? 'block' : 'check_circle'}
              size={20}
              color={tone === 'warning' ? 'var(--sf-error-700)' : 'var(--sf-success-700)'}
            />
            <span style={{ flex: 1 }}>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
