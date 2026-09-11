import type { ReactNode } from 'react';
import { Icon } from '@/components/ui';
import { BrandMark } from '@/components/BrandMark';

/** Một bước của thanh tiến độ kích hoạt tài khoản. */
export interface AuthStep {
  label: string;
  state: 'done' | 'current' | 'todo';
}

/**
 * Khung cho các màn hình chưa đăng nhập — bố cục theo mockup Figma `58:59`.
 *
 * Nửa trái là dải navy mang nhận diện thương hiệu, nửa phải là biểu mẫu trên nền
 * trắng. Dưới breakpoint `lg` bỏ hẳn nửa trái — trên tablet dọc nó chiếm chỗ của
 * bàn phím ảo mà không mang thêm thông tin nào.
 *
 * ## Vì sao navy chứ không phải blue-700
 *
 * Thanh điều hướng sau khi đăng nhập là navy. Màn đăng nhập màu xanh dương tươi
 * rồi vào trong lại thành navy khiến hai màn hình trông như hai sản phẩm; navy ở
 * cả hai chỗ làm cái nền tối trở thành một hằng số của thương hiệu.
 */
export function AuthShell({
  title,
  subtitle,
  steps,
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  /** Thanh "1. Đổi mật khẩu · 2. Xác thực OTP · 3. Hoàn tất" của luồng kích hoạt. */
  steps?: AuthStep[];
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="sf-auth">
      {/* Nửa trang trí — trình đọc màn hình không cần đọc lại khẩu hiệu. */}
      <aside className="sf-auth__brand sf-on-dark" aria-hidden="true">
        <div className="sf-auth__wordmark">
          <BrandMark className="sf-auth__mark" />
          SmartFace
        </div>

        <BrandArt />

        <div>
          <h2 className="sf-auth__slogan">
            Quản lý chấm công
            <br />
            minh bạch, chính xác
          </h2>

          <ul className="sf-auth__features">
            {FEATURES.map((feature) => (
              <li key={feature.title}>
                <span className="sf-auth__feature-icon" style={{ background: feature.color }}>
                  <Icon name={feature.icon} size={26} fill />
                </span>
                <span>
                  <strong>{feature.title}</strong>
                  <span className="sf-auth__feature-note">{feature.note}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <main className="sf-auth__main">
        <div className="sf-auth__panel">
          {/*
            Biểu mẫu nằm trong một thẻ nổi trên nền xám nhạt, đúng bản vẽ. Cái
            viền đó không chỉ để đẹp: nửa phải rộng hơn biểu mẫu rất nhiều, và
            không có thẻ thì các ô nhập trôi giữa một mảng trắng vô tận, không
            gì cho mắt biết vùng cần điền bắt đầu và kết thúc ở đâu.
          */}
          <section className="sf-auth__card">
            {steps ? <AuthStepper steps={steps} /> : null}

            <h1 className="sf-auth__title">{title}</h1>
            {subtitle ? <p className="sf-auth__subtitle">{subtitle}</p> : null}

            {children}

            {footer ? <div style={{ marginTop: 24 }}>{footer}</div> : null}
          </section>

          {/*
            Hai liên kết pháp lý nằm ở KHUNG chứ không ở từng màn: chúng phải có
            mặt trên mọi màn chưa đăng nhập, và đặt ở từng màn thì sớm muộn sẽ có
            một màn mới quên mất chúng. Chúng nằm NGOÀI thẻ — bản vẽ đặt chúng
            dưới chân trang, không phải phần cuối của biểu mẫu.
          */}
          <p className="sf-auth__legal">
            <a href="/dieu-khoan">Điều khoản sử dụng</a>
            <span className="sf-auth__legal-sep" aria-hidden="true">
              |
            </span>
            <a href="/bao-mat">Chính sách bảo mật</a>
          </p>
        </div>
      </main>
    </div>
  );
}

/**
 * Thanh ba bước của luồng kích hoạt tài khoản.
 *
 * Không bấm được, và đó là chủ ý: người dùng KHÔNG được nhảy tới bước xác thực
 * số điện thoại khi mật khẩu tạm còn nguyên — Backend cũng chặn đúng như vậy
 * (`PasswordChangeGuard`). Một thanh bước bấm được ở đây sẽ hứa một thứ máy chủ
 * không cho phép.
 *
 * ## Chỉ bước đang làm mới có huy hiệu tròn
 *
 * Bản vẽ để bước 2 và 3 là chữ xám trơn, "2. Xác thực OTP" — không vòng tròn,
 * không nền. Ba huy hiệu xếp ngang nhau làm cả ba bước trông ngang vai nhau, và
 * người dùng phải đọc màu chữ mới biết mình đang ở đâu; một huy hiệu duy nhất
 * thì nói ngay điều đó từ khoảng cách một mét.
 *
 * ## Mũi tên nằm trong `<li>`, không phải `<li>` riêng
 *
 * Bản vẽ có mũi tên "→" giữa các bước. Cho mỗi mũi tên một `<li>` của riêng nó
 * sẽ biến danh sách ba bước thành danh sách năm mục, và trình đọc màn hình đọc
 * "mục 2 trên 5" cho một hình trang trí. Đặt nó bên trong `<li>` của bước đứng
 * sau, kèm `aria-hidden`, thì nó vẽ ở đúng chỗ mà không lọt vào cây ngữ nghĩa.
 */
function AuthStepper({ steps }: { steps: AuthStep[] }) {
  return (
    <ol className="sf-auth-steps" aria-label="Tiến độ kích hoạt tài khoản">
      {steps.map((step, index) => (
        <li
          key={step.label}
          className={`sf-auth-steps__item sf-auth-steps__item--${step.state}`}
          aria-current={step.state === 'current' ? 'step' : undefined}
        >
          {index > 0 ? (
            <span className="sf-auth-steps__arrow" aria-hidden="true">
              <Icon name="arrow_forward" size={16} />
            </span>
          ) : null}

          {step.state === 'todo' ? null : (
            <span className="sf-auth-steps__badge">
              {step.state === 'done' ? <Icon name="check" size={14} /> : index + 1}
            </span>
          )}
          <span className="sf-auth-steps__label">
            {index + 1}. {step.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Các đỉnh của lưới khuôn mặt, trong hệ toạ độ của `BrandArt`.
 *
 * Tách ra thành dữ liệu thay vì viết thẳng ~36 thẻ `<line>`: lưới này chỉ đúng
 * khi mọi cạnh nối vào cùng một bộ đỉnh, và gõ tay từng cặp toạ độ thì chỉ cần
 * lệch một chữ số là có một cạnh treo lơ lửng, không ai nhìn ra ngay.
 */
const FACE_POINTS = {
  top: [110, 62],
  ul: [86, 68],
  ur: [134, 68],
  tl: [78, 86],
  tr: [142, 86],
  cl: [80, 110],
  cr: [140, 110],
  jl: [90, 132],
  jr: [130, 132],
  chin: [110, 146],
  brow: [110, 76],
  bl: [97, 84],
  br: [123, 84],
  el: [98, 94],
  er: [122, 94],
  nose: [110, 95],
  tip: [110, 112],
  ml: [100, 124],
  mr: [120, 124],
  mouth: [110, 126],
  chl: [92, 110],
  chr: [128, 110],
} as const satisfies Record<string, readonly [number, number]>;

type FacePoint = keyof typeof FACE_POINTS;

/** Cạnh của lưới — vành mặt, sống giữa, hai chuỗi bên, rồi các cạnh chéo nối chúng. */
const FACE_EDGES: [FacePoint, FacePoint][] = [
  // Vành mặt
  ['top', 'ur'],
  ['ur', 'tr'],
  ['tr', 'cr'],
  ['cr', 'jr'],
  ['jr', 'chin'],
  ['chin', 'jl'],
  ['jl', 'cl'],
  ['cl', 'tl'],
  ['tl', 'ul'],
  ['ul', 'top'],
  // Sống giữa
  ['top', 'brow'],
  ['brow', 'nose'],
  ['nose', 'tip'],
  ['tip', 'mouth'],
  ['mouth', 'chin'],
  // Chuỗi bên trái
  ['ul', 'bl'],
  ['bl', 'el'],
  ['el', 'chl'],
  ['chl', 'ml'],
  ['ml', 'jl'],
  // Chuỗi bên phải
  ['ur', 'br'],
  ['br', 'er'],
  ['er', 'chr'],
  ['chr', 'mr'],
  ['mr', 'jr'],
  // Cạnh chéo nối sống giữa với hai bên
  ['brow', 'bl'],
  ['brow', 'br'],
  ['nose', 'el'],
  ['nose', 'er'],
  ['tip', 'chl'],
  ['tip', 'chr'],
  ['mouth', 'ml'],
  ['mouth', 'mr'],
  // Cạnh nối vành mặt vào trong
  ['tl', 'bl'],
  ['tr', 'br'],
  ['cl', 'chl'],
  ['cr', 'chr'],
  ['ul', 'brow'],
  ['ur', 'brow'],
  ['jl', 'mouth'],
  ['jr', 'mouth'],
];

/** Ô ngày tô đậm trên tấm lịch — chỉ để tấm lịch trông có dữ liệu, không mang nghĩa gì. */
const CALENDAR_MARKED = new Set(['1-1', '2-2', '0-3']);

/**
 * Hình minh hoạ nửa trái — khung quét khuôn mặt dạng lưới, tấm lịch, đồng hồ và
 * dấu tích.
 *
 * ## Vì sao là SVG chứ không phải một tệp ảnh
 *
 * Nó đổi màu theo token (nền navy, điểm nhấn blue và success) — tệp PNG thì
 * không. Nó nét ở mọi độ phân giải, kể cả màn hình 2x mà một tệp PNG xuất một
 * lần sẽ bị nhoè. Và nó nặng vài KB trong khi một ảnh minh hoạ cùng kích thước
 * tốn hàng chục KB, ngay trên màn hình người dùng đang chờ để vào hệ thống.
 *
 * ## Bố cục bám bản vẽ
 *
 * Khung quét nằm bên trái, bên trong là khuôn mặt vẽ dạng lưới tam giác với hai
 * mắt phát sáng. Tấm lịch chồng lên góc trên bên phải. Đồng hồ đậu ở góc dưới
 * bên trái tấm lịch, đè lên góc dưới bên phải khung quét. Dấu tích xanh lá bám
 * mép phải tấm lịch. Bốn vật thể ĐÈ LÊN NHAU chứ không xếp hàng ngang — bản vẽ
 * dựng chiều sâu bằng cách chồng lớp, xếp ngang sẽ ra một dải icon phẳng.
 *
 * Hai huy hiệu tròn đều có một vòng navy bao ngoài. Vòng đó không phải viền
 * trang trí: nó là khoảng hở để huy hiệu tách khỏi nền trắng của tấm lịch mà nó
 * đang đè lên.
 */
function BrandArt() {
  return (
    <svg
      className="sf-auth__art"
      viewBox="0 0 360 224"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      focusable="false"
    >
      {/*
        Không có vệt mạch điện ở ĐÂY. Bốn vật thể đã chiếm gần hết khung nhìn,
        nên mọi vệt vẽ thêm vào đều cắt ngang một trong số chúng và trông như
        lỗi hiển thị. Lớp hoạ tiết nền nằm ở `.sf-auth__brand`, phủ cả nửa
        trái và chạy phía sau chứ không đâm vào khung quét.
      */}

      {/* Khung quét */}
      <rect
        x="20"
        y="16"
        width="180"
        height="180"
        rx="24"
        fill="#ffffff"
        fillOpacity="0.05"
        stroke="var(--sf-blue-400)"
        strokeOpacity="0.28"
      />
      {[
        'M36 66V48a12 12 0 0 1 12-12h18',
        'M154 36h18a12 12 0 0 1 12 12v18',
        'M184 146v18a12 12 0 0 1-12 12h-18',
        'M66 176H48a12 12 0 0 1-12-12v-18',
      ].map((d) => (
        <path key={d} d={d} stroke="var(--sf-blue-400)" strokeWidth="5" strokeLinecap="round" />
      ))}

      {/*
        Lưới khuôn mặt, phóng 1.45 lần quanh tâm của chính nó.

        Toạ độ gốc dựng khuôn mặt rộng 64px, chỉ chiếm khoảng bốn phần mười bề
        ngang khung quét — nhìn ra một chấm nhỏ lọt thỏm. Phóng ở đây thay vì
        sửa 22 cặp toạ độ: một phép biến hình giữ nguyên tỉ lệ giữa các đỉnh,
        còn sửa tay thì lệch một đỉnh là méo cả lưới.
      */}
      <g transform="translate(110 106) scale(1.45) translate(-110 -104)">
        <g stroke="var(--sf-blue-300)" strokeWidth="0.9" strokeOpacity="0.75">
          {FACE_EDGES.map(([from, to]) => (
            <line
              key={`${from}-${to}`}
              x1={FACE_POINTS[from][0]}
              y1={FACE_POINTS[from][1]}
              x2={FACE_POINTS[to][0]}
              y2={FACE_POINTS[to][1]}
            />
          ))}
        </g>
        <g fill="var(--sf-blue-300)">
          {Object.entries(FACE_POINTS).map(([name, point]) => (
            <circle key={name} cx={point[0]} cy={point[1]} r="1.5" />
          ))}
        </g>

        {/* Hai mắt phát sáng — quầng mờ bên ngoài, nhân sáng bên trong. */}
        {[FACE_POINTS.el, FACE_POINTS.er].map((point) => (
          <g key={point[0]}>
            <circle cx={point[0]} cy={point[1]} r="5" fill="var(--sf-blue-400)" fillOpacity="0.4" />
            <circle cx={point[0]} cy={point[1]} r="2.4" fill="#e0f2fe" />
          </g>
        ))}
      </g>

      {/* Tấm lịch */}
      <rect x="216" y="54" width="8" height="18" rx="4" fill="var(--sf-blue-800)" />
      <rect x="302" y="54" width="8" height="18" rx="4" fill="var(--sf-blue-800)" />
      <rect x="196" y="64" width="132" height="112" rx="12" fill="#ffffff" />
      <path
        d="M196 76a12 12 0 0 1 12-12h108a12 12 0 0 1 12 12v14H196V76Z"
        fill="var(--sf-blue-600)"
      />
      {[0, 1, 2].map((row) =>
        [0, 1, 2, 3].map((col) => (
          <rect
            key={`${row}-${col}`}
            x={206 + col * 29}
            y={102 + row * 22}
            width="20"
            height="14"
            rx="3"
            fill={
              CALENDAR_MARKED.has(`${row}-${col}`) ? 'var(--sf-blue-500)' : 'var(--sf-neutral-200)'
            }
          />
        )),
      )}

      {/*
        Chìa khoá — đè lên góc dưới bên phải khung quét.

        Bản vẽ để CHÌA KHOÁ ở đây, không phải đồng hồ. Đây là màn đổi mật khẩu:
        vật thể thứ ba phải nói về cái việc người dùng đang làm. Đồng hồ nói về
        giờ giấc — đúng cho màn đăng nhập, lạc chỗ ở đây.
      */}
      <circle cx="186" cy="182" r="30" fill="var(--sf-navy)" />
      <circle cx="186" cy="182" r="25" fill="var(--sf-blue-600)" />
      <g stroke="#ffffff" strokeWidth="3.2" strokeLinecap="round" fill="none">
        {/* Vòng cầm ở dưới trái, thân chìa chỉ lên trên phải, hai răng ở gần mũi. */}
        <circle cx="179" cy="190" r="6.5" />
        <path d="M183.8 185.4 197 172.2" />
        <path d="M189.6 179.6l4.4 4.4" />
        <path d="M193.4 175.8l4.4 4.4" />
      </g>

      {/*
        Dấu tích — "đã ghi nhận", bám GÓC DƯỚI BÊN PHẢI tấm lịch.

        Bản vẽ neo nó vào góc chứ không vào giữa mép phải: ở giữa mép, dấu tích
        trôi lơ lửng cạnh tấm lịch; ở góc, nó đọc ra là "tấm lịch này đã xong".
      */}
      <circle cx="326" cy="164" r="26" fill="var(--sf-navy)" />
      <circle cx="326" cy="164" r="21" fill="var(--sf-success-500)" />
      <path
        d="M317 164.5l6 6 12-13"
        stroke="#ffffff"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Ba dòng giới thiệu.
 *
 * ⚠ Câu chữ ở đây lấy NGUYÊN VĂN từ bản vẽ. Bản trước dùng ba câu khác — "Giờ
 * chính thức luôn là giờ máy chủ", "Mọi quyết định để lại dấu vết không xoá
 * được", "Số liệu truy được về từng lượt chấm gốc" — với lập luận rằng chúng là
 * cam kết kiểm chứng được chứ không phải tính từ. Lập luận đó vẫn đúng, nhưng
 * đây là trang tiếp thị đầu tiên người dùng nhìn thấy và câu chữ của nó do bản
 * thiết kế quyết định. Đừng đổi lại nếu không có một bản vẽ mới.
 */
const FEATURES = [
  {
    icon: 'schedule',
    title: 'Chấm công',
    note: 'Ghi nhận nhanh chóng, chính xác',
    color: 'var(--sf-blue-600)',
  },
  {
    icon: 'assignment_turned_in',
    title: 'Duyệt đơn',
    note: 'Xử lý đơn từ mọi lúc, mọi nơi',
    color: 'var(--sf-success-600)',
  },
  {
    icon: 'bar_chart',
    title: 'Tính công',
    note: 'Tự động, minh bạch, đúng quy định',
    // blue-500, KHONG phai blue-800: mau tham chim vao nen navy (1.95:1).
    // Xem cap "Huy hieu thu ba tren navy" trong `check-contrast.mjs`.
    color: 'var(--sf-blue-500)',
  },
];
