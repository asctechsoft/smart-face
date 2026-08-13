import { useState, type ReactNode } from 'react';
import { PageHeader } from '@/components/PageHeader';
import {
  Avatar,
  Badge,
  BottomSheet,
  BulkAction,
  BulkActionBar,
  Button,
  Card,
  CardSkeleton,
  Checkbox,
  ClickableCard,
  ConfirmDialog,
  Drawer,
  EmptyState,
  ErrorState,
  Fab,
  Field,
  FilterChip,
  FilterChipGroup,
  Icon,
  IconButton,
  ListSkeleton,
  Modal,
  NotificationItem,
  Radio,
  RadioGroup,
  Select,
  StatCard,
  StatCardSkeleton,
  TableSkeleton,
  TextArea,
  TextInput,
  useToast,
  type ButtonVariant,
} from '@/components/ui';

/**
 * Trang trưng bày thư viện component.
 *
 * Đây là công cụ làm việc, không phải trang trí. Checklist nghiệm thu ở
 * `docs/16` mục 16 đòi kiểm "mọi phần tử tương tác có đủ 5 trạng thái" và
 * "tương phản chữ ≥ 4.5:1" — cả hai chỉ kiểm được khi nhìn thấy tất cả biến thể
 * cạnh nhau. Rải chúng khắp 11 màn hình nghiệp vụ thì QC phải dựng đủ dữ liệu
 * mới thấy được một nút disabled.
 *
 * Dùng để: chạy axe DevTools một lượt, chụp màn hình đối chiếu Figma, và thử
 * `Tab` xuyên trang xem vòng focus có chỗ nào mất không.
 */
