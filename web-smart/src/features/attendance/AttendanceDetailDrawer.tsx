import { Alert, Divider, Drawer, Empty, Tag } from 'antd';
import { DetailField, DetailGrid, DetailSection } from '@/components/DetailField';
import { StatusBadge, severityTone } from '@/components/StatusBadge';
import { Icon } from '@/components/Icon';
import { CardSkeleton } from '@/components/Skeleton';
import { useAuth } from '@/lib/auth/auth-context';
import { formatDay, formatSecondsGap, formatTimeWithSeconds } from '@/lib/utils/date';
import { formatDistance, formatScore } from '@/lib/utils/format';
import { FRAUD_CODE_LABEL, FRAUD_SEVERITY_LABEL } from '@/config/constants';
import { env } from '@/config/env';
import { useAttendanceLogs, type AttendanceLog } from './attendance.api';
import { ApiErrorState } from '@/components/ApiErrorState';

/**
 * Chi tiết một ngày công — docs/04 mục 3.2 (`FR-WEB-ATT-03`).
 *
 * Một ngày có thể có nhiều lượt (vào, ra ngoài, vào lại, ra), nên drawer liệt kê
 * TỪNG lượt thay vì chỉ hiện cặp vào/ra đầu-cuối. Đây là màn hình dùng để đối
 * soát khiếu nại (AF-22): mọi con số mà hệ thống dùng để ra quyết định đều phải
 * nhìn thấy được ở đây, kể cả những con số làm hệ thống chấp nhận lượt chấm công.
 */
export function AttendanceDetailDrawer({
  open,
  employeeId,
  workDate,
  employeeName,
  onClose,
}: {
  open: boolean;
  employeeId: string | null;
  workDate: string | null;
  employeeName: string;
  onClose: () => void;
}) {
  const { timezone } = useAuth();
  const logs = useAttendanceLogs(open ? employeeId : null, open ? workDate : null);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        <div>
          <div className="sf-title-md">{employeeName}</div>
          <div className="sf-body-sm sf-text-variant">
            Ngày {workDate ? formatDay(workDate, timezone) : '—'}
          </div>
        </div>
      }
      width={720}
      destroyOnClose
      // Drawer bẫy focus và đóng bằng Esc sẵn theo mặc định của antd —
      // docs/16 mục 14.2 điều 6.
      styles={{ body: { padding: 24, display: 'flex', flexDirection: 'column', gap: 24 } }}
    >
      {logs.isLoading ? (
        <CardSkeleton height={280} />
      ) : logs.error ? (
        <ApiErrorState error={logs.error} onRetry={() => void logs.refetch()} />
      ) : !logs.data || logs.data.length === 0 ? (
        <Empty
          description={
            <div>
              <p className="sf-body-md" style={{ marginBottom: 4 }}>
                Không có lượt chấm công nào trong ngày này
              </p>
              <p className="sf-body-sm sf-text-variant" style={{ margin: 0 }}>
                Ngày công có thể được sinh từ đơn nghỉ phép đã duyệt hoặc từ lịch ngày lễ, không
                phải từ một lượt chấm công thật.
              </p>
            </div>
          }
        />
      ) : (
        logs.data.map((log, index) => (
          <div key={log.id}>
            {index > 0 ? <Divider style={{ marginBlock: 8 }} /> : null}
            <AttendanceLogCard log={log} timezone={timezone} />
          </div>
        ))
      )}
    </Drawer>
  );
}

