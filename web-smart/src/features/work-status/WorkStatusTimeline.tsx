import { useEffect, useRef, useState } from 'react';
import { Tooltip } from 'antd';
import { formatClock } from './work-status.format';
import type {
  MinuteRange,
  OutsideInterval,
  WorkState,
  WorkStatusMark,
  WorkStatusRequest,
  WorkStatusShiftWindow,
} from './work-status.api';

/**
 * Dòng thời gian của MỘT người trong MỘT ngày.
 *
 * ## Vì sao là thanh trên trục giờ, không phải mấy cột "giờ vào / giờ ra"
 *
 * "08:02 → —" và "08:02 → 13:00, 14:10 → —" là hai tình huống khác hẳn nhau mà
 * hai cột giờ vào/ra không phân biệt được: cột chỉ giữ mốc ĐẦU và mốc CUỐI, nên
 * người đang ngồi làm và người vừa xin ra ngoài trông giống hệt nhau. Trục giờ
 * giữ được cả những gì xảy ra ở giữa — mà giữa mới là chỗ có câu trả lời cho
 * "bây giờ người này đang ở đâu".
 *
 * ## Bốn tầng, xếp chồng, mỗi tầng trả lời một câu
 *
 *  1. **Ca được xếp** (nền nhạt) — đáng lẽ phải có mặt lúc nào.
 *  2. **Đơn từ đã duyệt** (nền xanh mòng két) — hôm nay được phép vắng lúc nào.
 *  3. **Thực tế đã làm** (thanh đậm) — có mặt thật lúc nào, cắt rời ở đoạn ra ngoài.
 *  4. **Mốc quẹt thẻ** (vạch dọc) — chính xác từng lượt.
 *
 * Gộp bốn tầng thành một thanh sẽ mất đúng thứ cần tìm: khoảng LỆCH giữa kế
 * hoạch và thực tế.
 *
 * ## Màu không bao giờ đứng một mình
 *
 * docs/16 mục 14.2 điều 1. Mỗi dòng có `aria-label` đọc thành câu đầy đủ, và cột
 * trạng thái bên phải luôn có nhãn chữ. Người dùng bàn phím nghe được đúng những
 * gì người dùng chuột nhìn thấy qua màu.
 */

/** Chiều cao vùng vẽ. Đủ cho ba tầng chồng nhau mà dòng vẫn quét mắt được. */
const TRACK_HEIGHT = 34;

/**
 * Bề ngang tối thiểu của vùng vẽ.
 *
 * Không phải chuyện thẩm mỹ mà là chuyện tồn tại: mọi thứ bên trong vùng này đều
 * `position: absolute`, nên chiều rộng NỘI TẠI của nó bằng 0. Đặt trong một ô
 * bảng, cột đó sẽ co về 0 và cả dòng thời gian biến mất — các cột khác có nội
 * dung thật sẽ nuốt hết bề ngang.
 *
 * `colgroup` ở `WorkStatusPage` là tuyến phòng thủ chính; con số này là tuyến thứ
 * hai, và cũng là mốc để bảng bắt đầu cuộn ngang thay vì bóp trục giờ tới mức
 * các nhãn chồng lên nhau.
 */
const TRACK_MIN_WIDTH = 480;

export interface TimelineProps {
  window: MinuteRange;
  shiftWindows: WorkStatusShiftWindow[];
  breakWindows: MinuteRange[];
  requests: WorkStatusRequest[];
  marks: WorkStatusMark[];
  outsideIntervals: OutsideInterval[];
  firstCheckInMinutes: number | null;
  lastCheckOutMinutes: number | null;
  state: WorkState;
  /** Vạch "bây giờ". `null` = đang xem ngày khác, không vẽ vạch. */
  nowMinutes: number | null;
  label: string;
}

