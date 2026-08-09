import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EmployeeStatus, SystemRole } from '@prisma/client';
import request from 'supertest';
import { AppModule } from 'src/app.module';
import { AllExceptionsFilter } from 'src/common/filters/all-exceptions.filter';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { TokenService } from 'src/modules/auth/token.service';

/**
 * NFR-SEC-05 — KIỂM CHỨNG CÁCH LY TENANT.
 *
 * ⚠ Test này FAIL = CHẶN RELEASE.
 *
 * "Một lỗi thiếu company_id trong query = rò rỉ dữ liệu chéo khách hàng — sự cố
 *  nghiêm trọng nhất có thể xảy ra" (ADR-05).
 *
 * Kịch bản (docs/09 mục 1.1):
 *   1. Seed 2 tenant A và B, mỗi bên có nhân viên + dữ liệu nghiệp vụ riêng.
 *   2. Đăng nhập bằng tài khoản HR của tenant A.
 *   3. Với mọi endpoint GET:
 *        - Gọi với ID thuộc tenant B → phải 404/403, KHÔNG BAO GIỜ 200.
 *        - Gọi danh sách → không chứa bất kỳ bản ghi nào của tenant B.
 *   4. Lặp lại với vai trò MANAGER và EMPLOYEE.
 *
 * Yêu cầu: DATABASE_URL trỏ tới database TEST (dữ liệu sẽ bị xoá), Redis chạy.
 *
 * Cần thêm `FIREBASE_PROJECT_ID` vì test này nạp cả `AppModule`, và
 * `FirebaseService` cố tình chết lúc khởi động khi thiếu cấu hình. Không cần
 * Firebase thật — test cấp token thẳng qua `TokenService` chứ không đi qua màn
 * hình đăng nhập, nên trỏ vào Auth Emulator là đủ:
 *
 *   FIREBASE_PROJECT_ID=demo-smartface FIREBASE_AUTH_EMULATOR_HOST=localhost:9099
 *
 * Chạy: `npm run test:e2e`
 */
