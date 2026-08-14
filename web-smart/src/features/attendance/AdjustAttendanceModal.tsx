import { useEffect, useState } from 'react';
import { Alert, Input, Modal, Radio, Select, TimePicker } from 'antd';
import { useAuth } from '@/lib/auth/auth-context';
import { toUserMessage } from '@/lib/errors/api-error';
import { formatDay, formatTime } from '@/lib/utils/date';
import { dayjs, type Dayjs } from '@/lib/utils/dayjs';
import { REASON_MIN_LENGTH } from '@/config/constants';
import {
  useAdjustAttendance,
  useAttendanceLogs,
  type AttendanceDaily,
  type AdjustPayload,
} from './attendance.api';
import { useToast } from '@/components/ui';

type AdjustType = 'ADD' | 'MODIFY_TIME' | 'VOID';

/**
 * Hiệu chỉnh công thủ công — docs/04 mục 3.3 (`FR-WEB-ATT-04`).
 *
 * Điều quan trọng nhất mà giao diện phải truyền đạt: đây KHÔNG phải sửa đè.
 * `BR-ADJ-01` bắt tạo bản ghi `AttendanceAdjustment` mới trỏ về bản ghi gốc, và
 * bản ghi gốc vẫn còn nguyên, vẫn xem được. Nhân viên cũng xem được lịch sử
 * hiệu chỉnh liên quan tới mình (`BR-ADJ-06`) — nói rõ điều đó ngay trên form
 * để người thao tác biết việc mình làm không vô hình.
 */
