// @ts-check
import { defineConfig } from 'astro/config'
import react from '@astrojs/react'

// Static landing page (Astro) + React islands for animations and the user dashboard.
export default defineConfig({
  integrations: [react()],
})
