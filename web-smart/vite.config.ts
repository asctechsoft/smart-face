import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    resolve: {
      alias: { '@': path.resolve(__dirname, 'src') },
    },
    server: {
      port: 5173,
      // Gọi Backend qua proxy trong lúc phát triển để trình duyệt coi API là cùng
      // origin — không dính CORS, và cookie/`SameSite` cư xử giống production
      // (nơi Nginx/Kong đứng trước cả hai).
      proxy: {
        '/v1': {
          target: env.VITE_API_PROXY_TARGET || 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
    build: {
      target: 'es2022',
      sourcemap: mode !== 'production',
      rollupOptions: {
        output: {
          // Tách 3 nhóm nặng nhất ra chunk riêng. Antd + Recharts chiếm phần lớn
          // bundle; gộp chung khiến mỗi lần sửa một dòng code nghiệp vụ là người
          // dùng phải tải lại toàn bộ.
          manualChunks: {
            antd: ['antd', '@ant-design/icons'],
            charts: ['recharts'],
            firebase: ['firebase/app', 'firebase/auth'],
          },
        },
      },
    },
  };
});
