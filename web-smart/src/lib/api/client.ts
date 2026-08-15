import axios, {
  AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios';
import { env } from '@/config/env';
import { ApiError, NetworkError } from '@/lib/errors/api-error';
import { tokenStorage } from '@/lib/auth/token-storage';
import type { ApiResponse, Paginated } from './types';

/** Sự kiện phát ra khi phiên hết hiệu lực — `AuthProvider` lắng nghe để điều hướng. */
export const SESSION_EXPIRED_EVENT = 'sf:session-expired';

function emitSessionExpired(): void {
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
}

const http: AxiosInstance = axios.create({
  baseURL: env.VITE_API_BASE_URL,
  timeout: 30_000,
  headers: { 'X-Platform': 'web' },
});

/**
 * Ngưỡng chờ riêng cho lời gọi ĐẦU TIÊN của một phiên làm việc.
 *
 * Truy vấn trên kết nối database đã mở chỉ mất khoảng 65ms, nhưng MỞ một kết
 * nối mới tới database đặt ở xa tốn từ vài trăm mili giây tới vài chục giây tuỳ
 * chất lượng đường truyền. Lời gọi đầu tiên là lời gọi phải trả toàn bộ chi phí
 * đó, vì pool của Backend còn trống.
 *
 * 30 giây mặc định đủ cho mọi lời gọi sau đó, nhưng với lời gọi đầu tiên thì nó
 * cắt ngang một yêu cầu đang chạy bình thường — và cắt ngang ở đúng chỗ tệ nhất:
 * Backend đã tạo xong phiên, còn người dùng thì nhận được báo lỗi mất kết nối.
 */
export const COLD_START_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
//  Gắn token
// ---------------------------------------------------------------------------

http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = tokenStorage.getAccessToken();
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

// ---------------------------------------------------------------------------
//  Làm mới token khi gặp 401
// ---------------------------------------------------------------------------

/**
 * Hàng đợi các request đang chờ token mới.
 *
 * Không có hàng đợi này thì mở Dashboard (5 request song song) đúng lúc token
 * hết hạn sẽ bắn 5 lệnh refresh cùng lúc. Refresh token XOAY VÒNG: lệnh đầu
 * tiên thành công làm 4 lệnh còn lại thành "dùng lại token đã bị thay thế" —
 * Backend hiểu là dấu hiệu token bị đánh cắp và thu hồi TOÀN BỘ phiên (AF-16).
 * Người dùng bị đá ra ngoài chỉ vì mở một màn hình.
 */
let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  const refreshToken = tokenStorage.getRefreshToken();
  if (!refreshToken) throw new Error('NO_REFRESH_TOKEN');

  // `axios` trần, không qua `http`: đi qua instance có interceptor sẽ gắn access
  // token đã hết hạn và có thể lặp vô hạn nếu chính lệnh refresh trả 401.
  const response = await axios.post<ApiResponse<{ accessToken: string; refreshToken: string }>>(
    `${env.VITE_API_BASE_URL}/auth/refresh`,
    { refreshToken },
    { timeout: 15_000 },
  );

  const body = response.data;
  if (!body.success) throw new Error(body.error.code);

  tokenStorage.save(body.data);
  return body.data.accessToken;
}

/**
 * Lệnh làm mới token hỏng vì KHÔNG NHẬN ĐƯỢC phản hồi, chứ không phải vì Backend
 * từ chối.
 *
 * Phân biệt được hai chuyện này mới quyết định đúng số phận của phiên: Backend
 * từ chối nghĩa là refresh token hết hiệu lực thật, phải đăng nhập lại; còn mạng
 * chập một nhịp thì token vẫn còn nguyên giá trị, xoá đi là tự đá người dùng ra
 * giữa lúc họ đang làm dở.
 */
function isTransportFailure(error: unknown): boolean {
  return axios.isAxiosError(error) && !error.response;
}

