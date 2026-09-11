import { useCallback, useEffect, useState } from 'react';

/** Lựa chọn của người dùng, không phải chế độ đang hiển thị. */
export type ThemePreference = 'system' | 'light' | 'dark';

/** Chế độ đang thực sự hiển thị, sau khi đã giải `system`. */
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'sf.theme';
const ATTRIBUTE = 'data-sf-theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

export function readPreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    return raw === 'light' || raw === 'dark' ? raw : 'system';
  } catch {
    // Trình duyệt chặn lưu trữ (chế độ riêng tư, chính sách doanh nghiệp) thì
    // vẫn phải chạy được — chỉ là không nhớ được lựa chọn giữa các phiên.
    return 'system';
  }
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== 'system') return preference;
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

function apply(resolved: ResolvedTheme): void {
  document.documentElement.setAttribute(ATTRIBUTE, resolved);
}

/**
 * Chế độ sáng/tối.
 *
 * ## Vì sao thuộc tính LUÔN được đặt, kể cả khi để "theo hệ điều hành"
 *
 * CSS chỉ có một khối `[data-sf-theme='dark']`. Cách thường thấy là viết thêm
 * một khối `@media (prefers-color-scheme: dark)` nữa cho chế độ tự động, nhưng
 * hai khối đó là bản sao của nhau và bản sao thì sẽ lệch. Ở đây React (và một
 * đoạn script nhỏ trong `index.html` chạy trước khi trang vẽ) giải "theo hệ
 * điều hành" thành `light` hoặc `dark` rồi mới ghi ra thuộc tính, nên CSS chỉ
 * cần biết một trạng thái.
 *
 * ## Vì sao vẫn phải lắng nghe `matchMedia`
 *
 * Người dùng đổi chế độ của hệ điều hành trong lúc tab đang mở là chuyện có
 * thật — nhất là khi máy tự chuyển tối theo giờ. Không lắng nghe thì trang giữ
 * nguyên chế độ cũ cho tới lần tải lại tiếp theo.
 */
export function useTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(readPreference()));

  useEffect(() => {
    const next = resolveTheme(preference);
    setResolved(next);
    apply(next);
  }, [preference]);

  useEffect(() => {
    if (preference !== 'system') return undefined;

    const media = window.matchMedia(DARK_QUERY);
    const onChange = () => {
      const next: ResolvedTheme = media.matches ? 'dark' : 'light';
      setResolved(next);
      apply(next);
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    try {
      if (next === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Không lưu được thì lựa chọn chỉ sống trong phiên này. Vẫn tốt hơn là ném lỗi.
    }
  }, []);

  return { preference, resolved, setPreference };
}
