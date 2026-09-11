/**
 * Seed dữ liệu khởi tạo — docs/13-mo-hinh-du-lieu.md mục 4.5.
 *
 * Chạy: `npm run seed`
 *
 * ⚠ CHỈ môi trường phát triển. Production dùng `node dist/sync-reference-data`
 *   (tự chạy khi container api khởi động) để có dữ liệu nền mà KHÔNG kèm tài
 *   khoản mẫu, rồi tạo quản trị viên đầu tiên bằng scripts/bootstrap-admin.sh.
 *
 * Tạo:
 *   - Dữ liệu nền dùng chung với production: gói Free / Plus / Max, danh mục
 *     quyền + vai trò hệ thống, bản ghi model AI (src/modules/provisioning/reference-data.ts)
 *   - Tài khoản SYSTEM_ADMIN
 *   - Công ty demo AMOBI + chi nhánh + phòng ban + mã mời
 *   - RequestType + ApprovalFlow mặc định
 *   - Ca hành chính, LeavePolicy, ngày lễ Việt Nam
 *   - CompanyPolicy mặc định
 *   - Vài nhân viên mẫu (chưa có dữ liệu sinh trắc học)
 */
// Phải đứng TRƯỚC mọi import khác: `import` được hoist và PrismaClient đọc
// DATABASE_URL ngay lúc khởi tạo. Prisma CLI tự nạp .env, nhưng seed chạy qua
// ts-node thì không — thiếu dòng này seed chết với "Environment variable not found".
import 'dotenv/config';

import { PrismaClient, ScopeLevel, ShiftType, SystemRole } from '@prisma/client';
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { buildUniqueEmployeeCode } from '../src/common/utils/employee-code.util';
import { syncReferenceData } from '../src/modules/provisioning/reference-data';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
//  Firebase — nơi giữ mật khẩu của tài khoản seed
// ---------------------------------------------------------------------------
//
// Seed phải tạo tài khoản ở CẢ HAI nơi, vì `UserAccount.firebaseUid` là bắt buộc
// và Backend không còn lưu mật khẩu. Chạy seed mà bỏ qua bước này sẽ sinh ra một
// cơ sở dữ liệu mà không tài khoản nào đăng nhập được.
//
// Cách dùng khuyến nghị khi phát triển — dùng Auth Emulator, không đụng dự án thật:
//
//   firebase emulators:start --only auth
//   FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 FIREBASE_PROJECT_ID=demo-smartface npm run seed

const emulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '';
const projectId = process.env.FIREBASE_PROJECT_ID ?? '';

if (!projectId) {
  throw new Error(
    'Thiếu FIREBASE_PROJECT_ID. Seed cần tạo tài khoản bên Firebase vì Backend không còn ' +
      'lưu mật khẩu. Dùng Auth Emulator cho môi trường phát triển — xem chú thích trong seed.ts.',
  );
}

const firebaseApp = initializeApp(
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
  'smartface-seed',
);
const firebaseAuth = getAuth(firebaseApp);

/**
 * Tạo tài khoản Firebase, hoặc đặt lại mật khẩu nếu email đã tồn tại.
 *
 * Seed phải chạy lại được nhiều lần (`prisma db seed` sau mỗi lần reset). Nếu
 * gặp email đã có mà báo lỗi thì lần chạy thứ hai luôn hỏng — nên ở đây dùng
 * kiểu "tạo hoặc cập nhật".
 */
async function upsertFirebaseUser(email: string, fullName: string): Promise<string> {
  try {
    const existing = await firebaseAuth.getUserByEmail(email);
    await firebaseAuth.updateUser(existing.uid, {
      password: SEED_PASSWORD,
      displayName: fullName,
      disabled: false,
    });
    return existing.uid;
  } catch {
    const created = await firebaseAuth.createUser({
      email,
      password: SEED_PASSWORD,
      displayName: fullName,
      emailVerified: true,
    });
    return created.uid;
  }
}

const COMPANY_CODE = 'amobi';
const COMPANY_DOMAIN = 'amobi.vn';
const ADMIN_EMAIL = 'admin@smartface.vn';

