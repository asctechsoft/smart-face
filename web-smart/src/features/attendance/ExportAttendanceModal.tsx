import { useEffect, useState } from 'react';
import { Alert, DatePicker, Modal, Progress, Radio, Select } from 'antd';
import { toUserMessage } from '@/lib/errors/api-error';
import { toWorkDate } from '@/lib/utils/date';
import { toDayjs } from '@/lib/utils/dayjs';
import { downloadFromUrl } from '@/lib/utils/download';
import { useDepartments } from '@/features/shared/org.api';
import { useExportAttendance, useExportJob } from './attendance.api';
import { useToast } from '@/components/ui';

const { RangePicker } = DatePicker;

/**
 * Xuất bảng công — docs/04 mục 7.4.
 *
 * Xử lý ở Backend, đẩy vào queue, trả link tải có thời hạn. Client chỉ gửi yêu
 * cầu rồi hỏi trạng thái job. Vì sao không xuất tại chỗ: bảng công có công OT,
 * hệ số ngày lễ, phạt luỹ kế — client không nắm đủ luật để tính, và 5000 dòng
 * dựng trong trình duyệt là treo tab.
 */
export function ExportAttendanceModal({
  open,
  defaultFrom,
  defaultTo,
  onClose,
}: {
  open: boolean;
  defaultFrom?: string;
  defaultTo?: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const departments = useDepartments();
  const startExport = useExportAttendance();

  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const [format, setFormat] = useState<'XLSX' | 'CSV'>('XLSX');
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const job = useExportJob(jobId);

  useEffect(() => {
    if (open) {
      setFrom(defaultFrom);
      setTo(defaultTo);
      setDepartmentIds([]);
      setJobId(null);
      setError(null);
    }
  }, [open, defaultFrom, defaultTo]);

  // Tải xuống ngay khi job xong. Người dùng đã bấm "Xuất" một lần rồi — bắt họ
  // bấm thêm lần nữa chỉ vì file phải chạy nền là thừa một bước.
  useEffect(() => {
    if (job.data?.status === 'COMPLETED' && job.data.downloadUrl) {
      downloadFromUrl(job.data.downloadUrl, `bang-cong-${from}-${to}.${format.toLowerCase()}`);
      toast.success('Đã tải file bảng công');
    }
    if (job.data?.status === 'FAILED') {
      setError(job.data.error ?? 'Không tạo được file. Thử thu hẹp khoảng ngày rồi xuất lại.');
    }
  }, [job.data, from, to, format, toast]);

  async function submit() {
    setError(null);
    try {
      const result = await startExport.mutateAsync({
        from,
        to,
        departmentIds: departmentIds.length > 0 ? departmentIds : undefined,
        format,
      });
      setJobId(result.jobId);
    } catch (caught) {
      setError(toUserMessage(caught));
    }
  }

  const running = job.data?.status === 'PENDING' || job.data?.status === 'PROCESSING';
  const done = job.data?.status === 'COMPLETED';

  return (
    <Modal
      open={open}
      onCancel={onClose}
      onOk={() => void submit()}
      title="Xuất bảng công"
      okText={done ? 'Xuất file khác' : 'Bắt đầu xuất'}
      cancelText="Đóng"
      okButtonProps={{
        loading: startExport.isPending || running,
        disabled: !from || !to,
        size: 'large',
      }}
      cancelButtonProps={{ size: 'large' }}
      width={560}
      destroyOnClose
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {error ? <Alert type="error" showIcon message={error} role="alert" /> : null}

        <div>
          <label className="sf-field__label" style={{ display: 'block', marginBottom: 4 }}>
            Khoảng ngày
          </label>
          <RangePicker
            format="DD/MM/YYYY"
            value={[toDayjs(from), toDayjs(to)]}
            onChange={(dates) => {
              setFrom(toWorkDate(dates?.[0]?.toDate()));
              setTo(toWorkDate(dates?.[1]?.toDate()));
            }}
            style={{ width: '100%' }}
          />
        </div>

        <div>
          <label className="sf-field__label" htmlFor="exp-dept" style={{ display: 'block', marginBottom: 4 }}>
            Phòng ban
          </label>
          <Select
            id="exp-dept"
            mode="multiple"
            allowClear
            value={departmentIds}
            onChange={setDepartmentIds}
            loading={departments.isLoading}
            placeholder="Bỏ trống = toàn bộ phạm vi bạn được xem"
            style={{ width: '100%' }}
            options={(departments.data ?? []).map((department) => ({
              value: department.id,
              label: department.name,
            }))}
          />
        </div>

        <div>
          <label className="sf-field__label" style={{ display: 'block', marginBottom: 8 }}>
            Định dạng
          </label>
          <Radio.Group
            value={format}
            onChange={(event) => setFormat(event.target.value as 'XLSX' | 'CSV')}
            optionType="button"
            buttonStyle="solid"
            options={[
              { value: 'XLSX', label: 'Excel (.xlsx)' },
              { value: 'CSV', label: 'CSV' },
            ]}
          />
        </div>

        {jobId ? (
          <div
            style={{
              background: 'var(--sf-neutral-100)',
              borderRadius: 12,
              padding: 16,
            }}
            aria-live="polite"
          >
            <div className="sf-body-md" style={{ fontWeight: 600, marginBottom: 8 }}>
              {running ? 'Đang tạo file...' : done ? 'File đã sẵn sàng' : 'Đang chờ xử lý'}
            </div>
            <Progress
              percent={done ? 100 : (job.data?.progress ?? 30)}
              status={job.data?.status === 'FAILED' ? 'exception' : done ? 'success' : 'active'}
              strokeColor="var(--sf-teal-700)"
            />
            {done && job.data?.downloadUrl ? (
              <a
                href={job.data.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="sf-body-sm"
                style={{ fontWeight: 700 }}
              >
                Tải lại file
              </a>
            ) : (
              <p className="sf-body-sm sf-text-variant" style={{ margin: 0 }}>
                File được xử lý trên máy chủ. Bạn có thể đóng hộp thoại này — liên kết tải sẽ có
                trong mục thông báo khi xong.
              </p>
            )}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
