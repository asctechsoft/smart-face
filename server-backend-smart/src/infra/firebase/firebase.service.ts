import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { App, cert, deleteApp, initializeApp } from 'firebase-admin/app';
import { Auth, DecodedIdToken, getAuth, UserRecord } from 'firebase-admin/auth';
import { AppException } from 'src/common/errors';

/**
 * Firebase Authentication — nhà cung cấp danh tính của hệ thống.
 *
 * ## Ranh giới trách nhiệm
 *
 * | Việc                                   | Ai làm    |
 * |----------------------------------------|-----------|
 * | Giữ email + mật khẩu, chống dò mật khẩu | Firebase  |
 * | Xác minh thông tin đăng nhập            | Firebase  |
 * | Đặt lại mật khẩu qua email              | Firebase  |
 * | Phiên làm việc (access + refresh token) | Backend   |
 * | Xác thực 2 lớp (OTP)                    | Backend   |
 * | Vai trò, công ty, phạm vi, thiết bị     | Backend   |
 *
 * Backend KHÔNG dùng thẳng Firebase ID token làm bearer token cho API. Lý do ở
 * `AuthService.createSession`.
 *
 * ## Vì sao không có chế độ "chạy tạm khi thiếu cấu hình"
 *
 * `SmsService` thiếu cấu hình thì chỉ ghi log rồi đi tiếp — chấp nhận được vì
 * hỏng lắm là tin nhắn không tới. Ở đây thì khác: đây là thứ quyết định "anh có
 * đúng là người này không". Một chế độ giả lập cho qua sẽ biến mọi môi trường lỡ
 * thiếu biến môi trường thành hệ thống không cần mật khẩu. Nên thiếu cấu hình là
 * chết ngay lúc khởi động.
 */