export function AdjustAttendanceModal({
  open,
  daily,
  onClose,
}: {
  open: boolean;
  daily: AttendanceDaily | null;
  onClose: () => void;
}) {
  const { timezone } = useAuth();
  const toast = useToast();
  const adjust = useAdjustAttendance();

  const [adjustType, setAdjustType] = useState<AdjustType>('MODIFY_TIME');
  const [logId, setLogId] = useState<string | undefined>();
  const [newTime, setNewTime] = useState<Dayjs | null>(null);
  const [newType, setNewType] = useState<'CHECK_IN' | 'CHECK_OUT'>('CHECK_IN');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const logs = useAttendanceLogs(
    open ? (daily?.employeeId ?? null) : null,
    open ? (daily?.workDate ?? null) : null,
  );

  useEffect(() => {
    if (open) {
      setAdjustType('MODIFY_TIME');
      setLogId(undefined);
      setNewTime(null);
      setNewType('CHECK_IN');
      setReason('');
      setError(null);
    }
  }, [open]);

  const needsLog = adjustType === 'MODIFY_TIME' || adjustType === 'VOID';
  const needsTime = adjustType === 'MODIFY_TIME' || adjustType === 'ADD';
  const reasonTooShort = reason.trim().length < REASON_MIN_LENGTH;
  const canSubmit =
    !reasonTooShort && (!needsLog || Boolean(logId)) && (!needsTime || Boolean(newTime));

  async function submit() {
    if (!daily || !canSubmit) return;
    setError(null);

    /**
     * Giờ mới ghép từ `workDate` + giờ người dùng chọn, rồi quy về UTC.
     *
     * Không dùng `newTime.toDate()` trần: `TimePicker` gắn giờ vào NGÀY HÔM NAY,
     * nên hiệu chỉnh một ngày trong quá khứ sẽ ghi nhầm sang hôm nay. Phải lấy
     * đúng `workDate` của dòng đang sửa.
     */
    const afterValue: Record<string, unknown> = {};
    if (needsTime && newTime) {
      const composed = dayjs(`${daily.workDate} ${newTime.format('HH:mm')}`, 'YYYY-MM-DD HH:mm');
      afterValue.recordedAt = composed.toDate().toISOString();
      if (adjustType === 'ADD') afterValue.type = newType;
    }

    const payload: AdjustPayload = {
      employeeId: daily.employeeId,
      workDate: daily.workDate,
      adjustType,
      reason: reason.trim(),
      ...(needsLog && logId ? { attendanceLogId: logId } : {}),
      ...(Object.keys(afterValue).length > 0 ? { afterValue } : {}),
    };

    try {
      await adjust.mutateAsync(payload);
      toast.success('Đã tạo bản ghi hiệu chỉnh', 'Bảng công của ngày này đang được tính lại.');
      onClose();
    } catch (caught) {
      setError(toUserMessage(caught));
    }
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      onOk={() => void submit()}
      title="Hiệu chỉnh công"
      okText="Tạo bản ghi hiệu chỉnh"
      cancelText="Huỷ bỏ"
      okButtonProps={{ disabled: !canSubmit, loading: adjust.isPending }}
      width={600}
      destroyOnClose
    >
      {daily ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div
            style={{
              background: 'var(--sf-neutral-100)',
              borderRadius: 12,
              padding: 12,
            }}
          >
            <div className="sf-body-md" style={{ fontWeight: 600 }}>
              {daily.employee?.fullName ?? 'Nhân viên'}
            </div>
            <div className="sf-body-sm sf-text-variant">
              Ngày {formatDay(daily.workDate, timezone)} · Vào{' '}
              {formatTime(daily.firstCheckInAt, timezone)} · Ra{' '}
              {formatTime(daily.lastCheckOutAt, timezone)}
            </div>
          </div>

          <Alert
            type="info"
            showIcon
            message="Bản ghi gốc không bị thay đổi"
            description="Hệ thống tạo một bản ghi hiệu chỉnh riêng trỏ về bản ghi gốc. Nhân viên xem được lịch sử hiệu chỉnh liên quan tới mình."
          />

          {error ? <Alert type="error" showIcon message={error} role="alert" /> : null}

          <div>
            <label className="sf-field__label" style={{ display: 'block', marginBottom: 8 }}>
              Loại hiệu chỉnh
            </label>
            <Radio.Group
              value={adjustType}
              onChange={(event) => setAdjustType(event.target.value as AdjustType)}
              style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
            >
              <Radio value="MODIFY_TIME">
                Sửa giờ của một lượt đã có
                <div className="sf-body-sm sf-text-variant">
                  VD: nhân viên chấm vào lúc 08:47 nhưng thực tế có mặt từ 08:00.
                </div>
              </Radio>
              <Radio value="ADD">
                Bổ sung một lượt còn thiếu
                <div className="sf-body-sm sf-text-variant">
                  VD: quên chấm ra, hoặc điện thoại hết pin.
                </div>
              </Radio>
              <Radio value="VOID">
                Huỷ một lượt không hợp lệ
                <div className="sf-body-sm sf-text-variant">
                  VD: lượt chấm công bị xác định là gian lận sau khi đối soát.
                </div>
              </Radio>
            </Radio.Group>
          </div>

          {needsLog ? (
            <div>
              <label
                className="sf-field__label"
                htmlFor="adj-log"
                style={{ display: 'block', marginBottom: 4 }}
              >
                Lượt chấm công cần {adjustType === 'VOID' ? 'huỷ' : 'sửa'}
              </label>
              <Select
                id="adj-log"
                value={logId}
                onChange={setLogId}
                loading={logs.isLoading}
                placeholder="Chọn một lượt"
                style={{ width: '100%' }}
                notFoundContent={
                  logs.isLoading ? 'Đang tải...' : 'Ngày này không có lượt chấm công thô nào'
                }
                options={(logs.data ?? []).map((log) => ({
                  value: log.id,
                  label: `${log.type === 'CHECK_IN' ? 'Vào' : 'Ra'} · ${formatTime(log.recordedAt, timezone)} · ${
                    log.authMethod === 'FACE'
                      ? 'Khuôn mặt'
                      : log.authMethod === 'FINGERPRINT'
                        ? 'Vân tay'
                        : 'Nhập tay'
                  }`,
                }))}
              />
            </div>
          ) : null}

          {adjustType === 'ADD' ? (
            <div>
              <label className="sf-field__label" style={{ display: 'block', marginBottom: 4 }}>
                Loại lượt bổ sung
              </label>
              <Radio.Group
                value={newType}
                onChange={(event) => setNewType(event.target.value as 'CHECK_IN' | 'CHECK_OUT')}
                optionType="button"
                buttonStyle="solid"
                options={[
                  { value: 'CHECK_IN', label: 'Chấm vào' },
                  { value: 'CHECK_OUT', label: 'Chấm ra' },
                ]}
              />
            </div>
          ) : null}

          {needsTime ? (
            <div>
              <label
                className="sf-field__label"
                htmlFor="adj-time"
                style={{ display: 'block', marginBottom: 4 }}
              >
                Giờ mới
              </label>
              <TimePicker
                id="adj-time"
                value={newTime}
                onChange={setNewTime}
                format="HH:mm"
                minuteStep={1}
                style={{ width: '100%' }}
                placeholder="Chọn giờ"
              />
              <p className="sf-body-sm sf-text-variant" style={{ margin: '4px 0 0' }}>
                Giờ theo múi giờ {timezone}, gắn vào ngày {formatDay(daily.workDate, timezone)}.
              </p>
            </div>
          ) : null}

          <div>
            <label
              className="sf-field__label"
              htmlFor="adj-reason"
              style={{ display: 'block', marginBottom: 4 }}
            >
              Lý do hiệu chỉnh (bắt buộc)
            </label>
            <Input.TextArea
              id="adj-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              maxLength={1000}
              showCount
              placeholder="VD: Nhân viên có mặt từ 08:00, xác nhận qua camera lễ tân. Đơn bổ sung công số 123."
              aria-invalid={reason.length > 0 && reasonTooShort}
              status={reason.length > 0 && reasonTooShort ? 'error' : undefined}
            />
            <p className="sf-body-sm sf-text-variant" style={{ margin: '4px 0 0' }}>
              Tối thiểu {REASON_MIN_LENGTH} ký tự. Lý do được ghi vào nhật ký kiểm toán cùng tên
              người thực hiện.
            </p>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