export function WorkStatusTimeline({
  window,
  shiftWindows,
  breakWindows,
  requests,
  marks,
  outsideIntervals,
  firstCheckInMinutes,
  lastCheckOutMinutes,
  state,
  nowMinutes,
  label,
}: TimelineProps) {
  const span = Math.max(1, window.toMinutes - window.fromMinutes);
  const pct = (minutes: number) => ((minutes - window.fromMinutes) / span) * 100;

  /** Kẹp về trong trục rồi mới vẽ — lượt quẹt ngoài khung sẽ tràn ra ngoài ô. */
  const clampPct = (minutes: number) => Math.min(100, Math.max(0, pct(minutes)));

  function band(from: number, to: number) {
    const left = clampPct(from);
    const right = clampPct(to);
    // Bề rộng tối thiểu 0.4%: một khoảng ra ngoài 5 phút trên trục 12 tiếng là
    // 0.7px và biến mất hoàn toàn — mà đúng những khoảng ngắn bất thường mới là
    // thứ người ta soi trên màn hình này.
    return { left: `${left}%`, width: `${Math.max(0.4, right - left)}%` };
  }

  /**
   * Đoạn ĐÃ LÀM, đã trừ những khoảng ra ngoài.
   *
   * Vẽ một thanh liền rồi phủ màu "ra ngoài" lên trên sẽ đúng về thị giác nhưng
   * sai về ngữ nghĩa với trình đọc màn hình và với `title` khi rê chuột. Cắt
   * thẳng ở đây thì mỗi mảnh là một khoảng có mặt thật.
   */
  const workedPieces = buildWorkedPieces(
    firstCheckInMinutes,
    lastCheckOutMinutes,
    outsideIntervals,
    nowMinutes,
    window,
  );

  const openOutside = outsideIntervals.filter((interval) => interval.toMinutes === null);
  const closedOutside = outsideIntervals.filter(
    (interval): interval is { fromMinutes: number; toMinutes: number } =>
      interval.toMinutes !== null,
  );

  return (
    <div
      role="img"
      aria-label={label}
      style={{
        position: 'relative',
        width: '100%',
        minWidth: TRACK_MIN_WIDTH,
        height: TRACK_HEIGHT,
        borderRadius: 6,
        background: 'var(--sf-neutral-50)',
        overflow: 'hidden',
      }}
    >
      {/* --- Tầng 1: ca được xếp. Nền nhạt, chiếm trọn chiều cao. --- */}
      {shiftWindows.map((shift) => (
        <span
          key={`shift-${shift.shiftId}-${shift.fromMinutes}`}
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            ...band(shift.fromMinutes, shift.toMinutes),
            background: 'var(--sf-neutral-200)',
          }}
        />
      ))}

      {/* Nghỉ giữa ca — khoét sáng ra khỏi nền ca để không ai đọc nhầm khoảng
          không có mặt lúc nghỉ trưa thành một khoảng vắng mặt. */}
      {breakWindows.map((rest, index) => (
        <span
          key={`break-${index}`}
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            ...band(rest.fromMinutes, rest.toMinutes),
            background: 'var(--sf-neutral-50)',
            borderLeft: '1px dashed var(--sf-neutral-300)',
            borderRight: '1px dashed var(--sf-neutral-300)',
          }}
        />
      ))}

      {/* --- Tầng 2: đơn từ. Đơn CHỜ DUYỆT vẽ gạch chéo, không tô đặc: nó chưa
              cho phép ai vắng mặt, và tô như đơn đã duyệt là nói dối về hiệu lực. --- */}
      {requests.map((request) => {
        const approved = request.status === 'APPROVED';
        const range = request.wholeDay
          ? { fromMinutes: window.fromMinutes, toMinutes: window.toMinutes }
          : request;

        return (
          <Tooltip
            key={`req-${request.id}`}
            title={`${request.typeName}${approved ? '' : ' · chờ duyệt'}${request.reason ? ` — ${request.reason}` : ''}`}
          >
            <span
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                ...band(range.fromMinutes, range.toMinutes),
                background: approved
                  ? 'var(--sf-teal-100)'
                  : 'repeating-linear-gradient(45deg, var(--sf-teal-50) 0 6px, transparent 6px 12px)',
                borderTop: approved ? 'none' : '1px dashed var(--sf-teal-400)',
                borderBottom: approved ? 'none' : '1px dashed var(--sf-teal-400)',
              }}
            />
          </Tooltip>
        );
      })}

      {/* --- Tầng 3: thực tế đã làm. Dải giữa, mảnh hơn nền ca để nền ca vẫn
              nhìn thấy ở hai đầu — chính hai đầu đó là "đi muộn" và "về sớm". --- */}
      {workedPieces.map((piece, index) => (
        <span
          key={`worked-${index}`}
          style={{
            position: 'absolute',
            top: 8,
            height: TRACK_HEIGHT - 16,
            borderRadius: 3,
            ...band(piece.fromMinutes, piece.toMinutes),
            background: WORKED_COLOR[state] ?? 'var(--sf-teal-600)',
          }}
        />
      ))}

      {closedOutside.map((interval, index) => (
        <Tooltip
          key={`out-${index}`}
          title={`Ra ngoài ${formatClock(interval.fromMinutes)}–${formatClock(interval.toMinutes)}`}
        >
          <span
            style={{
              position: 'absolute',
              top: 8,
              height: TRACK_HEIGHT - 16,
              borderRadius: 3,
              ...band(interval.fromMinutes, interval.toMinutes),
              background:
                'repeating-linear-gradient(45deg, var(--sf-warning-100) 0 5px, var(--sf-warning-50) 5px 10px)',
              border: '1px solid var(--sf-warning-700)',
            }}
          />
        </Tooltip>
      ))}

      {/* Khoảng ra ngoài CHƯA đóng: kéo tới tận "bây giờ" và tô đậm hơn — đây là
          người đang vắng mặt ngay lúc này, không phải một sự kiện đã qua. */}
      {openOutside.map((interval, index) => (
        <Tooltip
          key={`out-open-${index}`}
          title={`Đang ở ngoài từ ${formatClock(interval.fromMinutes)}`}
        >
          <span
            style={{
              position: 'absolute',
              top: 8,
              height: TRACK_HEIGHT - 16,
              borderRadius: 3,
              ...band(interval.fromMinutes, nowMinutes ?? window.toMinutes),
              background: 'var(--sf-warning-100)',
              border: '1px solid var(--sf-warning-800)',
            }}
          />
        </Tooltip>
      ))}

      {/* --- Tầng 4: mốc quẹt thẻ. Vạch dọc mảnh, cao hết ô để đọc được cả khi
              nó rơi vào chỗ không có thanh nào bên dưới. --- */}
      {marks.map((mark) => (
        <Tooltip
          key={mark.logId}
          title={`${MARK_LABEL[mark.type] ?? mark.type} ${formatClock(mark.atMinutes)}${
            mark.branchName ? ` · ${mark.branchName}` : ''
          } · ${AUTH_LABEL[mark.authMethod] ?? mark.authMethod}`}
        >
          <span
            style={{
              position: 'absolute',
              top: 2,
              bottom: 2,
              left: `${clampPct(mark.atMinutes)}%`,
              width: 2,
              marginLeft: -1,
              borderRadius: 1,
              background: MARK_COLOR[mark.type] ?? 'var(--sf-neutral-800)',
            }}
          />
        </Tooltip>
      ))}

      {/* --- Vạch "bây giờ". Chỉ vẽ khi đang xem hôm nay: trên một ngày đã qua
              nó là một vạch vô nghĩa nằm ở cuối mọi dòng. --- */}
      {nowMinutes !== null &&
      nowMinutes >= window.fromMinutes &&
      nowMinutes <= window.toMinutes ? (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${clampPct(nowMinutes)}%`,
            width: 1,
            background: 'var(--sf-error-600)',
          }}
        />
      ) : null}
    </div>
  );
}

// =============================================================================
//  Trục giờ dùng chung cho cả bảng
// =============================================================================

/** Các bước nhảy được phép, từ dày tới thưa. Toàn mốc giờ "tròn" mà người ta đọc quen. */
const AXIS_STEPS_MINUTES = [30, 60, 120, 180, 240, 360];

/**
 * Khoảng cách tối thiểu giữa hai nhãn giờ.
 *
 * Một nhãn "07:00" ở cỡ chú thích rộng ~34px. 56px cho nó ~22px thở — đủ để hai
 * nhãn cạnh nhau không dính, chưa tới mức phí chỗ.
 */
const MIN_LABEL_GAP_PX = 56;

/** Nửa bề ngang một nhãn. Dùng để biết nhãn ở hai đầu có tràn ra ngoài trục không. */
const LABEL_HALF_WIDTH_PX = 20;

/**
 * Vạch chia giờ trên đầu lưới.
 *
 * ## Mật độ nhãn ĐO được, không đoán
 *
 * Cột này co giãn theo bề ngang cửa sổ: 480px lúc chật nhất, gần 1000px trên màn
 * rộng. Chọn bước nhảy theo cận dưới thì màn rộng bị thưa vô cớ; chọn theo cận
 * trên thì màn hẹp có 12 nhãn chồng lên nhau. Cả hai đều sai ở một nửa số máy.
 *
 * Vì vậy `ResizeObserver` đo bề ngang thật rồi chọn bước nhảy nhỏ nhất mà hai
 * nhãn cạnh nhau vẫn cách nhau `MIN_LABEL_GAP_PX`. Màn rộng được nhãn từng giờ,
 * màn hẹp tự giãn sang 2 tiếng — không cần ai chỉnh gì.
 *
 * ## Nhãn ở hai đầu KHÔNG căn giữa
 *
 * Mốc cuối thường rơi đúng 100% (Backend làm tròn khoảng lên mốc giờ tròn), nên
 * căn giữa là để một nửa nhãn tràn sang cột Trạng thái bên cạnh. Hai nhãn đầu và
 * cuối vì thế nép vào trong; riêng vạch chỉ vị trí vẫn nằm đúng toạ độ thật, nên
 * không mất độ chính xác nào.
 */
export function TimelineAxis({ window }: { window: MinuteRange }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width;
      if (measured) setWidth(measured);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const span = Math.max(1, window.toMinutes - window.fromMinutes);

  // Lần render đầu chưa đo được gì. Giả định bề ngang TỐI THIỂU: thà thưa một
  // nhịp rồi dày lên, còn hơn hiện ra chồng chữ rồi mới giãn ra trước mắt người
  // dùng.
  const usable = width || TRACK_MIN_WIDTH;
  const step =
    AXIS_STEPS_MINUTES.find((candidate) => (candidate / span) * usable >= MIN_LABEL_GAP_PX) ??
    (AXIS_STEPS_MINUTES[AXIS_STEPS_MINUTES.length - 1] as number);

  const ticks: number[] = [];
  const first = Math.ceil(window.fromMinutes / step) * step;
  for (let minute = first; minute <= window.toMinutes; minute += step) ticks.push(minute);

  return (
    // Cùng `minWidth` với vùng vẽ bên dưới — hai thứ phải chia cùng một trục,
    // lệch nhau một pixel là mọi nhãn giờ trỏ sai chỗ trên cả bảng.
    <div
      ref={ref}
      style={{ position: 'relative', width: '100%', minWidth: TRACK_MIN_WIDTH, height: 20 }}
    >
      {ticks.map((minute) => {
        const ratio = (minute - window.fromMinutes) / span;
        const left = `${ratio * 100}%`;

        // Còn bao nhiêu chỗ mỗi bên của mốc này. Nhãn nào không đủ chỗ để căn
        // giữa thì nép hẳn vào trong thay vì tràn ra khỏi trục.
        const spaceRight = (1 - ratio) * usable;
        const spaceLeft = ratio * usable;
        const transform =
          spaceRight < LABEL_HALF_WIDTH_PX
            ? 'translateX(-100%)'
            : spaceLeft < LABEL_HALF_WIDTH_PX
              ? 'none'
              : 'translateX(-50%)';

        return (
          <span key={minute}>
            <span
              className="sf-caption sf-text-variant"
              style={{
                position: 'absolute',
                top: 0,
                left,
                transform,
                whiteSpace: 'nowrap',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {formatClock(minute)}
            </span>
            <span
              aria-hidden="true"
              style={{
                position: 'absolute',
                bottom: 0,
                left,
                width: 1,
                height: 4,
                background: 'var(--sf-neutral-300)',
              }}
            />
          </span>
        );
      })}
    </div>
  );
}

// =============================================================================
//  Bảng tra
// =============================================================================

/**
 * Màu thanh "đã làm" nói luôn trạng thái, để không phải liếc sang cột bên phải.
 *
 * Chỉ ba tông, không phải mười một: thanh này trả lời ĐÚNG MỘT câu — "có vấn đề
 * gì không". Trạng thái đầy đủ đã có nhãn chữ ngay cạnh, và nhồi mười một màu
 * vào một kênh thị giác là biến nó thành không kênh nào.
 */
const WORKED_COLOR: Partial<Record<WorkState, string>> = {
  WORKING: 'var(--sf-teal-600)',
  DONE: 'var(--sf-success-600)',
  OUTSIDE: 'var(--sf-warning-700)',
  MISSING_CHECKOUT: 'var(--sf-warning-700)',
};

const MARK_LABEL: Record<string, string> = {
  CHECK_IN: 'Chấm vào',
  CHECK_OUT: 'Chấm ra',
  BREAK_OUT: 'Ra ngoài',
  BREAK_IN: 'Vào lại',
  RANDOM_CHECK: 'Xác thực giữa ca',
};

const MARK_COLOR: Record<string, string> = {
  CHECK_IN: 'var(--sf-success-800)',
  CHECK_OUT: 'var(--sf-neutral-800)',
  BREAK_OUT: 'var(--sf-warning-800)',
  BREAK_IN: 'var(--sf-warning-800)',
  RANDOM_CHECK: 'var(--sf-teal-500)',
};

const AUTH_LABEL: Record<string, string> = {
  FACE: 'khuôn mặt',
  FINGERPRINT: 'vân tay',
  MANUAL: 'nhập tay',
  KIOSK: 'kiosk',
};

// =============================================================================
//  Tiện ích
// =============================================================================

/**
 * Các đoạn CÓ MẶT thật, đã khoét bỏ những khoảng ra ngoài.
 *
 * Đầu đoạn là lượt chấm vào; cuối đoạn là lượt chấm ra, hoặc "bây giờ" nếu người
 * đó chưa chấm ra và đang là hôm nay. Với ngày đã qua mà thiếu lượt chấm ra thì
 * kéo tới hết trục — vẽ tới "bây giờ" của một ngày đã qua là vẽ tới cuối ngày,
 * nhưng nói ra điều đó ở đây rõ hơn là để nó xảy ra tình cờ.
 */
function buildWorkedPieces(
  checkIn: number | null,
  checkOut: number | null,
  outside: OutsideInterval[],
  nowMinutes: number | null,
  window: MinuteRange,
): MinuteRange[] {
  if (checkIn === null) return [];

  const end = checkOut ?? nowMinutes ?? window.toMinutes;
  if (end <= checkIn) return [{ fromMinutes: checkIn, toMinutes: checkIn }];

  // Chỉ những khoảng ĐÃ ĐÓNG mới cắt đôi đoạn làm việc. Khoảng còn mở kéo tới
  // hết đoạn, nên nó cắt phần đuôi chứ không tạo ra một mảnh mới phía sau.
  const cuts = outside
    .map((interval) => ({
      from: interval.fromMinutes,
      to: interval.toMinutes ?? end,
    }))
    .filter((cut) => cut.to > checkIn && cut.from < end)
    .sort((a, b) => a.from - b.from);

  const pieces: MinuteRange[] = [];
  let cursor = checkIn;

  for (const cut of cuts) {
    if (cut.from > cursor) pieces.push({ fromMinutes: cursor, toMinutes: cut.from });
    cursor = Math.max(cursor, cut.to);
  }
  if (cursor < end) pieces.push({ fromMinutes: cursor, toMinutes: end });

  return pieces;
}
