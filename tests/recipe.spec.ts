import { readFile } from 'node:fs/promises'
import { expect, test, type Locator, type Page } from '@playwright/test'

const BASE_URL = 'http://localhost:5190'
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

const image = (name: string) => ({ name, mimeType: 'image/png', buffer: PIXEL_PNG })

async function openApp(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /集めたレシピ/ })).toBeVisible()
}

async function openNewRecipe(page: Page) {
  await page.getByRole('button', { name: '追加', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '追加' })
  await expect(dialog).toBeVisible()
  return dialog
}

async function openOptionalFields(dialog: Locator) {
  const details = dialog.locator('details.optional-fields')
  if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await details.locator('summary').click()
  }
}

async function addLinkRecipe(page: Page, title = '鶏と玉ねぎ') {
  const dialog = await openNewRecipe(page)
  await dialog
    .getByLabel('レシピのURL')
    .fill('おすすめです https://example.com/recipe?id=7&from=share#steps 。')
  await openOptionalFields(dialog)
  await dialog.getByLabel('レシピ名').fill(title)
  await dialog.getByLabel('材料').fill('鶏肉、たまねぎ')
  await dialog.getByRole('button', { name: '保存する' }).click()

  const detail = page.getByRole('dialog', { name: 'レシピ' })
  await expect(detail.getByRole('heading', { name: title })).toBeVisible()
  await expect(detail.getByRole('link', { name: '元のレシピを見る' })).toHaveAttribute(
    'href',
    'https://example.com/recipe?id=7&from=share#steps',
  )
  return detail
}

async function addPaperRecipe(page: Page, title = '祖母の煮物') {
  const dialog = await openNewRecipe(page)
  await dialog.getByRole('button', { name: '手動で登録' }).click()
  await dialog.getByLabel('レシピの画像').setInputFiles([image('page-1.png'), image('page-2.png')])
  await expect(dialog.getByAltText('レシピの画像 1')).toBeVisible()
  await expect(dialog.getByAltText('レシピの画像 2')).toBeVisible()
  await openOptionalFields(dialog)
  await dialog.getByLabel('レシピ名').fill(title)
  await dialog.getByLabel('材料').fill('じゃがいも、にんじん')
  await dialog.getByLabel('出典').fill('祖母のノート')
  await dialog.getByRole('button', { name: '保存する' }).click()

  const detail = page.getByRole('dialog', { name: 'レシピ' })
  await expect(detail.getByRole('heading', { name: title })).toBeVisible()
  await expect(detail.getByAltText('レシピ画像 1')).toBeVisible()
  await expect(detail.getByAltText('レシピ画像 2')).toBeVisible()
  return detail
}

async function closeDialog(page: Page, name: string) {
  const dialog = page.getByRole('dialog', { name })
  await dialog.getByRole('button', { name: '閉じる' }).click()
  await expect(dialog).toBeHidden()
}

async function navigate(page: Page, label: 'レシピ帳') {
  const accessibleName = /^レシピ帳(?:\s+\d+)?$/u
  await page
    .getByRole('navigation')
    .getByRole('button', { name: accessibleName })
    .filter({ visible: true })
    .click()
}

async function openSettings(page: Page) {
  await page.getByRole('button', { name: '設定を開く' }).click()
  await expect(page.getByRole('heading', { name: /レシピ帳の設定/ })).toBeVisible()
}

