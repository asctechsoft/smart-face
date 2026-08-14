import { useState } from 'react';
import {
  Alert,
  Button,
  DatePicker,
  InputNumber,
  Modal,
  Select,
  Switch,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DataTable } from '@/components/DataTable';
import { StatusBadge } from '@/components/StatusBadge';
import { Icon } from '@/components/Icon';
import { useCan } from '@/lib/rbac/Can';
import { useAuth } from '@/lib/auth/auth-context';
import { formatDay, toWorkDate } from '@/lib/utils/date';
import { toDayjs } from '@/lib/utils/dayjs';
import { useLeavePolicies, useUpsertLeavePolicy, type LeavePolicy } from '../policy.api';
import { Field, useToast } from '@/components/ui';
import { useErrorToast } from '@/lib/errors/use-error-toast';

/** NFR-LEGAL-07 — Điều 113 Bộ luật Lao động 2019, điều kiện làm việc bình thường. */
const STATUTORY_MIN_DAYS = 12;

const CONTRACT_TYPES = ['Chính thức', 'Thử việc', 'Thời vụ', 'Part-time'];

/**
 * Chính sách phép năm — docs/04 mục 6.3 (`FR-WEB-POL-07`, `FR-WEB-POL-08`).
 *
 * Bảng liệt kê cả phiên bản ĐÃ ĐÓNG chứ không chỉ bản đang hiệu lực. Đó là chủ
 * đích: câu hỏi hay gặp nhất về phép năm là "sao năm ngoái tôi được 12 ngày mà
 * năm nay 14", và câu trả lời nằm ở đúng những bản cũ đó — sửa đè thì không ai
 * trả lời được nữa.
 *
 * Cộng dồn phép là chỗ dễ tạo nợ tiền mặt nhất: cho cộng dồn mà không đặt hạn
 * dùng thì phép tích luỹ vô hạn, và tới lúc nhân viên nghỉ việc công ty phải
 * thanh toán bằng tiền. Vì vậy bật cộng dồn là form hiện ngay hai ô kiểm soát.
 */
