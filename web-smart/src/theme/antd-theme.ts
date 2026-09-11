import type { ThemeConfig } from 'antd';

/**
 * Cấu hình Ant Design — phải khớp `src/styles/tokens.css`.
 *
 * ## Vì sao ở đây là mã hex chứ không phải `var(--sf-*)`
 *
 * Ant Design tính ra hàng chục màu dẫn xuất (nền hover, viền disabled, bóng
 * focus) từ các màu gốc này, và phép tính đó chạy trong JavaScript nên nó cần
 * giá trị thật, không phải một chuỗi `var(...)` mà chỉ trình duyệt hiểu. Đây là
 * chỗ DUY NHẤT trong dự án được viết hex ngoài `tokens.css` — đổi màu thì phải
 * sửa cả hai file rồi chạy `npm run check:contrast`.
 *
 * ## Ghi chú về hover, đã đảo chiều so với bản trước
 *
 * Bản teal/amber phải ép nút chính SÁNG LÊN khi hover, vì nút amber có chữ nâu
 * sẫm và tối nền đi làm tương phản tụt xuống 3.02:1. Nút xanh dương có chữ
 * trắng nên hành vi mặc định của Ant Design (tối đi) lại là hướng đúng:
 * `blue-800` cho 8.72:1, cao hơn 6.70:1 ở trạng thái nghỉ.
 *
 * Đừng chép quy tắc "luôn sáng lên" của bản cũ sang — nó đúng cho một bảng màu
 * đã không còn dùng.
 */
