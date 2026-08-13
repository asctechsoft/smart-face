import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { SESSION_EXPIRED_EVENT } from '@/lib/api/client';
import { tokenStorage } from './token-storage';
import { authApi, type CompanyInfo, type SessionInfo, type SessionTokens } from './auth.api';
import { firebaseSignOut } from './firebase';
import { env } from '@/config/env';
import type { SystemRole } from '@/config/constants';

interface AuthState {
  status: 'loading' | 'authenticated' | 'anonymous';
  session: SessionInfo | null;
  company: CompanyInfo | null;
  /** Múi giờ để quy đổi mọi mốc thời gian hiển thị. Ưu tiên timezone của công ty. */
  timezone: string;
  roles: SystemRole[];
  mustChangePassword: boolean;
  applyTokens: (tokens: SessionTokens) => Promise<void>;
  refreshSession: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [company, setCompany] = useState<CompanyInfo | null>(null);

  /**
   * Nạp danh tính từ token đang có.
   *
   * `GET /auth/me` đọc thẳng từ JWT nên rẻ; `GET /company/me` cần cho múi giờ.
   * Công ty hỏng thì vẫn cho vào — thiếu tên công ty ở thanh tiêu đề không phải
   * lý do chặn cả phiên làm việc.
   */
  const loadSession = useCallback(async () => {
    if (!tokenStorage.getAccessToken()) {
      setStatus('anonymous');
      return;
    }

    try {
      const me = await authApi.me();
      setSession(me);
      setStatus('authenticated');

      if (!me.mustChangePassword && me.companyId) {
        authApi
          .company()
          .then(setCompany)
          .catch(() => setCompany(null));
      }
    } catch {
      tokenStorage.clear();
      setSession(null);
      setCompany(null);
      setStatus('anonymous');
    }
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  // Interceptor phát sự kiện này khi refresh token cũng hỏng. Xoá cache ở đây
  // chứ không ở interceptor: interceptor nằm ngoài React nên không chạm được
  // vào QueryClient của cây component.
  useEffect(() => {
    const onExpired = () => {
      setSession(null);
      setCompany(null);
      setStatus('anonymous');
      queryClient.clear();
    };

    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [queryClient]);

  const applyTokens = useCallback(
    async (tokens: SessionTokens) => {
      tokenStorage.save(tokens);
      await loadSession();
    },
    [loadSession],
  );

  const logout = useCallback(async () => {
    const refreshToken = tokenStorage.getRefreshToken() ?? undefined;

    // Thu hồi phía server TRƯỚC khi xoá token cục bộ — xoá trước thì không còn
    // gì để gửi lên và phiên vẫn sống trong database cho tới lúc hết hạn.
    await authApi.logout(refreshToken).catch(() => {
      // Mất mạng vẫn phải đăng xuất được ở phía máy này.
    });
    await firebaseSignOut();

    tokenStorage.clear();
    queryClient.clear();
    setSession(null);
    setCompany(null);
    setStatus('anonymous');
  }, [queryClient]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      session,
      company,
      timezone: company?.timezone ?? env.VITE_DEFAULT_TIMEZONE,
      roles: session?.roles ?? [],
      mustChangePassword: session?.mustChangePassword ?? false,
      applyTokens,
      refreshSession: loadSession,
      logout,
    }),
    [status, session, company, applyTokens, loadSession, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth phải nằm trong <AuthProvider>');
  return context;
}