test('リンクを保存し、横断検索・独立した絞り込み・編集ができる', async ({ page }) => {
  await openApp(page)
  await expect(page.getByRole('heading', { name: 'レシピはまだありません' })).toBeVisible()

  const detail = await addLinkRecipe(page)
  const cooked = detail.getByRole('button', { name: '作った', exact: true })
  await expect(cooked).toHaveAttribute('aria-pressed', 'false')
  await cooked.click()
  await expect(cooked).toHaveAttribute('aria-pressed', 'true')
  const favorite = detail.getByRole('button', { name: 'お気に入り', exact: true })
  await expect(favorite).toHaveAttribute('aria-pressed', 'false')
  await favorite.click()
  await expect(favorite).toHaveAttribute('aria-pressed', 'true')
  await closeDialog(page, 'レシピ')

  const card = page.locator('.recipe-card').filter({ hasText: '鶏と玉ねぎ' })
  await expect(card.getByText(/^追加 \d{4}年/u)).toBeVisible()
  await page.setViewportSize({ width: 768, height: 1024 })
  expect(
    await page
      .locator('.recipe-grid')
      .evaluate(
        (grid) => getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length,
      ),
  ).toBe(3)
  await expect(page.getByRole('button', { name: '追加', exact: true })).toHaveCSS(
    'position',
    'fixed',
  )

  await page.getByLabel('レシピを検索').fill('鶏 玉ね')
  await expect(page.getByRole('button', { name: /鶏と玉ねぎを開く/ })).toBeVisible()

  await page.getByLabel('レシピを検索').fill('鶏 じゃがいも')
  await expect(page.getByRole('heading', { name: '該当するレシピがありません' })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('button', { name: /鶏と玉ねぎを開く/ })).toBeVisible()
  await expect(page.getByRole('button', { name: '鶏と玉ねぎを作った' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  const filterRow = page.locator('.filter-row')
  const cookedFilter = filterRow.getByRole('button', { name: '作った', exact: true })
  const favoriteFilter = filterRow.getByRole('button', { name: 'お気に入り', exact: true })
  await cookedFilter.click()
  await favoriteFilter.click()
  await expect(cookedFilter).toHaveAttribute('aria-pressed', 'true')
  await expect(favoriteFilter).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('heading', { name: /作った・お気に入り/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /鶏と玉ねぎを開く/ })).toBeVisible()
  await cookedFilter.click()
  await expect(cookedFilter).toHaveAttribute('aria-pressed', 'false')
  await expect(favoriteFilter).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('heading', { name: /お気に入り/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /鶏と玉ねぎを開く/ })).toBeVisible()
  await page.getByRole('button', { name: /鶏と玉ねぎを開く/ }).click()
  const editButton = page
    .getByRole('dialog', { name: 'レシピ' })
    .getByRole('button', { name: '編集' })
  await expect(editButton).toHaveClass(/\bsecondary\b/u)
  await editButton.click()
  const edit = page.getByRole('dialog', { name: 'レシピを編集' })
  await edit.getByLabel('レシピ名').fill('鶏と玉ねぎの甘酢炒め')
  await edit.getByRole('button', { name: '保存する' }).click()
  await expect(
    page
      .getByRole('dialog', { name: 'レシピ' })
      .getByRole('heading', { name: '鶏と玉ねぎの甘酢炒め' }),
  ).toBeVisible()
})

test('手動登録の複数画像を保存し、作った状態を付けて削除できる', async ({ page }) => {
  await openApp(page)
  const detail = await addPaperRecipe(page)
  await expect(detail.getByAltText('レシピ画像 1')).toBeVisible()
  await expect(detail.getByAltText('レシピ画像 2')).toBeVisible()
  const cooked = detail.getByRole('button', { name: '作った', exact: true })
  await cooked.click()
  await expect(cooked).toHaveAttribute('aria-pressed', 'true')

  await detail.getByRole('button', { name: 'レシピを削除', exact: true }).click()
  await expect(detail.getByText('このレシピと関連する写真を削除します')).toBeVisible()
  await page.getByRole('button', { name: 'レシピを削除する' }).click()
  await expect(page.getByRole('heading', { name: 'レシピはまだありません' })).toBeVisible()
  await expect(page.getByRole('button', { name: /祖母の煮物を開く/ })).toHaveCount(0)
})

test('バックアップを別コンテキストへ復元し、重複を上書きせず不正ファイルも拒否する', async ({
  browser,
}) => {
  const sourceContext = await browser.newContext()
  const source = await sourceContext.newPage()
  await source.goto(BASE_URL)
  await expect(source.getByRole('heading', { name: /集めたレシピ/ })).toBeVisible()
  await addLinkRecipe(source)
  await closeDialog(source, 'レシピ')
  const paper = await addPaperRecipe(source)
  await paper.getByRole('button', { name: '作った', exact: true }).click()
  await closeDialog(source, 'レシピ')
  await openSettings(source)

  const downloadPromise = source.waitForEvent('download')
  await source.getByRole('button', { name: 'バックアップを書き出す' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^hitosaji-backup-\d{4}-\d{2}-\d{2}\.json$/)
  const downloadPath = await download.path()
  expect(downloadPath).not.toBeNull()
  const backup = await readFile(downloadPath!)
  await sourceContext.close()

  const restoreContext = await browser.newContext()
  const restored = await restoreContext.newPage()
  await restored.goto(BASE_URL)
  await expect(restored.getByRole('heading', { name: /集めたレシピ/ })).toBeVisible()
  await openSettings(restored)
  await restored.getByLabel('バックアップを選ぶ').setInputFiles({
    name: 'hitosaji-backup.json',
    mimeType: 'application/json',
    buffer: backup,
  })
  const restoreDialog = restored.getByRole('dialog', { name: 'バックアップを取り込む' })
  await expect(restoreDialog.getByText('2件のレシピが入っています。')).toBeVisible()
  await restoreDialog.getByRole('button', { name: '取り込む' }).click()
  await expect(restored.getByRole('status')).toContainText('2件のレシピを取り込みました')

  await navigate(restored, 'レシピ帳')
  await restored.getByRole('button', { name: /祖母の煮物を開く/ }).click()
  const paperDetail = restored.getByRole('dialog', { name: 'レシピ' })
  await expect(paperDetail.getByAltText('レシピ画像 1')).toBeVisible()
  await expect(paperDetail.getByAltText('レシピ画像 2')).toBeVisible()
  await expect(paperDetail.getByRole('button', { name: '作った', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await closeDialog(restored, 'レシピ')

  await restored.getByRole('button', { name: /鶏と玉ねぎを開く/ }).click()
  await restored
    .getByRole('dialog', { name: 'レシピ' })
    .getByRole('button', { name: '編集' })
    .click()
  const edit = restored.getByRole('dialog', { name: 'レシピを編集' })
  await edit.getByLabel('レシピ名').fill('復元後に変更したレシピ')
  await edit.getByRole('button', { name: '保存する' }).click()
  await closeDialog(restored, 'レシピ')

  await openSettings(restored)
  await restored.getByLabel('バックアップを選ぶ').setInputFiles({
    name: 'same-backup.json',
    mimeType: 'application/json',
    buffer: backup,
  })
  await restored
    .getByRole('dialog', { name: 'バックアップを取り込む' })
    .getByRole('button', { name: '取り込む' })
    .click()
  await expect(restored.getByRole('status')).toContainText('0件のレシピを取り込みました')

  const malformed = Buffer.from(
    JSON.stringify({
      format: 'recipe-box',
      version: 2,
      recipes: [{ id: 'bad', secret: 'unexpected' }],
    }),
  )
  await restored.getByLabel('バックアップを選ぶ').setInputFiles({
    name: 'malformed.json',
    mimeType: 'application/json',
    buffer: malformed,
  })
  await expect(restored.getByRole('alert')).toContainText('未対応の項目です')
  await expect(restored.getByText('2 レシピ', { exact: true })).toBeVisible()

  await navigate(restored, 'レシピ帳')
  await expect(restored.getByRole('button', { name: /復元後に変更したレシピを開く/ })).toBeVisible()
  await expect(restored.locator('.recipe-card')).toHaveCount(2)
  await restoreContext.close()
})

test('URLだけで保存し、Cookpadのプレビュー画像をカードに表示する', async ({ page }) => {
  await page.route('https://og-image.cookpad.com/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG })
  })
  await openApp(page)
  const dialog = await openNewRecipe(page)
  await dialog.getByLabel('レシピのURL').fill('https://cookpad.com/jp/recipes/12345')
  await expect(dialog.locator('details.optional-fields')).toHaveJSProperty('open', false)
  await dialog.getByRole('button', { name: '保存する' }).click()
  await expect(
    page.getByRole('dialog', { name: 'レシピ' }).getByRole('heading', {
      name: 'Cookpadのレシピ',
    }),
  ).toBeVisible()
  await closeDialog(page, 'レシピ')

  const card = page.locator('.recipe-card').filter({ hasText: 'Cookpadのレシピ' })
  await expect(card.getByRole('img', { name: 'Cookpadのレシピ' })).toBeVisible()
  await expect(card.getByRole('img', { name: 'Cookpadのレシピ' })).toHaveAttribute(
    'src',
    'https://og-image.cookpad.com/global/jp/recipe/12345',
  )
})

test('YouTubeのURLからタイトルとプレビュー画像を取得する', async ({ page }) => {
  await page.route('https://www.youtube.com/oembed?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        title: 'フライパンで作る簡単レシピ',
        thumbnail_url: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg',
      }),
    })
  })
  await page.route('https://i.ytimg.com/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG })
  })
  await openApp(page)
  const dialog = await openNewRecipe(page)
  await dialog.getByLabel('レシピのURL').fill('https://youtu.be/abcdefghijk')
  await dialog.getByRole('button', { name: '保存する' }).click()
  const detail = page.getByRole('dialog', { name: 'レシピ' })
  await expect(detail.getByRole('heading', { name: 'フライパンで作る簡単レシピ' })).toBeVisible()
  await expect(detail.getByText('YouTube', { exact: true })).toBeVisible()
  await closeDialog(page, 'レシピ')
  await expect(page.getByRole('img', { name: 'フライパンで作る簡単レシピ' })).toHaveAttribute(
    'src',
    'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg',
  )
})

