// Patch tương thích React 19 cho Ant Design 5 — phải nạp TRƯỚC `antd`, nếu
// không các API tĩnh (Modal.confirm, message) sẽ cảnh báo về `ReactDOM.render`.
import '@ant-design/v5-patch-for-react-19';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Không tìm thấy phần tử #root trong index.html');
}

/**
 * Nạp ứng dụng bằng dynamic import để bọc được trong `try/catch`.
 *
 * Vì sao không `import App from './App'` như bình thường: lỗi xảy ra trong lúc
 * NẠP MODULE (thiếu biến môi trường, một thư viện hỏng, một vòng import lặp)
 * nổ ra trước khi React kịp mount. `ErrorBoundary` không bắt được — nó chỉ bắt
 * lỗi trong lúc render. Kết quả là **trang trắng tinh**, thông báo lỗi duy nhất
 * nằm trong console mà người dùng không nghĩ tới việc mở.
 *
 * Đây là lỗi đã xảy ra thật với file này: thiếu `.env` làm `config/env.ts` ném
 * lỗi ở tầng module, và cả ứng dụng biến mất không dấu vết.
 */
async function bootstrap(): Promise<void> {
  try {
    const { default: App } = await import('./App');

    createRoot(container as HTMLElement).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  } catch (error) {
    renderStartupError(error);
  }
}

/**
 * Màn hình chẩn đoán khi ứng dụng không khởi động được.
 *
 * Dựng bằng DOM thuần, KHÔNG dùng React và KHÔNG import gì thêm — đúng lúc này
 * ta không còn tin được module nào đã nạp thành công. Style viết thẳng vì
 * `global.css` cũng có thể là thứ đang hỏng.
 */
function renderStartupError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[SmartFace] Không khởi động được ứng dụng:', error);

  const root = container as HTMLElement;
  root.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.setAttribute('role', 'alert');
  wrap.style.cssText = [
    'min-height:100vh',
    'display:grid',
    'place-items:center',
    'padding:24px',
    'background:#F8FAF9',
    'font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    'color:#191C1C',
  ].join(';');

  const card = document.createElement('div');
  card.style.cssText = [
    'max-width:640px',
    'width:100%',
    'background:#FFFFFF',
    'border:1px solid #BFC9C3',
    'border-radius:12px',
    'padding:32px',
    'box-shadow:0 1px 2px 0 rgba(0,0,0,.05)',
  ].join(';');

  const title = document.createElement('h1');
  title.textContent = 'Không khởi động được ứng dụng';
  title.style.cssText =
    'font-size:24px;line-height:32px;font-weight:600;margin:0 0 8px;color:#003B2C';

  const lead = document.createElement('p');
  lead.textContent = 'Ứng dụng dừng lại trong lúc nạp. Nguyên nhân do máy chủ báo về:';
  lead.style.cssText = 'font-size:16px;line-height:24px;margin:0 0 16px;color:#3F4944';

  const pre = document.createElement('pre');
  pre.textContent = message;
  pre.style.cssText = [
    'margin:0 0 24px',
    'padding:16px',
    'background:#FFE8E0',
    'border-radius:8px',
    'color:#740000',
    'font-size:14px',
    'line-height:20px',
    'white-space:pre-wrap',
    'word-break:break-word',
  ].join(';');

  const help = document.createElement('div');
  help.style.cssText = 'font-size:14px;line-height:20px;color:#3F4944';
  help.innerHTML = [
    '<p style="margin:0 0 8px;font-weight:600">Cần kiểm tra theo thứ tự:</p>',
    '<ol style="margin:0;padding-left:20px">',
    '<li>Đã có file <code>.env</code> trong thư mục <code>web-smart</code> chưa? Sao chép từ <code>.env.example</code>.</li>',
    '<li>Đã chạy <code>npm install</code> sau lần kéo mã mới nhất chưa?</li>',
    '<li>Sửa <code>.env</code> xong phải <strong>khởi động lại</strong> máy chủ phát triển — Vite chỉ đọc file này lúc khởi động.</li>',
    '</ol>',
  ].join('');

  card.append(title, lead, pre, help);
  wrap.append(card);
  root.append(wrap);
}

void bootstrap();
