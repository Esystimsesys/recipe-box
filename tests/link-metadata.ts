import type { Page } from '@playwright/test'

/** ビルド時に埋め込まれる取得用エンドポイント。未設定のビルドでは自動取得を行わない。 */
export const METADATA_ENDPOINT = process.env.VITE_LINK_METADATA_ENDPOINT || ''

/** 取得用エンドポイントが設定されたビルドでも、テストが外部へ出ないようにする。 */
export async function routeLinkMetadata(
  page: Page,
  metadata: { title: string; imageUrl: string } = { title: '', imageUrl: '' },
) {
  if (!METADATA_ENDPOINT) return
  await page.route(`${new URL(METADATA_ENDPOINT).origin}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(metadata),
    }),
  )
}