export const smartFaceTheme: ThemeConfig = {
  token: {
    colorPrimary: '#1D4ED8',
    colorSuccess: '#15803D',
    colorWarning: '#B45309',
    colorError: '#DC2626',
    colorInfo: '#1D4ED8',

    colorText: '#0F172A',
    colorTextSecondary: '#334155',
    colorTextTertiary: '#64748B',
    colorTextDisabled: '#64748B',
    colorTextPlaceholder: '#64748B',

    colorBgBase: '#FFFFFF',
    colorBgLayout: '#F8FAFC',
    colorBgContainer: '#FFFFFF',
    colorFillSecondary: '#F1F5F9',
    colorFillTertiary: '#E2E8F0',

    colorBorder: '#64748B',
    colorBorderSecondary: '#CBD5E1',

    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontSize: 16,
    fontSizeSM: 14,
    fontSizeLG: 18,
    fontSizeHeading1: 40,
    fontSizeHeading2: 32,
    fontSizeHeading3: 24,
    fontSizeHeading4: 20,
    fontSizeHeading5: 16,

    borderRadiusXS: 4,
    borderRadiusSM: 8,
    borderRadius: 12,
    borderRadiusLG: 16,
    /**
     * Ba bậc chiều cao — docs/16 mục 11.1.
     *
     *   `SM` 28px  — nút trong bảng và thanh công cụ
     *   `default` 32px — MẶC ĐỊNH cho mọi nút và mọi ô nhập, KỂ CẢ trong
     *                    modal và drawer
     *   `LG` 40px  — chỉ nút CTA chiếm trọn chiều ngang ở màn xác thực
     *
     * ## Vì sao 32px chứ không phải 44px
     *
     * Đây là công cụ quản trị dùng trên desktop, màn hình đặc dữ liệu: một thanh
     * lọc bốn ô cộng một bảng hai mươi dòng. Ở mật độ đó, control 44px đẩy nội
     * dung thật xuống dưới nếp gấp và làm trang trông nặng nề.
     *
     * ## Vùng chạm vẫn 44px — trên thiết bị cảm ứng
     *
     * 32px sẽ vi phạm mục 10.2 (sàn vùng chạm 44×44) nếu áp cho MỌI thiết bị.
     * Giải pháp không phải chọn một trong hai: `components.css` có khối
     * `@media (pointer: coarse)` nâng mọi control lên 44px khi thiết bị nhập là
     * ngón tay. Desktop được độ gọn, tablet giữ được vùng chạm — docs/04 mục
     * 12.4 nói rõ web phải dùng được trên tablet.
     *
     * ⚠ Sửa các con số ở đây thì PHẢI sửa cả khối `pointer: coarse` bên đó,
     * không thì hai bộ số lệch nhau và lỗi chỉ lộ ra trên máy tablet.
     *
     * ⚠ `size="large"` là ngoại lệ hiếm, không phải mặc định. Nó từng bị rải lên
     * 65 ô nhập, 21 nút cấp trang, rồi lên cả 43 nút footer của modal và drawer.
     * Lần cuối cùng đó là lỗi khó thấy nhất: hộp thoại là chỗ NGƯỜI DÙNG ĐANG
     * NHÌN, nên nút 40px giữa một trang toàn control 32px trông như thuộc về một
     * sản phẩm khác. Hộp thoại không cần nút to hơn để được chú ý — nó đã chiếm
     * trọn màn hình rồi.
     *
     * Hiện chỉ còn đúng một chỗ dùng `LG`: nút xác thực hai lớp ở màn đăng nhập,
     * vốn là nút `block` chiếm trọn chiều ngang thẻ.
     */
    controlHeightSM: 28,
    controlHeight: 32,
    controlHeightLG: 40,

    motionDurationFast: '0.15s',
    motionDurationMid: '0.2s',
    motionDurationSlow: '0.25s',

    boxShadow: '0 1px 2px 0 rgba(0,0,0,.05)',
    boxShadowSecondary: '0 10px 15px -3px rgba(0,0,0,.1), 0 4px 6px -4px rgba(0,0,0,.1)',
  },
  components: {
    /*
     * Chữ TRONG control là 14px, không phải 16px của `token.fontSize`.
     *
     * `token.fontSize: 16` là cỡ chữ CHẠY (body-md, mục 3.2) — đúng cho đoạn văn
     * và ô chi tiết. Nhưng nhét chữ 16px (dòng 24px) vào control cao 32px chỉ
     * còn 3px đệm trên dưới, chữ dính sát viền. 14px cho ra 5px đệm, đọc thoáng
     * mà control vẫn gọn.
     */
    Button: {
      /*
       * Nút `type="primary"` của Ant Design là nút XANH DƯƠNG, không phải nút
       * xác nhận xanh lá.
       *
       * Bản trước gán màu hành động (amber) cho `type="primary"`, nên mọi nút
       * mặc định trên toàn ứng dụng đều là nút nhấn mạnh — và khi mọi nút đều
       * nhấn mạnh thì không nút nào nhấn mạnh nữa. Nút xác nhận xanh lá bây giờ
       * là lớp `.sf-btn--action` dùng cho đúng các thao tác chốt (phê duyệt,
       * xác nhận), không phải cho mọi nút.
       */
      colorPrimary: '#1D4ED8',
      colorPrimaryHover: '#1E40AF',
      colorPrimaryActive: '#1D4ED8',
      primaryColor: '#FFFFFF',
      borderRadius: 8,
      fontSize: 14,
      fontWeight: 700,
      // 24px đệm ngang cân với nút cao 44px; với nút 32px thì nút dài ngoẵng.
      paddingInline: 16,
      dangerColor: '#FFFFFF',
      colorError: '#DC2626',
      colorErrorHover: '#B91C1C',
    },
    Input: {
      borderRadius: 8,
      fontSize: 14,
      paddingBlock: 4,
      paddingInline: 12,
      colorBorder: '#64748B',
      activeBorderColor: '#1D4ED8',
      activeShadow: '0 0 0 3px #DBEAFE',
    },
    InputNumber: {
      borderRadius: 8,
      fontSize: 14,
      colorBorder: '#64748B',
      activeBorderColor: '#1D4ED8',
      activeShadow: '0 0 0 3px #DBEAFE',
    },
    Select: {
      borderRadius: 8,
      fontSize: 14,
      colorBorder: '#CBD5E1',
      optionSelectedBg: '#DBEAFE',
    },
    DatePicker: {
      borderRadius: 8,
      fontSize: 14,
      colorBorder: '#CBD5E1',
      cellActiveWithRangeBg: '#EFF6FF',
    },
    /*
     * Ba bậc mật độ bảng — docs/16 mục 11.10.
     *
     *   mặc định      16 / 24  — bảng dữ liệu cấp trang
     *   `size="small"` 8 / 16  — bảng tra cứu, bảng xem trước trong modal
     *
     * ⚠ PHẢI khai cả bậc `SM` và `MD`. Ant Design KHÔNG suy chúng ra từ
     * `cellPaddingInline`: bỏ trống thì `size="small"` rơi về mặc định 8px của
     * thư viện, tức là đệm ngang chỉ bằng MỘT PHẦN BA bảng bên cạnh. Chữ dính
     * sát mép ô, và tệ hơn là hai bảng trên cùng một trang lệch nhịp nhau —
     * đúng hiện tượng ở bảng "Vai trò làm được những gì".
     *
     * Bậc dày đặc siết theo CHIỀU DỌC là chính (16→8). Đệm ngang chỉ hạ 24→16
     * chứ không hạ sâu hơn: cột hẹp lại thì bảng buộc phải cuộn ngang, mà cuộn
     * ngang mới là thứ giết khả năng đọc của một bảng tra cứu.
     */
    Table: {
      headerBg: '#F1F5F9',
      headerColor: '#334155',
      rowHoverBg: '#F8FAFC',
      rowSelectedBg: '#EFF6FF',
      rowSelectedHoverBg: '#DBEAFE',
      borderColor: '#CBD5E1',
      cellPaddingBlock: 16,
      cellPaddingInline: 24,
      cellPaddingBlockMD: 12,
      cellPaddingInlineMD: 16,
      cellPaddingBlockSM: 8,
      cellPaddingInlineSM: 16,
    },
    Modal: { borderRadiusLG: 16, headerBg: '#F8FAFC', footerBg: '#F1F5F9', contentBg: '#FFFFFF' },
    Drawer: { paddingLG: 24 },
    /*
     * Sidenav KHÔNG dùng `Menu` của antd — nó là `.sf-nav-item` viết riêng
     * (`global.css`, mục 11.15). Cấu hình ở đây chỉ tác động tới `Dropdown`,
     * vốn dựng bằng `Menu` bên trong: menu thao tác trên từng dòng bảng và menu
     * tài khoản ở góc phải.
     *
     * Vì vậy `itemHeight` phải theo nhịp control 32px, không theo nhịp sidenav.
     */
    Menu: {
      itemSelectedBg: '#EFF6FF',
      itemSelectedColor: '#1E40AF',
      itemHoverBg: '#E2E8F0',
      itemBorderRadius: 6,
      itemHeight: 32,
      fontSize: 14,
    },
    Card: { borderRadiusLG: 12, colorBorderSecondary: '#CBD5E1', paddingLG: 16 },
    Tag: { borderRadiusSM: 9999, defaultBg: '#E2E8F0', defaultColor: '#0F172A' },
    Checkbox: { colorPrimary: '#1D4ED8', borderRadiusSM: 4 },
    Radio: { colorPrimary: '#1D4ED8' },
    Tabs: { itemSelectedColor: '#1D4ED8', inkBarColor: '#1D4ED8', titleFontSize: 16 },
    Tooltip: { colorBgSpotlight: '#1E293B', borderRadius: 8 },
    Segmented: { itemSelectedBg: '#DBEAFE', itemSelectedColor: '#1D4ED8', borderRadius: 8 },
    Alert: { borderRadiusLG: 12 },
    Statistic: { contentFontSize: 32 },
  },
};
