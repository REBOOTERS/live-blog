import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // 部署到 GitHub Pages 子路径时由 CI 注入 PAGES_BASE=/live-blog/；
  // 本地 dev / preview 保持 '/' 不受影响。
  base: process.env.PAGES_BASE || '/',
})
