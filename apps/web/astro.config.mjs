// @ts-check
import { defineConfig } from 'astro/config'
import react from '@astrojs/react'

// Static landing page (Astro) + React islands for animations and the user dashboard.
// In development, /api is proxied to the Envinity API (apps/api) so cookies stay same-origin.
// In production, serve both behind one origin (reverse proxy) for the same reason.
export default defineConfig({
  integrations: [react()],
  vite: {
    server: {
      proxy: {
        '/api': { target: process.env.API_PROXY_TARGET || 'http://127.0.0.1:4000', changeOrigin: false },
      },
    },
  },
})
