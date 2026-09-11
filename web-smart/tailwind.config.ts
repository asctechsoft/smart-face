import type { Config } from 'tailwindcss';

/**
 * Thang màu Tailwind — phải khớp `src/styles/tokens.css`.
 *
 * Sửa một giá trị ở đây mà quên file kia là hai nguồn sự thật lệch nhau: một
 * component viết bằng lớp Tailwind và một component viết bằng biến CSS sẽ ra hai
 * sắc xanh khác nhau trên cùng một màn hình. Đổi màu thì sửa cả hai, rồi chạy
 * `npm run check:contrast`.
 *
 * `darkMode: 'class'` chứ không phải `'media'`: chế độ tối được quyết bằng thuộc
 * tính `data-sf-theme` trên `<html>` (xem docblock trong `tokens.css`), nên
 * Tailwind cũng phải nhìn vào đúng chỗ đó thay vì hỏi lại hệ điều hành — hai
 * nguồn sẽ mâu thuẫn khi người dùng ép chế độ sáng trên máy đang để tối.
 *
 * `preflight` TẮT: Ant Design đã có reset riêng, bật cả hai thì hai bộ reset đè
 * nhau và các control của antd mất chiều cao mặc định.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  corePlugins: { preflight: false },
  darkMode: ['selector', '[data-sf-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // Thương hiệu — thay thang teal của bản trước.
        blue: {
          50: '#EFF6FF',
          100: '#DBEAFE',
          200: '#BFDBFE',
          300: '#93C5FD',
          400: '#60A5FA',
          500: '#3B82F6',
          600: '#2563EB',
          700: '#1D4ED8',
          800: '#1E40AF',
          900: '#1E3A8A',
        },
        // Thanh điều hướng. Không nằm trong thang blue vì nó tối hơn `blue-900`
        // một cách có chủ ý: sidenav phải lùi ra sau nội dung, không tranh chú ý.
        navy: {
          DEFAULT: '#0B1B3A',
          hover: '#16294D',
          deep: '#060D1D',
        },
        neutral: {
          50: '#F8FAFC',
          100: '#F1F5F9',
          200: '#E2E8F0',
          300: '#CBD5E1',
          400: '#94A3B8',
          500: '#64748B',
          600: '#475569',
          700: '#334155',
          800: '#1E293B',
          900: '#0F172A',
        },
        success: {
          50: '#F0FDF4',
          100: '#DCFCE7',
          200: '#BBF7D0',
          300: '#86EFAC',
          400: '#4ADE80',
          500: '#22C55E',
          600: '#16A34A',
          700: '#15803D',
          800: '#166534',
          900: '#14532D',
        },
        warning: {
          50: '#FFFBEB',
          100: '#FEF3C7',
          200: '#FDE68A',
          300: '#FCD34D',
          400: '#FBBF24',
          500: '#F59E0B',
          600: '#D97706',
          700: '#B45309',
          800: '#92400E',
          900: '#78350F',
        },
        error: {
          50: '#FEF2F2',
          100: '#FEE2E2',
          200: '#FECACA',
          300: '#FCA5A5',
          400: '#F87171',
          500: '#EF4444',
          600: '#DC2626',
          700: '#B91C1C',
          800: '#991B1B',
          900: '#7F1D1D',
        },
        // Token ngữ nghĩa — cách ĐÚNG để dùng màu trong component mới.
        // `bg-surface`, `text-muted`, `border-outline`… tự đổi theo chế độ tối,
        // còn `bg-blue-700` thì không.
        surface: {
          DEFAULT: 'var(--sf-surface)',
          bright: 'var(--sf-surface-bright)',
          low: 'var(--sf-surface-container-low)',
          container: 'var(--sf-surface-container)',
          inverse: 'var(--sf-surface-inverse)',
        },
        ink: {
          DEFAULT: 'var(--sf-on-surface)',
          variant: 'var(--sf-on-surface-variant)',
          muted: 'var(--sf-on-surface-muted)',
          inverse: 'var(--sf-on-surface-inverse)',
        },
        outline: {
          DEFAULT: 'var(--sf-outline)',
          variant: 'var(--sf-outline-variant)',
        },
        brand: {
          DEFAULT: 'var(--sf-primary)',
          surface: 'var(--sf-primary-surface)',
          hover: 'var(--sf-primary-surface-hover)',
          tint: 'var(--sf-primary-tint)',
          'tint-strong': 'var(--sf-primary-tint-strong)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'Inter', 'sans-serif'],
      },
      fontSize: {
        'display-lg': ['32px', { lineHeight: '40px', letterSpacing: '-0.64px', fontWeight: '700' }],
        'headline-xl': ['40px', { lineHeight: '48px', letterSpacing: '-0.8px', fontWeight: '700' }],
        'headline-md': ['24px', { lineHeight: '32px', fontWeight: '600' }],
        'title-lg': ['20px', { lineHeight: '28px', fontWeight: '600' }],
        'title-sm': ['16px', { lineHeight: '24px', fontWeight: '700' }],
        'body-lg': ['18px', { lineHeight: '28px' }],
        'body-md': ['16px', { lineHeight: '24px' }],
        'body-sm': ['14px', { lineHeight: '20px' }],
        'label-lg': ['14px', { lineHeight: '20px', letterSpacing: '0.7px', fontWeight: '600' }],
        'label-md': ['12px', { lineHeight: '16px', letterSpacing: '0.6px', fontWeight: '600' }],
        'label-sm': ['12px', { lineHeight: '16px', fontWeight: '500' }],
        caption: ['10px', { lineHeight: '15px' }],
        badge: ['10px', { lineHeight: '15px', letterSpacing: '0.5px', fontWeight: '700' }],
      },
      borderRadius: { xs: '4px', sm: '8px', md: '12px', lg: '16px' },
      spacing: { '18': '72px' },
      height: { btn: '44px', 'btn-sm': '36px', 'btn-lg': '52px' },
      zIndex: {
        sticky: '100',
        dropdown: '1000',
        overlay: '1040',
        modal: '1050',
        toast: '1080',
        tooltip: '1100',
      },
      transitionDuration: { instant: '100ms', fast: '150ms', base: '200ms', slow: '250ms' },
      keyframes: {
        shimmer: { from: { backgroundPosition: '200% 0' }, to: { backgroundPosition: '-200% 0' } },
      },
      animation: { shimmer: 'shimmer 1500ms ease-in-out infinite' },
    },
  },
  plugins: [],
} satisfies Config;