http.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiResponse<unknown>>) => {
    const original = error.config as (AxiosRequestConfig & { _sfRetried?: boolean }) | undefined;

    if (!error.response) {
      // `ECONNABORTED` là mã axios dùng cho hết giờ chờ; `ETIMEDOUT` do tầng
      // socket của trình duyệt trả về. Phân biệt được hai trường hợp này thì mới
      // nói đúng cho người dùng biết thao tác của họ đã chạy hay chưa.
      const timedOut = error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT';
      throw new NetworkError(timedOut ? 'TIMEOUT' : 'UNREACHABLE');
    }

    const body = error.response.data;
    const code = body && !body.success ? body.error.code : undefined;

    const isAuthEndpoint = original?.url?.startsWith('/auth/');
    const shouldRefresh =
      error.response.status === 401 && !original?._sfRetried && !isAuthEndpoint && original;

    if (shouldRefresh) {
      try {
        refreshPromise ??= refreshAccessToken().finally(() => {
          refreshPromise = null;
        });
        const token = await refreshPromise;

        original._sfRetried = true;
        original.headers = { ...original.headers, Authorization: `Bearer ${token}` };
        return http.request(original);
      } catch (refreshError) {
        // Mạng hỏng giữa chừng thì giữ nguyên phiên và báo lỗi mạng như mọi lời
        // gọi khác. Người dùng bấm lại là xong; xoá token ở đây thì họ mất hết
        // việc đang làm dở chỉ vì một nhịp mạng chập.
        if (isTransportFailure(refreshError)) {
          const timedOut =
            axios.isAxiosError(refreshError) &&
            (refreshError.code === 'ECONNABORTED' || refreshError.code === 'ETIMEDOUT');
          throw new NetworkError(timedOut ? 'TIMEOUT' : 'UNREACHABLE');
        }

        tokenStorage.clear();
        emitSessionExpired();
      }
    }

    // 401 không cứu được, hoặc tài khoản vừa bị khoá giữa phiên.
    if (
      error.response.status === 401 ||
      code === 'AUTH_ACCOUNT_SUSPENDED' ||
      code === 'AUTH_REFRESH_REUSE_DETECTED'
    ) {
      tokenStorage.clear();
      emitSessionExpired();
    }

    if (body && !body.success) {
      throw new ApiError(body.error, error.response.status);
    }

    throw new NetworkError('BAD_RESPONSE');
  },
);

// ---------------------------------------------------------------------------
//  Hàm gọi API — bóc sẵn vỏ `{ success, data, meta }`
// ---------------------------------------------------------------------------

function unwrap<T>(body: ApiResponse<T>, status: number): T {
  if (!body.success) throw new ApiError(body.error, status);
  return body.data;
}

export const api = {
  async get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
    const response = await http.get<ApiResponse<T>>(url, { params: cleanParams(params) });
    return unwrap(response.data, response.status);
  },

  /**
   * Như `get` nhưng giữ lại `meta` phân trang.
   *
   * Tách thành hàm riêng thay vì luôn trả `{ data, meta }`: phần lớn endpoint
   * không phân trang, bắt mọi nơi phải bóc thêm một lớp là thuế vô ích.
   */
  async getPaginated<T>(url: string, params?: Record<string, unknown>): Promise<Paginated<T>> {
    const response = await http.get<ApiResponse<T[]>>(url, { params: cleanParams(params) });
    const body = response.data;
    if (!body.success) throw new ApiError(body.error, response.status);

    return {
      items: body.data ?? [],
      meta: body.meta ?? {
        page: 1,
        pageSize: body.data?.length ?? 0,
        total: body.data?.length ?? 0,
        totalPages: 1,
      },
    };
  },

  async post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const response = await http.post<ApiResponse<T>>(url, data, config);
    return unwrap(response.data, response.status);
  },

  async put<T>(url: string, data?: unknown): Promise<T> {
    const response = await http.put<ApiResponse<T>>(url, data);
    return unwrap(response.data, response.status);
  },

  async patch<T>(url: string, data?: unknown): Promise<T> {
    const response = await http.patch<ApiResponse<T>>(url, data);
    return unwrap(response.data, response.status);
  },

  async delete<T>(url: string): Promise<T> {
    const response = await http.delete<ApiResponse<T>>(url);
    return unwrap(response.data, response.status);
  },
};

/**
 * Bỏ tham số rỗng trước khi gửi.
 *
 * `status=undefined` mà vẫn serialize thành `?status=` khiến `@IsEnum()` của
 * Backend từ chối cả request — chuỗi rỗng không phải giá trị hợp lệ của enum.
 */
function cleanParams(params?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!params) return undefined;
  return Object.fromEntries(
    Object.entries(params).filter(
      ([, value]) => value !== undefined && value !== null && value !== '',
    ),
  );
}

export { http };
