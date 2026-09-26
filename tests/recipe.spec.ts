import { readFile } from 'node:fs/promises'
import { devices, expect, test, type Locator, type Page } from '@playwright/test'
import { METADATA_ENDPOINT, routeLinkMetadata } from './link-metadata'

const BASE_URL = 'http://localhost:5190'
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

const image = (name: string) => ({ name, mimeType: 'image/png', buffer: PIXEL_PNG })

test.beforeEach(async ({ page }) => {
  await routeLinkMetadata(page)
})

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
  await dialog.getByLabel('材料など').fill('鶏肉、たまねぎ')
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
  await dialog.getByLabel('材料など').fill('じゃがいも、にんじん')
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

test('レシピ詳細を開いた直後は閉じるボタンを強調しない', async ({ page }) => {
  await openApp(page)
  const detail = await addLinkRecipe(page)
  const heading = detail.getByRole('heading', { name: 'レシピ', exact: true })
  const close = detail.getByRole('button', { name: '閉じる' })
  await expect(heading).toBeFocused()
  await expect(heading).toHaveCSS('outline-style', 'none')
  await expect(close).not.toBeFocused()
  await close.click()
  await expect(detail).toBeHidden()
})

async function openSettings(page: Page) {
  await page.getByRole('button', { name: '設定を開く' }).click()
  await expect(page.getByRole('heading', { name: /レシピ帳の設定/ })).toBeVisible()
}

test('共有されたURLを登録フォームに入れ、保存後も共有情報をURLに残さない', async ({ page }) => {
  const shared = new URLSearchParams({
    share_target: '1',
    title: '共有されたレシピ',
    text: 'こちらのレシピ https://example.com/shared?from=app#method をどうぞ',
  })
  await page.goto(`/?${shared}`)
  const dialog = page.getByRole('dialog', { name: '追加' })
  await expect(dialog.getByLabel('レシピのURL')).toHaveValue(
    'https://example.com/shared?from=app#method',
  )
  await expect(dialog.getByLabel('レシピ名')).toHaveValue('共有されたレシピ')
  await expect(page).toHaveURL('/')
  await dialog.getByRole('button', { name: '保存する' }).click()
  await expect(page.getByRole('dialog', { name: 'レシピ' })).toContainText('共有されたレシピ')
  await expect(page.getByRole('link', { name: '元のレシピを見る' })).toHaveAttribute(
    'href',
    'https://example.com/shared?from=app#method',
  )
})

test('ショートカットからURLのフラグメントで受け取り、登録フォームを開く', async ({ page }) => {
  const shared = new URLSearchParams({
    share_target: '1',
    url: 'https://example.com/recipe?from=iphone&meal=rice#step-2',
  })
  await page.goto(`/#${shared}`)
  const dialog = page.getByRole('dialog', { name: '追加' })
  await expect(dialog.getByLabel('レシピのURL')).toHaveValue(
    'https://example.com/recipe?from=iphone&meal=rice#step-2',
  )
  await expect(page).toHaveURL('/')
})

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
  await expect(filterRow.getByRole('button')).toHaveText(['すべて', 'お気に入り', '作った'])
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
  await routeLinkMetadata(source)
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
  await routeLinkMetadata(restored)
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

  await restored.getByRole('button', { name: '一覧に戻る' }).click()
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

  await restored.getByRole('button', { name: '一覧に戻る' }).click()
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
  const optionalFields = dialog.locator('details.optional-fields')
  await expect(optionalFields).toHaveJSProperty('open', true)
  await expect(dialog.getByLabel('レシピ名')).toBeVisible()
  await expect(dialog.getByLabel('材料など')).toBeVisible()
  await expect(dialog.getByLabel('自分用メモ')).toBeVisible()
  await optionalFields.locator('summary').click()
  await expect(optionalFields).toHaveJSProperty('open', false)
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
  await routeLinkMetadata(page, {
    title: 'フライパンで作る簡単レシピ',
    imageUrl: '',
    ingredients: [],
  })
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
  await expect(detail.getByText('材料など')).toHaveCount(0)
  await closeDialog(page, 'レシピ')
  await expect(page.getByRole('img', { name: 'フライパンで作る簡単レシピ' })).toHaveAttribute(
    'src',
    'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg',
  )
})

test('YouTubeの概要欄は取り込まず、手入力した材料などは保存する', async ({ page }) => {
  test.skip(!METADATA_ENDPOINT, '取得用エンドポイントが必要')
  const description = '【作り方】1. 鶏むね肉を切る 2. 片栗粉をまぶす'
  // 概要欄は作り方を含むことが多いため、応答に含まれていても取り込まない。
  await page.route(`${new URL(METADATA_ENDPOINT).origin}/**`, (route) =>
    route.fulfill({ json: { title: '動画のレシピ', imageUrl: '', ingredients: [], description } }),
  )
  await page.route('https://www.youtube.com/oembed?**', (route) =>
    route.fulfill({ json: { title: '動画のレシピ', thumbnail_url: '' } }),
  )
  await openApp(page)
  const dialog = await openNewRecipe(page)
  await dialog.getByLabel('レシピのURL').fill('https://youtu.be/abcdefghijk')
  await dialog.getByLabel('材料など').fill('鶏むね肉、片栗粉')
  await dialog.getByRole('button', { name: '保存する' }).click()
  const detail = page.getByRole('dialog', { name: 'レシピ' })
  await expect(detail).not.toContainText(description)
  await expect(detail.getByText('鶏むね肉、片栗粉')).toBeVisible()
  await closeDialog(page, 'レシピ')
  await page.getByRole('textbox', { name: 'レシピを検索' }).fill('片栗粉')
  await expect(page.locator('.recipe-card')).toHaveCount(1)
})

