import { Link } from 'react-router-dom';
import { Icon } from '@/components/ui';
import { SETUP_STEP_KEYS, type SetupStep, type SetupStepKey } from './provisioning.api';

/** Biểu tượng của từng bước — dùng chung ở màn tổng quan wizard và thanh bước. */
export const SETUP_STEP_ICON: Record<SetupStepKey, string> = {
  companyInfo: 'apartment',
  departments: 'account_tree',
  shifts: 'schedule',
  accountantAccount: 'person_add',
  handover: 'handshake',
};

/**
 * Thanh 5 bước nằm ngang — mockup Figma `69:254`, `67:77`, `67:78`, `67:76`.
 *
 * ## Nó trả lời ba câu, và cả ba đều cần
 *
 * "Tôi đang ở bước mấy", "còn mấy bước nữa", "bước nào đã xong". Một thanh tiến
 * độ phần trăm chỉ trả lời câu thứ hai; một dòng chữ "Bước 3/5" chỉ trả lời câu
 * thứ nhất. Người đang thiết lập lần đầu cần cả ba cùng lúc để quyết định có
 * làm tiếp bây giờ hay để mai.
 *
 * ## Ổ khoá trên bước chưa tới
 *
 * Mockup vẽ ổ khoá ở mọi bước phía sau. Ở đây ổ khoá CHỈ hiện trên bước bàn
 * giao, vì đó là bước duy nhất thật sự bị khoá (`SetupWizardPage` giải thích
 * vì sao bốn bước đầu không khoá theo thứ tự). Vẽ ổ khoá lên một bước bấm được
 * là nói dối người dùng về chính thứ họ đang nhìn.
 */
export function SetupStepper({
  steps,
  current,
  locked,
}: {
  steps: SetupStep[];
  current: SetupStepKey;
  /** Bước bị khoá thật — không dẫn đi đâu và hiện ổ khoá. */
  locked: SetupStepKey[];
}) {
  const byKey = new Map(steps.map((step) => [step.key, step]));

  return (
    <nav className="sf-stepper" aria-label="Tiến độ thiết lập ban đầu">
      <ol>
        {SETUP_STEP_KEYS.map((key, index) => {
          const step = byKey.get(key);
          if (!step) return null;

          const isCurrent = key === current;
          const isLocked = locked.includes(key);
          const state = step.done ? 'done' : isCurrent ? 'current' : 'todo';

          const body = (
            <>
              <span className={`sf-stepper__badge sf-stepper__badge--${state}`}>
                {step.done ? <Icon name="check" size={18} /> : index + 1}
              </span>
              <span className="sf-stepper__icon">
                <Icon name={SETUP_STEP_ICON[key]} size={20} />
                {isLocked ? (
                  <Icon name="lock" size={14} label="Bước này chưa mở" />
                ) : null}
              </span>
              <span className={`sf-stepper__label sf-stepper__label--${state}`}>{step.label}</span>
            </>
          );

          return (
            <li key={key} className="sf-stepper__item">
              {isLocked ? (
                <span className="sf-stepper__cell" aria-disabled="true">
                  {body}
                </span>
              ) : (
                <Link
                  to={`/thiet-lap/${key}`}
                  className="sf-stepper__cell"
                  aria-current={isCurrent ? 'step' : undefined}
                >
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
