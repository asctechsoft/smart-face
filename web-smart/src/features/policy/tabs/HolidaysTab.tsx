import { useState } from 'react';
import { Alert, App as AntApp, Button, DatePicker, Input, InputNumber, Modal, Select } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DataTable } from '@/components/DataTable';
import { Icon } from '@/components/Icon';
import { useCan } from '@/lib/rbac/Can';
import { useAuth } from '@/lib/auth/auth-context';
import { formatDay, toWorkDate } from '@/lib/utils/date';
import { toDayjs } from '@/lib/utils/dayjs';
import { toUserMessage } from '@/lib/errors/api-error';
import { useBranches } from '@/features/shared/org.api';
import { useCreateHoliday, useDeleteHoliday, useHolidays, type Holiday } from '../policy.api';

/**
 * Danh mục ngày nghỉ lễ — `FR-WEB-POL-06`.
 *
 * Trường `substituteDate` xử lý bẫy ở docs/04 mục 6.4: 30/04 rơi vào Chủ nhật
 * thì nghỉ bù thứ Hai. Hai ngày này có ý nghĩa khác nhau với engine tính công —
 * hệ số OT áp theo ngày gốc hay ngày bù là quyết định của công ty, nên cả hai
 * đều phải khai được.
 */
export function HolidaysTab() {
  const { timezone } = useAuth();
  const { message } = AntApp.useApp();
  const canEdit = useCan('policy.edit');

  const [year, setYear] = useState(new Date().getFullYear());
  const [formOpen, setFormOpen] = useState(false);

  const holidays = useHolidays(year);
  const remove = useDeleteHoliday();

  const columns: ColumnsType<Holiday> = [
    { title: 'Tên ngày lễ', dataIndex: 'name', key: 'name', width: 240 },
    {
      title: 'Ngày',
      dataIndex: 'date',
      key: 'date',
      width: 140,
      render: (value: string) => formatDay(value, timezone),
    },
    {
      title: 'Nghỉ bù',
      dataIndex: 'substituteDate',
      key: 'substitute',
      width: 140,
      render: (value: string | null) =>
        value ? formatDay(value, timezone) : <span className="sf-text-muted">—</span>,
    },
    {
      title: 'Hệ số OT',
      dataIndex: 'otMultiplier',
      key: 'multiplier',
      width: 120,
      align: 'right',
      render: (value: string | number) => `${Math.round(Number(value) * 100)}%`,
    },
    {
      title: 'Phạm vi',
      dataIndex: 'branchIds',
      key: 'branches',
      width: 200,
      render: (value: string[]) =>
        value.length === 0 ? 'Toàn công ty' : `${value.length} chi nhánh`,
    },
    ...(canEdit
      ? [
          {
            title: '',
            key: 'actions',
            width: 100,
            render: (_: unknown, row: Holiday) => (
              <Button
                size="small"
                type="text"
                danger
                onClick={() =>
                  Modal.confirm({
                    title: `Xoá ngày lễ "${row.name}"?`,
                    content:
                      'Bảng công của ngày này sẽ được tính như ngày làm việc bình thường ở lần tính lại tiếp theo.',
                    okText: 'Xoá',
                    okButtonProps: { danger: true },
                    cancelText: 'Huỷ',
                    onOk: async () => {
                      try {
                        await remove.mutateAsync(row.id);
                        message.success('Đã xoá ngày lễ.');
                      } catch (caught) {
                        message.error(toUserMessage(caught));
                      }
                    },
                  })
                }
              >
                Xoá
              </Button>
            ),
          } as ColumnsType<Holiday>[number],
        ]
      : []),
  ];

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between', marginBottom: 16 }}>
        <Select
          value={year}
          onChange={setYear}
          style={{ width: 140 }}
          aria-label="Chọn năm"
          options={Array.from({ length: 5 }, (_, index) => {
            const value = new Date().getFullYear() - 1 + index;
            return { value, label: `Năm ${value}` };
          })}
        />

        {canEdit ? (
          <Button type="primary" icon={<Icon name="add" size={20} />} onClick={() => setFormOpen(true)}>
            Thêm ngày lễ
          </Button>
        ) : null}
      </div>

      <DataTable<Holiday>
        rowKey="id"
        data={holidays.data}
        isLoading={holidays.isLoading}
        error={holidays.error}
        onRetry={() => void holidays.refetch()}
        columns={columns}
        pagination={false}
        emptyIcon="calendar_month"
        emptyTitle={`Chưa khai ngày lễ nào cho năm ${year}`}
        emptyDescription="Không khai ngày lễ thì các ngày đó được tính như ngày làm việc bình thường, và hệ số OT ngày lễ không được áp dụng."
        emptyAction={
          canEdit ? (
            <Button type="primary" size="large" onClick={() => setFormOpen(true)}>
              Thêm ngày lễ
            </Button>
          ) : undefined
        }
      />

      <HolidayFormModal open={formOpen} year={year} onClose={() => setFormOpen(false)} />
    </div>
  );
}

