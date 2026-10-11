import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || 'http://localhost:8080'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // VITE_HOST=0.0.0.0 时允许局域网访问；默认仍只监听本机
    host: process.env.VITE_HOST || 'localhost',
    port: 5173,
    open: true,
    // VITE_ALLOWED_HOSTS=all 时放行任意域名（内网穿透用）；不设则保持 Vite 默认校验
    allowedHosts: process.env.VITE_ALLOWED_HOSTS === 'all' ? true : undefined,
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
})