/**
 * Mật khẩu cho toàn bộ tài khoản seed.
 *
 * ⚠ CHỈ dùng cho môi trường phát triển. Seed không bao giờ được chạy trên
 * production — nếu chạy, đây là mật khẩu công khai trong mã nguồn.
 *
 * Mọi tài khoản seed đều đặt `mustChangePassword: false` để đội phát triển
 * không phải đổi mật khẩu 5 lần mỗi lần reset cơ sở dữ liệu.
 */
const SEED_PASSWORD = 'SmartFaceDev2026';

async function main(): Promise<void> {
  console.log('▶ Bắt đầu seed dữ liệu SmartFace...');

  // --- 1. Dữ liệu nền: gói dịch vụ, quyền & vai trò hệ thống, model AI -------
  //
  // Dùng chung với production (`src/sync-reference-data.ts`, chạy mỗi lần
  // container api khởi động). Seed ghi đè gói dịch vụ để mỗi lần reset là về
  // đúng catalog chuẩn; production thì không bao giờ ghi đè.
  const reference = await syncReferenceData(prisma, { overwritePlans: true });
  const demoPlan = await prisma.subscriptionPlan.findUniqueOrThrow({ where: { code: 'PLUS' } });
  console.log(`  ✓ ${reference.plansWritten} gói dịch vụ`);
  console.log(`  ✓ ${reference.permissions} quyền · ${reference.roles} vai trò hệ thống`);
  console.log(reference.aiModelCreated ? '  ✓ Model buffalo_l@2.1' : '  ✓ Model AI đã có');

  // --- 2. Admin hệ thống -----------------------------------------------------
  //
  // `companyId = null` — quản trị viên nền tảng không thuộc công ty nào. Ràng
  // buộc duy nhất cho nhóm này là chỉ mục một phần trong
  // prisma/sql/02_auth_constraints.sql, nên ở đây phải tự tra trước khi tạo.
  const adminUid = await upsertFirebaseUser(ADMIN_EMAIL, 'Quản trị hệ thống');

  const existingAdmin = await prisma.userAccount.findFirst({
    where: { companyId: null, email: ADMIN_EMAIL },
  });
  if (existingAdmin) {
    await prisma.userAccount.update({
      where: { id: existingAdmin.id },
      data: { isSystemAdmin: true, firebaseUid: adminUid, mustChangePassword: false },
    });
  } else {
    await prisma.userAccount.create({
      data: {
        companyId: null,
        email: ADMIN_EMAIL,
        fullName: 'Quản trị hệ thống',
        firebaseUid: adminUid,
        mustChangePassword: false,
        isSystemAdmin: true,
      },
    });
  }
  console.log(`  ✓ Admin hệ thống (${ADMIN_EMAIL})`);

  // --- 3. Công ty demo -------------------------------------------------------
  const company = await prisma.company.upsert({
    where: { code: COMPANY_CODE },
    create: {
      code: COMPANY_CODE,
      domain: COMPANY_DOMAIN,
      name: 'Công ty AMOBI',
      taxCode: '0101234567',
      timezone: 'Asia/Ho_Chi_Minh',
      status: 'ACTIVE',
      planId: demoPlan.id,
    },
    update: { domain: COMPANY_DOMAIN, planId: demoPlan.id, status: 'ACTIVE' },
  });
  console.log(`  ✓ Công ty ${company.name} (${company.code}, tên miền ${company.domain})`);

  // --- 4. Chi nhánh & phòng ban ---------------------------------------------
  let branch = await prisma.branch.findFirst({
    where: { companyId: company.id, name: 'Văn phòng Hà Nội' },
  });
  if (!branch) {
    branch = await prisma.branch.create({
      data: {
        companyId: company.id,
        name: 'Văn phòng Hà Nội',
        address: '123 Trần Duy Hưng, Cầu Giấy, Hà Nội',
        latitude: 21.0123,
        longitude: 105.7987,
        // GPS trong nhà sai số 20–50m → bán kính 100m là khởi điểm hợp lý.
        radiusMeters: 100,
        // AF-02 — BẮT BUỘC với chính sách mặc định `WIFI_REQUIREMENT = BLOCK`.
        // Chi nhánh không khai BSSID thì mọi lượt chấm công đều bị từ chối.
        //
        // Đối chiếu bằng BSSID (địa chỉ MAC của bộ phát), KHÔNG bằng SSID: ai
        // cũng đặt điểm phát sóng cá nhân tên "AMOBI-WiFi" được trong ba giây.
        wifiSsids: ['AMOBI-Office'],
        wifiBssids: ['a4:2b:8c:11:9d:0e', 'a4:2b:8c:11:9d:0f'],
        // AF-02b — dải IP CÔNG CỘNG của văn phòng.
        //
        // 203.0.113.0/24 là dải tài liệu (RFC 5737), dùng làm ví dụ. Khi triển
        // khai thật phải thay bằng dải nhà mạng cấp cho văn phòng.
        //
        // ⚠ KHÔNG khai dải nội bộ kiểu 192.168.1.0/24 — server không bao giờ
        // nhìn thấy địa chỉ sau NAT. Đây là nhầm lẫn phổ biến nhất.
        //
        // Hai dải loopback ở dưới để môi trường phát triển chạy được: khi chạy
        // localhost thì request.ip là ::1 hoặc 127.0.0.1.
        allowedIpCidrs: ['203.0.113.0/24', '127.0.0.0/8', '::1/128'],
      },
    });
  }

  // "Ban giám đốc" tách riêng, không nhét Giám đốc vào phòng Kế toán: phạm vi
  // dữ liệu của Quản lý được cắt theo phòng ban, và một Giám đốc ngồi trong
  // phòng Kế toán làm mọi phép kiểm phạm vi trở nên khó đọc.
  const departmentNames = ['Ban giám đốc', 'Kỹ thuật', 'Kinh doanh', 'Nhân sự', 'Kế toán'];
  const departments: Record<string, string> = {};
  for (const name of departmentNames) {
    let department = await prisma.department.findFirst({
      where: { companyId: company.id, name },
    });
    if (!department) {
      department = await prisma.department.create({
        data: { companyId: company.id, branchId: branch.id, name },
      });
    }
    departments[name] = department.id;
  }
  console.log(`  ✓ 1 chi nhánh, ${departmentNames.length} phòng ban`);

  // --- 5. Ca làm việc --------------------------------------------------------
  let shift = await prisma.shift.findFirst({
    where: { companyId: company.id, name: 'Hành chính' },
  });
  if (!shift) {
    shift = await prisma.shift.create({
      data: {
        companyId: company.id,
        name: 'Hành chính',
        code: 'HC',
        symbol: 'X',
        type: ShiftType.FIXED,
        startTime: '08:00',
        endTime: '17:30',
        breakStart: '12:00',
        breakEnd: '13:00',
        breakMinutes: 60,
        checkInFrom: '06:00',
        checkInTo: '10:00',
        checkOutFrom: '16:00',
        checkOutTo: '22:00',
        lateToleranceMinutes: 5,
        earlyLeaveToleranceMinutes: 0,
        isDefault: true,
        // T2–T6 (1|2|4|8|16 = 31)
        weekdayMask: 31,
        effectiveFrom: new Date('2026-01-01'),
      },
    });
  }

  // Ca đêm để kiểm chứng bẫy "vắt qua nửa đêm" (docs/04 mục 6.4).
  const nightShift = await prisma.shift.findFirst({
    where: { companyId: company.id, name: 'Ca đêm' },
  });
  if (!nightShift) {
    await prisma.shift.create({
      data: {
        companyId: company.id,
        name: 'Ca đêm',
        code: 'CD',
        symbol: 'Đ',
        type: ShiftType.ROTATING,
        startTime: '22:00',
        endTime: '06:00',
        crossesMidnight: true,
        // Khoảng nghỉ NẰM TRONG ca đêm — 00:30–01:00, không phải nghỉ trưa.
        breakStart: '00:30',
        breakEnd: '01:00',
        breakMinutes: 30,
        lateToleranceMinutes: 10,
        weeklyRestFactor: 2,
        holidayFactor: 3,
        effectiveFrom: new Date('2026-01-01'),
      },
    });
  }
  console.log('  ✓ Ca hành chính 08:00–17:30 + Ca đêm 22:00–06:00');

  // --- 7. Chính sách phép năm ------------------------------------------------
  const leavePolicy = await prisma.leavePolicy.findFirst({ where: { companyId: company.id } });
  if (!leavePolicy) {
    await prisma.leavePolicy.create({
      data: {
        companyId: company.id,
        // NFR-LEGAL-07: tối thiểu 12 ngày/năm.
        baseDaysPerYear: 12,
        seniorityBonusDays: 1,
        seniorityEveryYears: 5,
        allowCarryOver: true,
        maxCarryOverDays: 5,
        carryOverExpireMonth: 3,
        accrualMode: 'YEARLY',
        effectiveFrom: new Date('2026-01-01'),
      },
    });
  }
  console.log('  ✓ Chính sách phép năm (12 ngày, cộng dồn tối đa 5 ngày, hết hạn 31/03)');

  // --- 8. Ngày lễ Việt Nam ---------------------------------------------------
  const holidays = [
    { name: 'Tết Dương lịch', date: '2026-01-01', otMultiplier: 3.0 },
    { name: 'Tết Nguyên đán', date: '2026-02-17', otMultiplier: 3.0 },
    { name: 'Giỗ Tổ Hùng Vương', date: '2026-04-26', otMultiplier: 3.0 },
    { name: 'Ngày Giải phóng miền Nam', date: '2026-04-30', otMultiplier: 3.0 },
    { name: 'Quốc tế Lao động', date: '2026-05-01', otMultiplier: 3.0 },
    { name: 'Quốc khánh', date: '2026-09-02', otMultiplier: 3.0 },
    { name: 'Quốc khánh (nghỉ thêm)', date: '2026-09-03', otMultiplier: 3.0 },
  ];
  for (const holiday of holidays) {
    const date = new Date(`${holiday.date}T00:00:00.000Z`);
    await prisma.holiday.upsert({
      where: { companyId_date: { companyId: company.id, date } },
      create: {
        companyId: company.id,
        name: holiday.name,
        date,
        otMultiplier: holiday.otMultiplier,
      },
      update: { name: holiday.name },
    });
  }
  console.log(`  ✓ ${holidays.length} ngày lễ`);

  // --- 9. Loại đơn + luồng duyệt --------------------------------------------
  const requestTypes = [
    {
      code: 'ANNUAL_LEAVE',
      name: 'Xin nghỉ phép',
      deductFrom: 'ANNUAL_LEAVE',
      isPaidLeave: true,
      unit: 'DAY',
      requiresAttachment: false,
      // 1 cấp thường; > 3 ngày thì thêm cấp HR.
      steps: [
        { order: 1, approverRole: 'DIRECT_MANAGER', condition: null },
        { order: 2, approverRole: 'HR_PAYROLL', condition: { minDays: 3 } },
      ],
    },
    {
      code: 'GO_OUT',
      name: 'Xin ra ngoài',
      deductFrom: 'NONE',
      unit: 'HOUR',
      requiresAttachment: false,
      steps: [{ order: 1, approverRole: 'DIRECT_MANAGER', condition: null }],
    },
    {
      code: 'EARLY_LEAVE',
      name: 'Về sớm',
      deductFrom: 'NONE',
      unit: 'HOUR',
      requiresAttachment: false,
      steps: [{ order: 1, approverRole: 'DIRECT_MANAGER', condition: null }],
    },
    {
      code: 'MAKEUP',
      name: 'Làm bù',
      deductFrom: 'MAKEUP_CREDIT',
      unit: 'HOUR',
      requiresAttachment: false,
      steps: [{ order: 1, approverRole: 'DIRECT_MANAGER', condition: null }],
    },
    {
      code: 'UNPAID_LEAVE',
      name: 'Nghỉ không lương',
      deductFrom: 'UNPAID',
      unit: 'DAY',
      requiresAttachment: false,
      steps: [
        { order: 1, approverRole: 'DIRECT_MANAGER', condition: null },
        { order: 2, approverRole: 'HR_PAYROLL', condition: null },
      ],
    },
    {
      code: 'BUSINESS_TRIP',
      name: 'Công tác',
      deductFrom: 'NONE',
      // Đi công tác là ngày ĐI LÀM, chỉ là làm ở chỗ khác.
      isPaidLeave: true,
      unit: 'DAY',
      requiresAttachment: true,
      steps: [{ order: 1, approverRole: 'DIRECT_MANAGER', condition: null }],
    },
    {
      code: 'SICK_LEAVE',
      name: 'Nghỉ ốm',
      deductFrom: 'NONE',
      isPaidLeave: true,
      unit: 'DAY',
      requiresAttachment: true,
      steps: [
        { order: 1, approverRole: 'DIRECT_MANAGER', condition: null },
        { order: 2, approverRole: 'HR_PAYROLL', condition: null },
      ],
    },
    {
      code: 'ATTENDANCE_FIX',
      name: 'Bổ sung công',
      deductFrom: 'NONE',
      unit: 'DAY',
      requiresAttachment: true,
      // 2 cấp vì ảnh hưởng trực tiếp tới bảng lương.
      steps: [
        { order: 1, approverRole: 'DIRECT_MANAGER', condition: null },
        { order: 2, approverRole: 'HR_PAYROLL', condition: null },
      ],
    },
    {
      code: 'OT_REGISTER',
      name: 'Đăng ký OT',
      deductFrom: 'OT_CREDIT',
      unit: 'HOUR',
      requiresAttachment: false,
      requiresPreApproval: true,
      steps: [{ order: 1, approverRole: 'DIRECT_MANAGER', condition: null }],
    },
  ];

  for (const type of requestTypes) {
    const requestType = await prisma.requestType.upsert({
      where: { companyId_code: { companyId: company.id, code: type.code } },
      create: {
        companyId: company.id,
        code: type.code,
        name: type.name,
        deductFrom: type.deductFrom,
        isPaidLeave: type.isPaidLeave ?? false,
        unit: type.unit,
        requiresAttachment: type.requiresAttachment,
        requiresPreApproval: type.requiresPreApproval ?? false,
      },
      update: { name: type.name },
    });

    const existingFlow = await prisma.approvalFlow.findUnique({
      where: { requestTypeId: requestType.id },
    });
    if (!existingFlow) {
      await prisma.approvalFlow.create({
        data: {
          companyId: company.id,
          requestTypeId: requestType.id,
          steps: {
            create: type.steps.map((step) => ({
              order: step.order,
              approverRole: step.approverRole,
              isRequired: true,
              condition: step.condition ?? undefined,
            })),
          },
        },
      });
    }
  }
  console.log(`  ✓ ${requestTypes.length} loại đơn + luồng duyệt`);

  // --- 10. Chính sách công ty ------------------------------------------------
  const policies: Record<string, unknown> = {
    'attendance.geofence.outOfRangeAction': 'WARN',
    'attendance.geofence.defaultRadiusMeters': 100,
    'attendance.gps.maxAccuracyMeters': 100,
    'attendance.gps.rejectMockLocation': true,
    'attendance.device.rejectRooted': true,
    'ai.face.matchThreshold': 0.45,
    'ai.face.livenessThreshold': 0.7,
    'ai.face.requireLiveness': true,
    'payroll.minutesPerStandardDay': 480,
    'payroll.ot.requiresPreApproval': true,
    'payroll.ot.multiplierNormal': 1.5,
    'payroll.ot.multiplierWeekend': 2.0,
    'payroll.ot.multiplierHoliday': 3.0,
  };

  for (const [key, value] of Object.entries(policies)) {
    const existing = await prisma.companyPolicy.findFirst({
      where: { companyId: company.id, key, effectiveTo: null },
    });
    if (!existing) {
      await prisma.companyPolicy.create({
        data: {
          companyId: company.id,
          key,
          value: value as never,
          effectiveFrom: new Date('2026-01-01'),
        },
      });
    }
  }
  console.log(`  ✓ ${Object.keys(policies).length} khoá chính sách`);

  // --- 11. Nhân viên mẫu -----------------------------------------------------
  //
  // ## MỘT VAI TRÒ MỘT TÀI KHOẢN — không gộp
  //
  // Bản trước gộp `COMPANY_ADMIN` và `HR_PAYROLL` vào `an@amobi.vn`. Tài khoản
  // đó thấy menu của cả hai vai trò cùng lúc, nên KHÔNG kiểm được thứ quan
  // trọng nhất của mô hình v2.1: ranh giới #1 của `docs/08` §1.1 — Kế toán gửi
  // đề nghị chốt kỳ, Giám đốc duyệt, và một người không làm cả hai bước.
  //
  // Với seed cũ, mở màn Kỳ công sẽ thấy CẢ "Gửi duyệt chốt" lẫn "Duyệt chốt"
  // trên cùng một hàng — đúng cái mà cả bảng phân quyền lẫn bộ test sinh ra để
  // ngăn. Tách ra thì mỗi tài khoản chỉ thấy nút của mình.
  const sampleEmployees: Array<{
    fullName: string;
    email: string;
    phone: string;
    department: string;
    position: string;
    roles: SystemRole[];
    /** Mã vai trò v2.1 trong bảng `role` — nguồn thật của `/v1/access/me`. */
    accessRole: string;
    /** Chủ sở hữu công ty (`BR-15`) — ghi thêm một dòng `CompanyOwner`. */
    isOwner?: boolean;
  }> = [
    {
      fullName: 'Nguyễn Văn Đức',
      email: 'duc@amobi.vn',
      phone: '0901234567',
      department: 'Kỹ thuật',
      position: 'Nhân viên',
      roles: [SystemRole.EMPLOYEE],
      accessRole: 'EMPLOYEE',
    },
    {
      fullName: 'Trần Văn Bình',
      email: 'binh@amobi.vn',
      phone: '0901234568',
      department: 'Kỹ thuật',
      position: 'Trưởng phòng',
      roles: [SystemRole.EMPLOYEE, SystemRole.MANAGER],
      accessRole: 'MANAGER',
    },
    {
      fullName: 'Lê Thị Hoa',
      email: 'hoa@amobi.vn',
      phone: '0901234569',
      department: 'Kế toán',
      position: 'Kế toán trưởng',
      roles: [SystemRole.EMPLOYEE, SystemRole.HR_PAYROLL],
      accessRole: 'HR_PAYROLL',
    },
    {
      // Giám đốc — CHỈ `COMPANY_ADMIN`. Không có `HR_PAYROLL`, và đó là điểm
      // chính: người này duyệt chốt kỳ nhưng không gửi được đề nghị chốt.
      fullName: 'Phạm Thị An',
      email: 'an@amobi.vn',
      phone: '0901234570',
      department: 'Ban giám đốc',
      position: 'Giám đốc',
      roles: [SystemRole.EMPLOYEE, SystemRole.COMPANY_ADMIN],
      accessRole: 'COMPANY_ADMIN',
    },
    {
      // Chủ sở hữu — trên Giám đốc một bậc: chỉ vai trò này có `owner.assign`.
      // Mang `SystemRole.COMPANY_ADMIN` ở lớp tương thích cũ vì enum `SystemRole`
      // không có `OWNER`; vai trò thật nằm ở `RoleAssignment`.
      fullName: 'Vũ Quốc Khánh',
      email: 'owner@amobi.vn',
      phone: '0901234571',
      department: 'Ban giám đốc',
      position: 'Chủ tịch',
      roles: [SystemRole.EMPLOYEE, SystemRole.COMPANY_ADMIN],
      accessRole: 'OWNER',
      isOwner: true,
    },
  ];

  const existingCodes = new Set(
    (
      await prisma.employee.findMany({
        where: { companyId: company.id },
        select: { employeeCode: true },
      })
    ).map((row) => row.employeeCode),
  );

  const createdEmployees: Record<string, string> = {};

  for (const sample of sampleEmployees) {
    const existing = await prisma.employee.findFirst({
      where: { companyId: company.id, phone: sample.phone },
    });
    if (existing) {
      /*
       * CẬP NHẬT chứ không bỏ qua.
       *
       * Bản trước `continue` ngay khi hồ sơ đã tồn tại, nên mọi thay đổi trong
       * bảng `sampleEmployees` — đổi vai trò, đổi phòng ban — không bao giờ tới
       * được cơ sở dữ liệu đã seed một lần. Người sửa seed rồi chạy lại sẽ thấy
       * dữ liệu cũ nguyên vẹn và không hiểu vì sao.
       *
       * KHÔNG đụng tới `employeeCode`: nó bất biến sau lần chấm công đầu (BR-04).
       */
      await prisma.employee.update({
        where: { id: existing.id },
        data: {
          fullName: sample.fullName,
          departmentId: departments[sample.department],
          position: sample.position,
          roles: sample.roles,
          status: 'ACTIVE',
          managedDepartmentIds: sample.roles.includes(SystemRole.MANAGER)
            ? [departments[sample.department]]
            : [],
        },
      });
      createdEmployees[sample.fullName] = existing.id;
      continue;
    }

    const employeeCode = buildUniqueEmployeeCode(sample.fullName, COMPANY_CODE, existingCodes);
    existingCodes.add(employeeCode);

    // Tài khoản đăng nhập đi kèm hồ sơ — HR cấp cả hai cùng lúc.
    const account = await prisma.userAccount.create({
      data: {
        companyId: company.id,
        email: sample.email,
        phone: sample.phone,
        fullName: sample.fullName,
        firebaseUid: await upsertFirebaseUser(sample.email, sample.fullName),
        // Seed dùng cho phát triển: không bắt đổi mật khẩu để đỡ vướng.
        mustChangePassword: false,
        passwordChangedAt: new Date(),
      },
    });

    const employee = await prisma.employee.create({
      data: {
        companyId: company.id,
        userId: account.id,
        employeeCode,
        fullName: sample.fullName,
        email: sample.email,
        phone: sample.phone,
        branchId: branch.id,
        departmentId: departments[sample.department],
        position: sample.position,
        contractType: 'Chính thức',
        joinedAt: new Date('2026-01-15'),
        // ACTIVE chứ không phải PENDING_ACTIVATION.
        //
        // `findActiveEmployeeIds` lọc đúng `status = 'ACTIVE'`, nên để
        // PENDING_ACTIVATION thì MỌI dashboard đếm ra 0 người và màn Tổng quan
        // trông như hỏng. Trong đời thật trạng thái này chuyển sang ACTIVE ở
        // lần nhân viên đăng nhập đầu tiên; seed đi thẳng tới đó.
        status: 'ACTIVE',
        roles: sample.roles,
        managedDepartmentIds: sample.roles.includes(SystemRole.MANAGER)
          ? [departments[sample.department]]
          : [],
      },
    });
    createdEmployees[sample.fullName] = employee.id;

    // Số dư phép năm khởi tạo.
    await prisma.leaveBalance.upsert({
      where: { employeeId_year: { employeeId: employee.id, year: 2026 } },
      create: {
        companyId: company.id,
        employeeId: employee.id,
        year: 2026,
        entitledDays: 12,
      },
      update: {},
    });
  }

  // --- 11b. Gán vai trò v2.1 (RoleAssignment) --------------------------------
  //
  // ⚠ Đây là thứ bản seed trước THIẾU HẲN.
  //
  // Seed cũ tạo danh mục `role` + `role_permission` nhưng không gán vai trò cho
  // ai. `AccessService` khi đó rơi về `fallbackFromLegacyRoles` — suy quyền từ
  // `SystemRole` cũ. Nó chạy được, nhưng đường chạy THẬT (`RoleAssignment` có
  // `validFrom`/`validTo`, có scope, có người cấp) thì không bao giờ được thực
  // thi trong môi trường phát triển, nên lỗi ở đó chỉ lộ ra khi lên production.
  //
  // `grantedById` là BẮT BUỘC trong lược đồ, và đó là chủ ý: mọi quyền trong hệ
  // thống phải truy được về người đã cấp nó (`BR-08`). Ở đây người cấp là Chủ
  // sở hữu — kể cả với chính vai trò của Chủ sở hữu, vì công ty mới lập thì
  // không có ai khác để cấp.
  const ownerSample = sampleEmployees.find((row) => row.isOwner);
  const granterId = ownerSample ? createdEmployees[ownerSample.fullName] : undefined;

  for (const sample of sampleEmployees) {
    const employeeId = createdEmployees[sample.fullName];
    if (!employeeId || !granterId) continue;

    const role = await prisma.role.findFirst({
      where: { companyId: null, code: sample.accessRole },
    });
    if (!role) continue;

    /*
     * Thu hồi vai trò cũ không còn khớp — bằng `validTo`, KHÔNG xoá dòng.
     *
     * Đây chính là cách hệ thống thu hồi quyền trong đời thật (`FR-GDW-ROLE-03`),
     * nên seed đi đúng đường đó thay vì `deleteMany`. Nó cũng là thứ khiến việc
     * tách `an@amobi.vn` khỏi `HR_PAYROLL` có hiệu lực trên cơ sở dữ liệu đã
     * seed từ trước: dòng cũ bị đóng lại chứ không bị bỏ quên.
     */
    await prisma.roleAssignment.updateMany({
      where: { companyId: company.id, employeeId, validTo: null, roleId: { not: role.id } },
      data: { validTo: new Date() },
    });

    const existingAssignment = await prisma.roleAssignment.findFirst({
      where: { companyId: company.id, employeeId, roleId: role.id, validTo: null },
    });
    if (!existingAssignment) {
      await prisma.roleAssignment.create({
        data: {
          companyId: company.id,
          employeeId,
          roleId: role.id,
          // Quản lý bị giới hạn ở phòng ban mình phụ trách; các vai trò khác
          // làm việc trên toàn công ty. Đây là chỗ `scopeIds` mang nghĩa thật:
          // để rỗng cho COMPANY nghĩa là "mọi phòng ban", không phải "không có".
          scopeLevel: sample.accessRole === 'MANAGER' ? ScopeLevel.DEPARTMENT : ScopeLevel.COMPANY,
          scopeIds: sample.accessRole === 'MANAGER' ? [departments[sample.department]] : [],
          validFrom: new Date('2026-01-01'),
          grantedById: granterId,
          reason: 'Khởi tạo dữ liệu mẫu',
        },
      });
    }

    if (sample.isOwner) {
      const existingOwner = await prisma.companyOwner.findFirst({
        where: { companyId: company.id, employeeId, revokedAt: null },
      });
      if (!existingOwner) {
        await prisma.companyOwner.create({
          data: {
            companyId: company.id,
            employeeId,
            grantedBy: granterId,
          },
        });
      }
    }
  }
  console.log(`  ✓ ${sampleEmployees.length} phân vai trò (RoleAssignment)`);

  // Gán trưởng phòng cho phòng Kỹ thuật — cần cho bước duyệt DIRECT_MANAGER.
  if (createdEmployees['Trần Văn Bình']) {
    await prisma.department.update({
      where: { id: departments['Kỹ thuật'] },
      data: { managerId: createdEmployees['Trần Văn Bình'] },
    });
  }
  console.log(`  ✓ ${sampleEmployees.length} nhân viên mẫu`);

  // --- 12. Kỳ lương hiện tại -------------------------------------------------
  const periodStart = new Date('2026-08-01T00:00:00.000Z');
  const periodEnd = new Date('2026-08-31T00:00:00.000Z');
  await prisma.payrollPeriod.upsert({
    where: {
      companyId_startDate_endDate: {
        companyId: company.id,
        startDate: periodStart,
        endDate: periodEnd,
      },
    },
    create: {
      companyId: company.id,
      name: 'Tháng 08/2026',
      startDate: periodStart,
      endDate: periodEnd,
      status: 'OPEN',
    },
    update: {},
  });
  console.log('  ✓ Kỳ lương Tháng 08/2026');

  console.log('');
  console.log('✅ Seed hoàn tất.');
  console.log('');
  console.log('   Đăng nhập 2 bước:');
  console.log('     ① Firebase SDK: signInWithEmailAndPassword(email, password)');
  console.log('     ② POST /v1/auth/session  { domain, firebaseIdToken }');
  console.log(`   Mật khẩu chung: ${SEED_PASSWORD}`);
  if (emulatorHost) {
    console.log(`   Tài khoản đã tạo trên Auth Emulator tại ${emulatorHost}`);
  }
  console.log('');
  console.log('   Mỗi vai trò MỘT tài khoản — dùng để kiểm giao diện đổi theo quyền:');
  console.log('');
  console.log(`     Quản trị nền tảng : ${ADMIN_EMAIL}   (không thuộc công ty nào)`);
  console.log('     Chủ sở hữu        : owner@amobi.vn');
  console.log('     Giám đốc          : an@amobi.vn');
  console.log('     Kế toán / HR      : hoa@amobi.vn');
  console.log('     Quản lý           : binh@amobi.vn      (giới hạn phòng Kỹ thuật)');
  console.log('     Nhân viên         : duc@amobi.vn');
  console.log('');
  console.log(`   Tên miền công ty: ${COMPANY_DOMAIN}`);
}

main()
  .catch((error) => {
    console.error('❌ Seed thất bại:', error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
