const ACCESS_KEY = 'sf.accessToken';
const REFRESH_KEY = 'sf.refreshToken';

/**
 * Nơi cất token của phiên Backend.
 *
 * Dùng `localStorage` chứ không phải cookie `HttpOnly` là một đánh đổi có chủ
 * đích, và cần nói rõ: `localStorage` đọc được bằng JavaScript nên một lỗ hổng
 * XSS sẽ lấy được token. Bù lại, Backend cấp token qua thân phản hồi JSON
 * (`POST /auth/session`) chứ không set cookie, nên không có lựa chọn HttpOnly
 * mà không đổi cả hợp đồng API.
 *
 * Hệ quả phải chấp nhận và bù lại ở chỗ khác:
 *   • CSP nghiêm ngặt + không `dangerouslySetInnerHTML` ở bất kỳ đâu (NFR-SEC).
 *   • Access token TTL ngắn (900s) — cửa sổ lợi dụng hẹp.
 *   • Refresh token XOAY VÒNG: dùng lại token cũ → Backend thu hồi toàn bộ phiên (AF-16).
 */
export const tokenStorage = {
  getAccessToken(): string | null {
    return localStorage.getItem(ACCESS_KEY);
  },

  getRefreshToken(): string | null {
    return localStorage.getItem(REFRESH_KEY);
  },

  save(tokens: { accessToken: string; refreshToken: string }): void {
    localStorage.setItem(ACCESS_KEY, tokens.accessToken);
    localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
  },

  clear(): void {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};
