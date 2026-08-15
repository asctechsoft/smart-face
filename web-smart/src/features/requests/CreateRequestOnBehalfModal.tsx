import { useMemo, useState } from 'react';
import { Alert, DatePicker, Input, Modal, Select, Switch, TimePicker } from 'antd';
import { EMPLOYABLE_STATUSES, REASON_MIN_LENGTH } from '@/config/constants';
import { toDayjs, toDayjsTime } from '@/lib/utils/dayjs';
import { useEmployeeList } from '@/features/employees/employees.api';
import { useApprovalPreview, useCreateRequestOnBehalf, useRequestTypes } from './requests.api';

/**
 * Giá trị giả cho lựa chọn "bỏ trống người duyệt".
 *
 * `<Select>` của antd coi `undefined` là "chưa chọn gì" và hiện placeholder, nên
 * không dùng `undefined` để biểu đạt một lựa chọn CÓ CHỦ ĐÍCH được. Chuỗi này
 * chỉ sống trong state của form và bị lọc bỏ trước khi gửi lên máy chủ.
 */
const ANY_APPROVER = '__ANY__';
import { Field, useToast } from '@/components/ui';
import { useErrorToast } from '@/lib/errors/use-error-toast';

/**
 * HR / Quản lý tạo đơn THAY MẶT nhân viên — `FR-WEB-REQ-09`.
 *
 * ## Vì sao màn này tồn tại
 *
 * Nhân viên nghỉ ốm đột xuất, nộp đơn giấy, hoặc chưa cài ứng dụng thì đơn không
 * bao giờ vào hệ thống. Trước đây HR chữa bằng Hiệu chỉnh công — nhưng hiệu
 * chỉnh công sửa BẢNG CÔNG, nó KHÔNG trừ ngày phép. Cuối năm số dư phép lệch
 * khỏi thực tế mà không truy được từ đâu.
 *
 * ## Hai ô lý do, không phải một
 *
 * `reason` là lời khai của NHÂN VIÊN ("Việc gia đình") — nó đi vào nội dung đơn
 * và người duyệt đọc nó để ra quyết định. `onBehalfReason` trả lời câu hỏi khác
 * hẳn, dành cho người đọc nhật ký kiểm toán sáu tháng sau: vì sao đơn này không
 * do chính nhân viên gửi?
 *
 * Gộp hai ô làm một thì mất một trong hai thông tin, và thông tin mất đi luôn là
 * cái thứ hai — cái duy nhất giải thích được vì sao có một đơn không ai ký.
 */
export function CreateRequestOnBehalfModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const showError = useErrorToast();
  const create = useCreateRequestOnBehalf();

  const requestTypes = useRequestTypes();
  // Chỉ tải khi hộp thoại mở — trang bên dưới không cần danh sách này.
  // `pageSize` trần của API là 100; gửi lớn hơn bị ép về 100 chứ không báo lỗi.
  const employees = useEmployeeList(
    open ? { pageSize: 100, status: EMPLOYABLE_STATUSES } : { pageSize: 1 },
  );

  const [employeeId, setEmployeeId] = useState<string | undefined>();
  const [requestTypeCode, setRequestTypeCode] = useState<string | undefined>();
  const [range, setRange] = useState<{ from?: string; to?: string }>({});
  const [isHalfDay, setIsHalfDay] = useState(false);
  /** Đơn tính theo GIỜ: một ngày + giờ bắt đầu / kết thúc. */
  const [hourDay, setHourDay] = useState<string | undefined>();
  const [hourFrom, setHourFrom] = useState<string | undefined>();
  const [hourTo, setHourTo] = useState<string | undefined>();
  const [reason, setReason] = useState('');
  const [onBehalfReason, setOnBehalfReason] = useState('');
  /** Người duyệt do người dùng chọn, theo `order` của bước. Rỗng = để hệ thống suy. */
  const [approvers, setApprovers] = useState<Record<number, string>>({});

  const selectedType = useMemo(
    () => requestTypes.data?.find((type) => type.code === requestTypeCode) ?? null,
    [requestTypes.data, requestTypeCode],
  );

  /**
   * Đơn tính theo GIỜ cần GIỜ, không phải khoảng ngày.
   *
   * `computeQuantity` phía Backend lấy hiệu hai mốc thời gian chia 3.600.000 khi
   * `unit === 'HOUR'`. Đưa một khoảng NGÀY vào đó cho ra những con số vô nghĩa —
   * chọn 14/08 đến 16/08 cho đơn làm bù thành "làm bù 72 giờ", và con số đó đi
   * thẳng vào sổ công làm bù.
   *
   * Bốn loại đơn đang tính theo giờ: làm bù, xin ra ngoài, về sớm, đăng ký OT.
   */
  const byHour = selectedType?.unit === 'HOUR';

  const startAt = byHour
    ? hourDay && hourFrom
      ? `${hourDay}T${hourFrom}:00+07:00`
      : undefined
    : range.from
      ? `${range.from}T00:00:00+07:00`
      : undefined;

  const endAt = byHour
    ? hourDay && hourTo
      ? `${hourDay}T${hourTo}:00+07:00`
      : undefined
    : range.to
      ? `${range.to}T23:59:59+07:00`
      : undefined;

  /** Số giờ đơn khai — hiện ngay để người nhập thấy con số Backend sẽ tính. */
  const hourQuantity =
    startAt && endAt && byHour
      ? Math.round(((new Date(endAt).getTime() - new Date(startAt).getTime()) / 3_600_000) * 100) /
        100
      : null;

  const preview = useApprovalPreview({
    employeeId,
    requestTypeCode,
    startAt,
    endAt,
    isHalfDay,
  });

  const reasonOk = reason.trim().length > 0;
  const onBehalfOk = onBehalfReason.trim().length >= REASON_MIN_LENGTH;
  const timeOk = !byHour || (hourQuantity !== null && hourQuantity > 0);
  const canSubmit =
    Boolean(employeeId && requestTypeCode && startAt && endAt) && timeOk && reasonOk && onBehalfOk;

  function reset() {
    setEmployeeId(undefined);
    setRequestTypeCode(undefined);
    setRange({});
    setIsHalfDay(false);
    setHourDay(undefined);
    setHourFrom(undefined);
    setHourTo(undefined);
    setReason('');
    setOnBehalfReason('');
    setApprovers({});
  }

  return (
    <Modal
      open={open}
      title="Tạo đơn thay mặt nhân viên"
      okText="Tạo đơn"
      cancelText="Huỷ bỏ"
      okButtonProps={{ loading: create.isPending, disabled: !canSubmit }}
      width={640}
      destroyOnClose
      afterOpenChange={(isOpen) => {
        if (isOpen) reset();
      }}
      onCancel={onClose}
      onOk={async () => {
        if (!employeeId || !requestTypeCode || !startAt || !endAt) return;
        try {
          await create.mutateAsync({
            employeeId,
            requestTypeCode,
            // Kèm offset múi giờ: gửi `2026-08-10T00:00:00` trần thì máy chủ hiểu
            // là giờ UTC, thành 07:00 sáng giờ Việt Nam — đơn nghỉ cả ngày biến
            // thành nghỉ từ 7 giờ, và ngày cuối lệch sang hôm sau.
            startAt,
            endAt,
            isHalfDay,
            reason: reason.trim(),
            onBehalfReason: onBehalfReason.trim(),
            // Chỉ gửi những bước NGƯỜI DÙNG thực sự chọn. Gửi kèm cả gợi ý của
            // hệ thống sẽ đóng đinh người duyệt vào đơn — trong khi để trống có
            // nghĩa khác hẳn: "ai giữ vai trò này cũng duyệt được", nên người
            // duyệt nghỉ phép thì đơn vẫn chạy tiếp.
            ...(Object.keys(approvers).length > 0
              ? {
                  approvers: Object.entries(approvers).map(([order, approverId]) => ({
                    order: Number(order),
                    approverId,
                  })),
                }
              : {}),
          });
          toast.success(
            'Đã tạo đơn và gửi đi duyệt',
            'Đơn nằm ở hàng chờ của người duyệt như mọi đơn khác. Màn chi tiết ghi rõ đơn này do bạn nhập hộ.',
          );
          onClose();
        } catch (caught) {
          showError(caught);
        }
      }}
    >
      <div style={{ display: 'grid', gap: 16 }}>
        <Alert
          type="info"
          showIcon
          message="Đơn vẫn đi qua luồng duyệt bình thường"
          description="Bạn nhập hộ, không phải duyệt hộ. Đơn vào trạng thái Chờ duyệt và người duyệt sẽ nhìn thấy đây là đơn do bạn nhập thay nhân viên."
        />

        <Field label="Nhân viên" htmlFor="ob-emp" required>
          <Select
            id="ob-emp"
            showSearch
            optionFilterProp="label"
            style={{ width: '100%' }}
            placeholder="Tìm theo tên hoặc mã nhân viên"
            loading={employees.isLoading}
            value={employeeId}
            onChange={setEmployeeId}
            options={(employees.data?.items ?? []).map((employee) => ({
              value: employee.id,
              label: `${employee.fullName} · ${employee.employeeCode}`,
            }))}
          />
        </Field>

        <Field label="Loại đơn" htmlFor="ob-type" required>
          <Select
            id="ob-type"
            style={{ width: '100%' }}
            placeholder="Chọn loại đơn"
            loading={requestTypes.isLoading}
            value={requestTypeCode}
            onChange={(value) => {
              setRequestTypeCode(value);
              setIsHalfDay(false);
            }}
            options={(requestTypes.data ?? []).map((type) => ({
              value: type.code,
              label: type.name,
            }))}
          />
          {selectedType?.deductFrom === 'ANNUAL_LEAVE' ? (
            <p className="sf-body-sm sf-text-variant" style={{ margin: '4px 0 0' }}>
              Loại đơn này trừ vào quỹ phép năm. Hệ thống sẽ từ chối nếu nhân viên không còn đủ
              phép.
            </p>
          ) : null}
          {selectedType?.requiresAttachment ? (
            <p className="sf-body-sm" style={{ margin: '4px 0 0', color: 'var(--sf-warning-800)' }}>
              Loại đơn này bắt buộc có minh chứng. Tạo xong hãy mở đơn và đính kèm file trước khi
              người duyệt xử lý.
            </p>
          ) : null}
        </Field>

        {byHour ? (
          <Field label="Ngày và giờ" required>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <DatePicker
                format="DD/MM/YYYY"
                style={{ flex: '1 1 160px' }}
                placeholder="Ngày"
                value={toDayjs(hourDay)}
                onChange={(date) => setHourDay(date?.format('YYYY-MM-DD'))}
                aria-label="Ngày"
              />
              <TimePicker
                format="HH:mm"
                minuteStep={15}
                style={{ flex: '1 1 120px' }}
                placeholder="Từ giờ"
                value={toDayjsTime(hourFrom)}
                onChange={(time) => setHourFrom(time?.format('HH:mm'))}
                aria-label="Từ giờ"
              />
              <TimePicker
                format="HH:mm"
                minuteStep={15}
                style={{ flex: '1 1 120px' }}
                placeholder="Đến giờ"
                value={toDayjsTime(hourTo)}
                onChange={(time) => setHourTo(time?.format('HH:mm'))}
                aria-label="Đến giờ"
              />
            </div>

            {/*
              Hiện luôn con số Backend sẽ tính. Đây là số đi thẳng vào sổ công
              làm bù — người nhập phải đối chiếu được với chứng từ trước khi bấm,
              chứ không phải phát hiện sai sau khi đơn đã duyệt.
            */}
            {hourQuantity !== null ? (
              hourQuantity > 0 ? (
                <p className="sf-body-sm" style={{ margin: '8px 0 0', fontWeight: 600 }}>
                  Đơn khai {hourQuantity} giờ
                  {selectedType?.deductFrom === 'MAKEUP_CREDIT'
                    ? ` — sẽ trừ ${Math.round(hourQuantity * 60)} phút vào khoản nợ công cũ nhất`
                    : ''}
                </p>
              ) : (
                <p
                  className="sf-body-sm"
                  style={{ margin: '8px 0 0', color: 'var(--sf-error-700)' }}
                >
                  Giờ kết thúc phải sau giờ bắt đầu.
                </p>
              )
            ) : null}
          </Field>
        ) : (
          <>
            <Field label="Khoảng thời gian nghỉ" required>
              <DatePicker.RangePicker
                format="DD/MM/YYYY"
                style={{ width: '100%' }}
                value={[toDayjs(range.from), toDayjs(range.to)]}
                onChange={(dates) =>
                  setRange({
                    from: dates?.[0]?.format('YYYY-MM-DD'),
                    to: dates?.[1]?.format('YYYY-MM-DD'),
                  })
                }
              />
            </Field>

            {selectedType?.unit === 'HALF_DAY' || selectedType?.unit === 'DAY' ? (
              <Field label="Nghỉ nửa ngày" htmlFor="ob-half">
                <Switch id="ob-half" checked={isHalfDay} onChange={setIsHalfDay} />
              </Field>
            ) : null}
          </>
        )}

        {/*
          Luồng duyệt hiện NGAY SAU khoảng ngày, không đặt cuối form.

          Số bước duyệt phụ thuộc ĐỘ DÀI đơn — nghỉ 1 ngày chỉ cần trưởng phòng,
          từ 3 ngày trở lên mới thêm bước HR (docs/04 mục 4.1). Người nhập hộ
          không đoán được điều đó, và đặt khối này ở cuối form thì họ gõ xong hai
          ô lý do rồi mới phát hiện đơn đi sai đường.
        */}
        {preview.isFetching ? (
          <div className="sf-body-sm sf-text-variant">Đang dựng luồng duyệt…</div>
        ) : preview.data ? (
          <Field label="Luồng duyệt">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {preview.data.steps.map((step) => (
                <div key={step.order} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span
                    aria-hidden="true"
                    style={{
                      flexShrink: 0,
                      width: 24,
                      height: 24,
                      borderRadius: 9999,
                      display: 'grid',
                      placeItems: 'center',
                      background: 'var(--sf-teal-700)',
                      color: '#FFFFFF',
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    {step.order}
                  </span>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="sf-body-sm" style={{ fontWeight: 600, marginBottom: 4 }}>
                      {step.approverRoleLabel}
                    </div>
                    <Select
                      style={{ width: '100%' }}
                      showSearch
                      optionFilterProp="label"
                      value={approvers[step.order] ?? step.suggestedApproverId ?? ANY_APPROVER}
                      onChange={(value: string) =>
                        setApprovers((previous) => {
                          const next = { ...previous };
                          // `ANY_APPROVER` không phải một người — nó là "bỏ trống",
                          // nên phải XOÁ khoá chứ không lưu chuỗi đó xuống server.
                          if (value === ANY_APPROVER) delete next[step.order];
                          else next[step.order] = value;
                          return next;
                        })
                      }
                      options={[
                        {
                          value: ANY_APPROVER,
                          label: `Bất kỳ ai là ${step.approverRoleLabel.toLowerCase()}`,
                        },
                        ...step.candidates.map((candidate) => ({
                          value: candidate.id,
                          label: `${candidate.fullName} · ${candidate.employeeCode}`,
                        })),
                      ]}
                    />
                  </div>
                </div>
              ))}
            </div>

            <p className="sf-body-sm sf-text-variant" style={{ margin: '8px 0 0' }}>
              {preview.data.steps.length === 0
                ? 'Loại đơn này chưa cấu hình luồng duyệt.'
                : 'Để “Bất kỳ ai” thì ai giữ vai trò đó cũng duyệt được — người duyệt nghỉ phép thì đơn vẫn chạy tiếp. Chỉ định đích danh khi cần đúng một người xử lý.'}
            </p>
          </Field>
        ) : preview.isError ? (
          <Alert
            type="warning"
            showIcon
            message="Chưa dựng được luồng duyệt"
            description="Đơn vẫn tạo được — hệ thống sẽ tự xác định người duyệt theo cấu hình của loại đơn."
          />
        ) : null}

        <Field label="Lý do nghỉ của nhân viên" htmlFor="ob-reason" required>
          <Input.TextArea
            id="ob-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            maxLength={500}
            showCount
            placeholder="VD: Việc gia đình"
          />
          <p className="sf-body-sm sf-text-variant" style={{ margin: '4px 0 0' }}>
            Chép đúng lý do nhân viên khai. Người duyệt đọc dòng này để ra quyết định.
          </p>
        </Field>

        <Field label="Vì sao bạn nhập hộ" htmlFor="ob-note" required>
          <Input.TextArea
            id="ob-note"
            value={onBehalfReason}
            onChange={(event) => setOnBehalfReason(event.target.value)}
            rows={2}
            maxLength={500}
            showCount
            placeholder="VD: Nhân viên nộp đơn giấy ngày 12/08, chưa cài ứng dụng."
            status={onBehalfReason.length > 0 && !onBehalfOk ? 'error' : undefined}
            aria-invalid={onBehalfReason.length > 0 && !onBehalfOk}
          />
          <p className="sf-body-sm sf-text-variant" style={{ margin: '4px 0 0' }}>
            Tối thiểu {REASON_MIN_LENGTH} ký tự, được ghi vào nhật ký kiểm toán và hiện trên màn chi
            tiết đơn.
          </p>
        </Field>
      </div>
    </Modal>
  );
}
