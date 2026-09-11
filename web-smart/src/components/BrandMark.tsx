/**
 * Dấu hiệu thương hiệu — hai cánh lá lồng nhau, xanh lá và xanh dương.
 *
 * Nằm ở `components/` chứ không ở màn hình nào cả, vì nó xuất hiện ở hai nơi
 * cách xa nhau: màn đăng nhập và đầu thanh điều hướng. Một logo bị chép thành
 * hai bản là một logo sẽ lệch — nơi này đổi màu, nơi kia thì không, và không ai
 * phát hiện ra cho tới khi nhìn hai màn hình cạnh nhau.
 *
 * Không có ô vuông bo góc bọc ngoài. Bản vẽ đầu dùng icon `face` của Material
 * đặt trong một ô xanh; nó không phải logo của sản phẩm. Hai màu của glyph này
 * chính là hai màu chạy suốt phần còn lại của giao diện — xanh dương cho việc
 * chấm công, xanh lá cho việc đã hoàn tất.
 */
export function BrandMark({ className, size }: { className?: string; size?: number }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      focusable="false"
      aria-hidden="true"
    >
      {/*
        Mỗi cánh là một hình thấu kính dựng từ hai cung tròn cùng bán kính, nối
        hai đầu của một đường chéo. Hai cánh đối xứng quay quanh tâm (20,20) —
        nhờ vậy chúng cân nhau ở mọi kích thước mà không phải chỉnh tay.
      */}
      <path d="M20 4A14 14 0 0 1 36 20 14 14 0 0 1 20 4Z" fill="var(--sf-blue-500)" />
      <path d="M20 36A14 14 0 0 1 4 20 14 14 0 0 1 20 36Z" fill="var(--sf-success-500)" />
    </svg>
  );
}
