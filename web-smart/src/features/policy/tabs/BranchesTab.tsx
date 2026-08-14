import { useState } from 'react';
import { Alert, Button, Input, InputNumber, Modal, Select, Slider } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DataTable } from '@/components/DataTable';
import { Icon } from '@/components/Icon';
import { useCan } from '@/lib/rbac/Can';
import { useBranches, type Branch } from '@/features/shared/org.api';
import { useUpsertBranch } from '../policy.api';
import { useToast } from '@/components/ui';
import { useErrorToast } from '@/lib/errors/use-error-toast';

/**
 * Chi nhánh & geofence — `FR-WEB-POL-09`, docs/04 mục 11.1.
 *
 * Ba lớp xác thực vị trí, mạnh yếu rất khác nhau, và giao diện phải nói rõ điều
 * đó để HR không khai nhầm:
 *
 *   Toạ độ + bán kính — chốt cơ bản, GPS sai số 20–50m trong nhà
 *   BSSID WiFi        — App tự khai, app đã bị sửa khai được bất cứ thứ gì
 *   Dải IP công cộng  — MẠNH NHẤT: server tự quan sát từ kết nối, client không khai được
 *
 * Ô IP có cảnh báo riêng vì nhầm lẫn phổ biến nhất là khai dải nội bộ
 * `192.168.x.x` — địa chỉ mà máy chủ không bao giờ nhìn thấy.
 */
