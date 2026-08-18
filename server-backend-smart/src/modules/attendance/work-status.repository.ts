import { Injectable } from '@nestjs/common';
import { EmployeeStatus, Prisma } from '@prisma/client';
import { BaseRepository } from 'src/infra/prisma/base.repository';
import { PrismaService } from 'src/infra/prisma/prisma.service';

export interface WorkStatusEmployeeFilter {
  /**
   * Phòng ban người dùng chọn, ĐÃ mở rộng xuống cấp dưới.
   *
   * Ba trạng thái, không phải hai — và phân biệt được chúng là chuyện bảo mật:
   *
   * - `undefined` → không lọc theo phòng ban.
   * - `['a','b']` → chỉ hai phòng đó.
   * - `[]`        → KHÔNG phòng ban nào, trả về rỗng.
   *
   * Trường hợp cuối có thật: phép giao giữa phòng ban người dùng chọn và phạm
   * vi quyền của họ có thể ra rỗng. Gộp nó với `undefined` thành "không lọc" là
   * biến một yêu cầu vượt quyền thành một lượt đọc toàn công ty.
   */
  departmentIds?: string[];
  /** Phạm vi của MANAGER. `null` = HR/Admin, không giới hạn. */
  departmentScope: string[] | null;
  q?: string;
}

export interface WorkStatusEmployeeRow {
  id: string;
  fullName: string;
  employeeCode: string;
  status: string;
  department: { id: string; name: string } | null;
}

/**
 * Đúng những cột của ca mà màn theo dõi cần.
 *
 * Khai tay thay vì `Prisma.ShiftGetPayload`: cùng hình dạng này còn phải mô tả
 * được ca MẶC ĐỊNH (đọc từ bảng `shift` thẳng) lẫn ca ĐƯỢC XẾP (đọc lồng qua
 * `shiftAssignment`), và một kiểu suy từ payload chỉ khớp được một trong hai.
 */
export interface WorkStatusShiftRow {
  id: string;
  code: string;
  name: string;
  symbol: string | null;
  startTime: string | null;
  endTime: string | null;
  crossesMidnight: boolean;
  breakStart: string | null;
  breakEnd: string | null;
  lateToleranceMinutes: number;
}

/** Ca mặc định mang thêm bitmask ngày trong tuần — BR-ATT-04 lọc theo nó. */
export interface WorkStatusDefaultShiftRow extends WorkStatusShiftRow {
  weekdayMask: number;
}

export interface WorkStatusAssignmentRow {
  id: string;
  employeeId: string;
  shiftId: string;
  shift: WorkStatusShiftRow | null;
}

export type WorkStatusLogRow = Prisma.AttendanceLogGetPayload<{
  select: {
    id: true;
    employeeId: true;
    type: true;
    authMethod: true;
    recordedAt: true;
    branchId: true;
    decision: true;
    isOffline: true;
  };
}>;

/**
 * Đọc dữ liệu cho màn "Theo dõi công việc" — trạng thái làm việc của MỘT ngày.
 *
 * Khác `AttendanceSheetRepository` ở trục thời gian, và khác biệt đó quyết định
 * mọi thứ còn lại: bảng chấm công đọc CẢ THÁNG của một tập người đã chốt sẵn,
 * còn ở đây là MỘT ngày của mọi người trong phạm vi quyền. Vì chỉ một ngày nên
 * đọc được cả `AttendanceLog` thô — thứ mà bảng chấm công cố ý không đụng tới vì
 * 31 ngày × 500 người là chục nghìn lượt quẹt.
 *
 * Chính những lượt quẹt thô đó là lý do màn này tồn tại: `AttendanceDaily` chỉ
 * có giờ vào đầu tiên và giờ ra cuối cùng, nên nó KHÔNG trả lời được "người này
 * lúc này đang ở trong hay đã ra ngoài".
 */
