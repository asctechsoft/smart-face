import type { ThemeConfig } from 'antd';

/**
 * docs/16-quy-chuan-style-guide.md mục 13.1 — chép nguyên văn.
 *
 * ⚠ Điểm dễ sai nhất: Ant Design mặc định TỐI màu nút khi hover. Nút chính của
 * SmartFace là amber, và tối đi một bậc (`amber-600`) làm chữ nâu tụt xuống
 * 3.02:1 — trượt WCAG AA. Vì vậy `colorPrimaryHover` phải là `amber-400`
 * (SÁNG LÊN). Xem lập luận đầy đủ ở mục 0.1 của tài liệu.
 */
export const smartFaceTheme: ThemeConfig = {
  token: {
    colorPrimary: '#003B2C',
    colorSuccess: '#2E7D32',
    colorWarning: '#855400',
    colorError: '#BA1A1A',
    colorInfo: '#005440',

    colorText: '#191C1C',
    colorTextSecondary: '#3F4944',
    colorTextTertiary: '#6F7974',
    colorTextDisabled: '#6F7974',
    colorTextPlaceholder: '#6F7974',

    colorBgBase: '#FFFFFF',
    colorBgLayout: '#F8FAF9',
    colorBgContainer: '#FFFFFF',
    colorFillSecondary: '#F2F4F3',
    colorFillTertiary: '#E1E3E2',

    colorBorder: '#6F7974',
    colorBorderSecondary: '#BFC9C3',

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
      // Nút "primary" của SmartFace là amber, không phải teal.
      colorPrimary: '#FCAA33',
      colorPrimaryHover: '#FFBD67',
      colorPrimaryActive: '#FCAA33',
      primaryColor: '#6B4200',
      borderRadius: 8,
      fontSize: 14,
      fontWeight: 700,
      // 24px đệm ngang cân với nút cao 44px; với nút 32px thì nút dài ngoẵng.
      paddingInline: 16,
      dangerColor: '#FFFFFF',
      colorError: '#BA1A1A',
      colorErrorHover: '#980001',
    },
    Input: {
      borderRadius: 8,
      fontSize: 14,
      paddingBlock: 4,
      paddingInline: 12,
      colorBorder: '#6F7974',
      activeBorderColor: '#003B2C',
      activeShadow: '0 0 0 3px #D1F7E8',
    },
    InputNumber: {
      borderRadius: 8,
      fontSize: 14,
      colorBorder: '#6F7974',
      activeBorderColor: '#003B2C',
      activeShadow: '0 0 0 3px #D1F7E8',
    },
    Select: {
      borderRadius: 8,
      fontSize: 14,
      colorBorder: '#BFC9C3',
      optionSelectedBg: '#D1F7E8',
    },
    DatePicker: {
      borderRadius: 8,
      fontSize: 14,
      colorBorder: '#BFC9C3',
      cellActiveWithRangeBg: '#E4FEF4',
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
      headerBg: '#F2F4F3',
      headerColor: '#3F4944',
      rowHoverBg: '#F8FAF9',
      rowSelectedBg: '#E4FEF4',
      rowSelectedHoverBg: '#D1F7E8',
      borderColor: '#BFC9C3',
      cellPaddingBlock: 16,
      cellPaddingInline: 24,
      cellPaddingBlockMD: 12,
      cellPaddingInlineMD: 16,
      cellPaddingBlockSM: 8,
      cellPaddingInlineSM: 16,
    },
    Modal: { borderRadiusLG: 16, headerBg: '#F8FAF9', footerBg: '#F2F4F3', contentBg: '#FFFFFF' },
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
      itemSelectedBg: '#FCAA33',
      itemSelectedColor: '#6B4200',
      itemHoverBg: '#E1E3E2',
      itemBorderRadius: 6,
      itemHeight: 32,
      fontSize: 14,
    },
    Card: { borderRadiusLG: 12, colorBorderSecondary: '#BFC9C3', paddingLG: 16 },
    Tag: { borderRadiusSM: 9999, defaultBg: '#E1E3E2', defaultColor: '#191C1C' },
    Checkbox: { colorPrimary: '#003B2C', borderRadiusSM: 4 },
    Radio: { colorPrimary: '#003B2C' },
    Tabs: { itemSelectedColor: '#003B2C', inkBarColor: '#005440', titleFontSize: 16 },
    Tooltip: { colorBgSpotlight: '#2D3230', borderRadius: 8 },
    Segmented: { itemSelectedBg: '#D1F7E8', itemSelectedColor: '#003B2C', borderRadius: 8 },
    Alert: { borderRadiusLG: 12 },
    Statistic: { contentFontSize: 32 },
  },
};
