import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 3002,
    proxy: {
      // Proxy API requests to your Express server
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  }
})