test('料理サイトの材料を自動で保存し検索できる', async ({ page }) => {
  test.skip(!METADATA_ENDPOINT, '取得用エンドポイントが必要')
  await routeLinkMetadata(page, {
    title: '季節のスープ',
    imageUrl: '',
    ingredients: ['かぼちゃ 200g', '牛乳 100ml'],
  })
  await openApp(page)
  const dialog = await openNewRecipe(page)
  await dialog.getByLabel('レシピのURL').fill('https://example.com/seasonal-soup')
  await dialog.getByRole('button', { name: '保存する' }).click()
  const detail = page.getByRole('dialog', { name: 'レシピ' })
  await expect(detail.getByText('かぼちゃ 200g')).toBeVisible()
  await closeDialog(page, 'レシピ')
  await page.getByRole('textbox', { name: 'レシピを検索' }).fill('かぼちゃ')
  await expect(page.locator('.recipe-card')).toHaveCount(1)
})

test('取得用エンドポイントからレシピ名を受け取って登録する', async ({ page }) => {
  test.skip(!METADATA_ENDPOINT, 'VITE_LINK_METADATA_ENDPOINT が未設定のビルドでは自動取得しない')
  const recipeUrl = 'https://www.kurashiru.com/recipes/226cd24c-6fb1-4102-b6b5-ba1357825a35'
  let requestedTarget = ''
  await page.route(`${new URL(METADATA_ENDPOINT).origin}/**`, async (route) => {
    requestedTarget = new URL(route.request().url()).searchParams.get('url') || ''
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ title: '焼き鳥缶で簡単炊き込みご飯 作り方・レシピ', imageUrl: '' }),
    })
  })
  await page.route('https://video.kurashiru.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG }),
  )
  await openApp(page)
  const dialog = await openNewRecipe(page)
  await dialog.getByLabel('レシピのURL').fill(recipeUrl)
  await dialog.getByRole('button', { name: '保存する' }).click()
  await expect(
    page
      .getByRole('dialog', { name: 'レシピ' })
      .getByRole('heading', { name: '焼き鳥缶で簡単炊き込みご飯 作り方・レシピ' }),
  ).toBeVisible()
  expect(requestedTarget).toBe(recipeUrl)
  await closeDialog(page, 'レシピ')
  await expect(
    page.getByRole('button', { name: /焼き鳥缶で簡単炊き込みご飯.*を開く/ }),
  ).toBeVisible()
})

test('URLを入れた時点でレシピ名を取り込み、保存前に直せる', async ({ page }) => {
  test.skip(!METADATA_ENDPOINT, 'VITE_LINK_METADATA_ENDPOINT が未設定のビルドでは自動取得しない')
  await routeLinkMetadata(page, { title: '肉じゃがの基本レシピ', imageUrl: '' })
  await openApp(page)
  const dialog = await openNewRecipe(page)
  await dialog.getByLabel('レシピのURL').fill('https://www.sirogohan.com/recipe/nikujaga/')
  await dialog.getByLabel('レシピ名').click()
  await expect(dialog.getByLabel('レシピ名')).toHaveValue('肉じゃがの基本レシピ')

  await dialog.getByLabel('レシピ名').fill('肉じゃが（週末用）')
  await dialog.getByRole('button', { name: '保存する' }).click()
  await expect(
    page
      .getByRole('dialog', { name: 'レシピ' })
      .getByRole('heading', { name: '肉じゃが（週末用）' }),
  ).toBeVisible()
})

test('計測用のパラメーターが違うだけのURLを重複として扱う', async ({ page }) => {
  await openApp(page)
  const first = await openNewRecipe(page)
  await first.getByLabel('レシピのURL').fill('https://example.com/recipe?id=7')
  await first.getByLabel('レシピ名').fill('重複のもと')
  await first.getByRole('button', { name: '保存する' }).click()
  await closeDialog(page, 'レシピ')

  const second = await openNewRecipe(page)
  await second
    .getByLabel('レシピのURL')
    .fill('https://example.com/recipe?id=7&utm_source=line&ref=x')
  await second.getByRole('button', { name: '保存する' }).click()
  await expect(second.getByRole('alert')).toContainText('登録済み')
  await second.getByRole('button', { name: '登録済みのレシピを開く' }).click()
  await expect(
    page.getByRole('dialog', { name: 'レシピ' }).getByRole('heading', { name: '重複のもと' }),
  ).toBeVisible()
})