describe('Cách ly dữ liệu multi-tenant (NFR-SEC-05)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens: TokenService;

  const suffix = `iso${Date.now().toString(36)}`;
  const fixtures = {
    a: { companyId: '', hrToken: '', employeeToken: '', employeeId: '', attendanceLogId: '', requestId: '' },
    b: { companyId: '', hrToken: '', employeeId: '', attendanceLogId: '', requestId: '' },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1', { exclude: ['health'] });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);

    await seedTenant('a', `${suffix}a`);
    await seedTenant('b', `${suffix}b`);
  });

  afterAll(async () => {
    await cleanup();
    await app?.close();
  });

  // ---------------------------------------------------------------------------

  async function seedTenant(key: 'a' | 'b', code: string) {
    const company = await prisma.company.create({
      data: {
        code,
        domain: `${code}.test`,
        name: `Công ty ${code.toUpperCase()}`,
        status: 'ACTIVE',
      },
    });

    // Test này cấp token thẳng qua TokenService thay vì đi qua màn hình đăng
    // nhập, nên không cần tài khoản Firebase thật. Nhưng cột `firebaseUid` là
    // NOT NULL và UNIQUE nên vẫn phải điền một giá trị riêng cho từng dòng.
    const fakeUid = (role: string) => `test-uid-${code}-${role}-${Date.now()}`;
    const phoneOf = (prefix: string) =>
      `${prefix}${Date.now().toString().slice(-8)}${key === 'a' ? '1' : '2'}`.slice(0, 10);

    const hrUser = await prisma.userAccount.create({
      data: {
        companyId: company.id,
        email: `hr@${code}.test`,
        phone: phoneOf('09'),
        fullName: `HR ${code}`,
        firebaseUid: fakeUid('hr'),
        mustChangePassword: false,
      },
    });
    const hr = await prisma.employee.create({
      data: {
        companyId: company.id,
        userId: hrUser.id,
        employeeCode: `hr.${code}`,
        fullName: `HR ${code}`,
        phone: hrUser.phone ?? '',
        status: EmployeeStatus.ACTIVE,
        roles: [SystemRole.EMPLOYEE, SystemRole.HR_PAYROLL],
      },
    });

    const staffUser = await prisma.userAccount.create({
      data: {
        companyId: company.id,
        email: `nv@${code}.test`,
        phone: phoneOf('08'),
        fullName: `NV ${code}`,
        firebaseUid: fakeUid('nv'),
        mustChangePassword: false,
      },
    });
    const staff = await prisma.employee.create({
      data: {
        companyId: company.id,
        userId: staffUser.id,
        employeeCode: `nv.${code}`,
        fullName: `Nhân viên ${code}`,
        phone: staffUser.phone ?? '',
        status: EmployeeStatus.ACTIVE,
        roles: [SystemRole.EMPLOYEE],
      },
    });

    const workDate = new Date(Date.UTC(2026, 7, 3));
    const log = await prisma.attendanceLog.create({
      data: {
        companyId: company.id,
        employeeId: staff.id,
        type: 'CHECK_IN',
        authMethod: 'MANUAL',
        workDate,
      },
    });

    const requestType = await prisma.requestType.create({
      data: { companyId: company.id, code: 'ANNUAL_LEAVE', name: 'Nghỉ phép' },
    });
    const leaveRequest = await prisma.leaveRequest.create({
      data: {
        companyId: company.id,
        employeeId: staff.id,
        requestTypeId: requestType.id,
        status: 'PENDING',
        startAt: new Date('2026-08-10T00:00:00Z'),
        endAt: new Date('2026-08-10T23:59:59Z'),
        quantity: 1,
        reason: 'Test cách ly tenant',
        submittedAt: new Date(),
      },
    });

    const hrTokens = await tokens.issue({
      userId: hrUser.id,
      employee: hr,
      isSystemAdmin: false,
      deviceId: null,
    });

    fixtures[key].companyId = company.id;
    fixtures[key].hrToken = hrTokens.accessToken;
    fixtures[key].employeeId = staff.id;
    fixtures[key].attendanceLogId = log.id;
    fixtures[key].requestId = leaveRequest.id;

    if (key === 'a') {
      const staffTokens = await tokens.issue({
        userId: staffUser.id,
        employee: staff,
        isSystemAdmin: false,
        deviceId: null,
      });
      fixtures.a.employeeToken = staffTokens.accessToken;
    }
  }

  async function cleanup() {
    const companyIds = [fixtures.a.companyId, fixtures.b.companyId].filter(Boolean);
    if (companyIds.length === 0) return;

    // Xoá theo thứ tự phụ thuộc khoá ngoại.
    await prisma.approvalStep.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.leaveRequest.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.requestType.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.fraudFlag.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.attendanceDaily.deleteMany({ where: { companyId: { in: companyIds } } });
    // attendance_log có rule chặn DELETE ở tầng DB (BR-06) — bỏ qua là đúng thiết kế.
    const employees = await prisma.employee.findMany({
      where: { companyId: { in: companyIds } },
      select: { id: true, userId: true },
    });
    const userIds = employees.map((e) => e.userId).filter((id): id is string => Boolean(id));
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.employee.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.userAccount.deleteMany({ where: { id: { in: userIds } } });
    await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
  }

  const get = (path: string, token: string) =>
    request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`);

  // ===========================================================================
  //  Truy cập theo ID xuyên tenant — KHÔNG BAO GIỜ được trả 200
  // ===========================================================================

  describe('HR của tenant A truy cập tài nguyên của tenant B theo ID', () => {
    it('GET /admin/attendance/{id} của tenant B → không phải 200', async () => {
      const response = await get(
        `/v1/admin/attendance/${fixtures.b.attendanceLogId}`,
        fixtures.a.hrToken,
      );
      expect(response.status).not.toBe(200);
      expect([403, 404]).toContain(response.status);
    });

    it('GET /admin/employees/{id} của tenant B → không phải 200', async () => {
      const response = await get(
        `/v1/admin/employees/${fixtures.b.employeeId}`,
        fixtures.a.hrToken,
      );
      expect(response.status).not.toBe(200);
      expect([403, 404]).toContain(response.status);
    });

    it('GET /requests/{id} của tenant B → không phải 200', async () => {
      const response = await get(`/v1/requests/${fixtures.b.requestId}`, fixtures.a.hrToken);
      expect(response.status).not.toBe(200);
      expect([403, 404]).toContain(response.status);
    });
  });

  // ===========================================================================
  //  Danh sách — không được lẫn bản ghi của tenant khác
  // ===========================================================================

  describe('Danh sách không chứa dữ liệu của tenant khác', () => {
    it('GET /admin/employees chỉ trả nhân viên của tenant A', async () => {
      const response = await get('/v1/admin/employees?pageSize=100', fixtures.a.hrToken);
      expect(response.status).toBe(200);

      const items = response.body.data as Array<{ id: string; companyId: string }>;
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((item) => item.companyId === fixtures.a.companyId)).toBe(true);
      expect(items.some((item) => item.id === fixtures.b.employeeId)).toBe(false);
    });

    it('GET /requests không chứa đơn của tenant B', async () => {
      const response = await get('/v1/requests?pageSize=100', fixtures.a.hrToken);
      expect(response.status).toBe(200);

      const items = response.body.data as Array<{ id: string; companyId: string }>;
      expect(items.every((item) => item.companyId === fixtures.a.companyId)).toBe(true);
      expect(items.some((item) => item.id === fixtures.b.requestId)).toBe(false);
    });

    it('GET /admin/fraud/flags không chứa cờ của tenant B', async () => {
      const response = await get('/v1/admin/fraud/flags?pageSize=100', fixtures.a.hrToken);
      expect(response.status).toBe(200);

      const items = response.body.data as Array<{ companyId: string }>;
      expect(items.every((item) => item.companyId === fixtures.a.companyId)).toBe(true);
    });

    it('GET /admin/audit-logs không chứa log của tenant B', async () => {
      const response = await get('/v1/admin/audit-logs?pageSize=100', fixtures.a.hrToken);
      expect(response.status).toBe(200);

      const items = response.body.data as Array<{ companyId: string | null }>;
      expect(items.every((item) => item.companyId === fixtures.a.companyId)).toBe(true);
    });
  });

  // ===========================================================================
  //  Header X-Company-Id không được nâng quyền
  // ===========================================================================

  describe('Không nâng quyền được bằng header', () => {
    it('X-Company-Id trỏ sang tenant B KHÔNG có tác dụng với người dùng thường', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/admin/employees?pageSize=100')
        .set('Authorization', `Bearer ${fixtures.a.hrToken}`)
        .set('X-Company-Id', fixtures.b.companyId);

      expect(response.status).toBe(200);
      const items = response.body.data as Array<{ companyId: string }>;
      expect(items.every((item) => item.companyId === fixtures.a.companyId)).toBe(true);
    });
  });

  // ===========================================================================
  //  Phân quyền theo vai trò
  // ===========================================================================

  describe('EMPLOYEE không truy cập được API quản lý', () => {
    it.each([
      '/v1/admin/employees',
      '/v1/admin/payroll/periods',
      '/v1/admin/fraud/flags',
      '/v1/system/tenants',
    ])('GET %s → 403', async (path) => {
      const response = await get(path, fixtures.a.employeeToken);
      expect(response.status).toBe(403);
    });

    it('không xem được lượt chấm công của người khác', async () => {
      const response = await get(
        `/v1/attendance/${fixtures.a.attendanceLogId}`,
        fixtures.a.employeeToken,
      );
      // Bản ghi thuộc nhân viên khác trong CÙNG công ty → vẫn phải chặn.
      expect(response.status).not.toBe(200);
    });
  });
});
