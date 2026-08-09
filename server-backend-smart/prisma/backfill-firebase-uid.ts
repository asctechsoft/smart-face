// Phải đứng TRƯỚC mọi import khác — xem chú thích cùng chỗ trong seed.ts.
import 'dotenv/config';

import { PrismaClient } from '@prisma/client';
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { randomBytes } from 'node:crypto';

/**
 * Bước (c) của migration `20260809000000_firebase_auth`.
 *
 * Migration thêm cột `firebaseUid` và điền tạm `CHUA-CHUYEN-<id>` cho những dòng
 * đã có. Giá trị đó cố tình KHÔNG hợp lệ, nên tài khoản chưa chuyển không đăng
 * nhập được — hỏng về phía an toàn, thay vì đăng nhập nhầm danh tính.
 *
 * Script này nối chúng với Firebase: mỗi `user_account` được ghép với một tài
 * khoản Firebase cùng email (tạo mới nếu chưa có), rồi ghi `firebaseUid` thật.
 *
 * ## Mật khẩu KHÔNG chuyển được
 *
 * Mật khẩu cũ băm bằng scrypt với tham số riêng của `PasswordService`. Firebase
 * chỉ nhập được scrypt biến thể của riêng nó, bcrypt, PBKDF2, SHA/MD5 có salt —
 * không có định dạng nào khớp. Nên mọi người dùng BẮT BUỘC đặt lại mật khẩu.
 *
 * Với tài khoản tạo mới, script đặt một mật khẩu ngẫu nhiên rồi vứt đi (không in
 * ra, không lưu). Cách lấy lại quyền truy cập:
 *
 *   --reset-links   in ra liên kết đặt lại mật khẩu của Firebase cho từng người
 *
 * ⚠ Liên kết đó dẫn tới trang của Firebase, nơi mật khẩu mới chỉ bị kiểm theo
 *   chuẩn của Firebase (tối thiểu 6 ký tự) chứ không qua `PasswordService`.
 *   Chấp nhận được cho một đợt chuyển đổi; đừng biến nó thành luồng thường trực.
 *
 * ## Cách chạy
 *
 *   npm run backfill:firebase -- --dry-run      # xem trước, không ghi gì
 *   npm run backfill:firebase                   # ghi thật
 *   npm run backfill:firebase -- --reset-links  # ghi thật + in liên kết đặt lại
 *
 * Chạy lại được nhiều lần: dòng đã có uid thật sẽ bị bỏ qua.
 */

const DRY_RUN = process.argv.includes('--dry-run');
const RESET_LINKS = process.argv.includes('--reset-links');

const prisma = new PrismaClient();

const projectId = process.env.FIREBASE_PROJECT_ID ?? '';
const emulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '';

if (!projectId) {
  throw new Error(
    'Thiếu FIREBASE_PROJECT_ID. Xem .env.example, hoặc dùng Auth Emulator:\n' +
      '  firebase emulators:start --only auth\n' +
      '  FIREBASE_PROJECT_ID=demo-smartface FIREBASE_AUTH_EMULATOR_HOST=localhost:9099',
  );
}

const firebaseAuth = getAuth(
  initializeApp(
    emulatorHost
      ? { projectId }
      : {
          projectId,
          credential: cert({
            projectId,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL ?? '',
            privateKey: (process.env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
          }),
        },
    'smartface-backfill',
  ),
);

async function main(): Promise<void> {
  console.log(`▶ Backfill firebaseUid — dự án ${projectId}${emulatorHost ? ' (EMULATOR)' : ''}`);
  if (DRY_RUN) console.log('  CHẾ ĐỘ XEM TRƯỚC — không ghi gì cả.');

  if (emulatorHost) {
    console.log(
      '\n  ⚠ Đang dùng Auth Emulator. Tài khoản trong emulator MẤT khi tắt tiến trình,\n' +
        '    còn `firebaseUid` thì nằm lại trong database. Lần chạy sau sẽ trỏ vào những\n' +
        '    uid không còn tồn tại và không ai đăng nhập được.\n' +
        '    Chỉ làm vậy với database dùng riêng cho máy mình.\n',
    );
  }

  const accounts = await prisma.userAccount.findMany({
    where: { firebaseUid: { startsWith: 'CHUA-CHUYEN-' } },
    select: { id: true, email: true, fullName: true, companyId: true },
    orderBy: { email: 'asc' },
  });

  const total = await prisma.userAccount.count();
  console.log(`\n  ${accounts.length}/${total} tài khoản cần chuyển.\n`);

  if (accounts.length === 0) {
    console.log('✅ Không còn gì để làm.');
    return;
  }

  const resetLinks: Array<{ email: string; link: string }> = [];
  let created = 0;
  let matched = 0;
  const failures: Array<{ email: string; reason: string }> = [];

  for (const account of accounts) {
    try {
      let uid: string;
      const existing = await firebaseAuth.getUserByEmail(account.email).catch(() => null);

      if (existing) {
        uid = existing.uid;
        matched += 1;
        console.log(`  ↔ ${account.email.padEnd(24)} ghép với tài khoản Firebase sẵn có`);
      } else {
        if (DRY_RUN) {
          console.log(`  + ${account.email.padEnd(24)} (sẽ TẠO MỚI)`);
          created += 1;
          continue;
        }
        const user = await firebaseAuth.createUser({
          email: account.email,
          displayName: account.fullName,
          // Mật khẩu cũ không nhập được sang Firebase, nên đặt một chuỗi ngẫu
          // nhiên KHÔNG ai biết — kể cả script này. Lấy lại quyền truy cập bằng
          // liên kết đặt lại mật khẩu.
          password: randomBytes(24).toString('base64url'),
        });
        uid = user.uid;
        created += 1;
        console.log(`  + ${account.email.padEnd(24)} đã tạo tài khoản Firebase`);
      }

      if (!DRY_RUN) {
        await prisma.userAccount.update({
          where: { id: account.id },
          data: { firebaseUid: uid },
        });
      }

      if (RESET_LINKS && !DRY_RUN) {
        resetLinks.push({
          email: account.email,
          link: await firebaseAuth.generatePasswordResetLink(account.email),
        });
      }
    } catch (error) {
      // Không dừng cả đợt vì một dòng hỏng — ghi lại rồi đi tiếp, cuối cùng in
      // danh sách để xử lý tay. Dừng giữa chừng sẽ để lại trạng thái nửa vời khó
      // biết đã tới đâu.
      const reason = (error as Error).message;
      failures.push({ email: account.email, reason });
      console.log(`  ✗ ${account.email.padEnd(24)} ${reason}`);
    }
  }

  console.log(`\n  Ghép sẵn có: ${matched} · Tạo mới: ${created} · Lỗi: ${failures.length}`);

  if (resetLinks.length > 0) {
    console.log('\n  Liên kết đặt lại mật khẩu (gửi riêng cho từng người, KHÔNG đăng công khai):');
    for (const { email, link } of resetLinks) {
      console.log(`    ${email}\n      ${link}`);
    }
  }

  if (failures.length > 0) {
    console.log('\n  ⚠ Những tài khoản sau CHƯA chuyển được, vẫn không đăng nhập được:');
    for (const { email, reason } of failures) {
      console.log(`    ${email} — ${reason}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(DRY_RUN ? '\n✅ Xem trước xong, chưa ghi gì.' : '\n✅ Backfill hoàn tất.');
}

main()
  .catch((error) => {
    console.error('❌ Backfill thất bại:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