test('一覧の並び替えを切り替え、再読み込み後も残す', async ({ page }) => {
  await openApp(page)
  for (const [name, url] of [
    ['あんかけ豆腐', 'https://example.com/a'],
    ['ざる蕎麦', 'https://example.com/b'],
  ]) {
    const dialog = await openNewRecipe(page)
    await dialog.getByLabel('レシピのURL').fill(url)
    await dialog.getByLabel('レシピ名').fill(name)
    await dialog.getByRole('button', { name: '保存する' }).click()
    await closeDialog(page, 'レシピ')
  }
  const titles = page.locator('.recipe-card .card-title')
  await expect(titles).toHaveText(['ざる蕎麦', 'あんかけ豆腐'])

  await page.getByLabel('並び替え').selectOption('title')
  await expect(titles).toHaveText(['あんかけ豆腐', 'ざる蕎麦'])
  await page.reload()
  await expect(page.getByLabel('並び替え')).toHaveValue('title')
  await expect(titles).toHaveText(['あんかけ豆腐', 'ざる蕎麦'])
})

test('リンクのURLを変えると、プレビュー画像を取り直す', async ({ page }) => {
  await page.route('https://www.youtube.com/oembed?**', async (route) => {
    const target = new URL(new URL(route.request().url()).searchParams.get('url') || '')
    const id = target.searchParams.get('v') || target.pathname.slice(1)
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        title: `動画 ${id}`,
        thumbnail_url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      }),
    })
  })
  await page.route('https://i.ytimg.com/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG })
  })
  await openApp(page)
  const dialog = await openNewRecipe(page)
  await dialog.getByLabel('レシピのURL').fill('https://www.youtube.com/watch?v=aaa111')
  await dialog.getByRole('button', { name: '保存する' }).click()
  const detail = page.getByRole('dialog', { name: 'レシピ' })
  await expect(detail.getByRole('heading', { name: '動画 aaa111' })).toBeVisible()

  await detail.getByRole('button', { name: '編集' }).click()
  const edit = page.getByRole('dialog', { name: 'レシピを編集' })
  await edit.getByLabel('レシピのURL').fill('https://www.youtube.com/watch?v=bbb222')
  await edit.getByRole('button', { name: '保存する' }).click()
  await expect(detail.getByRole('link', { name: '元のレシピを見る' })).toHaveAttribute(
    'href',
    'https://www.youtube.com/watch?v=bbb222',
  )
  await closeDialog(page, 'レシピ')
  await expect(page.getByRole('img', { name: '動画 aaa111' })).toHaveAttribute(
    'src',
    'https://i.ytimg.com/vi/bbb222/hqdefault.jpg',
  )
})

test('クラシル・X・Instagramのリンク画像をカードに表示する', async ({ page }) => {
  await page.route('https://www.kurashiru.com/recipes/**', (route) =>
    route.fulfill({ status: 403 }),
  )
  await page.route('https://video.kurashiru.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG }),
  )
  await page.route('https://api.fxtwitter.com/2/status/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 200,
        status: {
          text: 'Xの料理',
          media: { photos: [{ url: 'https://pbs.twimg.com/media/dish.jpg' }] },
        },
      }),
    }),
  )
  await page.route('https://pbs.twimg.com/media/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG }),
  )
  await page.route('https://www.instagram.com/p/**/embed/', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<div style="height:56px"></div><img alt="投稿写真" style="display:block;width:100%;height:400px" src="data:image/png;base64,${PIXEL_PNG.toString('base64')}">`,
    }),
  )
  await openApp(page)

  for (const [url, title] of [
    ['https://www.kurashiru.com/recipes/9ab38152-75d5-4ef2-bc66-fc83bdfb0899', 'クラシル料理'],
    ['https://x.com/ore825/status/1089823055684091904', 'Xの料理'],
    ['https://www.instagram.com/reel/C6qVNUPyhRc/', 'Instagram料理'],
  ]) {
    const dialog = await openNewRecipe(page)
    await dialog.getByLabel('レシピのURL').fill(url)
    await dialog.getByLabel('レシピ名').fill(title)
    await dialog.getByRole('button', { name: '保存する' }).click()
    await closeDialog(page, 'レシピ')
  }

  const kurashiru = page.locator('.recipe-card').filter({ hasText: 'クラシル料理' })
  await expect(kurashiru.getByRole('img', { name: 'クラシル料理' })).toHaveJSProperty(
    'naturalWidth',
    1,
  )
  const x = page.locator('.recipe-card').filter({ hasText: 'Xの料理' })
  await expect(x.getByRole('img', { name: 'Xの料理' })).toHaveJSProperty('naturalWidth', 1)
  const instagram = page.locator('.recipe-card').filter({ hasText: 'Instagram料理' })
  await expect(instagram.locator('iframe.instagram-preview')).toHaveAttribute(
    'src',
    'https://www.instagram.com/p/C6qVNUPyhRc/embed/',
  )
  await expect(instagram.frameLocator('iframe').locator('img')).toBeVisible()
})

test('期限切れのTikTokサムネイルを再取得する', async ({ page }) => {
  let requests = 0
  await page.route('https://www.tiktok.com/oembed?**', (route) => {
    requests += 1
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        title: 'クラシル動画',
        thumbnail_url: `https://p16.tiktokcdn.com/dish.jpg?x-expires=${Math.floor(Date.now() / 1000) + (requests === 1 ? -1 : 3600)}`,
      }),
    })
  })
  await page.route('https://p16.tiktokcdn.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG }),
  )
  await openApp(page)
  const dialog = await openNewRecipe(page)
  await dialog
    .getByLabel('レシピのURL')
    .fill('https://www.tiktok.com/@kurashiru.com/video/7329796860212808967')
  await dialog.getByRole('button', { name: '保存する' }).click()
  const detail = page.getByRole('dialog', { name: 'レシピ' })
  await expect(detail.getByRole('img', { name: 'クラシル動画' })).toHaveAttribute(
    'src',
    /x-expires=\d+/,
  )
  await expect.poll(() => requests).toBeGreaterThan(1)
})

