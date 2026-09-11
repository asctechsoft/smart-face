import { Link, useNavigate } from 'react-router-dom';
import { Alert, Progress } from 'antd';
import { PageHeader } from '@/components/PageHeader';
import { Badge, Button, Card, CardSkeleton, ErrorState, Icon } from '@/components/ui';
import { useErrorToast } from '@/lib/errors/use-error-toast';
import { SETUP_STEP_ICON } from './SetupStepper';
import {
  SETUP_STEP_KEYS,
  useReopenSetupStep,
  useSetupState,
  type SetupStep,
  type SetupStepKey,
} from './provisioning.api';

/**
 * Mô tả và lối vào của từng bước.
 *
 * Nhãn bước do Backend trả về (nó là nguồn sự thật của thứ tự), còn phần mô tả
 * và đường dẫn nằm ở đây vì chúng là chuyện của giao diện. Trùng lặp một chút
 * nhưng đúng ranh giới: Backend không nên biết `/thiet-lap/departments`.
 */
const STEP_META: Record<SetupStepKey, { description: string; cta: string; short: string }> = {
  companyInfo: {
    description: 'Xác nhận tên công ty, tên miền đăng nhập và múi giờ.',
    cta: 'Thiết lập',
    short: 'Thông tin công ty',
  },
  departments: {
    description: 'Tạo phòng ban đầu tiên và sơ đồ tổ chức.',
    cta: 'Tạo phòng ban',
    short: 'Phòng ban',
  },
  shifts: {
    description: 'Thiết lập ca chuẩn, khung giờ chấm công và hệ số ngày công.',
    cta: 'Tạo ca làm việc',
    short: 'Ca làm việc',
  },
  accountantAccount: {
    description: 'Mời Kế toán/HR vào hệ thống để quản lý nhân sự và bảng công.',
    cta: 'Tạo tài khoản',
    short: 'Tài khoản Kế toán/HR',
  },
  handover: {
    description: 'Kiểm tra cấu hình và bàn giao cho Kế toán/HR.',
    cta: 'Bàn giao',
    short: 'Bàn giao',
  },
};

/**
 * Wizard "Thiết lập ban đầu" 5 bước của Tổng giám đốc (mockup Figma `67:75`).
 *
 * ## Bố cục hai cột
 *
 * Cột trái là VIỆC PHẢI LÀM, cột phải là NGỮ CẢNH: ai làm gì trong giai đoạn
 * khởi tạo, còn khoảng bao lâu nữa. Người mở màn này lần đầu hỏi hai câu sau
 * trước khi bấm bất cứ nút nào — trả lời chúng ngay cạnh danh sách bước thì họ
 * không phải rời trang để đi tìm.
 *
 * ## Vì sao bốn bước đầu KHÔNG bị khoá theo thứ tự
 *
 * Người dùng thật hay tạo ca làm việc trước rồi mới lập phòng ban, hoặc mở sẵn
 * hai tab. Khoá cứng thứ tự chỉ để giữ đúng một con số đếm là làm khó không có
 * lý do. Riêng bước 5 có điều kiện THẬT — không có phòng ban, ca làm việc và
 * người nhận thì không có gì để bàn giao — nên nó bị khoá cho tới khi bốn bước
 * kia xong, và Backend kiểm lại điều đó chứ không tin giao diện.
 *
 * ## Vì sao thẻ bước chỉ còn MỘT nút
 *
 * Bản trước có thêm nút "Đánh dấu xong" ngay trên thẻ, và nó cho phép tích một
 * bước mà không hề mở bước đó ra. Bản vẽ bỏ nút này, đúng: màn tổng quan để đi
 * tới, còn việc xác nhận xong nằm ở cuối chính bước đó, nơi người dùng vừa nhìn
 * thấy thứ mình vừa cấu hình. Nút "Mở lại" vẫn giữ vì bấm nhầm là chuyện xảy
 * ra, và không mở lại được thì cách duy nhất để sửa là vào thẳng database.
 */
