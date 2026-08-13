import { initials } from '@/lib/utils/format';

export interface EmployeeRef {
  id: string;
  fullName: string;
  employeeCode?: string;
  departmentName?: string | null;
  department?: { id: string; name: string } | null;
  avatarUrl?: string | null;
}

/**
 * Ô "Nhân viên" trong bảng — docs/16 mục 11.8.
 *
 * Avatar `32px` nền `teal-700`, chữ viết tắt `#FFFFFF` (8.97:1). Bản Figma cũ
 * dùng `#82C6AD` — 4.54:1, sát ngưỡng tới mức đổi độ sáng màn hình là trượt.
 */
export function EmployeeCell({
  employee,
  secondary,
}: {
  employee: EmployeeRef | null | undefined;
  /** Dòng phụ. Bỏ trống thì mặc định hiện mã nhân viên. */
  secondary?: string | null;
}) {
  if (!employee) {
    return <span className="sf-text-muted">Không xác định</span>;
  }

  const sub = secondary ?? employee.employeeCode ?? employee.department?.name ?? null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
      {employee.avatarUrl ? (
        <img
          src={employee.avatarUrl}
          alt=""
          width={32}
          height={32}
          style={{ borderRadius: 9999, objectFit: 'cover', flexShrink: 0 }}
        />
      ) : (
        <span
          aria-hidden="true"
          style={{
            width: 32,
            height: 32,
            borderRadius: 9999,
            background: 'var(--sf-teal-700)',
            color: '#FFFFFF',
            display: 'grid',
            placeItems: 'center',
            fontSize: 14,
            lineHeight: '20px',
            fontWeight: 600,
            letterSpacing: '0.7px',
            flexShrink: 0,
          }}
        >
          {initials(employee.fullName)}
        </span>
      )}

      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            lineHeight: '20px',
            fontWeight: 600,
            letterSpacing: '0.7px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {employee.fullName}
        </div>
        {sub ? (
          <div
            className="sf-body-sm sf-text-variant"
            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {sub}
          </div>
        ) : null}
      </div>
    </div>
  );
}
