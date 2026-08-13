import { useState } from 'react';
import { Alert, App as AntApp, DatePicker, InputNumber, Modal } from 'antd';
import { useAuth } from '@/lib/auth/auth-context';
import { formatDay, formatMinutes, toWorkDate, todayWorkDate } from '@/lib/utils/date';
import { toDayjs } from '@/lib/utils/dayjs';
import { toUserMessage } from '@/lib/errors/api-error';
import { useRecordMakeup, type MakeupRecord } from './makeup.api';

/**
 * Ghi nhận một lần làm bù — `FR-WEB-MKUP-02`, `FR-WEB-MKUP-03`.
 *
 * Hai điều màn hình phải nói rõ, vì cả hai đều trái với kỳ vọng tự nhiên:
 *
 *   1. Giờ bù cộng vào bảng công của NGÀY LÀM BÙ, không phải ngày phát sinh nợ.
 *      Chọn sai ngày là cộng giờ công vào một ngày nhân viên không đi làm.
 *
 *   2. Bù thiếu thì phần còn nợ TÁCH sang một khoản mới giữ nguyên hạn cũ. Không
 *      nói ra thì người dùng thấy dòng cũ đóng lại và tưởng đã xong.
 */
export function RecordMakeupModal({
  record,
  onClose,
}: {
  record: MakeupRecord | null;
  onClose: () => void;
}) {
  const { timezone } = useAuth();
  const { message } = AntApp.useApp();
  const save = useRecordMakeup();

  const [makeupWorkDate, setMakeupWorkDate] = useState(todayWorkDate(timezone));
  const [hours, setHours] = useState(0);
  const [minutes, setMinutes] = useState(0);

  const totalMinutes = hours * 60 + minutes;
  const remaining = record?.remainingMinutes ?? 0;
  const exceeds = totalMinutes > remaining;
  const leftover = Math.max(0, remaining - totalMinutes);

  return (
    <Modal
      open={Boolean(record)}
      title="Ghi nhận giờ làm bù"
      okText="Ghi nhận"
      cancelText="Huỷ bỏ"
      okButtonProps={{
        size: 'large',
        loading: save.isPending,
        disabled: totalMinutes <= 0 || exceeds,
      }}
      cancelButtonProps={{ size: 'large' }}
      width={560}
      destroyOnClose
      afterOpenChange={(open) => {
        if (!open || !record) return;
        setMakeupWorkDate(todayWorkDate(timezone));
        // Điền sẵn đúng số còn nợ: trường hợp phổ biến nhất là bù đủ một lần.
        setHours(Math.floor(record.remainingMinutes / 60));
        setMinutes(record.remainingMinutes % 60);
      }}
      onCancel={onClose}
      onOk={async () => {
        if (!record) return;
        try {
          const result = await save.mutateAsync({
            id: record.id,
            makeupWorkDate,
            minutes: totalMinutes,
          });

          message.success(
            result.carried
              ? `Đã ghi nhận ${formatMinutes(totalMinutes)}. Phần còn nợ ${formatMinutes(result.carried.remainingMinutes)} chuyển sang một khoản mới, giữ nguyên hạn cũ.`
              : `Đã ghi nhận ${formatMinutes(totalMinutes)}. Nhân viên đã bù đủ giờ.`,
          );
          onClose();
        } catch (caught) {
          message.error(toUserMessage(caught));
        }
      }}
    >
      {record ? (
        <div style={{ display: 'grid', gap: 16 }}>
          <p className="sf-body-md" style={{ margin: 0 }}>
            {record.employee?.fullName} · nợ {formatMinutes(record.debtMinutes)} phát sinh ngày{' '}
            {formatDay(record.debtWorkDate, timezone)} · còn {formatMinutes(remaining)}
          </p>

          <Field label="Ngày làm bù" htmlFor="rm-date" required>
            <DatePicker
              id="rm-date"
              size="large"
              allowClear={false}
              format="DD/MM/YYYY"
              style={{ width: '100%' }}
              value={toDayjs(makeupWorkDate)}
              onChange={(date) => setMakeupWorkDate(toWorkDate(date?.toDate()) ?? makeupWorkDate)}
            />
            <p className="sf-body-sm sf-text-variant" style={{ margin: '4px 0 0' }}>
              Giờ bù được cộng vào bảng công của ĐÚNG ngày này, nên phải là ngày nhân viên thật sự
              ở lại làm.
            </p>
          </Field>

          <Field label="Số giờ đã bù" required>
            <div style={{ display: 'flex', gap: 12 }}>
              <InputNumber
                size="large"
                min={0}
                max={24}
                addonAfter="giờ"
                style={{ width: '100%' }}
                value={hours}
                onChange={(value) => setHours(value ?? 0)}
                aria-label="Số giờ đã bù"
              />
              <InputNumber
                size="large"
                min={0}
                max={59}
                addonAfter="phút"
                style={{ width: '100%' }}
                value={minutes}
                onChange={(value) => setMinutes(value ?? 0)}
                aria-label="Số phút đã bù"
              />
            </div>
          </Field>

          {exceeds ? (
            <Alert
              type="error"
              showIcon
              message="Vượt quá số phút còn nợ"
              description={`Còn nợ ${formatMinutes(remaining)}. Phần dôi ra là tăng ca, không phải công làm bù — tăng ca có luồng duyệt và hệ số lương riêng, ghi nhầm vào đây là trả sai lương.`}
            />
          ) : leftover > 0 ? (
            <Alert
              type="warning"
              showIcon
              message={`Sau lần này còn nợ ${formatMinutes(leftover)}`}
              description={`Phần còn nợ tự tách sang một khoản mới, giữ nguyên ngày phát sinh và hạn ${record.dueDate ? formatDay(record.dueDate, timezone) : 'hiện tại'}.`}
            />
          ) : (
            <Alert type="success" showIcon message="Bù đủ giờ — khoản nợ này sẽ được đóng lại." />
          )}
        </div>
      ) : null}
    </Modal>
  );
}

function Field({
  label,
  htmlFor,
  required,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="sf-label-md" htmlFor={htmlFor} style={{ display: 'block', marginBottom: 4 }}>
        {label}
        {required ? <span style={{ color: 'var(--sf-error-600)' }}> *</span> : null}
      </label>
      {children}
    </div>
  );
}