export function DesignSystemPage() {
  const toast = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [chips, setChips] = useState<Record<string, boolean>>({ late: true });
  const [selected, setSelected] = useState(3);
  const [checkbox, setCheckbox] = useState(true);
  const [radio, setRadio] = useState('keep');
  const [inputValue, setInputValue] = useState('');
  const [note, setNote] = useState('');

  /**
   * Công tắc mô phỏng trạng thái tải.
   *
   * Skeleton chạy vòng lặp vô hạn theo đúng thiết kế (mục 11.11, chu kỳ 1500ms
   * `lặp vô hạn`). Trên trang trưng bày điều đó gây hiểu nhầm: người xem không
   * phân biệt được "đây là ảnh mẫu" với "trang này đang treo". Công tắc giải
   * quyết bằng cách cho họ tự bật tắt và thấy cả hai đầu trạng thái.
   */
  const [demoLoading, setDemoLoading] = useState(true);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--sf-surface-bright)',
        // Trang này nằm ngoài ManagerLayout nên phải tự dựng khung: không có
        // padding thì nội dung dính sát mép trái màn hình.
        padding: '32px clamp(16px, 4vw, 48px) 96px',
      }}
    >
      <div style={{ maxWidth: 'var(--sf-content-max-width)', marginInline: 'auto' }}>
      <PageHeader
        title="Thư viện component"
        description="Toàn bộ component dùng chung, dựng theo docs/16 mục 11. Mỗi nhóm hiện đủ 5 trạng thái để đối chiếu khi nghiệm thu giao diện."
        actions={
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 16px',
              borderRadius: 12,
              border: '1px solid var(--sf-outline-variant)',
              background: 'var(--sf-surface)',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={demoLoading}
              onChange={(e) => setDemoLoading(e.target.checked)}
              style={{ width: 18, height: 18, accentColor: 'var(--sf-primary)' }}
            />
            <span className="sf-body-sm">Mô phỏng trạng thái đang tải</span>
          </label>
        }
      />

      <TableOfContents />

      {/* ── 11.1 Nút ──────────────────────────────────────────────────── */}
      <Section id="nut" title="11.1 · Nút" note="Nút amber SÁNG LÊN khi rê chuột, không tối đi (mục 0.1). Nhấn giữ nguyên màu, dùng bóng lõm + dịch 1px.">
        <Row label="Ba kích thước">
          <Button size="sm">Nút nhỏ 36px</Button>
          <Button size="md">Nút vừa 44px</Button>
          <Button size="lg">Nút lớn 52px</Button>
        </Row>

        {(
          [
            ['primary', 'Primary (amber)'],
            ['teal', 'Primary teal'],
            ['secondary', 'Secondary (viền)'],
            ['tertiary', 'Tertiary (chữ)'],
            ['destructive', 'Destructive'],
            ['destructive-ghost', 'Destructive ghost'],
          ] as [ButtonVariant, string][]
        ).map(([variant, label]) => (
          <Row key={variant} label={label}>
            <Button variant={variant}>Trạng thái nghỉ</Button>
            <Button variant={variant} icon="check">
              Có icon
            </Button>
            <Button variant={variant} loading>
              Đang xử lý
            </Button>
            <Button variant={variant} disabled>
              Vô hiệu hoá
            </Button>
          </Row>
        ))}

        <Row label="Nút chỉ có icon" note="Bắt buộc có aria-label — kiểu dữ liệu ép điều đó.">
          <IconButton icon="edit" label="Sửa" />
          <IconButton icon="delete" label="Xoá" variant="destructive-ghost" />
          <IconButton icon="more_horiz" label="Thêm thao tác" variant="secondary" />
          <IconButton icon="close" label="Đóng" disabled />
        </Row>
      </Section>

      {/* ── 11.2 / 11.3 Checkbox & Radio ──────────────────────────────── */}
      <Section id="checkbox-radio" title="11.2 & 11.3 · Checkbox và Radio">
        <Row label="Checkbox">
          <Checkbox checked={checkbox} onChange={(e) => setCheckbox(e.target.checked)}>
            Đã chọn
          </Checkbox>
          <Checkbox defaultChecked={false}>Chưa chọn</Checkbox>
          <Checkbox indeterminate>Chọn một phần</Checkbox>
          <Checkbox disabled>Vô hiệu hoá</Checkbox>
          <Checkbox disabled defaultChecked>
            Vô hiệu + đã chọn
          </Checkbox>
        </Row>

        <Row label="Checkbox trong bảng (16px)">
          <Checkbox compact defaultChecked />
          <Checkbox compact />
        </Row>

        <div style={{ maxWidth: 480 }}>
          <RadioGroup legend="Quyết định về cảnh báo">
            <Radio
              name="demo-radio"
              value="keep"
              checked={radio === 'keep'}
              onChange={(e) => setRadio(e.target.value)}
              description="Cảnh báo là báo động giả — VD sai số GPS trong toà nhà cao tầng."
            >
              Giữ nguyên công
            </Radio>
            <Radio
              name="demo-radio"
              value="void"
              checked={radio === 'void'}
              onChange={(e) => setRadio(e.target.value)}
              description="Lượt chấm công bị loại khỏi phép tính. Bản ghi gốc vẫn giữ."
            >
              Huỷ công của lượt này
            </Radio>
            <Radio name="demo-radio" value="x" disabled description="Chưa mở ở phiên bản này.">
              Lựa chọn vô hiệu hoá
            </Radio>
          </RadioGroup>
        </div>
      </Section>

      {/* ── 11.5 Input ────────────────────────────────────────────────── */}
      <Section id="o-nhap" title="11.5 · Ô nhập" note="Nhãn hiển thị thường trực — placeholder không thay thế được nhãn (mục 14.2 điều 5).">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 24,
            maxWidth: 900,
          }}
        >
          <Field label="Trạng thái nghỉ" hint="Mô tả ngắn giúp người dùng điền đúng.">
            {(props) => (
              <TextInput
                {...props}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Nhập nội dung"
              />
            )}
          </Field>

          <Field label="Có icon dẫn">
            {(props) => <TextInput {...props} icon="search" placeholder="Tìm nhân viên" />}
          </Field>

          <Field
            label="Trạng thái lỗi"
            required
            error="Họ và tên không được để trống."
          >
            {(props) => <TextInput {...props} placeholder="Nguyễn Văn Đức" />}
          </Field>

          <Field label="Chỉ đọc">
            {(props) => <TextInput {...props} readOnly value="ducnv.amobi" />}
          </Field>

          <Field label="Vô hiệu hoá">
            {(props) => <TextInput {...props} disabled value="Không sửa được" />}
          </Field>

          <Field label="Select" hint="Dùng <select> thật để giữ bàn phím và trình đọc màn hình.">
            {(props) => (
              <Select
                {...props}
                placeholder="Chọn phòng ban"
                options={[
                  { value: 'ky-thuat', label: 'Kỹ thuật' },
                  { value: 'kinh-doanh', label: 'Kinh doanh' },
                  { value: 'ke-toan', label: 'Kế toán', disabled: true },
                ]}
              />
            )}
          </Field>
        </div>

        <div style={{ maxWidth: 560, marginTop: 24 }}>
          <Field label="Lý do hiệu chỉnh" hint="Tối thiểu 10 ký tự, ghi vào nhật ký kiểm toán.">
            {(props) => (
              <TextArea
                {...props}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={1000}
                showCount
                placeholder="Nhân viên có mặt từ 08:00, xác nhận qua camera lễ tân."
              />
            )}
          </Field>
        </div>
      </Section>

      {/* ── 11.6 Chip ─────────────────────────────────────────────────── */}
      <Section id="chip" title="11.6 · Chip lọc" note='Dùng <button role="switch" aria-checked>, không dùng <div>.'>
        <FilterChipGroup label="Lọc theo trạng thái">
          {[
            { key: 'ontime', label: 'Đúng giờ', count: 142 },
            { key: 'late', label: 'Đi muộn', count: 8 },
            { key: 'absent', label: 'Vắng mặt', count: 3 },
          ].map((chip) => (
            <FilterChip
              key={chip.key}
              selected={Boolean(chips[chip.key])}
              count={chip.count}
              onToggle={(next) => setChips((prev) => ({ ...prev, [chip.key]: next }))}
            >
              {chip.label}
            </FilterChip>
          ))}
          <FilterChip selected={false} disabled onToggle={() => {}}>
            Vô hiệu hoá
          </FilterChip>
        </FilterChipGroup>
      </Section>

      {/* ── 11.7 Badge ────────────────────────────────────────────────── */}
      <Section id="badge"
        title="11.7 · Badge"
        note="Nền bậc 100, chữ bậc 800 — 7.92 đến 13.30:1. Badge cũ dùng nền alpha chỉ đạt 3.91:1, không đạt AA."
      >
        <Row label="Đặc">
          <Badge tone="success">Đúng giờ</Badge>
          <Badge tone="warning">Đi muộn</Badge>
          <Badge tone="error">Vắng mặt</Badge>
          <Badge tone="teal">Đang xử lý</Badge>
          <Badge tone="neutral">Nháp</Badge>
        </Row>
        <Row label="Mềm (bảng dày đặc)">
          <Badge tone="success" soft>
            Đúng giờ
          </Badge>
          <Badge tone="warning" soft>
            Đi muộn
          </Badge>
          <Badge tone="error" soft>
            Vắng mặt
          </Badge>
        </Row>
        <Row label="Viết hoa 10px">
          <Badge tone="neutral" caps>
            Active
          </Badge>
          <Badge tone="teal" caps>
            Pending
          </Badge>
        </Row>
      </Section>

      {/* ── 11.8 Avatar ───────────────────────────────────────────────── */}
      <Section id="avatar" title="11.8 · Avatar" note="Chữ viết tắt #FFFFFF trên teal-700 = 8.97:1.">
        <Row label="Kích thước">
          <Avatar name="Nguyễn Văn Đức" size={32} />
          <Avatar name="Trần Thị Mai" size={40} />
          <Avatar name="Lê Văn Hùng" size={64} />
          <Avatar name="Phạm Thị An" size={96} />
        </Row>
        <Row label="Biến thể">
          <Avatar name="Nguyễn Văn Đức" size={96} shape="rounded" />
          <Avatar name="?" size={64} tone="muted" />
        </Row>
      </Section>

      {/* ── 11.9 Card ─────────────────────────────────────────────────── */}
      <Section id="card" title="11.9 · Card và thẻ chỉ số">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 16,
          }}
        >
          <Card>
            <h4 className="sf-title-sm">Card thường</h4>
            <p className="sf-body-sm sf-text-variant" style={{ margin: '4px 0 0' }}>
              Nền surface, viền 1px, radius 12px, shadow-xs.
            </p>
          </Card>

          <ClickableCard onClick={() => toast.success('Đã bấm vào card')}>
            <h4 className="sf-title-sm">Card bấm được</h4>
            <p className="sf-body-sm sf-text-variant" style={{ margin: '4px 0 0' }}>
              Là &lt;button&gt; thật, nhận được tiêu điểm bàn phím.
            </p>
          </ClickableCard>

          <StatCard label="Đang làm việc" value="142" suffix="/ 168" icon="badge" />
          <StatCard label="Đi muộn hôm nay" value="8" tone="warning" icon="schedule" />
          <StatCard label="Đơn chờ duyệt" value="12" to="/requests" icon="assignment_late" />
          <StatCard
            label={demoLoading ? 'Đang tải (mô phỏng)' : 'Tổng giờ OT tháng'}
            value={demoLoading ? '—' : '128h'}
            loading={demoLoading}
          />
        </div>
      </Section>

      {/* ── 11.11 Skeleton ────────────────────────────────────────────── */}
      <Section id="skeleton"
        title="11.11 · Skeleton"
        note='Vùng skeleton có aria-busy="true" và aria-live="polite". Hiệu ứng nhấp nháy lặp vô hạn theo thiết kế (mục 11.11) — ở đây nó là ẢNH MẪU, không phải trang đang treo.'
      >
        <DemoNotice loading={demoLoading} onToggle={() => setDemoLoading((v) => !v)} />

        <div style={{ display: 'grid', gap: 24, marginTop: 16 }}>
          <div
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}
          >
            {demoLoading ? (
              <>
                <StatCardSkeleton />
                <StatCardSkeleton />
                <CardSkeleton height={140} />
              </>
            ) : (
              <>
                <StatCard label="Đang làm việc" value="142" suffix="/ 168" icon="badge" />
                <StatCard label="Đi muộn hôm nay" value="8" tone="warning" icon="schedule" />
                <Card>
                  <h4 className="sf-title-sm">Đã tải xong</h4>
                  <p className="sf-body-sm sf-text-variant" style={{ margin: '4px 0 0' }}>
                    Skeleton giữ đúng hình dạng của nội dung thật, nên khi dữ liệu về thì bố cục
                    không nhảy.
                  </p>
                </Card>
              </>
            )}
          </div>

          {demoLoading ? (
            <TableSkeleton columns={4} rows={3} />
          ) : (
            <Card padding={0}>
              <div
                style={{
                  height: 40,
                  background: 'var(--sf-surface-container-low)',
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0 24px',
                }}
                className="sf-label-md"
              >
                Bảng đã có dữ liệu
              </div>
              {['Nguyễn Văn Đức', 'Trần Thị Mai', 'Lê Văn Hùng'].map((name) => (
                <div
                  key={name}
                  style={{
                    height: 74,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    padding: '0 24px',
                    borderTop: '1px solid var(--sf-outline-variant)',
                  }}
                >
                  <Avatar name={name} size={40} />
                  <span className="sf-body-md" style={{ flex: 1 }}>
                    {name}
                  </span>
                  <Badge tone="success">Đúng giờ</Badge>
                </div>
              ))}
            </Card>
          )}

          <Card padding={0}>
            {demoLoading ? (
              <ListSkeleton rows={3} />
            ) : (
              <>
                <NotificationItem
                  title="Danh sách đã tải xong"
                  body="Bật lại công tắc phía trên để xem trạng thái đang tải."
                  time="Vừa xong"
                  unread={false}
                />
              </>
            )}
          </Card>
        </div>
      </Section>

      {/* ── 11.12 Toast ───────────────────────────────────────────────── */}
      <Section id="toast"
        title="11.12 · Toast"
        note="Success tự đóng sau 4s, warning 6s, lỗi KHÔNG tự đóng. Rê chuột vào để dừng đếm giờ. Nút đóng có vùng chạm 44×44."
      >
        <Row label="Thử">
          <Button variant="secondary" onClick={() => toast.success('Đã lưu thay đổi.')}>
            Toast thành công
          </Button>
          <Button
            variant="secondary"
            onClick={() => toast.warning('Còn 3 đơn chờ duyệt', 'Chốt kỳ khi còn tồn đọng dễ gây khiếu nại lương.')}
          >
            Toast cảnh báo
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              toast.error('Không lưu được hiệu chỉnh', 'Kỳ lương chứa ngày này đã chốt. Mở lại kỳ rồi thử lại.')
            }
          >
            Toast lỗi
          </Button>
        </Row>
      </Section>

      {/* ── 11.13 / 11.14 / 11.19 Lớp nổi ─────────────────────────────── */}
      <Section id="lop-noi"
        title="11.13, 11.14 & 11.19 · Modal, Drawer, Bottom sheet"
        note="Cả ba đều bẫy focus, đóng bằng Esc và trả focus về nút đã mở. Thử bằng bàn phím: Tab không thoát ra được nội dung phía sau."
      >
        <Row label="Mở thử">
          <Button variant="secondary" onClick={() => setModalOpen(true)}>
            Modal
          </Button>
          <Button variant="secondary" onClick={() => setConfirmOpen(true)}>
            Hộp thoại xác nhận
          </Button>
          <Button variant="secondary" onClick={() => setDrawerOpen(true)}>
            Drawer
          </Button>
          <Button variant="secondary" onClick={() => setSheetOpen(true)}>
            Bottom sheet
          </Button>
        </Row>
      </Section>

      {/* ── 11.17 Bulk bar ────────────────────────────────────────────── */}
      <Section id="bulk" title="11.17 · Thanh hành động hàng loạt" note='Có aria-live="polite" thông báo số dòng đã chọn.'>
        <Row label="Số dòng đã chọn">
          <Button size="sm" variant="tertiary" onClick={() => setSelected((n) => n + 1)}>
            Thêm một
          </Button>
          <Button size="sm" variant="tertiary" onClick={() => setSelected(0)}>
            Về 0
          </Button>
        </Row>
        <BulkActionBar count={selected} itemNoun="đơn" onClear={() => setSelected(0)}>
          <BulkAction onClick={() => toast.success(`Đã duyệt ${selected} đơn`)}>
            Duyệt tất cả
          </BulkAction>
          <BulkAction danger onClick={() => toast.error('Đã từ chối')}>
            Từ chối
          </BulkAction>
        </BulkActionBar>
      </Section>

      {/* ── 11.18 Empty & Error ───────────────────────────────────────── */}
      <Section id="rong-loi" title="11.18 · Trạng thái rỗng và lỗi" note="Mô tả là bắt buộc — phải nói được làm gì tiếp theo, không chỉ 'Không có dữ liệu'.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
          <EmptyState
            icon="group_add"
            title="Chưa có nhân viên nào"
            description="Thêm từng người bằng nút Thêm nhân viên, hoặc tải lên file Excel để tạo hàng loạt."
            action={<Button>Thêm nhân viên</Button>}
          />
          <ErrorState
            description="Máy chủ không phản hồi. Kiểm tra đường truyền rồi thử lại."
            traceId="01J8XK2M9P4R7T"
            onRetry={() => toast.success('Đã thử lại')}
          />
        </div>
      </Section>

      {/* ── 11.20 Thông báo ───────────────────────────────────────────── */}
      <Section id="thong-bao" title="11.20 · Danh sách thông báo">
        <Card padding={0}>
          <NotificationItem
            title="3 đơn nghỉ phép chờ bạn duyệt"
            body="Phòng Kỹ thuật · hạn xử lý hôm nay"
            time="10 phút trước"
            unread
            onClick={() => toast.success('Đã đánh dấu đã đọc')}
          />
          <NotificationItem
            title="Phát hiện chấm công ngoài vùng cho phép"
            body="Phạm Thị An · cách văn phòng 340m"
            time="1 giờ trước"
            unread
            tone="warning"
            onClick={() => {}}
          />
          <NotificationItem
            title="File bảng công tháng 07 đã sẵn sàng"
            body="Liên kết tải có hiệu lực trong 24 giờ"
            time="Hôm qua"
            unread={false}
          />
        </Card>
      </Section>

      {/* ── 11.16 FAB ─────────────────────────────────────────────────── */}
      <Fab icon="add" label="Tạo mới" onClick={() => toast.success('FAB đã được bấm')} />

      {/* ── Lớp nổi ───────────────────────────────────────────────────── */}
      <Modal
        open={modalOpen}
        title="Tiêu đề modal"
        description="Mô tả ngắn nói rõ modal này dùng để làm gì."
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <Button variant="tertiary" onClick={() => setModalOpen(false)}>
              Huỷ bỏ
            </Button>
            <Button size="lg" onClick={() => setModalOpen(false)}>
              Xác nhận
            </Button>
          </>
        }
      >
        <p className="sf-body-md" style={{ marginTop: 0 }}>
          Thân modal dùng padding 24px. Header nền `surface-bright`, footer nền `neutral-100`.
        </p>
        <Field label="Một ô nhập bên trong modal">
          {(props) => <TextInput {...props} placeholder="Thử Tab để kiểm tra bẫy focus" />}
        </Field>
      </Modal>

      <ConfirmDialog
        open={confirmOpen}
        title="Chốt kỳ lương tháng 08/2026?"
        message="Sau khi chốt, kỳ này bị khoá hoàn toàn: không chấm công, không hiệu chỉnh, không duyệt đơn rơi vào kỳ."
        confirmText="Chốt kỳ"
        danger
        onConfirm={() => {
          setConfirmOpen(false);
          toast.success('Đã chốt kỳ lương');
        }}
        onCancel={() => setConfirmOpen(false)}
      />

      <Drawer
        open={drawerOpen}
        title="Nguyễn Văn Đức"
        subtitle="ducnv.amobi · Phòng Kỹ thuật"
        width={480}
        hero={{ name: 'Nguyễn Văn Đức' }}
        onClose={() => setDrawerOpen(false)}
        footer={
          <>
            <Button variant="tertiary" onClick={() => setDrawerOpen(false)}>
              Đóng
            </Button>
            <Button onClick={() => setDrawerOpen(false)}>Lưu</Button>
          </>
        }
      >
        <p className="sf-body-md" style={{ margin: 0 }}>
          Header dạng dải teal cao 128px với avatar 96px viền trắng 4px đè lên (mục 11.14).
        </p>
        <Field label="Ô nhập trong drawer">
          {(props) => <TextInput {...props} placeholder="Thử Esc để đóng" />}
        </Field>
      </Drawer>

      <BottomSheet open={sheetOpen} title="Thao tác" onClose={() => setSheetOpen(false)}>
        <div style={{ display: 'grid', gap: 8 }}>
          <Button variant="tertiary" icon="edit" block>
            Sửa hồ sơ
          </Button>
          <Button variant="tertiary" icon="sms" block>
            Gửi lại lời mời
          </Button>
          <Button variant="destructive-ghost" icon="person_remove" block>
            Chấm dứt hợp đồng
          </Button>
        </div>
      </BottomSheet>
      </div>
    </div>
  );
}