export function BranchesTab() {
  const canEdit = useCan('policy.edit');
  const branches = useBranches();
  const [editing, setEditing] = useState<Partial<Branch> | null>(null);

  const columns: ColumnsType<Branch> = [
    {
      title: 'Chi nhánh',
      key: 'name',
      width: 220,
      render: (_, row) => (
        <div>
          <div className="sf-body-md" style={{ fontWeight: 600 }}>
            {row.name}
          </div>
          <div className="sf-body-sm sf-text-variant">{row.address ?? 'Chưa có địa chỉ'}</div>
        </div>
      ),
    },
    {
      title: 'Toạ độ',
      key: 'coords',
      width: 200,
      render: (_, row) =>
        row.latitude !== null && row.longitude !== null ? (
          <a
            href={`https://www.google.com/maps?q=${row.latitude},${row.longitude}`}
            target="_blank"
            rel="noopener noreferrer"
            className="sf-body-sm"
          >
            {row.latitude.toFixed(5)}, {row.longitude.toFixed(5)}
          </a>
        ) : (
          <span style={{ color: 'var(--sf-error-700)' }}>Chưa khai toạ độ</span>
        ),
    },
    {
      title: 'Bán kính',
      dataIndex: 'radiusMeters',
      key: 'radius',
      width: 110,
      align: 'right',
      render: (value: number) => `${value}m`,
    },
    {
      title: 'Lớp xác thực thêm',
      key: 'layers',
      width: 240,
      render: (_, row) => (
        <div className="sf-body-sm sf-text-variant">
          {row.wifiBssids.length > 0 ? `${row.wifiBssids.length} BSSID · ` : ''}
          {row.allowedIpCidrs.length > 0 ? `${row.allowedIpCidrs.length} dải IP` : ''}
          {row.wifiBssids.length === 0 && row.allowedIpCidrs.length === 0 ? 'Chỉ dùng GPS' : ''}
        </div>
      ),
    },
    ...(canEdit
      ? [
          {
            title: '',
            key: 'actions',
            width: 90,
            render: (_: unknown, row: Branch) => (
              <Button size="small" onClick={() => setEditing(row)}>
                Sửa
              </Button>
            ),
          } as ColumnsType<Branch>[number],
        ]
      : []),
  ];

  return (
    <div>
      {canEdit ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
          <Button
            type="primary"
            icon={<Icon name="add" size={20} />}
            onClick={() => setEditing({ radiusMeters: 100, wifiBssids: [], allowedIpCidrs: [] })}
          >
            Thêm chi nhánh
          </Button>
        </div>
      ) : null}

      <DataTable<Branch>
        rowKey="id"
        data={branches.data}
        isLoading={branches.isLoading}
        error={branches.error}
        onRetry={() => void branches.refetch()}
        columns={columns}
        pagination={false}
        emptyIcon="location_on"
        emptyTitle="Chưa có chi nhánh nào"
        emptyDescription="Khai ít nhất một chi nhánh kèm toạ độ để hệ thống biết nhân viên đang ở đâu khi chấm công."
        emptyAction={
          canEdit ? (
            <Button type="primary" onClick={() => setEditing({ radiusMeters: 100 })}>
              Thêm chi nhánh
            </Button>
          ) : undefined
        }
      />

      <BranchFormModal branch={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function BranchFormModal({
  branch,
  onClose,
}: {
  branch: Partial<Branch> | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const showError = useErrorToast();
  const upsert = useUpsertBranch();
  const [draft, setDraft] = useState<Partial<Branch>>({});

  const value = { ...branch, ...draft };

  function patch(next: Partial<Branch>) {
    setDraft((prev) => ({ ...prev, ...next }));
  }

  return (
    <Modal
      open={Boolean(branch)}
      onCancel={onClose}
      title={branch?.id ? `Sửa chi nhánh · ${branch.name}` : 'Thêm chi nhánh'}
      okText="Lưu"
      cancelText="Huỷ bỏ"
      okButtonProps={{ loading: upsert.isPending, disabled: !value.name }}
      width={640}
      destroyOnClose
      afterOpenChange={(open) => {
        if (open) setDraft({});
      }}
      onOk={async () => {
        try {
          await upsert.mutateAsync(value);
          toast.success('Đã lưu chi nhánh');
          onClose();
        } catch (caught) {
          showError(caught);
        }
      }}
    >
      <div style={{ display: 'grid', gap: 16 }}>
        <div>
          <label
            className="sf-field__label"
            htmlFor="b-name"
            style={{ display: 'block', marginBottom: 4 }}
          >
            Tên chi nhánh
          </label>
          <Input
            id="b-name"
            value={value.name ?? ''}
            onChange={(event) => patch({ name: event.target.value })}
            placeholder="Văn phòng Hà Nội"
          />
        </div>

        <div>
          <label
            className="sf-field__label"
            htmlFor="b-addr"
            style={{ display: 'block', marginBottom: 4 }}
          >
            Địa chỉ
          </label>
          <Input
            id="b-addr"
            value={value.address ?? ''}
            onChange={(event) => patch({ address: event.target.value })}
            placeholder="123 Trần Duy Hưng, Cầu Giấy"
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label
              className="sf-field__label"
              htmlFor="b-lat"
              style={{ display: 'block', marginBottom: 4 }}
            >
              Vĩ độ
            </label>
            <InputNumber
              id="b-lat"
              style={{ width: '100%' }}
              step={0.000001}
              value={value.latitude ?? undefined}
              onChange={(latitude) => patch({ latitude: latitude ?? null })}
              placeholder="21.012345"
            />
          </div>
          <div>
            <label
              className="sf-field__label"
              htmlFor="b-lng"
              style={{ display: 'block', marginBottom: 4 }}
            >
              Kinh độ
            </label>
            <InputNumber
              id="b-lng"
              style={{ width: '100%' }}
              step={0.000001}
              value={value.longitude ?? undefined}
              onChange={(longitude) => patch({ longitude: longitude ?? null })}
              placeholder="105.798765"
            />
          </div>
        </div>

        <div>
          <label className="sf-field__label" style={{ display: 'block', marginBottom: 4 }}>
            Bán kính cho phép: {value.radiusMeters ?? 100}m
          </label>
          <Slider
            min={50}
            max={500}
            step={10}
            value={value.radiusMeters ?? 100}
            onChange={(radiusMeters) => patch({ radiusMeters })}
            marks={{ 50: '50m', 100: '100m', 250: '250m', 500: '500m' }}
          />
          <p className="sf-body-sm sf-text-variant" style={{ margin: '4px 0 0' }}>
            GPS trong nhà hoặc toà cao tầng có sai số 20–50m. Bán kính dưới 50m gây rất nhiều báo
            động giả — khuyến nghị khởi điểm 100m rồi điều chỉnh theo dữ liệu thực tế.
          </p>
        </div>

        <div>
          <label
            className="sf-field__label"
            htmlFor="b-bssid"
            style={{ display: 'block', marginBottom: 4 }}
          >
            Địa chỉ MAC bộ phát WiFi (BSSID)
          </label>
          <Select
            id="b-bssid"
            mode="tags"
            style={{ width: '100%' }}
            value={value.wifiBssids ?? []}
            onChange={(wifiBssids) => patch({ wifiBssids })}
            placeholder="a4:2b:8c:00:11:22"
            tokenSeparators={[',', ' ']}
          />
          <p className="sf-body-sm sf-text-variant" style={{ margin: '4px 0 0' }}>
            Chỉ BSSID (địa chỉ MAC) mới dùng để đối chiếu. Tên mạng WiFi ai cũng đặt trùng được nên
            không có giá trị xác thực.
          </p>
        </div>

        <div>
          <label
            className="sf-field__label"
            htmlFor="b-ip"
            style={{ display: 'block', marginBottom: 4 }}
          >
            Dải IP công cộng của văn phòng (CIDR)
          </label>
          <Select
            id="b-ip"
            mode="tags"
            style={{ width: '100%' }}
            value={value.allowedIpCidrs ?? []}
            onChange={(allowedIpCidrs) => patch({ allowedIpCidrs })}
            placeholder="203.0.113.0/24"
            tokenSeparators={[',', ' ']}
          />
          <Alert
            style={{ marginTop: 8 }}
            type="warning"
            showIcon
            message="Phải là IP công cộng do nhà mạng cấp cho văn phòng"
            description="Khai dải nội bộ sau NAT (192.168.x.x, 10.x.x.x) là nhầm lẫn phổ biến nhất — máy chủ không bao giờ nhìn thấy những địa chỉ đó, và chốt kiểm sẽ không bao giờ khớp."
          />
        </div>
      </div>
    </Modal>
  );
}
