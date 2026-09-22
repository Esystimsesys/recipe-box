import { defineConfig } from '@playwright/test'
import { loadEnv } from 'vite'

// ビルドと同じ .env を読み、テストから取得用エンドポイントの有無を判断できるようにする。
const env = loadEnv('production', process.cwd(), '')
process.env.VITE_LINK_METADATA_ENDPOINT ||= env.VITE_LINK_METADATA_ENDPOINT ?? ''

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: 2,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: 'http://localhost:5190',
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: {
    command: 'npm run preview -- --port 5190',
    url: 'http://localhost:5190',
    reuseExistingServer: false,
  },
})