@Injectable()
export class WorkStatusRepository extends BaseRepository {
  /*
   * Khai lại constructor dù nó chỉ gọi `super`.
   *
   * TypeScript chỉ phát ra `design:paramtypes` cho lớp CÓ constructor riêng; lớp
   * con thừa kế constructor của `BaseRepository` thì Nest không thấy tham số nào
   * để tiêm và `this.prisma` là `undefined` — một lỗi chỉ lộ ra ở lượt truy vấn
   * đầu tiên lúc chạy, không phải lúc biên dịch. Mọi repository khác trong dự án
   * đều khai lại đúng như thế này.
   */
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  /**
   * Điều kiện lọc CBNV — dùng chung cho cả trang đang xem lẫn phần tổng.
   *
   * Tách ra một chỗ vì hai lượt đọc đó BẮT BUỘC phải cùng tập người: con số tổng
   * tính trên một tập rộng hơn danh sách đang hiện là con số không giải thích
   * được cho người đang nhìn màn hình.
   */
  private buildWhere(
    companyId: string,
    filter: WorkStatusEmployeeFilter,
  ): Prisma.EmployeeWhereInput {
    const where: Prisma.EmployeeWhereInput = {
      companyId,
      deletedAt: null,
      // Người đã nghỉ việc KHÔNG có mặt — khác hẳn bảng chấm công cuối tháng, nơi
      // họ vẫn phải hiện ra để chốt công lần cuối. Đây là màn theo dõi ai đang
      // làm việc HÔM NAY, và người đã nghỉ thì không nằm trong câu hỏi đó.
      status: { in: [EmployeeStatus.ACTIVE, EmployeeStatus.PENDING_ACTIVATION] },
    };

    // Phạm vi của MANAGER thu hẹp, không mở rộng. GIAO hai tập chứ không ghi đè:
    // ghi đè thì một MANAGER lọc theo đúng một phòng trong quyền của mình vẫn
    // nhận về cả phạm vi, tức là bộ lọc họ vừa chọn im lặng không có tác dụng.
    //
    // So `!== undefined` chứ không `?.length`: mảng RỖNG phải cho ra `{ in: [] }`
    // — không dòng nào — chứ không rơi về nhánh "không lọc". Xem chú thích ở
    // `WorkStatusEmployeeFilter.departmentIds`.
    const picked = filter.departmentIds;
    if (picked !== undefined && filter.departmentScope) {
      where.departmentId = { in: picked.filter((id) => filter.departmentScope?.includes(id)) };
    } else if (picked !== undefined) {
      where.departmentId = { in: picked };
    } else if (filter.departmentScope) {
      where.departmentId = { in: filter.departmentScope };
    }

    if (filter.q) {
      where.OR = [
        { fullName: { contains: filter.q, mode: 'insensitive' } },
        { employeeCode: { contains: filter.q, mode: 'insensitive' } },
      ];
    }

    return where;
  }

  /**
   * CBNV trong phạm vi, kèm tổng số khớp bộ lọc.
   *
   * Service đọc CẢ phạm vi trong một lượt (`take` = trần an toàn) rồi mới cắt
   * trang trong bộ nhớ — không phải vì lười phân trang ở database, mà vì phần
   * tổng ở đầu trang phải nói về cả phạm vi: "còn 12 người chưa đến" mà thật ra
   * chỉ đếm trong trang 1 là một con số sai theo cách người đọc không thể phát
   * hiện. `total` vẫn trả về để service biết mình có chạm trần hay không.
   */
  async searchEmployees(
    companyId: string,
    filter: WorkStatusEmployeeFilter & { skip: number; take: number },
  ): Promise<{ items: WorkStatusEmployeeRow[]; total: number }> {
    const where = this.buildWhere(companyId, filter);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.employee.findMany({
        where,
        select: {
          id: true,
          fullName: true,
          employeeCode: true,
          status: true,
          department: { select: { id: true, name: true } },
        },
        orderBy: [{ employeeCode: 'asc' }, { fullName: 'asc' }],
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.employee.count({ where }),
    ]);

    return { items, total };
  }

