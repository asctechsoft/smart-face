import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/auth-context';
import type { EffectiveAccess } from './permissions';

interface AccessState {
  access: EffectiveAccess | null;
  /** Đang hỏi server lần đầu — giao diện nên chờ thay vì vẽ menu rỗng. */
  isLoading: boolean;
  /**
   * Hỏi thất bại.
   *
   * Phân biệt với "đã hỏi xong và không có quyền nào": lỗi mạng thì giao diện
   * phải nói rõ, còn không có quyền thì là một câu trả lời hợp lệ.
   */
  isError: boolean;
  refetch: () => void;
}

const AccessContext = createContext<AccessState | null>(null);

/** 5 phút — Backend đã cache 60 giây, đây chỉ để tránh gọi lại khi đổi trang. */
const STALE_TIME_MS = 5 * 60 * 1000;

/**
 * Quyền hiệu lực của người đang đăng nhập, lấy từ `GET /v1/access/me`.
 *
 * ## Vì sao hỏi server thay vì suy từ vai trò trong token
 *
 * Mô hình v2.1 là Role × Permission × Scope, và cả phạm vi lẫn thời hạn đều
 * không nằm trong token. Suy ở client thì mỗi lần Backend sửa bảng vai trò là
 * Web lại lệch — đúng lỗi của bản trước, nơi Kế toán/HR được cấp nhầm
 * `shift.assign` và người dùng chỉ biết khi bấm vào và nhận 403.
 *
 * ## Vì sao vẫn phải chịu được lỗi
 *
 * Endpoint này hỏng thì Web không biết vẽ gì. Lựa chọn ở đây là **không vẽ**
 * (`isError`) chứ không phải "cho hiện hết": hiện hết chỉ đẩy lỗi xuống thành
 * một loạt 403 khó hiểu, còn giấu hết thì người dùng biết ngay là có sự cố và
 * bấm thử lại được.
 */
export function AccessProvider({ children }: { children: ReactNode }) {
  const { status, session } = useAuth();
  const enabled = status === 'authenticated' && !session?.mustChangePassword;

  const query = useQuery({
    queryKey: ['access', 'me', session?.userId ?? null],
    queryFn: () => api.get<EffectiveAccess>('/access/me'),
    enabled,
    staleTime: STALE_TIME_MS,
    // Quyền vừa bị gỡ phải biến mất khỏi giao diện khi người dùng quay lại tab,
    // không phải chờ họ tải lại trang.
    refetchOnWindowFocus: true,
  });

  const value = useMemo<AccessState>(
    () => ({
      access: query.data ?? null,
      isLoading: enabled && query.isPending,
      isError: query.isError,
      refetch: () => void query.refetch(),
    }),
    [enabled, query],
  );

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess(): AccessState {
  const context = useContext(AccessContext);
  if (!context) throw new Error('useAccess phải nằm trong <AccessProvider>');
  return context;
}
