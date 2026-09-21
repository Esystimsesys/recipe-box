import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const allowedHosts = env.DEV_ALLOWED_HOST ? [env.DEV_ALLOWED_HOST] : []
  return {
    base: process.env.BASE_PATH || '/',
    plugins: [
      react(),
      VitePWA({
        registerType: 'prompt',
        includeAssets: ['icon.svg', 'apple-touch-icon.png'],
        manifest: {
          name: 'ひとさじ — わたしのレシピ帳',
          short_name: 'ひとさじ',
          description: 'お気に入りのレシピと、作った日の記録。',
          lang: 'ja',
          theme_color: '#faf8f3',
          background_color: '#faf8f3',
          display: 'standalone',
          icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: 'icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
          cleanupOutdatedCaches: true,
        },
      }),
    ],
    server: { host: 'localhost', allowedHosts },
    preview: { host: 'localhost', allowedHosts },
  }
})
