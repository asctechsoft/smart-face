import { useEffect, useState } from 'react';
import { Alert, Modal } from 'antd';
import { Badge, Checkbox, Icon, useToast } from '@/components/ui';
import { toUserMessage } from '@/lib/errors/api-error';
import { formatNumber } from '@/lib/utils/format';
import { useCloseAttendanceSheet, type MonthSheetRef } from './attendance-sheets.api';

/**
 * Chốt bảng công của một tháng — FR-WEB-ATT-08.
 *
 * ## Vì sao là một danh sách có tích chọn, không phải một nút "chốt cả tháng"
 *
 * Màn hình đọc theo tháng, nhưng hệ thống chốt theo BẢNG: bảng mới là thứ giữ
 * danh sách thành viên, và các bảng của một tháng thường không xong cùng lúc —
 * Kế toán rà xong khối văn phòng trước, Kho vận còn chờ bổ sung công.
 *
 * Một nút "chốt cả tháng" ép hai việc đó thành một, và người bấm không có cách
 * nào chốt phần đã xong mà không chốt luôn phần chưa xong.
 *
 * ## Vì sao phải in ra số người còn cần đối soát
 *
 * Chốt là bàn giao số liệu cho tính lương. Bảng còn 24 người thiếu dữ liệu mà
 * vẫn chốt thì bảng lương lấy đúng số liệu thiếu đó — và không ai phát hiện ra
 * cho tới kỳ trả lương. Con số này đếm trên TOÀN bảng, không theo bộ lọc đang
 * bật trên màn hình, nếu không thì lọc một phòng ban sẽ làm mọi bảng khác trông
 * như đã sạch.
 *
 * ## Vì sao mặc định KHÔNG tích bảng còn vướng
 *
 * Mặc định tích sẵn những bảng đã sạch. Bảng còn người cần rà thì để trống —
 * người dùng vẫn tích được, nhưng phải tự tay làm điều đó.
 */
export function CloseSheetsModal({
  open,
  month,
  sheets,
  onClose,
}: {
  open: boolean;
  /** "05/2025" — chỉ để hiện trên tiêu đề. */
  month: string;
  sheets: MonthSheetRef[];
  onClose: () => void;
}) {
  const toast = useToast();
  const closeSheet = useCloseAttendanceSheet();

  const openSheets = sheets.filter((sheet) => sheet.status !== 'CLOSED');

  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSelected(
      openSheets.filter((sheet) => sheet.needsReviewCount === 0).map((sheet) => sheet.id),
    );
    // `sheets` đổi tham chiếu mỗi lần truy vấn làm mới; theo dõi nó ở đây sẽ
    // xoá lựa chọn của người dùng giữa chừng. Chỉ dựng lại khi hộp thoại mở.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function toggle(sheetId: string, checked: boolean) {
    setSelected((prev) =>
      checked ? [...prev, sheetId] : prev.filter((id) => id !== sheetId),
    );
  }

  async function submit() {
    setError(null);
    try {
      /*
       * Chốt TUẦN TỰ, không `Promise.all`: mỗi lượt chốt kiểm lại kỳ lương ở
       * Backend, và một bảng bị từ chối không được kéo theo những bảng đứng sau
       * nó vào trạng thái không rõ ràng. Số bảng của một tháng đếm bằng đầu
       * ngón tay nên tuần tự không chậm đi đáng kể.
       */
      let closed = 0;
      for (const sheetId of selected) {
        await closeSheet.mutateAsync({ id: sheetId });
        closed += 1;
      }
      toast.success(
        `Đã chốt ${closed} bảng chấm công`,
        openSheets.length > closed
          ? `Còn ${openSheets.length - closed} bảng chưa chốt — mở lại hộp thoại này khi rà xong.`
          : `Toàn bộ bảng của tháng ${month} đã chốt. Số liệu sẵn sàng cho tính lương.`,
      );
      onClose();
    } catch (caught) {
      setError(toUserMessage(caught));
    }
  }

  const risky = selected.filter(
    (id) => (openSheets.find((sheet) => sheet.id === id)?.needsReviewCount ?? 0) > 0,
  ).length;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      onOk={() => void submit()}
      title={`Chốt bảng công tháng ${month}`}
      okText={selected.length > 0 ? `Chốt ${selected.length} bảng` : 'Chốt bảng'}
      cancelText="Huỷ"
      okButtonProps={{ loading: closeSheet.isPending, disabled: selected.length === 0 }}
      width={620}
      destroyOnClose
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {error ? <Alert type="error" showIcon message={error} role="alert" /> : null}

        {openSheets.length === 0 ? (
          <Alert
            type="success"
            showIcon
            message="Mọi bảng của tháng này đã chốt"
            description="Không còn gì để chốt. Muốn sửa số liệu thì mở lại từng bảng ở màn lưới người × ngày."
          />
        ) : (
          <>
            <p className="sf-body-md" style={{ margin: 0 }}>
              Chốt là tuyên bố đã rà xong và bàn giao số liệu cho tính lương. Sau khi chốt, bảng
              không thêm/bớt được CBNV nữa — công vẫn tính lại được cho tới khi kỳ lương chốt.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {openSheets.map((sheet) => (
                <label
                  key={sheet.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '12px 16px',
                    border: '1px solid var(--sf-outline-variant)',
                    borderRadius: 12,
                    cursor: 'pointer',
                  }}
                >
                  <Checkbox
                    checked={selected.includes(sheet.id)}
                    onChange={(event) => toggle(sheet.id, event.target.checked)}
                  />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 600 }}>{sheet.name}</span>
                    <span className="sf-body-sm sf-text-variant">
                      {formatNumber(sheet.memberCount)} CBNV
                    </span>
                  </span>
                  {sheet.needsReviewCount > 0 ? (
                    <Badge tone="warning" soft>
                      {formatNumber(sheet.needsReviewCount)} cần đối soát
                    </Badge>
                  ) : (
                    <Badge tone="success" soft>
                      Đã sạch
                    </Badge>
                  )}
                </label>
              ))}
            </div>

            {/*
              Cảnh báo hiện SAU khi người dùng tự tích, không phải chặn từ đầu:
              chốt bảng còn vướng là việc có thật (cuối kỳ lương phải chốt dù
              còn vài ca chưa rõ), nhưng nó phải là một lựa chọn có ý thức.
            */}
            {risky > 0 ? (
              <div className="sf-banner sf-banner--warning">
                <Icon name="warning" size={20} color="var(--sf-warning-700)" />
                <span className="sf-body-sm">
                  Bạn đang chốt <strong>{risky} bảng còn người chưa đối soát</strong>. Số liệu thiếu
                  của họ sẽ đi thẳng vào bảng lương.
                </span>
              </div>
            ) : null}
          </>
        )}
      </div>
    </Modal>
  );
}
