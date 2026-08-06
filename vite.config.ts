import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  // 生产构建默认带 /live-blog/ 子路径（对应 https://rebooters.github.io/live-blog/），
  // 本地 dev / preview 保持 '/'。自定义域名时用 PAGES_BASE=/ 覆盖。
  base: mode === 'production' ? process.env.PAGES_BASE || '/live-blog/' : '/',
}))
