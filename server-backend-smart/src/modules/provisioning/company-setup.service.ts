import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from 'src/common/errors';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SETUP_STEPS, type SetupStep } from './provisioning.service';
import type { TenantContext } from 'src/common/types/request-context';

interface StepState {
  done: boolean;
  at?: string;
  by?: string;
}

type SetupSteps = Partial<Record<SetupStep, StepState>>;

const STEP_LABELS: Record<SetupStep, string> = {
  companyInfo: 'Thông tin công ty',
  departments: 'Danh mục phòng ban',
  shifts: 'Ca làm việc',
  accountantAccount: 'Tạo tài khoản Kế toán/HR',
  handover: 'Bàn giao vận hành',
};

/**
 * Wizard "Thiết lập ban đầu" 5 bước của Tổng giám đốc (mockup Figma `67:75`).
 *
 * ## Vì sao trạng thái nằm trong DB chứ không suy ra từ dữ liệu
 *
 * "Đã tạo phòng ban chưa" thì đếm bảng `department` là biết. Nhưng bước 5 —
 * "Bàn giao vận hành" — không có dữ liệu nào để đếm, và bước 1 "Xác nhận thông
 * tin công ty" cũng vậy: công ty luôn tồn tại sẵn từ lúc Quản trị nền tảng tạo,
 * nên không phân biệt được "đã xác nhận" với "chưa ai nhìn tới".
 *
 * Suy ra một phần và lưu một phần thì tệ hơn cả hai: hai nguồn sự thật cho cùng
 * một thanh tiến độ, và chúng sẽ lệch nhau.
 *
 * ## Vì sao không ép thứ tự cứng
 *
 * Màn hình khoá bước 5 cho tới khi xong bốn bước trên — đó là điều kiện thật vì
 * không có gì để bàn giao. Bốn bước còn lại thì cho làm lệch thứ tự: người dùng
 * có thể tạo ca làm việc trước rồi mới lập phòng ban, và chặn họ chỉ để giữ
 * đúng một con số thứ tự là làm khó không có lý do.
 */
@Injectable()
export class CompanySetupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getState(companyId: string) {
    const state = await this.prisma.companySetupState.upsert({
      where: { companyId },
      create: { companyId, steps: {}, currentStep: 1 },
      update: {},
    });

    const steps = (state.steps as SetupSteps) ?? {};
    const items = SETUP_STEPS.map((key, index) => ({
      key,
      order: index + 1,
      label: STEP_LABELS[key],
      done: steps[key]?.done === true,
      at: steps[key]?.at ?? null,
      by: steps[key]?.by ?? null,
    }));

    const doneCount = items.filter((item) => item.done).length;

    return {
      companyId,
      steps: items,
      doneCount,
      totalSteps: SETUP_STEPS.length,
      currentStep: state.currentStep,
      completedAt: state.completedAt,
      /** Bước tiếp theo chưa xong — màn hình dùng để tô sáng đúng thẻ. */
      nextStep: items.find((item) => !item.done)?.key ?? null,
    };
  }

  async completeStep(ctx: TenantContext, step: SetupStep) {
    if (!SETUP_STEPS.includes(step)) {
      throw new AppException('SYS_VALIDATION_ERROR', {
        reason: `Bước "${step}" không có trong wizard thiết lập.`,
        allowed: SETUP_STEPS,
      });
    }

    const current = await this.getState(ctx.companyId);

    // Bàn giao vận hành là bước duy nhất có điều kiện thật: không có công ty,
    // phòng ban, ca làm việc và người nhận thì không có gì để bàn giao.
    if (step === 'handover') {
      const missing = current.steps
        .filter((item) => item.key !== 'handover' && !item.done)
        .map((item) => item.label);
      if (missing.length > 0) {
        throw new AppException('SETUP_STEP_INCOMPLETE', { missing });
      }
    }

    const steps = {
      ...current.steps.reduce<SetupSteps>((acc, item) => {
        if (item.done)
          acc[item.key] = { done: true, at: item.at ?? undefined, by: item.by ?? undefined };
        return acc;
      }, {}),
    };
    steps[step] = { done: true, at: new Date().toISOString(), by: ctx.userId };

    const doneCount = SETUP_STEPS.filter((key) => steps[key]?.done).length;
    const allDone = doneCount === SETUP_STEPS.length;

    await this.prisma.companySetupState.update({
      where: { companyId: ctx.companyId },
      data: {
        steps: steps as Prisma.InputJsonValue,
        currentStep: Math.min(doneCount + 1, SETUP_STEPS.length),
        completedAt: allDone ? new Date() : null,
      },
    });

    await this.audit.record(ctx, {
      action: 'COMPANY_SETUP_STEP',
      targetType: 'COMPANY_SETUP_STATE',
      targetId: ctx.companyId,
      after: { step, doneCount, completed: allDone },
    });

    return this.getState(ctx.companyId);
  }

  /**
   * Mở lại một bước đã đánh dấu xong.
   *
   * Có mặt vì bấm nhầm là chuyện xảy ra, và nếu không mở lại được thì cách duy
   * nhất để sửa là vào thẳng database.
   */
  async reopenStep(ctx: TenantContext, step: SetupStep) {
    const current = await this.getState(ctx.companyId);
    const steps = current.steps.reduce<SetupSteps>((acc, item) => {
      if (item.done && item.key !== step) {
        acc[item.key] = { done: true, at: item.at ?? undefined, by: item.by ?? undefined };
      }
      return acc;
    }, {});

    await this.prisma.companySetupState.update({
      where: { companyId: ctx.companyId },
      data: {
        steps: steps as Prisma.InputJsonValue,
        currentStep: Math.min(Object.keys(steps).length + 1, SETUP_STEPS.length),
        completedAt: null,
      },
    });

    await this.audit.record(ctx, {
      action: 'COMPANY_SETUP_STEP_REOPEN',
      targetType: 'COMPANY_SETUP_STATE',
      targetId: ctx.companyId,
      after: { step },
    });

    return this.getState(ctx.companyId);
  }
}