function HolidayFormModal({
  open,
  year,
  onClose,
}: {
  open: boolean;
  year: number;
  onClose: () => void;
}) {
  const { message } = AntApp.useApp();
  const branches = useBranches();
  const create = useCreateHoliday();

  const [name, setName] = useState('');
  const [date, setDate] = useState<string | undefined>();
  const [substituteDate, setSubstituteDate] = useState<string | undefined>();
  const [otMultiplier, setOtMultiplier] = useState(3);
  const [branchIds, setBranchIds] = useState<string[]>([]);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={`Thêm ngày lễ · năm ${year}`}
      okText="Lưu ngày lễ"
      cancelText="Huỷ bỏ"
      okButtonProps={{ size: 'large', loading: create.isPending, disabled: !name.trim() || !date }}
      cancelButtonProps={{ size: 'large' }}
      destroyOnClose
      afterOpenChange={(isOpen) => {
        if (isOpen) {
          setName('');
          setDate(undefined);
          setSubstituteDate(undefined);
          setOtMultiplier(3);
          setBranchIds([]);
        }
      }}
      onOk={async () => {
        try {
          await create.mutateAsync({
            name: name.trim(),
            date: date as string,
            substituteDate,
            otMultiplier,
            branchIds,
          });
          message.success('Đã thêm ngày lễ.');
          onClose();
        } catch (caught) {
          message.error(toUserMessage(caught));
        }
      }}
    >
      <div style={{ display: 'grid', gap: 16 }}>
        <div>
          <label className="sf-label-md" htmlFor="h-name" style={{ display: 'block', marginBottom: 4 }}>
            Tên ngày lễ
          </label>
          <Input
            id="h-name"
            size="large"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Quốc khánh 2/9"
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label className="sf-label-md" htmlFor="h-date" style={{ display: 'block', marginBottom: 4 }}>
              Ngày lễ
            </label>
            <DatePicker
              id="h-date"
              size="large"
              format="DD/MM/YYYY"
              style={{ width: '100%' }}
              value={toDayjs(date)}
              onChange={(value) => setDate(toWorkDate(value?.toDate()))}
            />
          </div>

          <div>
            <label className="sf-label-md" htmlFor="h-sub" style={{ display: 'block', marginBottom: 4 }}>
              Ngày nghỉ bù
            </label>
            <DatePicker
              id="h-sub"
              size="large"
              format="DD/MM/YYYY"
              style={{ width: '100%' }}
              value={toDayjs(substituteDate)}
              onChange={(value) => setSubstituteDate(toWorkDate(value?.toDate()))}
            />
          </div>
        </div>

        <Alert
          type="info"
          showIcon
          message="Khi nào cần khai ngày nghỉ bù"
          description="Ngày lễ rơi vào cuối tuần thì người lao động được nghỉ bù vào ngày làm việc kế tiếp. Khai cả hai để engine tính công biết ngày nào nghỉ và ngày nào áp hệ số."
        />

        <div>
          <label className="sf-label-md" htmlFor="h-mul" style={{ display: 'block', marginBottom: 4 }}>
            Hệ số OT áp dụng
          </label>
          <InputNumber
            id="h-mul"
            size="large"
            style={{ width: '100%' }}
            min={1}
            step={0.5}
            value={otMultiplier}
            onChange={(value) => setOtMultiplier(value ?? 3)}
          />
          <p className="sf-body-sm sf-text-variant" style={{ margin: '4px 0 0' }}>
            Bộ luật Lao động Việt Nam quy định làm việc ngày lễ hưởng tối thiểu 300% (hệ số 3.0).
          </p>
        </div>

        <div>
          <label className="sf-label-md" htmlFor="h-branch" style={{ display: 'block', marginBottom: 4 }}>
            Áp dụng cho chi nhánh
          </label>
          <Select
            id="h-branch"
            size="large"
            mode="multiple"
            allowClear
            style={{ width: '100%' }}
            value={branchIds}
            onChange={setBranchIds}
            loading={branches.isLoading}
            placeholder="Bỏ trống = toàn công ty"
            options={(branches.data ?? []).map((branch) => ({
              value: branch.id,
              label: branch.name,
            }))}
          />
        </div>
      </div>
    </Modal>
  );
}
