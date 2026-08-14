import { useState } from 'react';
import { Alert, Button, Modal, Steps, Switch, Table, Upload } from 'antd';
import type { UploadFile } from 'antd';
import { Icon } from '@/components/Icon';
import { StatusBadge } from '@/components/StatusBadge';
import { toUserMessage } from '@/lib/errors/api-error';
import { downloadCsv } from '@/lib/utils/download';
import {
  useExecuteImport,
  useValidateImport,
  type ImportRow,
  type ImportValidationResult,
} from './employees.api';
import { useToast } from '@/components/ui';

/**
 * Import nhân viên hàng loạt — docs/04 mục 8.2 (`FR-WEB-HR-10`).
 *
 * Nguyên tắc chi phối toàn bộ màn hình: **import không bao giờ fail toàn bộ file
 * vì một dòng lỗi.** Vì vậy luồng có ba bước, và bước giữa là bắt buộc:
 *
 *   1. Chọn file  → đọc CSV tại client
 *   2. Kiểm tra   → Backend trả bảng kết quả TỪNG DÒNG, hợp lệ và lỗi rõ ràng
 *   3. Import     → chỉ tạo các dòng hợp lệ, xuất file kết quả
 *
 * Bỏ bước 2 nghĩa là kế toán tải lên 200 dòng rồi nhận một thông báo "file không
 * hợp lệ" mà không biết dòng nào sai.
 */
export function ImportEmployeesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const validate = useValidateImport();
  const execute = useExecuteImport();

  const [step, setStep] = useState(0);
  const [validation, setValidation] = useState<ImportValidationResult | null>(null);
  const [sendInvite, setSendInvite] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fileList, setFileList] = useState<UploadFile[]>([]);

  function resetAll() {
    setStep(0);
    setValidation(null);
    setError(null);
    setFileList([]);
  }

  async function handleFile(file: File): Promise<false> {
    setError(null);
    try {
      const text = await file.text();
      const parsed = parseCsv(text);

      if (parsed.length === 0) {
        setError('File không có dòng dữ liệu nào. Kiểm tra lại tiêu đề cột và nội dung.');
        return false;
      }

      const result = await validate.mutateAsync(parsed);
      setValidation(result);
      setStep(1);
    } catch (caught) {
      setError(toUserMessage(caught));
    }
    // Trả `false` để antd không tự upload — file được đọc và gửi qua API riêng.
    return false;
  }

  async function runImport() {
    if (!validation) return;
    const validRows = validation.rows
      .filter((row) => row.valid)
      .map(({ valid: _valid, errors: _errors, generatedCode: _code, ...rest }) => rest);

    try {
      const result = await execute.mutateAsync({ rows: validRows, sendInvite });
      setStep(2);
      toast.success(`Đã tạo ${result.createdCount} nhân viên`);

      if (result.failedCount > 0) {
        downloadCsv(
          result.failed.map((item) => ({ dong: item.rowNumber, loi: item.message })),
          'ket-qua-import-loi.csv',
          { dong: 'Dòng', loi: 'Lỗi' },
        );
      }
    } catch (caught) {
      setError(toUserMessage(caught));
    }
  }

  return (
    <Modal
      open={open}
      onCancel={() => {
        resetAll();
        onClose();
      }}
      title="Import nhân viên từ file"
      width={880}
      destroyOnClose
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Button type="link" onClick={downloadTemplate} icon={<Icon name="download" size={18} />}>
            Tải file mẫu
          </Button>

          <div style={{ display: 'flex', gap: 12 }}>
            <Button
              size="large"
              onClick={() => {
                resetAll();
                onClose();
              }}
            >
              Đóng
            </Button>
            {step === 1 ? (
              <Button
                type="primary"
                size="large"
                loading={execute.isPending}
                disabled={!validation || validation.validCount === 0}
                onClick={() => void runImport()}
              >
                Import {validation?.validCount ?? 0} dòng hợp lệ
              </Button>
            ) : null}
          </div>
        </div>
      }
    >
      <Steps
        current={step}
        size="small"
        style={{ marginBottom: 24 }}
        items={[
          { title: 'Chọn file' },
          { title: 'Kiểm tra dữ liệu' },
          { title: 'Hoàn tất' },
        ]}
      />

      {error ? (
        <Alert type="error" showIcon message={error} role="alert" style={{ marginBottom: 16 }} />
      ) : null}

      {step === 0 ? (
        <div>
          <Upload.Dragger
            accept=".csv,text/csv"
            maxCount={1}
            fileList={fileList}
            beforeUpload={(file) => {
              setFileList([file as unknown as UploadFile]);
              return handleFile(file as unknown as File);
            }}
            onRemove={() => {
              resetAll();
              return true;
            }}
          >
            <p style={{ marginBottom: 8 }}>
              <Icon name="upload_file" size={32} color="var(--sf-teal-700)" />
            </p>
            <p className="sf-title-md" style={{ marginBottom: 4 }}>
              Kéo thả file vào đây hoặc bấm để chọn
            </p>
            <p className="sf-body-sm sf-text-variant">
              Định dạng CSV, mã hoá UTF-8. Tải file mẫu ở góc dưới bên trái để đúng thứ tự cột.
            </p>
          </Upload.Dragger>

          <div style={{ marginTop: 16 }}>
            <h4 className="sf-title-sm">Cột bắt buộc</h4>
            <p className="sf-body-sm sf-text-variant" style={{ margin: '4px 0 0' }}>
              Họ và tên · Số điện thoại · Phòng ban. Các cột Chức vụ, Ngày vào làm, Loại hợp đồng là
              tuỳ chọn.
            </p>
          </div>
        </div>
      ) : null}

      {step === 1 && validation ? (
        <div>
          <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
            <Alert
              type="success"
              showIcon
              style={{ flex: 1 }}
              message={`${validation.validCount} dòng hợp lệ`}
            />
            {validation.invalidCount > 0 ? (
              <Alert
                type="error"
                showIcon
                style={{ flex: 1 }}
                message={`${validation.invalidCount} dòng có lỗi`}
                description="Các dòng này sẽ bị bỏ qua. Sửa file rồi tải lên lại nếu muốn import đủ."
              />
            ) : null}
          </div>

          <Table
            className="sf-table-compact"
            rowKey="rowNumber"
            size="small"
            dataSource={validation.rows}
            pagination={{ pageSize: 10, showSizeChanger: false }}
            scroll={{ x: 'max-content', y: 320 }}
            columns={[
              { title: 'Dòng', dataIndex: 'rowNumber', width: 70 },
              { title: 'Họ tên', dataIndex: 'fullName', width: 180 },
              { title: 'SĐT', dataIndex: 'phone', width: 130 },
              { title: 'Phòng ban', dataIndex: 'departmentName', width: 150 },
              {
                title: 'Mã sinh ra',
                dataIndex: 'generatedCode',
                width: 150,
                render: (value: string | null) => value ?? <span className="sf-text-muted">—</span>,
              },
              {
                title: 'Trạng thái',
                key: 'status',
                width: 260,
                render: (_, row) =>
                  row.valid ? (
                    <StatusBadge tone="success">Hợp lệ</StatusBadge>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {row.errors.map((error) => (
                        <StatusBadge key={error} tone="error">
                          {error}
                        </StatusBadge>
                      ))}
                    </div>
                  ),
              },
            ]}
          />

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              marginTop: 16,
              padding: 12,
              background: 'var(--sf-neutral-100)',
              borderRadius: 12,
            }}
          >
            <div>
              <div className="sf-body-md" style={{ fontWeight: 600 }}>
                Gửi tin nhắn mời cho các nhân viên vừa tạo
              </div>
              <div className="sf-body-sm sf-text-variant">
                Tin nhắn được gửi qua hàng đợi, không làm chậm quá trình import.
              </div>
            </div>
            <Switch checked={sendInvite} onChange={setSendInvite} aria-label="Gửi lời mời hàng loạt" />
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div style={{ textAlign: 'center', padding: 32 }}>
          <Icon name="check_circle" size={32} color="var(--sf-success-600)" fill />
          <h3 className="sf-title-md" style={{ marginTop: 16 }}>
            Import hoàn tất
          </h3>
          <p className="sf-body-md sf-text-variant">
            Nhân viên mới ở trạng thái Chờ kích hoạt. Họ trở thành Đang làm việc sau khi hoàn tất
            thiết lập bảo mật trên ứng dụng.
          </p>
          <Button style={{ marginTop: 16 }} onClick={resetAll}>
            Import file khác
          </Button>
        </div>
      ) : null}
    </Modal>
  );
}

