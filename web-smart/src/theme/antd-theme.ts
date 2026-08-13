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
    controlHeightSM: 36,
    controlHeight: 44,
    controlHeightLG: 52,

    motionDurationFast: '0.15s',
    motionDurationMid: '0.2s',
    motionDurationSlow: '0.25s',

    boxShadow: '0 1px 2px 0 rgba(0,0,0,.05)',
    boxShadowSecondary: '0 10px 15px -3px rgba(0,0,0,.1), 0 4px 6px -4px rgba(0,0,0,.1)',
  },
  components: {
    Button: {
      // Nút "primary" của SmartFace là amber, không phải teal.
      colorPrimary: '#FCAA33',
      colorPrimaryHover: '#FFBD67',
      colorPrimaryActive: '#FCAA33',
      primaryColor: '#6B4200',
      borderRadius: 12,
      fontWeight: 700,
      paddingInline: 24,
      dangerColor: '#FFFFFF',
      colorError: '#BA1A1A',
      colorErrorHover: '#980001',
    },
    Input: {
      borderRadius: 12,
      paddingBlock: 8,
      paddingInline: 12,
      colorBorder: '#6F7974',
      activeBorderColor: '#003B2C',
      activeShadow: '0 0 0 3px #D1F7E8',
    },
    InputNumber: {
      borderRadius: 12,
      colorBorder: '#6F7974',
      activeBorderColor: '#003B2C',
      activeShadow: '0 0 0 3px #D1F7E8',
    },
    Select: { borderRadius: 8, colorBorder: '#BFC9C3', optionSelectedBg: '#D1F7E8' },
    DatePicker: { borderRadius: 8, colorBorder: '#BFC9C3', cellActiveWithRangeBg: '#E4FEF4' },
    Table: {
      headerBg: '#F2F4F3',
      headerColor: '#3F4944',
      rowHoverBg: '#F8FAF9',
      rowSelectedBg: '#E4FEF4',
      rowSelectedHoverBg: '#D1F7E8',
      borderColor: '#BFC9C3',
      cellPaddingBlock: 16,
      cellPaddingInline: 24,
    },
    Modal: { borderRadiusLG: 16, headerBg: '#F8FAF9', footerBg: '#F2F4F3', contentBg: '#FFFFFF' },
    Drawer: { paddingLG: 24 },
    Menu: {
      itemSelectedBg: '#FCAA33',
      itemSelectedColor: '#6B4200',
      itemHoverBg: '#E1E3E2',
      itemBorderRadius: 8,
      itemHeight: 48,
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
