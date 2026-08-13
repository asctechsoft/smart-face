module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  plugins: ['@typescript-eslint', 'react-hooks'],
  ignorePatterns: ['dist', 'node_modules', '*.cjs'],
  rules: {
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/no-explicit-any': 'error',

    // docs/16 mục 14.2 điều 3 — cấm tuyệt đối bỏ vòng focus.
    // Không có quy tắc ESLint sẵn cho việc này; chốt bằng review + `no-restricted-syntax`.
    'no-restricted-syntax': [
      'error',
      {
        selector: "Property[key.name='outline'][value.value='none']",
        message:
          'Cấm `outline: none` — docs/16 mục 10.1. Thay bằng chỉ dấu focus khác rõ ràng hơn nếu cần.',
      },
    ],

    // Ngày giờ phải đi qua lib/utils/date.ts để áp đúng múi giờ công ty
    // (docs/04 mục 6.4). `toLocaleString` dùng múi giờ của MÁY NGƯỜI DÙNG.
    'no-restricted-properties': [
      'error',
      {
        object: 'Date',
        property: 'toLocaleString',
        message: 'Dùng hàm trong lib/utils/date.ts — chúng áp múi giờ của công ty.',
      },
    ],
  },
};