test('サイドバーの開閉状態を再読み込み後も維持する', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await openApp(page)
  await page.locator('#main-sidebar').getByRole('button', { name: 'メニューを閉じる' }).click()
  await expect(page.locator('.app-shell')).toHaveClass(/\bsidebar-closed\b/u)
  await expect(page.getByRole('button', { name: 'メニューを開く' })).toBeVisible()

  await page.reload()
  await expect(page.locator('.app-shell')).toHaveClass(/\bsidebar-closed\b/u)
  await page.getByRole('button', { name: 'メニューを開く' }).click()
  await expect(page.locator('.app-shell')).not.toHaveClass(/\bsidebar-closed\b/u)
  await expect(page.getByRole('button', { name: 'メニューを閉じる' })).toBeVisible()

  await expect(page.getByRole('link', { name: 'ひとさじ トップへ' })).toHaveAttribute('href', '/')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await expect(page.getByRole('navigation', { name: 'モバイルメニュー' })).toHaveCount(0)
  await openSettings(page)
  await expect(page.getByRole('button', { name: '中', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: 'メニューを開く' }).click()
  await page
    .locator('#main-sidebar')
    .getByRole('button', { name: /^レシピ帳(?:\s+\d+)?$/u })
    .click()
  await expect(page.getByRole('heading', { name: /集めたレシピ/ })).toBeVisible()
})