test('保存済みで画像が空のX投稿を再表示時に取得する', async ({ page }) => {
  let available = false
  await page.route('**/sw.js', (route) => route.abort())
  await page.route('https://api.fxtwitter.com/2/status/**', (route) =>
    route.fulfill(
      available
        ? {
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              code: 200,
              status: { media: { photos: [{ url: 'https://pbs.twimg.com/media/existing.jpg' }] } },
            }),
          }
        : { status: 503 },
    ),
  )
  await page.route('https://pbs.twimg.com/media/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG }),
  )
  await openApp(page)
  const dialog = await openNewRecipe(page)
  await dialog.getByLabel('レシピのURL').fill('https://x.com/ore825/status/1089823055684091904')
  await dialog.getByLabel('レシピ名').fill('保存済みのXレシピ')
  await dialog.getByRole('button', { name: '保存する' }).click()
  await closeDialog(page, 'レシピ')
  await expect(page.locator('.recipe-card .photo-placeholder')).toBeVisible()

  available = true
  await page.reload()
  await expect(page.getByRole('img', { name: '保存済みのXレシピ' })).toHaveJSProperty(
    'naturalWidth',
    1,
  )
})

test('保存済みのクラシル画像URLが壊れていても公開画像へ切り替える', async ({ page }) => {
  await routeLinkMetadata(page, { title: '', imageUrl: 'https://images.example.com/old.jpg' })
  await page.route('https://www.kurashiru.com/recipes/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      headers: { 'access-control-allow-origin': '*' },
      body: '<meta property="og:image" content="https://images.example.com/old.jpg">',
    }),
  )
  await page.route('https://images.example.com/old.jpg', (route) => route.fulfill({ status: 404 }))
  await page.route('https://video.kurashiru.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG }),
  )
  await openApp(page)
  const dialog = await openNewRecipe(page)
  await dialog
    .getByLabel('レシピのURL')
    .fill('https://www.kurashiru.com/recipes/9ab38152-75d5-4ef2-bc66-fc83bdfb0899')
  await dialog.getByLabel('レシピ名').fill('保存済みのクラシルレシピ')
  await dialog.getByRole('button', { name: '保存する' }).click()
  await closeDialog(page, 'レシピ')
  await page.reload()
  await expect(page.getByRole('img', { name: '保存済みのクラシルレシピ' })).toHaveAttribute(
    'src',
    'https://video.kurashiru.com/production/videos/9ab38152-75d5-4ef2-bc66-fc83bdfb0899/compressed_thumbnail_square_large.jpg',
  )
})

test('上部のブランドからトップへ戻り、設定を開閉できる', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await openApp(page)
  const brand = page.getByRole('link', { name: 'ひとさじ トップへ' })
  await expect(brand).toHaveAttribute('href', '/')
  await expect(brand.locator('.brand-mark')).toBeVisible()
  await expect(brand).toContainText('わたしのレシピ帳')
  await expect(page.locator('#main-sidebar')).toHaveCount(0)
  await openSettings(page)
  await expect(page.getByRole('link', { name: 'ショートカットを追加' })).toHaveAttribute(
    'href',
    'https://www.icloud.com/shortcuts/f78f1b3c4d8749bfa6b7e631159f7ae3',
  )
  await brand.click()
  await expect(page.getByRole('heading', { name: /集めたレシピ/ })).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await expect(brand).toBeVisible()
  await expect(page.locator('#main-sidebar')).toHaveCount(0)
  await openSettings(page)
  await expect(page.getByRole('button', { name: '中', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: '一覧に戻る' }).click()
  await expect(page.getByRole('heading', { name: /集めたレシピ/ })).toBeVisible()
})

