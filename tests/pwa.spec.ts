import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import type { AddressInfo } from 'node:net'
import { test, expect } from '@playwright/test'

// Stop a real, isolated origin instead of setOffline: macOS WebKit's emulation
// rejects navigations even when the active service worker has a cached response.
test('PWAの配信元を停止しても再表示・端末内の編集ができる', async ({ page, context }) => {
  const root = resolve('dist')
  const types: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.webmanifest': 'application/manifest+json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
  }
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname
    const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`)
    if (!file.startsWith(`${root}/`)) {
      res.writeHead(403).end()
      return
    }
    try {
      const body = await readFile(file)
      res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream')
      res.end(body)
    } catch {
      res.writeHead(404).end()
    }
  })
  await new Promise<void>((done) => server.listen(0, 'localhost', done))
  const origin = `http://localhost:${(server.address() as AddressInfo).port}`
  const stop = async () => {
    if (server.listening) {
      server.closeAllConnections()
      await new Promise<void>((done, reject) =>
        server.close((error) => (error ? reject(error) : done())),
      )
    }
  }
  try {
    await page.goto(origin)
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready
    })
    const manifest = await page.locator('link[rel="manifest"]').getAttribute('href')
    const response = await context.request.get(new URL(manifest!, origin).href)
    const data = await response.json()
    expect(data.display).toBe('standalone')
    expect(data.share_target).toEqual({
      action: './?share_target=1',
      method: 'GET',
      params: { title: 'title', text: 'text', url: 'url' },
    })
    expect(data.icons.some((icon: { sizes: string }) => icon.sizes === '512x512')).toBeTruthy()
    await page.reload()
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBeTruthy()
    await page.getByRole('button', { name: '追加', exact: true }).click()
    await page.getByLabel('レシピのURL').fill('https://cookpad.com/jp/recipes/123?ref=share#step-2')
    await page.getByLabel('レシピ名', { exact: true }).fill('オフラインのスープ')
    await page.getByRole('button', { name: '保存する', exact: true }).click()
    await expect(page.getByRole('link', { name: '元のレシピを見る' })).toHaveAttribute(
      'href',
      'https://cookpad.com/jp/recipes/123?ref=share#step-2',
    )
    await page.getByRole('button', { name: '閉じる', exact: true }).click()
    const previousTime = await page.evaluate(() => performance.timeOrigin)
    await stop()
    await page.reload()
    expect(await page.evaluate(() => performance.timeOrigin)).not.toBe(previousTime)
    await page.getByRole('button', { name: 'オフラインのスープを開く' }).click()
    await page.getByRole('button', { name: '編集', exact: true }).click()
    await page.getByLabel('自分用メモ').fill('配信元に接続できなくても記録できます')
    await page.getByRole('button', { name: '保存する', exact: true }).click()
    await expect(page.getByText('配信元に接続できなくても記録できます')).toBeVisible()
  } finally {
    await stop()
  }
})

test('容量不足の保存失敗で入力内容を失わず、保存済みと表示しない', async ({ page }) => {
  await page.addInitScript(() => {
    IDBObjectStore.prototype.put = function () {
      throw new DOMException('Quota full', 'QuotaExceededError')
    }
  })
  await page.goto('/')
  await page.getByRole('button', { name: '追加', exact: true }).click()
  await page.getByLabel('レシピのURL').fill('https://example.com/soup')
  await page.getByLabel('レシピ名', { exact: true }).fill('消えてほしくないレシピ')
  await page.getByRole('button', { name: '保存する', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('保存容量が足りません')
  await expect(page.getByLabel('レシピ名', { exact: true })).toHaveValue('消えてほしくないレシピ')
  await expect(page.getByRole('dialog', { name: '追加' })).toBeVisible()
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click()
  await page.reload()
  await expect(page.getByRole('button', { name: '消えてほしくないレシピを開く' })).toHaveCount(0)
})

test('別タブで更新された内容を古い編集フォームが上書きしない', async ({ page, context }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '追加', exact: true }).click()
  await page.getByLabel('レシピのURL').fill('https://example.com/r')
  await page.getByLabel('レシピ名', { exact: true }).fill('元のレシピ')
  await page.getByRole('button', { name: '保存する', exact: true }).click()
  await page.getByRole('button', { name: '編集', exact: true }).click()
  await page.getByLabel('レシピ名', { exact: true }).fill('古い画面の編集')
  const second = await context.newPage()
  await second.goto('/')
  await second.getByRole('button', { name: '元のレシピを開く' }).click()
  await second.getByRole('button', { name: '編集', exact: true }).click()
  await second.getByLabel('レシピ名', { exact: true }).fill('別タブの新しい編集')
  await second.getByRole('button', { name: '保存する', exact: true }).click()
  await expect(
    second
      .getByRole('dialog', { name: 'レシピ', exact: true })
      .getByRole('heading', { name: '別タブの新しい編集', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: '保存する', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('別の画面で記録が変更')
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click()
  await page.reload()
  await expect(page.getByRole('button', { name: '別タブの新しい編集を開く' })).toBeVisible()
})
