import { useEffect, useRef, useState } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { qk } from '@/lib/api/query-client';
import { useToast } from '@/components/ui';
import { useErrorToast } from '@/lib/errors/use-error-toast';
import type { JobStatus } from './attendance.api';
import { useRecalculateAttendanceSheet } from './attendance-sheets.api';

/** Job đã kết thúc — thành công hay thất bại đều không hỏi tiếp nữa. */
function isSettled(status: string | undefined): boolean {
  return status === 'COMPLETED' || status === 'FAILED';
}

/**
 * Chạy lượt tính lại công cho MỘT HOẶC NHIỀU bảng và theo dõi tới lúc xong.
 *
 * ## Vì sao nhận nhiều bảng
 *
 * Màn "Bảng công" đọc theo THÁNG, mà một tháng được chia thành nhiều bảng theo
 * nhóm phòng ban. Nút "Đối soát tự động" ở đó phải chạm tới mọi bảng của tháng
 * — tính lại đúng một bảng rồi báo "đã cập nhật" là nói sai với người vừa nhìn
 * con số của cả tháng. Lưới của một bảng thì truyền vào mảng một phần tử.
 *
 * ## Vì sao là một hook chứ không chép hai lần
 *
 * Cả lưới người × ngày lẫn màn tháng đều mở đầu bằng đúng việc này: người rà
 * công bấm "Cập nhật / Đối soát" trước khi tin bất kỳ con số nào. Luật ở đây —
 * không làm mới lúc nhận job, chỉ làm mới khi job báo xong — là thứ dễ chép sai
 * nhất, và chép sai thì màn hình đứng im sau khi bấm nút, người dùng kết luận
 * nút hỏng rồi bấm thêm hai lần nữa (mỗi lần một job thật trên cùng dữ liệu).
 *
 * ## Vì sao không `invalidate` ngay khi request trả về
 *
 * Endpoint trả `202` + `jobId`: lúc đó job mới chỉ VỪA ĐƯỢC NHẬN và số liệu
 * chưa đổi. Tải lại ngay chỉ lấy về đúng những con số cũ rồi đứng yên.
 *
 * Quét cả nhánh `attendance` chứ không riêng khoá của bảng: tính lại chạm vào
 * `AttendanceDaily`, cùng nguồn với lưới, bảng tổng hợp, drawer chi tiết ô và
 * danh sách lượt chấm công có thể đang mở bên cạnh.
 */
export function useRecalculateSheets(sheetIds: string[]) {
  const toast = useToast();
  const showError = useErrorToast();
  const queryClient = useQueryClient();
  const recalculate = useRecalculateAttendanceSheet();

  /** Job đang chạy. Rỗng = không có lượt cập nhật nào đang chờ. */
  const [jobIds, setJobIds] = useState<string[]>([]);
  /** Chặn báo kết quả hai lần cho cùng một lượt bấm. */
  const reported = useRef(false);

  /*
   * `useQueries` chứ không `useExportJob` gọi nhiều lần: số bảng của một tháng
   * đổi theo tháng đang xem, mà số lần gọi hook thì không được đổi giữa hai lần
   * render.
   */
  const jobs = useQueries({
    queries: jobIds.map((jobId) => ({
      queryKey: qk.job(jobId),
      queryFn: () => api.get<JobStatus>(`/jobs/${jobId}`),
      refetchInterval: (query: { state: { data?: JobStatus } }) =>
        isSettled(query.state.data?.status) ? (false as const) : 2000,
    })),
  });

  const settled = jobIds.length > 0 && jobs.every((job) => isSettled(job.data?.status));
  const running = recalculate.isPending || (jobIds.length > 0 && !settled);

  const progress =
    jobs.length === 0
      ? 0
      : Math.round(
          jobs.reduce(
            (total, job) => total + (isSettled(job.data?.status) ? 100 : (job.data?.progress ?? 0)),
            0,
          ) / jobs.length,
        );

  useEffect(() => {
    if (!settled || reported.current) return;
    reported.current = true;

    const failed = jobs.filter((job) => job.data?.status === 'FAILED');

    if (failed.length === 0) {
      toast.success(
        'Đã đối soát lại công',
        'Số liệu đang hiện là kết quả tính mới nhất. Ngày thuộc kỳ lương đã chốt được giữ nguyên.',
      );
      void queryClient.invalidateQueries({ queryKey: qk.attendance });
    } else {
      // Nói rõ BAO NHIÊU bảng hỏng, không chỉ "thất bại": tháng có năm bảng mà
      // hỏng một thì bốn bảng kia đã có số mới, và người dùng cần biết điều đó.
      toast.error(
        `Đối soát thất bại ở ${failed.length}/${jobs.length} bảng`,
        failed[0]?.data?.error ?? failed[0]?.data?.errorMessage ?? undefined,
      );
      // Vẫn làm mới: những bảng chạy xong đã có số liệu mới thật.
      void queryClient.invalidateQueries({ queryKey: qk.attendance });
    }

    setJobIds([]);
  }, [settled, jobs, toast, queryClient]);

  async function start() {
    if (sheetIds.length === 0) {
      toast.warning(
        'Tháng này chưa có bảng chấm công nào',
        'Lập bảng cho tháng trước đã — không có bảng thì không có ai để tính công.',
      );
      return;
    }
    try {
      reported.current = false;
      const started = await Promise.all(sheetIds.map((id) => recalculate.mutateAsync(id)));
      setJobIds(started.map((job) => job.jobId));
    } catch (caught) {
      reported.current = true;
      showError(caught);
    }
  }

  return {
    /** Bắt đầu một lượt tính lại. Tự báo lỗi bằng toast, không ném ra ngoài. */
    start: () => void start(),
    running,
    /** 0–100, trung bình trên các bảng đang chạy. */
    progress,
    sheetCount: sheetIds.length,
  };
}