test.describe('共有の手順は端末に合わせて出し分ける', () => {
  const shortcut = { name: 'ショートカットを追加' }

  test('iPhoneではショートカットの手順だけ出す', async ({ browser }) => {
    const context = await browser.newContext({ ...devices['iPhone 14'], isMobile: undefined })
    const page = await context.newPage()
    await routeLinkMetadata(page)
    await openApp(page)
    await openSettings(page)
    await expect(page.getByRole('link', shortcut)).toBeVisible()
    await expect(page.getByText('ホーム画面に追加すると、共有メニューに')).toHaveCount(0)
    await context.close()
  })

  test('Androidではショートカットを出さない', async ({ browser }) => {
    const context = await browser.newContext({ ...devices['Pixel 7'], isMobile: undefined })
    const page = await context.newPage()
    await routeLinkMetadata(page)
    await openApp(page)
    await openSettings(page)
    await expect(page.getByRole('link', shortcut)).toHaveCount(0)
    await expect(page.getByText('ホーム画面に追加すると、共有メニューに')).toBeVisible()
    await context.close()
  })

  test('iPhoneのホーム画面版では使えないことを伝える', async ({ browser }) => {
    const context = await browser.newContext({ ...devices['iPhone 14'], isMobile: undefined })
    await context.addInitScript(() =>
      Object.defineProperty(navigator, 'standalone', { value: true }),
    )
    const page = await context.newPage()
    await routeLinkMetadata(page)
    await openApp(page)
    await openSettings(page)
    await expect(page.getByText('いまのホーム画面版では使えません')).toBeVisible()
    await expect(page.getByRole('link', shortcut)).toHaveCount(0)
    await context.close()
  })

  test('Androidでは共有が使えない注意書きを出さない', async ({ browser }) => {
    const context = await browser.newContext({ ...devices['Pixel 7'], isMobile: undefined })
    const page = await context.newPage()
    await routeLinkMetadata(page)
    await openApp(page)
    await openSettings(page)
    const caution = page.locator('.settings-caution')
    await expect(caution).toContainText('先にバックアップを書き出して')
    await expect(caution).not.toContainText('共有メニューから登録」は使えません')
    await context.close()
  })

  test('共有の案内は「アプリとして使う」とは別のカードに置く', async ({ page }) => {
    await openApp(page)
    await openSettings(page)
    const appCard = page
      .locator('.settings-card')
      .filter({ has: page.getByRole('heading', { name: 'アプリとして使う' }) })
    await expect(appCard.getByRole('link', shortcut)).toHaveCount(0)
    await expect(
      page
        .locator('.settings-card')
        .filter({ has: page.getByRole('heading', { name: '共有メニューから登録' }) }),
    ).toHaveCount(1)
  })

  test('判別できない端末では両方を見出し付きで並べる', async ({ page }) => {
    await openApp(page)
    await openSettings(page)
    await expect(page.getByText('iPhone・iPad', { exact: true })).toBeVisible()
    await expect(page.getByText('Android', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', shortcut)).toBeVisible()
    await expect(page.getByText('ホーム画面に追加すると、共有メニューに')).toBeVisible()
  })
})

test('スマホで小表示を2列にし、リスト表示へ切り替えられる', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openApp(page)
  const detail = await addLinkRecipe(page, 'スマホ表示の確認')
  await closeDialog(page, 'レシピ')

  await openSettings(page)
  const displayControl = page.getByRole('group', { name: '一覧の見た目' })
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
    .getByRole('group', { name: '一覧の見た目' })
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

test('URLを変更したら古い自動タイトルを消し、手入力の名前は残す', async ({ page }) => {
  await page.route('https://www.youtube.com/oembed**', (route) =>
    route.fulfill({ json: { title: 'あ'.repeat(400) } }),
  )
  await openApp(page)
  const dialog = await openNewRecipe(page)
  const url = dialog.getByLabel('レシピのURL')
  const title = dialog.getByLabel('レシピ名')
  await url.fill('https://youtu.be/first')
  await title.focus()
  await expect(title).toHaveValue('あ'.repeat(300))
  await url.fill('https://youtu.be/second')
  await expect(title).toHaveValue('')
  await title.fill('自分のレシピ名')
  await url.fill('https://youtu.be/third')
  await expect(title).toHaveValue('自分のレシピ名')
  await dialog.getByRole('button', { name: '保存する' }).click()
  await expect(page.getByRole('dialog', { name: 'レシピ' })).toContainText('自分のレシピ名')
})

test('URLを書き換えた後に届いた古い取得結果を入力しない', async ({ page }) => {
  let release!: () => void
  const responseReady = new Promise<void>((resolve) => {
    release = resolve
  })
  let requested!: () => void
  const requestStarted = new Promise<void>((resolve) => {
    requested = resolve
  })
  await page.route('https://www.youtube.com/oembed**', async (route) => {
    requested()
    await responseReady
    await route.fulfill({ json: { title: '古いURLの名前' } })
  })
  await openApp(page)
  const dialog = await openNewRecipe(page)
  await dialog.getByLabel('レシピのURL').fill('https://youtu.be/stale')
  await dialog.getByLabel('レシピ名').focus()
  await requestStarted
  await dialog.getByLabel('レシピのURL').fill('https://example.com/new')
  const received = page.waitForResponse('https://www.youtube.com/oembed**')
  release()
  await received
  // 後続の保存まで進め、古い結果がタイトルに混入しないことを確認する。
  await dialog.getByRole('button', { name: '保存する' }).click()
  await expect(page.getByRole('dialog', { name: 'レシピ' })).not.toContainText('古いURLの名前')
  await expect(page.getByRole('link', { name: '元のレシピを見る' })).toHaveAttribute(
    'href',
    'https://example.com/new',
  )
})

test('長い共有URLは切断せず保存し、上限超過はエラーとして残す', async ({ page }) => {
  const url = 'https://example.com/?token=' + 'a'.repeat(4020)
  await page.goto('/?' + new URLSearchParams({ share_target: '1', url }))
  let dialog = page.getByRole('dialog', { name: '追加' })
  await expect(dialog.getByLabel('レシピのURL')).toHaveValue(url)
  await dialog.getByRole('button', { name: '保存する' }).click()
  await expect(page.getByRole('link', { name: '元のレシピを見る' })).toHaveAttribute('href', url)
  const tooLong = url + 'a'.repeat(100)
  await page.goto('/?' + new URLSearchParams({ share_target: '1', url: tooLong }))
  dialog = page.getByRole('dialog', { name: '追加' })
  await expect(dialog.getByLabel('レシピのURL')).toHaveValue(tooLong)
  await dialog.getByRole('button', { name: '保存する' }).click()
  await expect(dialog.getByRole('alert')).toContainText('4096')
  await expect(dialog.getByLabel('レシピのURL')).toHaveValue(tooLong)
})

test.describe('タイトル取得の回復', () => {
  test.use({ serviceWorkers: 'block' })

  test('材料などの一括取得はYouTubeを対象にせず、手入力と旧データを残す', async ({ page }) => {
    test.skip(!METADATA_ENDPOINT, '取得用エンドポイントが必要')
    await page.route('https://www.youtube.com/oembed?**', (route) =>
      route.fulfill({ json: { title: '動画のレシピ', thumbnail_url: '' } }),
    )
    await openApp(page)
    const oldDescription = '旧データの概要欄。【作り方】鶏むね肉を切る'
    for (const [url, title, content] of [
      ['https://example.com/soup', 'スープ', ''],
      ['https://example.com/auto', '自動取得の料理', '古い自動材料'],
      ['https://youtu.be/abcdefghijk', '動画のレシピ', ''],
      ['https://youtu.be/olddesc1234', '概要欄が残る動画', oldDescription],
      ['https://example.com/manual', '手入力の料理', '手入力の材料'],
    ]) {
      const dialog = await openNewRecipe(page)
      await dialog.getByLabel('レシピのURL').fill(url)
      await dialog.getByLabel('レシピ名').fill(title)
      if (content) await dialog.getByLabel('材料など').fill(content)
      await dialog.getByRole('button', { name: '保存する' }).click()
      await closeDialog(page, 'レシピ')
    }
    // 自動取得ぶんと、取得元を記録する前に保存された旧データを用意する。
    await page.evaluate(async () => {
      const request = indexedDB.open('hitosaji', 1)
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const tx = db.transaction('recipes', 'readwrite')
      const store = tx.objectStore('recipes')
      const all = await new Promise<Array<{ id: string; url: string; contentSource?: string }>>(
        (resolve, reject) => {
          const get = store.getAll()
          get.onsuccess = () => resolve(get.result)
          get.onerror = () => reject(get.error)
        },
      )
      for (const recipe of all) {
        if (recipe.url.includes('example.com/auto')) recipe.contentSource = 'auto'
        else if (recipe.url.includes('olddesc1234')) delete recipe.contentSource
        else continue
        store.put(recipe)
      }
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
      db.close()
    })
    let youtubeLookups = 0
    await page.route(`${new URL(METADATA_ENDPOINT).origin}/**`, (route) => {
      const target = new URL(route.request().url()).searchParams.get('url') || ''
      if (target.includes('youtu.be')) youtubeLookups++
      return route.fulfill({
        json: {
          title: '',
          imageUrl: '',
          ingredients: [target.includes('example.com/auto') ? '新しい自動材料' : 'かぼちゃ 200g'],
        },
      })
    })
    await page.reload()
    await openSettings(page)
    const contentAction = page.locator('.settings-action').filter({
      has: page.getByRole('heading', { name: '材料などをまとめて取得' }),
    })
    // 対象は材料が空の料理サイトだけ。YouTubeの2件と手入力は数えない。
    await expect(contentAction.getByText('対象は1件です。')).toBeVisible()
    await contentAction.getByRole('button', { name: '材料などを再取得（1件）' }).click()
    await expect(contentAction.getByRole('status')).toContainText(
      '完了：1件を更新、0件は更新できませんでした。',
    )
    await contentAction.getByRole('button', { name: '材料などを一括取得' }).click()
    await expect(contentAction.getByRole('status')).toContainText(
      '完了：1件を更新、0件は更新できませんでした。',
    )
    await expect(contentAction.getByText('対象は0件です。')).toBeVisible()
    expect(youtubeLookups).toBe(0)
    await page.getByRole('button', { name: '一覧に戻る' }).click()
    for (const [keyword, count] of [
      ['かぼちゃ', 1],
      ['新しい自動材料', 1],
      ['古い自動材料', 0],
      ['手入力の材料', 1],
      // すでに保存された概要欄は消さず、そのまま残す。
      ['旧データの概要欄', 1],
    ] as const) {
      await page.getByRole('textbox', { name: 'レシピを検索' }).fill(keyword)
      await expect(page.locator('.recipe-card')).toHaveCount(count)
    }
  })

  test('取得済みの情報を更新し、手入力した情報を保護する', async ({ page }) => {
    test.skip(!METADATA_ENDPOINT, '取得用エンドポイントが必要')
    let refreshed = false
    let uncachedCalls = 0
    await page.route(`${new URL(METADATA_ENDPOINT).origin}/**`, (route) => {
      const requestUrl = new URL(route.request().url())
      if (requestUrl.searchParams.get('refresh') === '1') uncachedCalls++
      const target = requestUrl.searchParams.get('url') || ''
      return route.fulfill({
        headers: { 'Cache-Control': 'no-store' },
        json: {
          title: refreshed ? '新しい自動タイトル' : '古い自動タイトル',
          imageUrl: '',
          ingredients: [refreshed ? '新しい自動材料' : '古い自動材料'],
          ...(target.includes('manual') ? { title: '旧手動候補' } : {}),
        },
      })
    })
    await openApp(page)
    let dialog = await openNewRecipe(page)
    await dialog.getByLabel('レシピのURL').fill('https://example.com/auto')
    await dialog.getByLabel('レシピ名').click()
    await expect(dialog.getByLabel('レシピ名')).toHaveValue('古い自動タイトル')
    await expect(dialog.getByLabel('材料など')).toHaveValue('古い自動材料')
    await dialog.getByRole('button', { name: '保存する' }).click()
    await closeDialog(page, 'レシピ')

    dialog = await openNewRecipe(page)
    await dialog.getByLabel('レシピのURL').fill('https://example.com/manual')
    await dialog.getByLabel('レシピ名').click()
    await expect(dialog.getByLabel('レシピ名')).toHaveValue('旧手動候補')
    await dialog.getByRole('button', { name: '保存する' }).click()
    const detail = page.getByRole('dialog', { name: 'レシピ' })
    await detail.getByRole('button', { name: '編集' }).click()
    dialog = page.getByRole('dialog', { name: 'レシピを編集' })
    await dialog.getByLabel('レシピ名').fill('手入力したタイトル')
    await dialog.getByLabel('材料など').fill('手入力した材料')
    await dialog.getByRole('button', { name: '保存する' }).click()
    await closeDialog(page, 'レシピ')

    refreshed = true
    await openSettings(page)
    const fetchArea = page.locator('.settings-fetch')
    await expect(fetchArea.getByRole('heading', { name: '情報の取得' })).toBeVisible()
    const backupBox = await page.getByRole('heading', { name: '記録とバックアップ' }).boundingBox()
    const fetchBox = await fetchArea.boundingBox()
    expect(fetchBox!.y).toBeGreaterThan(backupBox!.y + backupBox!.height)
    await expect(fetchArea.getByRole('button', { name: 'レシピ名を再取得（1件）' })).toBeEnabled()
    await fetchArea.getByRole('button', { name: 'レシピ名を再取得（1件）' }).click()
    const titleAction = fetchArea.locator('.settings-action').filter({
      has: page.getByRole('heading', { name: 'レシピ名をまとめて取得' }),
    })
    await expect(titleAction.getByRole('status')).toContainText('完了：1件を更新')
    await fetchArea.getByRole('button', { name: '材料などを再取得（1件）' }).click()
    const contentAction = fetchArea.locator('.settings-action').filter({
      has: page.getByRole('heading', { name: '材料などをまとめて取得' }),
    })
    await expect(contentAction.getByRole('status')).toContainText('完了：1件を更新')
    expect(uncachedCalls).toBeGreaterThanOrEqual(2)
    await page.getByRole('button', { name: '一覧に戻る' }).click()
    await page.getByRole('textbox', { name: 'レシピを検索' }).fill('新しい自動材料')
    await expect(page.locator('.recipe-card')).toHaveCount(1)
    await expect(page.locator('.recipe-card')).toContainText('新しい自動タイトル')
    await page.getByRole('textbox', { name: 'レシピを検索' }).fill('手入力した材料')
    await expect(page.locator('.recipe-card')).toHaveCount(1)
    await expect(page.locator('.recipe-card')).toContainText('手入力したタイトル')
  })

  test('設定から空欄のレシピ名を一括取得し、入力済みの名前を保つ', async ({ page }) => {
    test.skip(!METADATA_ENDPOINT, 'タイトル取得用エンドポイントが必要')
    await openApp(page)
    for (const [path, title] of [
      ['one', ''],
      ['two', ''],
      ['three', ''],
      ['manual', '手入力した名前'],
    ]) {
      const dialog = await openNewRecipe(page)
      await dialog.getByLabel('レシピのURL').fill(`https://example.com/${path}`)
      if (title) await dialog.getByLabel('レシピ名').fill(title)
      await dialog.getByRole('button', { name: '保存する' }).click()
      await closeDialog(page, 'レシピ')
    }

    const endpoint = `${new URL(METADATA_ENDPOINT).origin}/**`
    await page.route(endpoint, (route) => {
      const target = new URL(route.request().url()).searchParams.get('url') || ''
      const title = target.endsWith('/three')
        ? ''
        : target.endsWith('/manual')
          ? '上書きされてはいけない名前'
          : target.endsWith('/one')
            ? '一件目の名前'
            : '二件目の名前'
      return route.fulfill({ json: { title, imageUrl: '' } })
    })
    await openSettings(page)
    await expect(page.getByText('対象は3件です。')).toBeVisible()
    await page.getByRole('button', { name: 'レシピ名を一括取得' }).click()
    await expect(page.getByRole('status').filter({ hasText: '完了：' })).toContainText(
      '完了：2件を更新、1件は更新できませんでした。',
    )
    await expect(page.getByText('対象は1件です。')).toBeVisible()

    await page.route(endpoint, (route) =>
      route.fulfill({ json: { title: '三件目の名前', imageUrl: '' } }),
    )
    await page.getByRole('button', { name: 'レシピ名を一括取得' }).click()
    await expect(page.getByRole('status').filter({ hasText: '完了：' })).toContainText(
      '完了：1件を更新、0件は更新できませんでした。',
    )
    await expect(page.getByRole('button', { name: 'レシピ名を一括取得' })).toBeDisabled()
    await page.getByRole('button', { name: '一覧に戻る' }).click()
    await expect(page.locator('.recipe-card .card-title')).toContainText([
      '手入力した名前',
      '三件目の名前',
      '二件目の名前',
      '一件目の名前',
    ])
    await page.reload()
    await expect(page.locator('.recipe-card .card-title')).toContainText([
      '手入力した名前',
      '三件目の名前',
      '二件目の名前',
      '一件目の名前',
    ])
  })
  test('クラシルの名前取得に失敗しても再取得し、保存済みの空欄も編集で補える', async ({ page }) => {
    test.skip(!METADATA_ENDPOINT, 'タイトル取得用エンドポイントが必要')
    const url = 'https://www.kurashiru.com/recipes/226cd24c-6fb1-4102-b6b5-ba1357825a35'
    const title = '焼き鳥缶で簡単炊き込みご飯 作り方・レシピ'
    await openApp(page)
    let dialog = await openNewRecipe(page)
    await dialog.getByLabel('レシピのURL').fill(url)
    await dialog.getByLabel('レシピ名').focus()
    await expect(dialog.getByText('レシピ名は取得できませんでした。入力できます。')).toBeVisible()
    await routeLinkMetadata(page, { title, imageUrl: '' })
    await dialog.getByRole('button', { name: 'レシピ名を再取得' }).click()
    await expect(dialog.getByLabel('レシピ名')).toHaveValue(title)
    await dialog.getByRole('button', { name: 'キャンセル' }).click()

    // 同じページでも失敗した結果を保持し続けず、保存後の編集で回復できる。
    await page.reload()
    await routeLinkMetadata(page)
    dialog = await openNewRecipe(page)
    await dialog.getByLabel('レシピのURL').fill(url)
    await dialog.getByRole('button', { name: '保存する' }).click()
    const detail = page.getByRole('dialog', { name: 'レシピ', exact: true })
    await expect(
      detail.getByRole('heading', { name: 'クラシルのレシピ', exact: true }),
    ).toBeVisible()
    await routeLinkMetadata(page, { title, imageUrl: '' })
    await detail.getByRole('button', { name: '編集', exact: true }).click()
    dialog = page.getByRole('dialog', { name: 'レシピを編集' })
    await expect(dialog.getByLabel('レシピ名')).toHaveValue(title)
    await dialog.getByRole('button', { name: '保存する' }).click()
    await expect(detail.getByRole('heading', { name: title, exact: true })).toBeVisible()
  })

  test('タイトル取得用サーバーが5秒を超えて応答しても名前を保存する', async ({ page }) => {
    test.skip(!METADATA_ENDPOINT, 'タイトル取得用エンドポイントが必要')
    await page.route(`${new URL(METADATA_ENDPOINT).origin}/**`, async (route) => {
      // Workerは上流に最大8秒待つため、その範囲内の遅延を再現する。
      await new Promise((resolve) => setTimeout(resolve, 5_500))
      await route.fulfill({ json: { title: '取得が遅いレシピ', imageUrl: '' } })
    })
    await openApp(page)
    const dialog = await openNewRecipe(page)
    await dialog.getByLabel('レシピのURL').fill('https://example.com/slow-metadata')
    await dialog.getByRole('button', { name: '保存する' }).click()
    await expect(page.getByRole('dialog', { name: 'レシピ', exact: true })).toContainText(
      '取得が遅いレシピ',
    )
  })
})