@Injectable()
export class FirebaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FirebaseService.name);
  private app!: App;
  private auth!: Auth;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const projectId = this.config.get<string>('firebase.projectId', '');
    const clientEmail = this.config.get<string>('firebase.clientEmail', '');
    const privateKey = this.config.get<string>('firebase.privateKey', '');
    const emulatorHost = this.config.get<string>('firebase.emulatorHost', '');

    if (emulatorHost) {
      // SDK chỉ đọc biến môi trường này, không có tham số tương ứng — đặt lại
      // ở đây để mọi cấu hình vẫn đi qua một cửa `configuration.ts`.
      process.env.FIREBASE_AUTH_EMULATOR_HOST = emulatorHost;
      this.logger.warn(
        `Đang dùng Firebase Auth Emulator tại ${emulatorHost} — ID token KHÔNG được kiểm chữ ký.`,
      );
    }

    if (!projectId) {
      throw new Error(
        'Thiếu FIREBASE_PROJECT_ID. Firebase Authentication là nhà cung cấp danh tính của ' +
          'hệ thống — không có nó thì không ai đăng nhập được. Xem .env.example.',
      );
    }

    // Với emulator, credential giả cũng chạy được; chỉ Firebase thật mới cần
    // service account.
    this.app = initializeApp(
      emulatorHost
        ? { projectId }
        : { credential: cert({ projectId, clientEmail, privateKey }), projectId },
      'smartface-auth',
    );
    this.auth = getAuth(this.app);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.app) await deleteApp(this.app);
  }

  // ===========================================================================
  //  Xác minh
  // ===========================================================================

  /**
   * Kiểm ID token do client gửi lên.
   *
   * `checkRevoked = true` để tài khoản vừa bị Admin khoá hoặc vừa đổi mật khẩu
   * không dùng được token cũ. Nó tốn thêm một lượt gọi tới Firebase, nên chỉ
   * chấp nhận được vì đường này chỉ chạy lúc ĐĂNG NHẬP và các thao tác nhạy cảm
   * — không phải mọi request (mọi request đi qua JWT của Backend).
   */
  async verifyIdToken(idToken: string): Promise<DecodedIdToken> {
    try {
      return await this.auth.verifyIdToken(idToken, true);
    } catch (error) {
      const code = (error as { code?: string }).code ?? '';
      this.logger.warn(`Từ chối Firebase ID token: ${code || (error as Error).message}`);

      if (code === 'auth/id-token-expired') {
        throw new AppException('AUTH_FIREBASE_TOKEN_EXPIRED');
      }
      if (code === 'auth/id-token-revoked' || code === 'auth/user-disabled') {
        throw new AppException('AUTH_ACCOUNT_SUSPENDED');
      }
      throw new AppException('AUTH_FIREBASE_TOKEN_INVALID');
    }
  }

  /**
   * Như `verifyIdToken` nhưng đòi người dùng VỪA nhập lại thông tin đăng nhập.
   *
   * Firebase ID token sống một giờ, nên chỉ kiểm token hợp lệ là chưa đủ cho
   * thao tác nhạy cảm: máy đang mở sẵn phiên vẫn lấy được token hợp lệ mà không
   * cần biết mật khẩu. `auth_time` mới là mốc người dùng thật sự xác thực.
   */
  async verifyFreshIdToken(idToken: string): Promise<DecodedIdToken> {
    const decoded = await this.verifyIdToken(idToken);
    const window = this.config.get<number>('firebase.freshAuthWindowSeconds', 300);
    const ageSeconds = Math.floor(Date.now() / 1000) - decoded.auth_time;

    if (ageSeconds > window) {
      throw new AppException('AUTH_REAUTH_STALE', {
        reason: `Cần xác thực lại. Lần xác thực gần nhất cách đây ${ageSeconds}s, cho phép tối đa ${window}s.`,
      });
    }
    return decoded;
  }

  // ===========================================================================
  //  Vòng đời tài khoản
  // ===========================================================================

  /** @returns uid của tài khoản Firebase vừa tạo. */
  async createUser(input: {
    email: string;
    password: string;
    displayName?: string;
    phoneNumber?: string | null;
  }): Promise<string> {
    try {
      const user = await this.auth.createUser({
        email: input.email,
        password: input.password,
        displayName: input.displayName,
        // Firebase đòi E.164 và bắt số điện thoại duy nhất toàn dự án. Nhân sự
        // hai công ty dùng chung một số là chuyện có thật, nên KHÔNG gắn số vào
        // tài khoản Firebase — số điện thoại do Backend quản lý.
        emailVerified: false,
      });
      return user.uid;
    } catch (error) {
      const code = (error as { code?: string }).code ?? '';
      if (code === 'auth/email-already-exists') {
        throw new AppException('EMP_EMAIL_TAKEN', { email: input.email });
      }
      if (code === 'auth/invalid-password') {
        throw new AppException('AUTH_PASSWORD_TOO_WEAK');
      }
      throw error;
    }
  }

  async setPassword(uid: string, password: string): Promise<void> {
    await this.auth.updateUser(uid, { password });
  }

  async setDisabled(uid: string, disabled: boolean): Promise<void> {
    await this.auth.updateUser(uid, { disabled });
  }

  /**
   * Vô hiệu mọi refresh token của Firebase.
   *
   * Cần gọi kèm `TokenService.revokeAllForUser`: hai bên giữ hai loại phiên
   * khác nhau, thu hồi một bên thì bên kia vẫn sống.
   */
  async revokeTokens(uid: string): Promise<void> {
    await this.auth.revokeRefreshTokens(uid);
  }

  /** Dùng để dọn dẹp khi tạo tài khoản thất bại giữa chừng. */
  async deleteUser(uid: string): Promise<void> {
    try {
      await this.auth.deleteUser(uid);
    } catch (error) {
      // Đây là đường dọn dẹp — ném tiếp sẽ che mất lỗi gốc đã gây ra rollback.
      this.logger.error(`Không xoá được tài khoản Firebase ${uid}: ${(error as Error).message}`);
    }
  }

  async getUserByEmail(email: string): Promise<UserRecord | null> {
    try {
      return await this.auth.getUserByEmail(email);
    } catch {
      return null;
    }
  }

  /**
   * Liên kết để người dùng tự đặt lại mật khẩu.
   *
   * Backend chỉ sinh liên kết; việc gửi email do hệ thống thông báo của mình lo,
   * để nội dung thống nhất với các email khác và ghi được log gửi.
   *
   * ⚠ Liên kết này dẫn tới trang của Firebase, nơi mật khẩu mới CHỈ bị kiểm theo
   * chuẩn của Firebase (tối thiểu 6 ký tự nếu chưa nâng cấp Identity Platform) —
   * `PasswordService.assertStrong` không chạy ở đó. Dùng nó nghĩa là chấp nhận
   * một cửa hậu hạ chuẩn mật khẩu từ 12 xuống 6 ký tự.
   *
   * Vì vậy hiện KHÔNG có endpoint nào gọi hàm này. Nếu cần "quên mật khẩu", hãy
   * làm luồng đi qua Backend (xác minh bằng OTP rồi gọi `setPassword`) để chính
   * sách mật khẩu vẫn còn hiệu lực.
   */
  generatePasswordResetLink(email: string): Promise<string> {
    return this.auth.generatePasswordResetLink(email);
  }
}