/**
 * Dải giải thích đặt ngay trên khối skeleton.
 *
 * Không phải trang trí: người xem trang này lần đầu không có cách nào biết một
 * ô nhấp nháy là ảnh mẫu hay là dữ liệu chưa về. Nói thẳng ra, kèm nút bật tắt
 * để họ tự kiểm chứng.
 */
function DemoNotice({ loading, onToggle }: { loading: boolean; onToggle: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        padding: '12px 16px',
        borderRadius: 12,
        background: 'var(--sf-teal-50)',
        border: '1px solid var(--sf-teal-200)',
      }}
    >
      <Icon name="info" size={20} color="var(--sf-teal-800)" />
      <span className="sf-body-sm" style={{ flex: 1, minWidth: 220, color: 'var(--sf-teal-800)' }}>
        {loading
          ? 'Các khối bên dưới đang ở trạng thái ĐANG TẢI mô phỏng. Trang không bị treo — hiệu ứng nhấp nháy lặp vô hạn là đúng thiết kế.'
          : 'Đang hiện trạng thái ĐÃ TẢI XONG. Bật lại để so sánh với lúc chờ dữ liệu.'}
      </span>
      <Button size="sm" variant="secondary" onClick={onToggle}>
        {loading ? 'Xem khi đã tải xong' : 'Xem khi đang tải'}
      </Button>
    </div>
  );
}

