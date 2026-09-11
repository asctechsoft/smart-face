// vite.config.ts
import { defineConfig, loadEnv } from "file:///E:/WebApp/smart-face/web-smart/node_modules/vite/dist/node/index.js";
import react from "file:///E:/WebApp/smart-face/web-smart/node_modules/@vitejs/plugin-react/dist/index.js";
import path from "node:path";
var __vite_injected_original_dirname = "E:\\WebApp\\smart-face\\web-smart";
var vite_config_default = defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react()],
    resolve: {
      alias: { "@": path.resolve(__vite_injected_original_dirname, "src") }
    },
    server: {
      port: 5173,
      // Gọi Backend qua proxy trong lúc phát triển để trình duyệt coi API là cùng
      // origin — không dính CORS, và cookie/`SameSite` cư xử giống production
      // (nơi Nginx/Kong đứng trước cả hai).
      proxy: {
        "/v1": {
          target: env.VITE_API_PROXY_TARGET || "http://localhost:3000",
          changeOrigin: true
        }
      }
    },
    build: {
      target: "es2022",
      sourcemap: mode !== "production",
      rollupOptions: {
        output: {
          // Tách 3 nhóm nặng nhất ra chunk riêng. Antd + Recharts chiếm phần lớn
          // bundle; gộp chung khiến mỗi lần sửa một dòng code nghiệp vụ là người
          // dùng phải tải lại toàn bộ.
          manualChunks: {
            antd: ["antd", "@ant-design/icons"],
            charts: ["recharts"],
            firebase: ["firebase/app", "firebase/auth"]
          }
        }
      }
    }
  };
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJFOlxcXFxXZWJBcHBcXFxcc21hcnQtZmFjZVxcXFx3ZWItc21hcnRcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIkU6XFxcXFdlYkFwcFxcXFxzbWFydC1mYWNlXFxcXHdlYi1zbWFydFxcXFx2aXRlLmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vRTovV2ViQXBwL3NtYXJ0LWZhY2Uvd2ViLXNtYXJ0L3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnLCBsb2FkRW52IH0gZnJvbSAndml0ZSc7XG5pbXBvcnQgcmVhY3QgZnJvbSAnQHZpdGVqcy9wbHVnaW4tcmVhY3QnO1xuaW1wb3J0IHBhdGggZnJvbSAnbm9kZTpwYXRoJztcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKCh7IG1vZGUgfSkgPT4ge1xuICBjb25zdCBlbnYgPSBsb2FkRW52KG1vZGUsIHByb2Nlc3MuY3dkKCksICcnKTtcblxuICByZXR1cm4ge1xuICAgIHBsdWdpbnM6IFtyZWFjdCgpXSxcbiAgICByZXNvbHZlOiB7XG4gICAgICBhbGlhczogeyAnQCc6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICdzcmMnKSB9LFxuICAgIH0sXG4gICAgc2VydmVyOiB7XG4gICAgICBwb3J0OiA1MTczLFxuICAgICAgLy8gR1x1MUVDRGkgQmFja2VuZCBxdWEgcHJveHkgdHJvbmcgbFx1MDBGQWMgcGhcdTAwRTF0IHRyaVx1MUVDM24gXHUwMTExXHUxRUMzIHRyXHUwMEVDbmggZHV5XHUxRUM3dCBjb2kgQVBJIGxcdTAwRTAgY1x1MDBGOW5nXG4gICAgICAvLyBvcmlnaW4gXHUyMDE0IGtoXHUwMEY0bmcgZFx1MDBFRG5oIENPUlMsIHZcdTAwRTAgY29va2llL2BTYW1lU2l0ZWAgY1x1MDFCMCB4XHUxRUVEIGdpXHUxRUQxbmcgcHJvZHVjdGlvblxuICAgICAgLy8gKG5cdTAxQTFpIE5naW54L0tvbmcgXHUwMTExXHUxRUU5bmcgdHJcdTAxQjBcdTFFREJjIGNcdTFFQTMgaGFpKS5cbiAgICAgIHByb3h5OiB7XG4gICAgICAgICcvdjEnOiB7XG4gICAgICAgICAgdGFyZ2V0OiBlbnYuVklURV9BUElfUFJPWFlfVEFSR0VUIHx8ICdodHRwOi8vbG9jYWxob3N0OjMwMDAnLFxuICAgICAgICAgIGNoYW5nZU9yaWdpbjogdHJ1ZSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgICBidWlsZDoge1xuICAgICAgdGFyZ2V0OiAnZXMyMDIyJyxcbiAgICAgIHNvdXJjZW1hcDogbW9kZSAhPT0gJ3Byb2R1Y3Rpb24nLFxuICAgICAgcm9sbHVwT3B0aW9uczoge1xuICAgICAgICBvdXRwdXQ6IHtcbiAgICAgICAgICAvLyBUXHUwMEUxY2ggMyBuaFx1MDBGM20gblx1MUVCN25nIG5oXHUxRUE1dCByYSBjaHVuayByaVx1MDBFQW5nLiBBbnRkICsgUmVjaGFydHMgY2hpXHUxRUJGbSBwaFx1MUVBN24gbFx1MUVEQm5cbiAgICAgICAgICAvLyBidW5kbGU7IGdcdTFFRDlwIGNodW5nIGtoaVx1MUVCRm4gbVx1MUVEN2kgbFx1MUVBN24gc1x1MUVFRGEgbVx1MUVEOXQgZFx1MDBGMm5nIGNvZGUgbmdoaVx1MUVDN3Agdlx1MUVFNSBsXHUwMEUwIG5nXHUwMUIwXHUxRUREaVxuICAgICAgICAgIC8vIGRcdTAwRjluZyBwaFx1MUVBM2kgdFx1MUVBM2kgbFx1MUVBMWkgdG9cdTAwRTBuIGJcdTFFRDkuXG4gICAgICAgICAgbWFudWFsQ2h1bmtzOiB7XG4gICAgICAgICAgICBhbnRkOiBbJ2FudGQnLCAnQGFudC1kZXNpZ24vaWNvbnMnXSxcbiAgICAgICAgICAgIGNoYXJ0czogWydyZWNoYXJ0cyddLFxuICAgICAgICAgICAgZmlyZWJhc2U6IFsnZmlyZWJhc2UvYXBwJywgJ2ZpcmViYXNlL2F1dGgnXSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9LFxuICB9O1xufSk7XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQW9SLFNBQVMsY0FBYyxlQUFlO0FBQzFULE9BQU8sV0FBVztBQUNsQixPQUFPLFVBQVU7QUFGakIsSUFBTSxtQ0FBbUM7QUFJekMsSUFBTyxzQkFBUSxhQUFhLENBQUMsRUFBRSxLQUFLLE1BQU07QUFDeEMsUUFBTSxNQUFNLFFBQVEsTUFBTSxRQUFRLElBQUksR0FBRyxFQUFFO0FBRTNDLFNBQU87QUFBQSxJQUNMLFNBQVMsQ0FBQyxNQUFNLENBQUM7QUFBQSxJQUNqQixTQUFTO0FBQUEsTUFDUCxPQUFPLEVBQUUsS0FBSyxLQUFLLFFBQVEsa0NBQVcsS0FBSyxFQUFFO0FBQUEsSUFDL0M7QUFBQSxJQUNBLFFBQVE7QUFBQSxNQUNOLE1BQU07QUFBQTtBQUFBO0FBQUE7QUFBQSxNQUlOLE9BQU87QUFBQSxRQUNMLE9BQU87QUFBQSxVQUNMLFFBQVEsSUFBSSx5QkFBeUI7QUFBQSxVQUNyQyxjQUFjO0FBQUEsUUFDaEI7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUFBLElBQ0EsT0FBTztBQUFBLE1BQ0wsUUFBUTtBQUFBLE1BQ1IsV0FBVyxTQUFTO0FBQUEsTUFDcEIsZUFBZTtBQUFBLFFBQ2IsUUFBUTtBQUFBO0FBQUE7QUFBQTtBQUFBLFVBSU4sY0FBYztBQUFBLFlBQ1osTUFBTSxDQUFDLFFBQVEsbUJBQW1CO0FBQUEsWUFDbEMsUUFBUSxDQUFDLFVBQVU7QUFBQSxZQUNuQixVQUFVLENBQUMsZ0JBQWdCLGVBQWU7QUFBQSxVQUM1QztBQUFBLFFBQ0Y7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFDRixDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=
