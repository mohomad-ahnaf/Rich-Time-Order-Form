import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

const lanHttps = process.env.LAN_HTTPS === '1'
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    strictPort: true,
    https: lanHttps ? { key: readFileSync('.certs/rich-time-key.pem'), cert: readFileSync('.certs/rich-time-cert.pem') } : undefined,
    proxy: { '/api': 'http://127.0.0.1:8787' }
  },
  build: { outDir: 'dist', emptyOutDir: true }
})
