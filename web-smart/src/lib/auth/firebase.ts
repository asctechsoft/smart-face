import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  EmailAuthProvider,
  getAuth,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  type Auth,
} from 'firebase/auth';
import { env, isFirebaseConfigured, missingFirebaseKeys } from '@/config/env';

/**
 * Firebase Authentication giữ danh tính; Backend giữ nghiệp vụ.
 *
 * Ranh giới quan trọng nhất của luồng này (docs/13, docs/08 mục 2):
 * Backend KHÔNG BAO GIỜ nhận mật khẩu. Web đăng nhập với Firebase, lấy ID token,
 * rồi đổi lấy phiên của Backend qua `POST /auth/session`. Firebase xác nhận
 * "đúng người", Backend xác nhận "người này thuộc công ty nào, quyền gì".
 */
let app: FirebaseApp | null = null;

/**
 * Khởi tạo Firebase LÚC CẦN DÙNG, không phải lúc nạp module.
 *
 * Nhờ vậy thiếu cấu hình chỉ làm hỏng đúng luồng đăng nhập, kèm thông báo nói
 * rõ thiếu biến nào — thay vì làm trắng cả ứng dụng.
 */
export function firebaseAuth(): Auth {
  if (!isFirebaseConfigured) {
    throw new FirebaseNotConfiguredError();
  }

  app ??= initializeApp({
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  });
  return getAuth(app);
}

export class FirebaseNotConfiguredError extends Error {
  readonly missingKeys = missingFirebaseKeys;

  constructor() {
    super(
      `Chưa cấu hình Firebase nên không đăng nhập được. Thiếu: ${missingFirebaseKeys.join(', ')}.`,
    );
    this.name = 'FirebaseNotConfiguredError';
  }
}

/** Đăng nhập với Firebase và trả về ID token còn mới. */
export async function signInAndGetIdToken(email: string, password: string): Promise<string> {
  const credential = await signInWithEmailAndPassword(firebaseAuth(), email, password);
  return credential.user.getIdToken();
}

/**
 * Xác thực lại bằng mật khẩu hiện tại rồi trả ID token vừa làm mới.
 *
 * Bắt buộc trước thao tác nhạy cảm (đổi mật khẩu, tắt 2FA). Backend từ chối
 * token cũ với `AUTH_REAUTH_STALE`: nó cần bằng chứng người đang ngồi trước máy
 * BIẾT mật khẩu, không chỉ đang cầm một phiên còn mở.
 */
export async function reauthenticateAndGetIdToken(currentPassword: string): Promise<string> {
  const auth = firebaseAuth();
  const user = auth.currentUser;
  if (!user?.email) {
    throw new Error('Phiên Firebase đã kết thúc. Vui lòng đăng nhập lại.');
  }

  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, credential);
  // `true` = ép lấy token mới thay vì đọc bản cache, nếu không `auth_time` vẫn
  // là mốc cũ và Backend coi là "xác thực lại đã ôi".
  return user.getIdToken(true);
}

/**
 * Đổi mật khẩu ở phía Firebase.
 *
 * Phải chạy TRƯỚC `POST /auth/password/change`: Firebase là nơi giữ mật khẩu,
 * Backend chỉ ghi nhận việc đã đổi rồi thu hồi các phiên cũ. Làm ngược thứ tự
 * sẽ có một khoảng thời gian Backend tưởng đã đổi mà mật khẩu thật vẫn là mật
 * khẩu tạm.
 */
export async function changeFirebasePassword(newPassword: string): Promise<string> {
  const user = firebaseAuth().currentUser;
  if (!user) throw new Error('Phiên Firebase đã kết thúc. Vui lòng đăng nhập lại.');

  await updatePassword(user, newPassword);
  return user.getIdToken(true);
}

export async function firebaseSignOut(): Promise<void> {
  await signOut(firebaseAuth()).catch(() => {
    // Đăng xuất Firebase hỏng không được cản trở việc xoá phiên Backend — nếu
    // không, mạng chập chờn là người dùng kẹt lại trong trạng thái nửa vời.
  });
}

/**
 * Chuyển mã lỗi của Firebase sang tiếng Việt.
 *
 * SDK trả `auth/invalid-credential` và tương tự; hiện thẳng ra màn hình thì
 * người dùng không hiểu gì (docs/16 mục 14.2 điều 9).
 */
const FIREBASE_MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'Email hoặc mật khẩu không đúng.',
  'auth/invalid-email': 'Địa chỉ email không hợp lệ.',
  'auth/user-disabled': 'Tài khoản đã bị vô hiệu hoá. Liên hệ bộ phận nhân sự.',
  'auth/user-not-found': 'Email hoặc mật khẩu không đúng.',
  'auth/wrong-password': 'Email hoặc mật khẩu không đúng.',
  'auth/too-many-requests': 'Bạn đã thử quá nhiều lần. Chờ ít phút rồi thử lại.',
  'auth/network-request-failed': 'Không kết nối được. Kiểm tra đường truyền rồi thử lại.',
  'auth/weak-password': 'Mật khẩu quá yếu. Cần tối thiểu 8 ký tự, có chữ và số.',
  'auth/requires-recent-login': 'Phiên đã cũ. Vui lòng đăng nhập lại rồi thử lại.',
};

export function firebaseErrorMessage(error: unknown): string {
  const code = (error as { code?: string })?.code;
  if (code && FIREBASE_MESSAGES[code]) return FIREBASE_MESSAGES[code] as string;
  if (error instanceof Error && error.message) return error.message;
  return 'Đăng nhập không thành công. Vui lòng thử lại.';
}