  /**
   * Ca đã xếp cho đúng ngày, KÈM cấu hình ca.
   *
   * `include` chứ không tra lại danh mục ca ở tầng trên: một `ShiftAssignment`
   * vẫn trỏ tới ca đã bị xoá mềm, và danh mục thì đã lọc `deletedAt: null`. Tra
   * qua danh mục sẽ làm những ô đó thành "không có ca" — đúng vào lúc cần biết
   * người ta đáng lẽ phải có mặt lúc mấy giờ.
   */
  async findAssignments(
    companyId: string,
    employeeIds: string[],
    workDate: Date,
  ): Promise<WorkStatusAssignmentRow[]> {
    if (employeeIds.length === 0) return [];
    return this.db().shiftAssignment.findMany({
      where: { companyId, employeeId: { in: employeeIds }, workDate },
      select: {
        id: true,
        employeeId: true,
        shiftId: true,
        shift: {
          select: {
            id: true,
            code: true,
            name: true,
            symbol: true,
            startTime: true,
            endTime: true,
            crossesMidnight: true,
            breakStart: true,
            breakEnd: true,
            lateToleranceMinutes: true,
          },
        },
      },
    });
  }

  async findDailies(companyId: string, employeeIds: string[], workDate: Date) {
    if (employeeIds.length === 0) return [];
    return this.db().attendanceDaily.findMany({
      where: { companyId, employeeId: { in: employeeIds }, workDate },
    });
  }

  /**
   * Lượt quẹt thô của ngày.
   *
   * KHÔNG lấy `photoKey`, toạ độ hay điểm AI. Màn theo dõi chỉ cần biết "lúc mấy
   * giờ, kiểu gì" để dựng dòng thời gian; ảnh là presigned URL hết hạn sau 5
   * phút và dựng nó cho vài trăm lượt mỗi lần làm mới là lãng phí thuần tuý.
   * Ai cần xem ảnh thì mở drawer chi tiết — nó gọi `admin/attendance/logs`.
   *
   * Lọc theo `workDate` chứ không theo khoảng `recordedAt`: ca đêm gắn với NGÀY
   * BẮT ĐẦU ca, nên lượt quẹt lúc 02:00 sáng hôm sau vẫn thuộc ngày hôm trước —
   * lọc theo instant sẽ đánh rơi đúng những lượt đó.
   */
  async findLogs(
    companyId: string,
    employeeIds: string[],
    workDate: Date,
  ): Promise<WorkStatusLogRow[]> {
    if (employeeIds.length === 0) return [];
    return this.db().attendanceLog.findMany({
      where: { companyId, employeeId: { in: employeeIds }, workDate },
      select: {
        id: true,
        employeeId: true,
        type: true,
        authMethod: true,
        recordedAt: true,
        branchId: true,
        decision: true,
        isOffline: true,
      },
      orderBy: { recordedAt: 'asc' },
    });
  }

  /** Ca mặc định còn hiệu lực — BR-ATT-04, áp cho người không được xếp ca. */
  async findDefaultShifts(companyId: string, workDate: Date): Promise<WorkStatusDefaultShiftRow[]> {
    return this.db().shift.findMany({
      where: {
        companyId,
        isDefault: true,
        deletedAt: null,
        effectiveFrom: { lte: workDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: workDate } }],
      },
      select: {
        id: true,
        code: true,
        name: true,
        symbol: true,
        startTime: true,
        endTime: true,
        crossesMidnight: true,
        breakStart: true,
        breakEnd: true,
        lateToleranceMinutes: true,
        weekdayMask: true,
      },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  /** Chi nhánh, để dòng thời gian nói được người đó quẹt ở đâu. */
  async findBranchNames(companyId: string): Promise<Map<string, string>> {
    const rows = await this.db().branch.findMany({
      where: { companyId },
      select: { id: true, name: true },
    });
    return new Map(rows.map((row) => [row.id, row.name]));
  }
}
