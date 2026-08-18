import { useEffect, useState } from 'react';
import { Alert, Input, Modal, Tag } from 'antd';
import { useToast } from '@/components/ui';
import { toUserMessage } from '@/lib/errors/api-error';
import { useRemindWorkStatus } from './work-status.api';

/** Số tên hiện ra trước khi gộp phần còn lại thành "và N người nữa". */
const NAMES_SHOWN = 12;

/**
 * Nhắc CBNV chưa chấm công.
 *
 * ## Vì sao phải liệt kê tên, không chỉ đếm số
 *
 * Đây là thao tác gửi thông báo tới người thật và KHÔNG có nút thu hồi. "Gửi cho
 * 14 người" không cho người bấm cơ hội phát hiện rằng trong 14 người đó có người
 * đang nghỉ phép mà đơn chưa duyệt kịp. Danh sách tên thì có.
 *
 * ## Vì sao lời nhắn để trống được
 *
 * Nội dung mặc định do Backend sinh, kèm đúng ngày đang xem. Bắt gõ tay mỗi lần
 * sẽ dẫn tới hai kết cục: hoặc người dùng gõ qua loa, hoặc họ thôi không dùng
 * nút này nữa.
 */
export function RemindEmployeesModal({
  open,
  workDate,
  employees,
  onClose,
}: {
  open: boolean;
  workDate: string;
  employees: { id: string; fullName: string; employeeCode: string }[];
  onClose: () => void;
}) {
  const toast = useToast();
  const remind = useRemindWorkStatus();

  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setMessage('');
      setError(null);
    }
  }, [open]);

  async function submit() {
    setError(null);
    try {
      const result = await remind.mutateAsync({
        employeeIds: employees.map((employee) => employee.id),
        date: workDate,
        message: message.trim() || undefined,
      });

      // Nói cả phần BỊ BỎ QUA. Backend lặng lẽ loại người ngoài phạm vi phòng
      // ban của người gửi; báo "đã gửi 12" trong khi họ chọn 14 mà không giải
      // thích sẽ đọc như hệ thống làm mất hai lượt gửi.
      toast.success(
        `Đã gửi nhắc nhở tới ${result.sent} CBNV`,
        result.skipped > 0
          ? `${result.skipped} người bị bỏ qua vì nằm ngoài phạm vi phòng ban bạn quản lý.`
          : 'Thông báo hiện ngay trên ứng dụng của họ.',
      );
      onClose();
    } catch (caught) {
      setError(toUserMessage(caught));
    }
  }

  const extra = employees.length - NAMES_SHOWN;

  return (
    <Modal
      open={open}
      title={`Nhắc ${employees.length} CBNV chấm công`}
      okText="Gửi nhắc nhở"
      cancelText="Huỷ"
      confirmLoading={remind.isPending}
      onOk={() => void submit()}
      onCancel={onClose}
      destroyOnClose
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {error ? <Alert type="error" showIcon message={error} /> : null}

        <div>
          <p className="sf-body-sm sf-text-variant" style={{ margin: '0 0 8px' }}>
            Thông báo gửi tới đúng những người bạn đã chọn trên lưới, cho ngày {workDate}. Không
            thu hồi được sau khi gửi.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {employees.slice(0, NAMES_SHOWN).map((employee) => (
              <Tag key={employee.id}>{employee.fullName}</Tag>
            ))}
            {extra > 0 ? <Tag color="default">và {extra} người nữa</Tag> : null}
          </div>
        </div>

        <label style={{ display: 'block' }}>
          <span className="sf-field__label">Lời nhắn (không bắt buộc)</span>
          <Input.TextArea
            rows={3}
            maxLength={300}
            showCount
            value={message}
            placeholder="Bỏ trống để dùng nội dung mặc định: nhắc chấm công hoặc gửi đơn nếu hôm nay không đi làm."
            onChange={(event) => setMessage(event.target.value)}
          />
        </label>
      </div>
    </Modal>
  );
}
