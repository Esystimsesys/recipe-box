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
      {
        name: 'clear-preview-worker-in-development',
        apply: 'serve',
        configureServer(server) {
          // A previous production preview at this origin must not hide the dev app.
          server.middlewares.use('/sw.js', (_request, response) => {
            response.setHeader('Content-Type', 'application/javascript')
            response.setHeader('Cache-Control', 'no-store')
            response.end(`
              self.addEventListener('install', () => self.skipWaiting());
              self.addEventListener('activate', event => event.waitUntil((async () => {
                await self.registration.unregister();
                const windows = await self.clients.matchAll({ type: 'window' });
                await Promise.all(windows.map(client => client.navigate(client.url)));
              })()));
            `)
          })
        },
      },
      VitePWA({
        registerType: 'prompt',
        includeAssets: ['icon.svg', 'favicon-32.png', 'favicon.ico', 'apple-touch-icon.png'],
        manifest: {
          name: 'ひとさじ — わたしのレシピ帳',
          short_name: 'ひとさじ',
          description: 'お気に入りのレシピと、料理の写真。',
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