export function LeavePolicyTab() {
  const { timezone } = useAuth();
  const canEdit = useCan('policy.edit');

  const policies = useLeavePolicies();
  const [editing, setEditing] = useState<Partial<LeavePolicy> | null>(null);

  const columns: ColumnsType<LeavePolicy> = [
    {
      title: 'Loại hợp đồng',
      key: 'contractType',
      width: 180,
      render: (_, row) => (
        <div>
          <div className="sf-body-md" style={{ fontWeight: 600 }}>
            {row.contractType ?? 'Mặc định (mọi loại)'}
          </div>
          {row.isCurrent ? (
            <StatusBadge tone="success" soft>
              Đang áp dụng
            </StatusBadge>
          ) : (
            <StatusBadge tone="neutral" soft>
              Đã thay thế
            </StatusBadge>
          )}
        </div>
      ),
    },
    {
      title: 'Phép cơ bản',
      dataIndex: 'baseDaysPerYear',
      key: 'base',
      width: 130,
      align: 'right',
      render: (value: number) => `${value} ngày/năm`,
    },
    {
      title: 'Thâm niên',
      key: 'seniority',
      width: 180,
      render: (_, row) =>
        row.seniorityBonusDays > 0
          ? `+${row.seniorityBonusDays} ngày mỗi ${row.seniorityEveryYears} năm`
          : 'Không cộng thâm niên',
    },
    {
      title: 'Cộng dồn',
      key: 'carryOver',
      width: 230,
      render: (_, row) => {
        if (!row.allowCarryOver) return 'Không cho cộng dồn';
        const cap = row.maxCarryOverDays != null ? `tối đa ${row.maxCarryOverDays} ngày` : 'không giới hạn';
        const expire = row.carryOverExpireMonth
          ? `, hết hạn cuối tháng ${row.carryOverExpireMonth}`
          : '';
        return `Cho cộng dồn ${cap}${expire}`;
      },
    },
    {
      title: 'Cách cấp phép',
      dataIndex: 'accrualMode',
      key: 'accrualMode',
      width: 190,
      render: (value: string) =>
        value === 'MONTHLY' ? 'Cộng dần theo tháng' : 'Cấp trọn gói đầu năm',
    },
    {
      title: 'Hiệu lực',
      key: 'effective',
      width: 210,
      render: (_, row) =>
        `${formatDay(row.effectiveFrom, timezone)} → ${row.effectiveTo ? formatDay(row.effectiveTo, timezone) : 'không thời hạn'}`,
    },
    ...(canEdit
      ? [
          {
            title: '',
            key: 'actions',
            width: 110,
            render: (_: unknown, row: LeavePolicy) =>
              row.isCurrent ? (
                <Button size="small" onClick={() => setEditing(row)}>
                  Sửa
                </Button>
              ) : null,
          } as ColumnsType<LeavePolicy>[number],
        ]
      : []),
  ];

  return (
    <div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Mỗi lần lưu tạo một PHIÊN BẢN MỚI, không sửa đè"
        description="Số phép đã cấp cho nhân viên hồi đầu năm phải giải thích được bằng chính sách lúc đó. Bản cũ được đóng lại và vẫn tra cứu được ở bảng dưới."
      />

      {canEdit ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
          <Button
            type="primary"
            icon={<Icon name="add" size={20} />}
            onClick={() =>
              setEditing({
                baseDaysPerYear: STATUTORY_MIN_DAYS,
                seniorityBonusDays: 1,
                seniorityEveryYears: 5,
                allowCarryOver: false,
                accrualMode: 'YEARLY',
              })
            }
          >
            Thêm chính sách phép
          </Button>
        </div>
      ) : null}

      <DataTable<LeavePolicy>
        rowKey="id"
        data={policies.data}
        isLoading={policies.isLoading}
        error={policies.error}
        onRetry={() => void policies.refetch()}
        columns={columns}
        pagination={false}
        emptyIcon="beach_access"
        emptyTitle="Chưa cấu hình chính sách phép năm"
        emptyDescription="Chưa có chính sách thì hệ thống không cấp được số ngày phép, và mọi đơn nghỉ phép sẽ bị chặn vì không đủ số dư."
        emptyAction={
          canEdit ? (
            <Button
              type="primary"
              onClick={() =>
                setEditing({
                  baseDaysPerYear: STATUTORY_MIN_DAYS,
                  seniorityBonusDays: 1,
                  seniorityEveryYears: 5,
                  allowCarryOver: true,
                  maxCarryOverDays: 5,
                  carryOverExpireMonth: 3,
                  accrualMode: 'YEARLY',
                })
              }
            >
              Tạo chính sách mặc định
            </Button>
          ) : undefined
        }
      />

      <LeavePolicyFormModal policy={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function LeavePolicyFormModal({
  policy,
  onClose,
}: {
  policy: Partial<LeavePolicy> | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const showError = useErrorToast();
  const upsert = useUpsertLeavePolicy();
  const [draft, setDraft] = useState<Partial<LeavePolicy>>({});

  const value = { ...policy, ...draft };
  const baseDays = value.baseDaysPerYear ?? STATUTORY_MIN_DAYS;
  const belowStatutory = baseDays < STATUTORY_MIN_DAYS;

  function patch(next: Partial<LeavePolicy>) {
    setDraft((prev) => ({ ...prev, ...next }));
  }

  return (
    <Modal
      open={Boolean(policy)}
      onCancel={onClose}
      title={policy?.id ? 'Sửa chính sách phép năm' : 'Thêm chính sách phép năm'}
      okText="Lưu phiên bản mới"
      cancelText="Huỷ bỏ"
      okButtonProps={{ size: 'large', loading: upsert.isPending, disabled: belowStatutory }}
      cancelButtonProps={{ size: 'large' }}
      width={620}
      destroyOnClose
      afterOpenChange={(open) => {
        if (open) setDraft({});
      }}
      onOk={async () => {
        try {
          await upsert.mutateAsync({
            ...(value.contractType ? { contractType: value.contractType } : {}),
            baseDaysPerYear: baseDays,
            seniorityBonusDays: value.seniorityBonusDays ?? 0,
            seniorityEveryYears: value.seniorityEveryYears ?? 5,
            allowCarryOver: value.allowCarryOver ?? false,
            ...(value.allowCarryOver && value.maxCarryOverDays != null
              ? { maxCarryOverDays: value.maxCarryOverDays }
              : {}),
            ...(value.allowCarryOver && value.carryOverExpireMonth != null
              ? { carryOverExpireMonth: value.carryOverExpireMonth }
              : {}),
            accrualMode: value.accrualMode ?? 'YEARLY',
            ...(value.effectiveFrom ? { effectiveFrom: value.effectiveFrom.slice(0, 10) } : {}),
          });
          toast.success('Đã lưu phiên bản mới của chính sách phép năm');
          onClose();
        } catch (caught) {
          showError(caught);
        }
      }}
    >
      <div style={{ display: 'grid', gap: 16 }}>
        <Field label="Áp dụng cho loại hợp đồng" htmlFor="lp-contract">
          <Select
            id="lp-contract"
            allowClear
            style={{ width: '100%' }}
            placeholder="Bỏ trống = chính sách mặc định cho mọi loại hợp đồng"
            value={value.contractType ?? undefined}
            onChange={(contractType) => patch({ contractType: contractType ?? null })}
            options={CONTRACT_TYPES.map((type) => ({ value: type, label: type }))}
          />
          <p className="sf-body-sm sf-text-variant" style={{ margin: '4px 0 0' }}>
            Loại hợp đồng chưa khai riêng sẽ dùng chính sách mặc định.
          </p>
        </Field>

        <Field label="Phép cơ bản mỗi năm" htmlFor="lp-base" required>
          <InputNumber
            id="lp-base"
            min={0}
            max={60}
            step={0.5}
            addonAfter="ngày"
            style={{ width: '100%' }}
            value={baseDays}
            onChange={(days) => patch({ baseDaysPerYear: days ?? STATUTORY_MIN_DAYS })}
          />
          {belowStatutory ? (
            <Alert
              style={{ marginTop: 8 }}
              type="error"
              showIcon
              role="alert"
              message="Dưới mức tối thiểu của Bộ luật Lao động"
              description={`Điều 113 Bộ luật Lao động 2019 quy định tối thiểu ${STATUTORY_MIN_DAYS} ngày/năm với điều kiện làm việc bình thường. Backend sẽ từ chối giá trị này.`}
            />
          ) : null}
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Field label="Cộng thêm theo thâm niên" htmlFor="lp-sen-days">
            <InputNumber
              id="lp-sen-days"
              min={0}
              step={0.5}
              addonAfter="ngày"
              style={{ width: '100%' }}
              value={value.seniorityBonusDays ?? 0}
              onChange={(days) => patch({ seniorityBonusDays: days ?? 0 })}
            />
          </Field>
          <Field label="Cứ mỗi" htmlFor="lp-sen-years">
            <InputNumber
              id="lp-sen-years"
              min={1}
              addonAfter="năm làm việc"
              style={{ width: '100%' }}
              value={value.seniorityEveryYears ?? 5}
              onChange={(years) => patch({ seniorityEveryYears: years ?? 5 })}
            />
          </Field>
        </div>

        <Field label="Cách cấp phép" htmlFor="lp-accrual">
          <Select
            id="lp-accrual"
            style={{ width: '100%' }}
            value={value.accrualMode ?? 'YEARLY'}
            onChange={(accrualMode) => patch({ accrualMode })}
            options={[
              { value: 'YEARLY', label: 'Cấp trọn gói vào đầu năm' },
              { value: 'MONTHLY', label: 'Cộng dần theo tháng làm việc' },
            ]}
          />
          <p className="sf-body-sm sf-text-variant" style={{ margin: '4px 0 0' }}>
            Cộng dần theo tháng công bằng hơn với người vào giữa năm; cấp trọn gói thì nhân viên
            nghỉ việc giữa năm có thể đã dùng quá phần tương ứng thời gian làm việc.
          </p>
        </Field>

        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 16,
            padding: 12,
            background: 'var(--sf-neutral-100)',
            borderRadius: 12,
          }}
        >
          <div>
            <div className="sf-body-md" style={{ fontWeight: 600 }}>
              Cho phép chuyển phép chưa dùng sang năm sau
            </div>
            <div className="sf-body-sm sf-text-variant">
              Bật thì phải đặt trần và hạn dùng, nếu không phép tích luỹ vô hạn và thành khoản phải
              thanh toán bằng tiền khi nhân viên nghỉ việc.
            </div>
          </div>
          <Switch
            checked={Boolean(value.allowCarryOver)}
            onChange={(checked) => patch({ allowCarryOver: checked })}
            aria-label="Cho phép cộng dồn phép"
          />
        </div>

        {value.allowCarryOver ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="Tối đa được cộng dồn" htmlFor="lp-max-carry">
              <InputNumber
                id="lp-max-carry"
                min={0}
                step={0.5}
                addonAfter="ngày"
                style={{ width: '100%' }}
                value={value.maxCarryOverDays ?? undefined}
                onChange={(days) => patch({ maxCarryOverDays: days ?? null })}
                placeholder="Không giới hạn"
              />
            </Field>
            <Field label="Hết hạn cuối tháng" htmlFor="lp-expire">
              <Select
                id="lp-expire"
                style={{ width: '100%' }}
                value={value.carryOverExpireMonth ?? 3}
                onChange={(month) => patch({ carryOverExpireMonth: month })}
                options={Array.from({ length: 12 }, (_, index) => ({
                  value: index + 1,
                  label: `Tháng ${index + 1} năm sau`,
                }))}
              />
            </Field>
          </div>
        ) : null}

        <Field label="Hiệu lực từ" htmlFor="lp-eff">
          <DatePicker
            id="lp-eff"
            format="DD/MM/YYYY"
            style={{ width: '100%' }}
            value={toDayjs(value.effectiveFrom?.slice(0, 10))}
            onChange={(date) => patch({ effectiveFrom: toWorkDate(date?.toDate()) ?? undefined })}
          />
          <p className="sf-body-sm sf-text-variant" style={{ margin: '4px 0 0' }}>
            Bỏ trống = có hiệu lực ngay. Số phép đã cấp trước mốc này giữ nguyên theo bản cũ.
          </p>
        </Field>
      </div>
    </Modal>
  );
}

