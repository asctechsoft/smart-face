/**
 * Seed dữ liệu khởi tạo — docs/07-mo-hinh-du-lieu.md mục 4.5.
 *
 * Chạy: `npm run seed`
 *
 * Tạo:
 *   - Gói dịch vụ mặc định (Trial / Basic / Pro / Enterprise)
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

import { PrismaClient, ShiftType, SystemRole } from '@prisma/client';
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { buildUniqueEmployeeCode } from '../src/common/utils/employee-code.util';

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

  // --- 1. Gói dịch vụ --------------------------------------------------------
  const plans = [
    {
      name: 'Trial',
      maxEmployees: 20,
      maxBranches: 1,
      maxRecognitionsPerMonth: 2000,
      storageGb: 5,
      photoRetentionDays: 30,
      features: { rotatingShift: false, ot: true, multiBranch: false, apiIntegration: false },
      pricePerMonth: 0,
    },
    {
      name: 'Basic',
      maxEmployees: 50,
      maxBranches: 2,
      maxRecognitionsPerMonth: 10_000,
      storageGb: 20,
      photoRetentionDays: 90,
      features: { rotatingShift: true, ot: true, multiBranch: false, apiIntegration: false },
      pricePerMonth: 1_500_000,
    },
    {
      name: 'Pro',
      maxEmployees: 200,
      maxBranches: 5,
      maxRecognitionsPerMonth: 50_000,
      storageGb: 100,
      photoRetentionDays: 180,
      features: { rotatingShift: true, ot: true, multiBranch: true, apiIntegration: false },
      pricePerMonth: 5_000_000,
    },
    {
      name: 'Enterprise',
      maxEmployees: null,
      maxBranches: null,
      maxRecognitionsPerMonth: null,
      storageGb: 500,
      photoRetentionDays: 365,
      features: { rotatingShift: true, ot: true, multiBranch: true, apiIntegration: true },
      pricePerMonth: null,
    },
  ];

  for (const plan of plans) {
    await prisma.subscriptionPlan.upsert({
      where: { name: plan.name },
      create: plan,
      update: plan,
    });
  }
  const proPlan = await prisma.subscriptionPlan.findUniqueOrThrow({ where: { name: 'Pro' } });
  console.log(`  ✓ ${plans.length} gói dịch vụ`);

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
      planId: proPlan.id,
    },
    update: { domain: COMPANY_DOMAIN, planId: proPlan.id, status: 'ACTIVE' },
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

  const departmentNames = ['Kỹ thuật', 'Kinh doanh', 'Nhân sự', 'Kế toán'];
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
  const sampleEmployees: Array<{
    fullName: string;
    email: string;
    phone: string;
    department: string;
    position: string;
    roles: SystemRole[];
  }> = [
    {
      fullName: 'Nguyễn Văn Đức',
      email: 'duc@amobi.vn',
      phone: '0901234567',
      department: 'Kỹ thuật',
      position: 'Nhân viên',
      roles: [SystemRole.EMPLOYEE],
    },
    {
      fullName: 'Trần Văn Bình',
      email: 'binh@amobi.vn',
      phone: '0901234568',
      department: 'Kỹ thuật',
      position: 'Trưởng phòng',
      roles: [SystemRole.EMPLOYEE, SystemRole.MANAGER],
    },
    {
      fullName: 'Lê Thị Hoa',
      email: 'hoa@amobi.vn',
      phone: '0901234569',
      department: 'Nhân sự',
      position: 'Chuyên viên nhân sự',
      roles: [SystemRole.EMPLOYEE, SystemRole.HR_PAYROLL],
    },
    {
      fullName: 'Phạm Thị An',
      email: 'an@amobi.vn',
      phone: '0901234570',
      department: 'Kế toán',
      position: 'Kế toán trưởng',
      roles: [SystemRole.EMPLOYEE, SystemRole.HR_PAYROLL, SystemRole.COMPANY_ADMIN],
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
        status: 'PENDING_ACTIVATION',
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

  // --- 13. Phiên bản model AI ------------------------------------------------
  await prisma.aiModelVersion.upsert({
    where: { name_version: { name: 'buffalo_l', version: '2.1' } },
    create: {
      name: 'buffalo_l',
      version: '2.1',
      isActive: true,
      defaultMatchThreshold: 0.45,
      defaultLivenessThreshold: 0.7,
      deployedAt: new Date(),
      notes:
        'Giá trị khởi điểm. PHẢI đo FAR/FRR trên dữ liệu thật của khách hàng và hiệu chỉnh lại ngưỡng TRƯỚC khi go-live.',
    },
    update: {},
  });
  console.log('  ✓ Model buffalo_l@2.1');

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
  console.log(`     Admin nền tảng : ${ADMIN_EMAIL}          (không cần tên miền)`);
  console.log(`     Admin công ty  : an@amobi.vn    tên miền ${COMPANY_DOMAIN}`);
  console.log(`     HR             : hoa@amobi.vn   tên miền ${COMPANY_DOMAIN}`);
  console.log(`     Quản lý        : binh@amobi.vn  tên miền ${COMPANY_DOMAIN}`);
  console.log(`     Nhân viên      : duc@amobi.vn   tên miền ${COMPANY_DOMAIN}`);
}

main()
  .catch((error) => {
    console.error('❌ Seed thất bại:', error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
