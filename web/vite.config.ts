import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// The API is reached same-origin through this dev proxy, so cookies and sessions work
// without CORS. BASE44_* values are only read to extend the dev-server host allowlist:
// the sandbox host changes whenever the environment is recreated.
const sandboxDomain = process.env.BASE44_SANDBOX_HOST_DOMAIN
const previewMode = process.env.BASE44_PREVIEW_MODE === '1'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    // Bind mounts do not always emit inotify events, so poll for hot reload.
    watch: { usePolling: true, interval: 300 },
    allowedHosts:
      previewMode && sandboxDomain
        ? [`.${sandboxDomain}`] // wildcard covers <port>-<sandbox id>.<domain>
        : undefined,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:8000',
        changeOrigin: false,
      },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
})
