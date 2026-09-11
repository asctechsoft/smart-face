const ACCESS_KEY = 'sf.accessToken';
const REFRESH_KEY = 'sf.refreshToken';

/**
 * Kho nào đang giữ token của phiên này.
 *
 * Cờ nằm ở `localStorage` chứ không ở kho đang dùng: nếu để trong
 * `sessionStorage` thì mở tab mới là mất cờ, và tab mới sẽ đi đọc
 * `localStorage` — đúng cái kho mà người dùng vừa từ chối.
 */
const STORE_KEY = 'sf.tokenStore';

/**
 * Nơi cất token của phiên Backend.
 *
 * Dùng `localStorage`/`sessionStorage` chứ không phải cookie `HttpOnly` là một
 * đánh đổi có chủ đích, và cần nói rõ: cả hai đều đọc được bằng JavaScript nên
 * một lỗ hổng XSS sẽ lấy được token. Bù lại, Backend cấp token qua thân phản
 * hồi JSON (`POST /auth/session`) chứ không set cookie, nên không có lựa chọn
 * HttpOnly mà không đổi cả hợp đồng API.
 *
 * Hệ quả phải chấp nhận và bù lại ở chỗ khác:
 *   • CSP nghiêm ngặt + không `dangerouslySetInnerHTML` ở bất kỳ đâu (NFR-SEC).
 *   • Access token TTL ngắn (900s) — cửa sổ lợi dụng hẹp.
 *   • Refresh token XOAY VÒNG: dùng lại token cũ → Backend thu hồi toàn bộ phiên (AF-16).
 *
 * ## "Ghi nhớ đăng nhập" đổi KHO, không đổi hạn token
 *
 * Bỏ tích ô đó thì token nằm ở `sessionStorage`: đóng tab là mất, và máy dùng
 * chung không giữ lại phiên của người trước. Tích vào thì nằm ở `localStorage`
 * như cũ. Không có cách nào làm điều này bằng cách rút ngắn hạn token — hạn do
 * Backend quyết, và một phiên 15 phút vẫn là một phiên sống trên máy công cộng.
 */
export const tokenStorage = {
  getAccessToken(): string | null {
    return activeStore().getItem(ACCESS_KEY);
  },

  getRefreshToken(): string | null {
    return activeStore().getItem(REFRESH_KEY);
  },

  /**
   * @param remember Bỏ trống = giữ nguyên kho đang dùng. Chỉ màn đăng nhập mới
   *   truyền giá trị; các lần lưu sau (xoay refresh token, đổi mật khẩu) phải
   *   giữ nguyên lựa chọn cũ, nếu không một lần xoay token là đủ để phiên nhảy
   *   từ `sessionStorage` sang `localStorage` sau lưng người dùng.
   */
  save(tokens: { accessToken: string; refreshToken: string }, remember?: boolean): void {
    if (remember !== undefined) {
      // Dọn kho KHÔNG được chọn trước khi ghi: để lại token mồ côi ở đó thì lần
      // sau đổi lựa chọn sẽ nhặt phải một phiên đã chết.
      const abandoned = remember ? sessionStorage : localStorage;
      abandoned.removeItem(ACCESS_KEY);
      abandoned.removeItem(REFRESH_KEY);

      localStorage.setItem(STORE_KEY, remember ? 'local' : 'session');
    }

    const store = activeStore();
    store.setItem(ACCESS_KEY, tokens.accessToken);
    store.setItem(REFRESH_KEY, tokens.refreshToken);
  },

  clear(): void {
    for (const store of [localStorage, sessionStorage]) {
      store.removeItem(ACCESS_KEY);
      store.removeItem(REFRESH_KEY);
    }
    localStorage.removeItem(STORE_KEY);
  },

  /** Ô "Ghi nhớ đăng nhập" hiện lại đúng lựa chọn lần trước. */
  isRemembered(): boolean {
    return localStorage.getItem(STORE_KEY) !== 'session';
  },
};

function activeStore(): Storage {
  return localStorage.getItem(STORE_KEY) === 'session' ? sessionStorage : localStorage;
}