function AttendanceLogCard({ log, timezone }: { log: AttendanceLog; timezone: string }) {
  const flags = log.fraudFlags ?? [];
  const outOfGeofence = log.insideGeofence === false;

  return (
    <article style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <StatusBadge tone={log.type === 'CHECK_IN' ? 'teal' : 'neutral'}>
          {log.type === 'CHECK_IN' ? 'Chấm vào' : 'Chấm ra'}
        </StatusBadge>
        <span className="sf-title-sm">{formatTimeWithSeconds(log.recordedAt, timezone)}</span>
        <span className="sf-body-sm sf-text-variant">giờ máy chủ</span>

        <Tag
          color={log.decision === 'ACCEPTED' ? 'success' : 'error'}
          style={{ marginLeft: 'auto' }}
        >
          {log.decision === 'ACCEPTED' ? 'Đã ghi nhận' : log.decision}
        </Tag>
      </header>

      {/* ── Cờ nghi vấn (FR-WEB-ATT-06) ───────────────────────────────── */}
      {flags.length > 0 ? (
        <Alert
          type={flags.some((flag) => flag.severity === 'HIGH') ? 'error' : 'warning'}
          showIcon
          message={`${flags.length} cờ nghi vấn trên lượt chấm công này`}
          description={
            <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
              {flags.map((flag) => (
                <li key={flag.id} className="sf-body-sm">
                  {FRAUD_CODE_LABEL[flag.code] ?? flag.code}{' '}
                  <StatusBadge tone={severityTone(flag.severity)} soft>
                    {FRAUD_SEVERITY_LABEL[flag.severity] ?? flag.severity}
                  </StatusBadge>
                  {flag.reviewDecision ? (
                    <span className="sf-text-variant"> · đã xử lý: {flag.reviewDecision}</span>
                  ) : (
                    <span style={{ color: 'var(--sf-warning-800)' }}> · chưa xử lý</span>
                  )}
                </li>
              ))}
            </ul>
          }
        />
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 220px) 1fr', gap: 24 }}>
        {/* ── Ảnh chụp lúc chấm công ──────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="sf-label-md">Ảnh lúc chấm công</span>
          {log.photoUrl ? (
            <img
              src={log.photoUrl}
              alt={`Ảnh chụp lúc chấm công ${formatTimeWithSeconds(log.recordedAt, timezone)}`}
              style={{
                width: '100%',
                aspectRatio: '3 / 4',
                objectFit: 'cover',
                borderRadius: 12,
                border: '1px solid var(--sf-outline-variant)',
              }}
            />
          ) : (
            <div
              style={{
                width: '100%',
                aspectRatio: '3 / 4',
                borderRadius: 12,
                background: 'var(--sf-neutral-100)',
                border: '1px solid var(--sf-outline-variant)',
                display: 'grid',
                placeItems: 'center',
                textAlign: 'center',
                padding: 16,
              }}
            >
              <div>
                <Icon name="no_photography" size={32} color="var(--sf-neutral-400)" />
                <p className="sf-body-sm sf-text-variant" style={{ marginBottom: 0 }}>
                  {log.authMethod === 'FINGERPRINT'
                    ? 'Chấm bằng vân tay — không có ảnh'
                    : 'Ảnh đã hết thời hạn lưu trữ'}
                </p>
              </div>
            </div>
          )}
          {/* Nói rõ vì sao ảnh có thể biến mất khi mở lại — docs/04 mục 3.4. */}
          <p className="sf-caption" style={{ margin: 0 }}>
            Liên kết ảnh hết hạn sau 5 phút. Tải lại trang để lấy liên kết mới.
          </p>
        </div>

        {/* ── Thời gian & xác thực ────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <DetailSection title="Thời gian">
            <DetailGrid>
              <DetailField label="Giờ máy chủ" hint="Đây là giờ dùng để tính công (BR-01)">
                {formatTimeWithSeconds(log.recordedAt, timezone)}
              </DetailField>
              <DetailField label="Giờ thiết bị gửi lên">
                {formatTimeWithSeconds(log.clientReportedAt, timezone)}
              </DetailField>
              <DetailField label="Độ lệch" hint="Lệch lớn là dấu hiệu chỉnh giờ thiết bị (AF-18)">
                <span
                  style={{
                    color:
                      Math.abs(log.clockSkewSeconds ?? 0) > 300
                        ? 'var(--sf-error-700)'
                        : 'var(--sf-on-surface)',
                    fontWeight: Math.abs(log.clockSkewSeconds ?? 0) > 300 ? 600 : 400,
                  }}
                >
                  {formatSecondsGap(log.clockSkewSeconds)}
                </span>
              </DetailField>
              <DetailField label="Nguồn">
                {log.isOffline ? 'Gửi lại sau khi mất mạng' : 'Trực tuyến'}
              </DetailField>
            </DetailGrid>
          </DetailSection>

          <DetailSection title="Xác thực">
            <DetailGrid>
              <DetailField label="Phương thức">
                {log.authMethod === 'FACE'
                  ? 'Khuôn mặt'
                  : log.authMethod === 'FINGERPRINT'
                    ? 'Vân tay'
                    : 'Nhập tay'}
              </DetailField>
              <DetailField label="Điểm tương đồng">{formatScore(log.matchScore)}</DetailField>
              <DetailField label="Điểm liveness">{formatScore(log.livenessScore)}</DetailField>
              <DetailField label="Hành động liveness">{log.livenessChallenge ?? '—'}</DetailField>
              <DetailField label="Phiên bản mô hình AI">{log.aiModelVersion ?? '—'}</DetailField>
              <DetailField label="Điểm rủi ro">
                <span
                  style={{
                    fontWeight: 600,
                    color: log.fraudScore > 0 ? 'var(--sf-warning-800)' : 'var(--sf-success-800)',
                  }}
                >
                  {log.fraudScore}
                </span>
              </DetailField>
            </DetailGrid>
          </DetailSection>
        </div>
      </div>

      {/* ── Vị trí ───────────────────────────────────────────────────── */}
      <DetailSection title="Vị trí">
        {outOfGeofence ? (
          <Alert
            type="warning"
            showIcon
            message="Chấm công ngoài vùng cho phép"
            description={`Cách chi nhánh ${formatDistance(log.distanceToBranchM)}${
              log.branch ? `, bán kính cho phép ${log.branch.radiusMeters}m` : ''
            }.`}
          />
        ) : null}

        <DetailGrid>
          <DetailField label="Chi nhánh">{log.branch?.name ?? '—'}</DetailField>
          <DetailField label="Khoảng cách">{formatDistance(log.distanceToBranchM)}</DetailField>
          <DetailField label="Nguồn vị trí">{log.locationProvider ?? '—'}</DetailField>
          <DetailField label="Độ chính xác GPS">{formatDistance(log.gpsAccuracy)}</DetailField>
          <DetailField label="Vị trí giả (mock)">
            {log.isMockLocation ? (
              <span style={{ color: 'var(--sf-error-700)', fontWeight: 600 }}>CÓ</span>
            ) : (
              'Không'
            )}
          </DetailField>
          <DetailField label="Toạ độ">
            {log.latitude !== null && log.longitude !== null
              ? `${log.latitude.toFixed(6)}, ${log.longitude.toFixed(6)}`
              : '—'}
          </DetailField>
        </DetailGrid>

        {log.latitude !== null && log.longitude !== null ? (
          env.VITE_GOOGLE_MAPS_API_KEY ? (
            <iframe
              title="Vị trí chấm công trên bản đồ"
              loading="lazy"
              style={{ width: '100%', height: 240, border: 0, borderRadius: 12 }}
              src={`https://www.google.com/maps/embed/v1/place?key=${env.VITE_GOOGLE_MAPS_API_KEY}&q=${log.latitude},${log.longitude}&zoom=17`}
            />
          ) : (
            // Không có API key thì vẫn phải mở được vị trí — link ra Google Maps
            // rẻ hơn nhiều so với để người dùng tự chép toạ độ.
            <a
              href={`https://www.google.com/maps?q=${log.latitude},${log.longitude}`}
              target="_blank"
              rel="noopener noreferrer"
              className="sf-body-sm"
              style={{ fontWeight: 600 }}
            >
              Mở vị trí trên Google Maps
            </a>
          )
        ) : null}
      </DetailSection>

      {/* ── Thiết bị & mạng ──────────────────────────────────────────── */}
      <DetailSection title="Thiết bị & mạng">
        <DetailGrid>
          <DetailField label="Thiết bị">
            {log.deviceModel ?? '—'}
            {log.osVersion ? ` · ${log.osVersion}` : ''}
          </DetailField>
          <DetailField label="Mã thiết bị">
            {log.deviceId ? `${log.deviceId.slice(0, 8)}…` : '—'}
          </DetailField>
          <DetailField label="Phiên bản app">{log.appVersion ?? '—'}</DetailField>
          <DetailField label="Địa chỉ IP">{log.ipAddress ?? '—'}</DetailField>
          <DetailField label="Thiết bị root/jailbreak">
            {log.isRootedDevice ? (
              <span style={{ color: 'var(--sf-error-700)', fontWeight: 600 }}>CÓ</span>
            ) : (
              'Không'
            )}
          </DetailField>
          <DetailField label="Kiểm chứng thiết bị">
            {log.attestationPassed === null ? '—' : log.attestationPassed ? 'Đạt' : 'Không đạt'}
          </DetailField>
        </DetailGrid>
      </DetailSection>
    </article>
  );
}