export function SetupWizardPage() {
  const navigate = useNavigate();
  const showError = useErrorToast();

  const state = useSetupState();
  const reopen = useReopenSetupStep();

  if (state.isPending) {
    return (
      <div style={{ display: 'grid', gap: 12 }}>
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  if (state.isError || !state.data) {
    return (
      <ErrorState
        title="Chưa tải được tiến độ thiết lập"
        description="Không đọc được trạng thái wizard từ máy chủ. Thử lại sau ít phút."
        onRetry={() => void state.refetch()}
      />
    );
  }

  const { steps, doneCount, totalSteps, completedAt, nextStep } = state.data;
  const prerequisitesDone = steps.filter((s) => s.key !== 'handover').every((s) => s.done);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <PageHeader
        title="Thiết lập hệ thống SmartFace"
        description="Hoàn tất các bước cơ bản để sẵn sàng quản lý nhân sự và chấm công."
      />

      {completedAt ? (
        <Alert
          type="success"
          showIcon
          message="Đã hoàn tất thiết lập ban đầu"
          description="Kế toán/HR đã có thể thêm nhân viên, gán ca và bắt đầu chấm công. Mục này sẽ không còn hiện trên thanh điều hướng."
        />
      ) : null}

      <div className="sf-setup-layout">
        <div style={{ display: 'grid', gap: 12 }}>
          <Card>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8 }}>
              <span className="sf-display-lg" style={{ color: 'var(--sf-primary)' }}>
                {doneCount} / {totalSteps}
              </span>
              <span className="sf-title-sm">bước hoàn tất</span>
            </div>
            <Progress
              percent={Math.round((doneCount / totalSteps) * 100)}
              showInfo={false}
              strokeColor="var(--sf-primary-surface)"
            />
            <p className="sf-body-sm sf-text-muted" style={{ marginTop: 8, marginBottom: 0 }}>
              Bạn có thể quay lại chỉnh sửa bất cứ lúc nào.
            </p>
          </Card>

          {steps.map((step) => {
            const meta = STEP_META[step.key];
            const isNext = step.key === nextStep;
            const locked = step.key === 'handover' && !prerequisitesDone;

            return (
              <Card
                key={step.key}
                padding={20}
                style={
                  isNext
                    ? { borderColor: 'var(--sf-primary)', background: 'var(--sf-primary-tint)' }
                    : undefined
                }
              >
                <div className="sf-setup-step">
                  <StepNumber order={step.order} done={step.done} active={isNext} />

                  <span
                    className={`sf-setup-step__icon${
                      step.done
                        ? ' sf-setup-step__icon--done'
                        : isNext
                          ? ' sf-setup-step__icon--current'
                          : ''
                    }`}
                  >
                    <Icon name={SETUP_STEP_ICON[step.key]} size={24} />
                  </span>

                  <div className="sf-setup-step__text">
                    <div className="sf-title-sm">{step.label}</div>
                    <div className="sf-body-sm sf-text-muted">{meta.description}</div>
                  </div>

                  {step.done ? (
                    <Badge tone="success">Đã thiết lập</Badge>
                  ) : (
                    <span className="sf-body-sm sf-text-muted">Chưa thiết lập</span>
                  )}

                  {step.done ? (
                    <Button
                      variant="tertiary"
                      size="sm"
                      loading={reopen.isPending}
                      onClick={() => reopen.mutate(step.key, { onError: showError })}
                    >
                      Mở lại
                    </Button>
                  ) : (
                    <Button
                      variant={isNext ? 'primary' : 'secondary'}
                      size="sm"
                      icon={locked ? 'lock' : undefined}
                      disabled={locked}
                      onClick={() => navigate(`/thiet-lap/${step.key}`)}
                    >
                      {locked ? 'Hoàn tất các bước trên' : meta.cta}
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>

        <SetupContextRail steps={steps} nextStep={nextStep} />
      </div>
    </div>
  );
}

/**
 * Cột phải — phân quyền giai đoạn khởi tạo, thời lượng ước tính, lối vào hướng dẫn.
 */
function SetupContextRail({
  steps,
  nextStep,
}: {
  steps: SetupStep[];
  nextStep: SetupStepKey | null;
}) {
  const byKey = new Map(steps.map((step) => [step.key, step]));

  return (
    <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
      <Card padding={16}>
        <h2 className="sf-title-md" style={{ margin: '0 0 12px' }}>
          Phân quyền trong giai đoạn khởi tạo
        </h2>

        <div style={{ display: 'grid', gap: 12 }}>
          <section className="sf-role-card sf-role-card--active">
            <div className="sf-role-card__head">
              <Icon name="badge" size={20} />
              <strong>Tổng giám đốc</strong>
              <span className="sf-role-card__pill">Đang thực hiện</span>
            </div>
            <p className="sf-role-card__desc">
              Thiết lập công ty, phòng ban, ca làm việc và tạo tài khoản Kế toán/HR.
            </p>
          </section>

          <section className="sf-role-card sf-role-card--muted">
            <div className="sf-role-card__head">
              <Icon name="support_agent" size={20} color="var(--sf-on-surface-variant)" />
              <strong>Kế toán / HR</strong>
            </div>
            <p className="sf-role-card__desc">
              Sau khi được mời: thêm nhân viên, tạo tài khoản ứng dụng, phân ca và tổng hợp
              bảng công.
            </p>
          </section>
        </div>
      </Card>

      <Card padding={16}>
        <h2 className="sf-title-sm" style={{ margin: 0 }}>
          Bạn sẽ hoàn tất trong khoảng 10 phút
        </h2>

        <ol className="sf-setup-dots">
          {SETUP_STEP_KEYS.map((key, index) => {
            const step = byKey.get(key);
            const state = step?.done ? 'done' : key === nextStep ? 'current' : 'todo';

            return (
              <li key={key}>
                <span className={`sf-setup-dots__num sf-setup-dots__num--${state}`}>
                  {step?.done ? <Icon name="check" size={16} /> : index + 1}
                </span>
                <span className="sf-setup-dots__label">{STEP_META[key].short}</span>
              </li>
            );
          })}
        </ol>
      </Card>

      {/*
        Lối vào hướng dẫn trỏ vào chính bước tiếp theo, không vào một trang trợ
        giúp riêng: người bấm nó đang muốn BẮT ĐẦU, không muốn đọc.
      */}
      <Link to={`/thiet-lap/${nextStep ?? 'companyInfo'}`} className="sf-link-row">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Icon name="menu_book" size={20} />
          Xem hướng dẫn từng bước
        </span>
        <Icon name="chevron_right" size={20} />
      </Link>

      <div className="sf-banner sf-banner--info">
        <Icon name="shield" size={20} color="var(--sf-primary)" />
        <span className="sf-body-sm" style={{ flex: 1 }}>
          Mọi cấu hình ban đầu được ghi nhận audit log.
        </span>
      </div>
    </div>
  );
}

/** Số thứ tự bước — tròn, đổi màu theo trạng thái. */
function StepNumber({ order, done, active }: { order: number; done: boolean; active: boolean }) {
  const background = done
    ? 'var(--sf-success)'
    : active
      ? 'var(--sf-primary-surface)'
      : 'var(--sf-surface-container)';
  const color = done || active ? '#fff' : 'var(--sf-on-surface-muted)';

  return (
    <span
      aria-hidden="true"
      style={{
        width: 32,
        height: 32,
        borderRadius: 999,
        background,
        color,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {done ? <Icon name="check" size={18} color="#fff" /> : order}
    </span>
  );
}
