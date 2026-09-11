import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { TextInput } from '@/components/ui';

const LENGTH = 6;

/**
 * Sáu ô nhập mã OTP — mockup Figma màn "Xác thực số điện thoại".
 *
 * ## Vì sao sáu ô chứ không phải một ô
 *
 * Sáu ô nói ngay độ dài của mã mà không cần một dòng chữ giải thích, và người
 * dùng thấy được mình đã gõ tới số thứ mấy khi phải liếc đi liếc lại giữa màn
 * hình và tin nhắn. Đổi lại phải tự lo bốn thứ mà một ô đơn cho sẵn: tự nhảy ô,
 * xoá lùi, dán cả mã, và tự động điền từ tin nhắn.
 *
 * `autoComplete="one-time-code"` đặt ở ô ĐẦU TIÊN. Trình duyệt điền cả chuỗi
 * vào đúng ô đó, nên `onChange` phải chấp nhận nhiều ký tự một lúc và tự rải ra
 * các ô sau — xử lý như thể người dùng vừa dán.
 *
 * ## Mã dự phòng thì sao
 *
 * Ô này chỉ nhận đúng sáu chữ số. Mã dự phòng (dài hơn, có chữ) nhập ở luồng
 * đăng nhập hai lớp `TwoFactorStep`, nơi vẫn là một ô văn bản tự do — người mất
 * điện thoại cần lối vào đó, còn ở màn kích hoạt lần đầu thì họ chưa hề có mã
 * dự phòng nào để mà nhập.
 */
export function OtpInput({
  value,
  onChange,
  onComplete,
  disabled,
  label = 'Mã xác thực',
}: {
  value: string;
  onChange: (value: string) => void;
  /** Gọi khi đủ sáu số — để bấm Enter hay tự gửi mà không phải chờ nút. */
  onComplete?: (value: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.padEnd(LENGTH).slice(0, LENGTH).split('');

  const commit = (next: string) => {
    const clean = next.replace(/\D/g, '').slice(0, LENGTH);
    onChange(clean);
    if (clean.length === LENGTH) onComplete?.(clean);
    return clean;
  };

  const handleInput = (index: number, raw: string) => {
    const typed = raw.replace(/\D/g, '');
    if (!typed) {
      // Xoá bằng phím Delete hoặc chọn-rồi-gõ-trắng: bỏ đúng chữ số ở ô này.
      const next = value.split('');
      next[index] = '';
      commit(next.join('').replace(/\s/g, ''));
      return;
    }

    // Gõ một ký tự thì thay tại chỗ; nhận nhiều ký tự (dán hoặc trình duyệt tự
    // điền) thì rải từ ô hiện tại trở đi.
    const merged = (value.slice(0, index) + typed).slice(0, LENGTH);
    const clean = commit(merged);
    focusAt(Math.min(clean.length, LENGTH - 1));
  };

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && !digits[index]?.trim() && index > 0) {
      // Ô đang trống mà bấm xoá lùi → lùi một ô và xoá chữ số ở đó. Không làm
      // thế thì người dùng phải bấm xoá hai lần cho mỗi ô, và lần đầu không có
      // gì xảy ra trên màn hình.
      event.preventDefault();
      commit(value.slice(0, index - 1));
      focusAt(index - 1);
      return;
    }
    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      focusAt(index - 1);
    }
    if (event.key === 'ArrowRight' && index < LENGTH - 1) {
      event.preventDefault();
      focusAt(index + 1);
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const clean = commit(event.clipboardData.getData('text'));
    focusAt(Math.min(clean.length, LENGTH - 1));
  };

  const focusAt = (index: number) => refs.current[index]?.focus();

  return (
    <div className="sf-otp" role="group" aria-label={label}>
      {Array.from({ length: LENGTH }, (_, index) => (
        <TextInput
          key={index}
          ref={(node) => {
            refs.current[index] = node;
          }}
          value={digits[index]?.trim() ?? ''}
          onChange={(event) => handleInput(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={handlePaste}
          onFocus={(event) => event.target.select()}
          disabled={disabled}
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          aria-label={`${label} — số thứ ${index + 1}`}
        />
      ))}
    </div>
  );
}