test('スマホで小表示を2列にし、リスト表示へ切り替えられる', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openApp(page)
  const detail = await addLinkRecipe(page, 'スマホ表示の確認')
  await closeDialog(page, 'レシピ')

  await openSettings(page)
  const displayControl = page.getByRole('group', { name: '一覧の表示' })
  await expect(displayControl.getByRole('button')).toHaveText(['小', '中', '大', 'リスト'])
  await expect(displayControl.getByRole('button', { name: '中', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await displayControl.getByRole('button', { name: '小', exact: true }).click()
  await page.getByRole('link', { name: 'ひとさじ トップへ' }).click()

  const grid = page.locator('.recipe-grid')
  await expect(grid).toHaveClass(/\bsmall\b/u)
  expect(
    await grid.evaluate(
      (element) => getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length,
    ),
  ).toBe(2)

  await openSettings(page)
  await page
    .getByRole('group', { name: '一覧の表示' })
    .getByRole('button', { name: 'リスト', exact: true })
    .click()
  await page.getByRole('link', { name: 'ひとさじ トップへ' }).click()
  await expect(grid).toHaveClass(/\blist\b/u)
  await expect(page.locator('.recipe-card')).toHaveCSS('flex-direction', 'row')
  const sourceBadge = page.locator('.source-badge')
  await expect(sourceBadge).toHaveCSS('white-space', 'nowrap')
  const [badgeBox, imageBox] = await Promise.all([
    sourceBadge.boundingBox(),
    page.locator('.card-image').boundingBox(),
  ])
  expect(badgeBox).not.toBeNull()
  expect(imageBox).not.toBeNull()
  expect(badgeBox!.width).toBeLessThanOrEqual(imageBox!.width - 12 + 0.5)
  expect(badgeBox!.height).toBeLessThan(20)

  await page.reload()
  await expect(grid).toHaveClass(/\blist\b/u)
})

test('危険なURLを保存せず、狭い画面と広い画面で横方向にはみ出さない', async ({ page }) => {
  await openApp(page)
  const dialog = await openNewRecipe(page)
  await dialog.getByLabel('レシピのURL').fill('javascript:alert(1)')
  await dialog.getByRole('button', { name: '保存する' }).click()
  await expect(dialog.getByRole('alert')).toContainText('http または https')
  await dialog.getByRole('button', { name: 'キャンセル' }).click()
  await expect(page.locator('.recipe-card')).toHaveCount(0)

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 640, height: 900 },
    { width: 800, height: 900 },
    { width: 1024, height: 900 },
    { width: 1280, height: 900 },
  ]) {
    await page.setViewportSize(viewport)
    const labelLines = await page
      .getByRole('button', { name: '追加', exact: true })
      .evaluate((button) => {
        const label = [...button.childNodes].find(
          (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.includes('追加'),
        )!
        const range = document.createRange()
        range.selectNodeContents(label)
        return range.getClientRects().length
      })
    expect(labelLines).toBe(1)
    await expect(page.getByRole('heading', { name: /集めたレシピ/ })).toBeVisible()
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1)
  }
})