function downloadTemplate() {
  downloadCsv(
    [
      {
        fullName: 'Nguyễn Văn Đức',
        phone: '0901234567',
        departmentName: 'Kỹ thuật',
        position: 'Nhân viên',
        joinedAt: '2026-08-01',
        contractType: 'Chính thức',
      },
    ],
    'mau-import-nhan-vien.csv',
    {
      fullName: 'Họ và tên',
      phone: 'Số điện thoại',
      departmentName: 'Phòng ban',
      position: 'Chức vụ',
      joinedAt: 'Ngày vào làm',
      contractType: 'Loại hợp đồng',
    },
  );
}

/**
 * Đọc CSV đơn giản (có xử lý ô bọc trong dấu nháy kép).
 *
 * Không dùng thư viện parse CSV đầy đủ vì file mẫu do chính hệ thống phát hành,
 * cấu trúc đã biết trước. Điều quan trọng hơn: mọi kiểm tra nghiệp vụ (SĐT hợp
 * lệ, trùng lặp, phòng ban tồn tại) đều do Backend làm — client chỉ tách chuỗi.
 */
function parseCsv(text: string): ImportRow[] {
  const lines = text
    // Excel luôn ghi BOM ở đầu file CSV. Không bỏ đi thì ô đầu tiên của dòng
    // tiêu đề mang thêm một ký tự vô hình và mọi so khớp cột đều trượt.
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  if (lines.length < 2) return [];

  return lines.slice(1).map((line, index) => {
    const cells = splitCsvLine(line);
    return {
      rowNumber: index + 2, // +2: dòng 1 là tiêu đề, người dùng đếm từ 1
      fullName: cells[0] ?? '',
      phone: cells[1] ?? '',
      departmentName: cells[2] || undefined,
      position: cells[3] || undefined,
      joinedAt: normalizeDate(cells[4]),
      contractType: cells[5] || undefined,
    };
  });
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

/** Chấp nhận cả `01/08/2026` (quen thuộc với người Việt) lẫn `2026-08-01`. */
function normalizeDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const slashed = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (slashed) return `${slashed[3]}-${slashed[2]}-${slashed[1]}`;
  return value;
}