/**
 * Mục lục nhảy nhanh.
 *
 * Trang cao hơn 5000px — cuộn tay từ nút xuống danh sách thông báo là một quãng
 * dài. `position: sticky` giữ nó theo màn hình khi cuộn.
 */
const SECTIONS = [
  { id: 'nut', label: 'Nút' },
  { id: 'checkbox-radio', label: 'Checkbox & Radio' },
  { id: 'o-nhap', label: 'Ô nhập' },
  { id: 'chip', label: 'Chip' },
  { id: 'badge', label: 'Badge' },
  { id: 'avatar', label: 'Avatar' },
  { id: 'card', label: 'Card' },
  { id: 'skeleton', label: 'Skeleton' },
  { id: 'toast', label: 'Toast' },
  { id: 'lop-noi', label: 'Modal & Drawer' },
  { id: 'bulk', label: 'Bulk bar' },
  { id: 'rong-loi', label: 'Rỗng & Lỗi' },
  { id: 'thong-bao', label: 'Thông báo' },
];

function TableOfContents() {
  return (
    <nav
      aria-label="Mục lục thư viện component"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        padding: '12px 16px',
        marginBottom: 32,
        borderRadius: 12,
        background: 'var(--sf-surface)',
        border: '1px solid var(--sf-outline-variant)',
        boxShadow: 'var(--sf-shadow-xs)',
      }}
    >
      {SECTIONS.map((section) => (
        <a
          key={section.id}
          href={`#${section.id}`}
          className="sf-body-sm"
          style={{
            padding: '4px 12px',
            borderRadius: 9999,
            textDecoration: 'none',
            color: 'var(--sf-on-surface-variant)',
            background: 'var(--sf-surface-container-low)',
          }}
        >
          {section.label}
        </a>
      ))}
    </nav>
  );
}

function Section({
  id,
  title,
  note,
  children,
}: {
  id?: string;
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      style={{
        marginBottom: 48,
        // Chừa chỗ cho mục lục dính phía trên: thiếu dòng này thì bấm vào một
        // mục sẽ cuộn tới đúng chỗ nhưng tiêu đề nằm khuất sau thanh mục lục.
        scrollMarginTop: 80,
      }}
    >
      <h2 className="sf-headline-md" style={{ marginBottom: 4 }}>
        {title}
      </h2>
      {note ? (
        <p className="sf-body-sm sf-text-variant" style={{ margin: '0 0 16px', maxWidth: '80ch' }}>
          {note}
        </p>
      ) : (
        <div style={{ height: 16 }} />
      )}
      {children}
    </section>
  );
}

function Row({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div className="sf-label-md" style={{ marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {children}
      </div>
      {note ? (
        <p className="sf-caption" style={{ margin: '6px 0 0' }}>
          <Icon name="info" size={16} /> {note}
        </p>
      ) : null}
    </div>
  );
}
