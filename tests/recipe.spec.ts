import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'

const BASE_URL = 'http://localhost:5188'
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

const image = (name: string) => ({ name, mimeType: 'image/png', buffer: PIXEL_PNG })

async function openApp(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /わたしのレシピ帳/ })).toBeVisible()
}

async function openNewRecipe(page: Page) {
  await page.getByRole('button', { name: 'レシピを追加', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'レシピを追加' })
  await expect(dialog).toBeVisible()
  return dialog
}

async function addLinkRecipe(page: Page, title = '鶏と玉ねぎ') {
  const dialog = await openNewRecipe(page)
  await dialog
    .getByLabel('レシピのURL')
    .fill('おすすめです https://example.com/recipe?id=7&from=share#steps 。')
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
  await dialog.getByRole('button', { name: '紙のレシピから' }).click()
  await dialog
    .getByLabel('紙のレシピ写真')
    .setInputFiles([image('page-1.png'), image('page-2.png')])
  await expect(dialog.getByAltText('紙のレシピ写真 1')).toBeVisible()
  await expect(dialog.getByAltText('紙のレシピ写真 2')).toBeVisible()
  await dialog.getByLabel('レシピ名').fill(title)
  await dialog.getByLabel('材料').fill('じゃがいも、にんじん')
  await dialog.getByLabel('出典').fill('祖母のノート')
  await dialog.getByRole('button', { name: '保存する' }).click()

  const detail = page.getByRole('dialog', { name: 'レシピ' })
  await expect(detail.getByRole('heading', { name: title })).toBeVisible()
  await expect(detail.getByAltText('レシピ 1ページ目')).toBeVisible()
  await expect(detail.getByAltText('レシピ 2ページ目')).toBeVisible()
  return detail
}

async function addCookLog(page: Page, date: string, note: string, withPhoto = false) {
  const detail = page.getByRole('dialog', { name: 'レシピ' })
  await detail.getByRole('button', { name: '記録する' }).click()
  const dialog = page.getByRole('dialog', { name: '作った記録を残す' })
  await dialog.getByLabel('作った日').fill(date)
  await dialog.getByLabel('感想・アレンジ').fill(note)
  if (withPhoto) {
    await dialog.getByLabel('作った料理の写真').setInputFiles(image('cooked.png'))
    await expect(dialog.getByAltText('作った料理の写真 1')).toBeVisible()
    await expect(
      dialog.getByRole('checkbox', { name: 'この写真をレシピの表紙にも使う' }),
    ).toBeChecked()
  }
  await dialog.getByRole('button', { name: '記録を保存' }).click()
  await expect(page.getByRole('dialog', { name: 'レシピ' }).getByText(note)).toBeVisible()
}

async function closeDialog(page: Page, name: string) {
  const dialog = page.getByRole('dialog', { name })
  await dialog.getByRole('button', { name: '閉じる' }).click()
  await expect(dialog).toBeHidden()
}

async function navigate(page: Page, label: 'レシピ帳' | '作った記録') {
  const accessibleName = label === 'レシピ帳' ? /^レシピ帳(?:\s+\d+)?$/u : /^作った記録$/u
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

test('リンクを保存し、AND検索・再読み込み・編集ができる', async ({ page }) => {
  await openApp(page)
  await expect(page.getByRole('heading', { name: 'レシピはまだありません' })).toBeVisible()

  await addLinkRecipe(page)
  await closeDialog(page, 'レシピ')

  await page.getByLabel('レシピを検索').fill('鶏と玉ねぎ')
  for (const ingredient of ['鶏肉', 'タマネギ']) {
    await page.getByLabel('検索する材料').fill(ingredient)
    await page.getByRole('button', { name: '材料を検索条件に追加' }).click()
  }
  await expect(page.getByText('すべて含む')).toBeVisible()
  await expect(page.getByRole('button', { name: /鶏と玉ねぎを開く/ })).toBeVisible()

  await page.getByLabel('検索する材料').fill('じゃがいも')
  await page.getByRole('button', { name: '材料を検索条件に追加' }).click()
  await expect(page.getByRole('heading', { name: '該当するレシピがありません' })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('button', { name: /鶏と玉ねぎを開く/ })).toBeVisible()
  await page.getByRole('button', { name: /鶏と玉ねぎを開く/ }).click()
  await page.getByRole('dialog', { name: 'レシピ' }).getByRole('button', { name: '編集' }).click()
  const edit = page.getByRole('dialog', { name: 'レシピを編集' })
  await edit.getByLabel('レシピ名').fill('鶏と玉ねぎの甘酢炒め')
  await edit.getByRole('button', { name: '保存する' }).click()
  await expect(
    page
      .getByRole('dialog', { name: 'レシピ' })
      .getByRole('heading', { name: '鶏と玉ねぎの甘酢炒め' }),
  ).toBeVisible()
})

test('紙レシピに複数の記録を残し、記録一覧から編集してレシピごと削除できる', async ({ page }) => {
  await openApp(page)
  await addPaperRecipe(page)
  await addCookLog(page, '2026-09-20', '初回は少し薄味', true)
  await expect(
    page.getByRole('dialog', { name: 'レシピ' }).getByText('1回作りました'),
  ).toBeVisible()

  await addCookLog(page, '2026-09-21', '二回目はちょうどよい')
  const detail = page.getByRole('dialog', { name: 'レシピ' })
  await expect(detail.getByText('2回作りました')).toBeVisible()
  await expect(detail.getByRole('button', { name: '料理写真を拡大' })).toBeVisible()
  await closeDialog(page, 'レシピ')

  await navigate(page, '作った記録')
  await expect(page.getByText('2回の記録')).toBeVisible()
  await page.getByRole('button').filter({ hasText: '二回目はちょうどよい' }).click()
  const editLog = page.getByRole('dialog', { name: '作った記録を編集' })
  await editLog.getByLabel('感想・アレンジ').fill('二回目は味が決まった')
  await editLog.getByRole('button', { name: '記録を保存' }).click()
  await expect(
    page.getByRole('dialog', { name: 'レシピ' }).getByText('二回目は味が決まった'),
  ).toBeVisible()

  await page
    .getByRole('dialog', { name: 'レシピ' })
    .getByRole('button', { name: 'レシピを削除', exact: true })
    .click()
  await expect(page.getByText('2件の調理記録・写真を削除します')).toBeVisible()
  await page.getByRole('button', { name: 'レシピを削除する' }).click()
  await expect(page.getByRole('heading', { name: '最初の「作った」を残そう' })).toBeVisible()
  await navigate(page, 'レシピ帳')
  await expect(page.getByRole('button', { name: /祖母の煮物を開く/ })).toHaveCount(0)
})

test('バックアップを別コンテキストへ復元し、重複を上書きせず不正ファイルも拒否する', async ({
  browser,
}) => {
  const sourceContext = await browser.newContext()
  const source = await sourceContext.newPage()
  await source.goto(BASE_URL)
  await expect(source.getByRole('heading', { name: /わたしのレシピ帳/ })).toBeVisible()
  await addLinkRecipe(source)
  await closeDialog(source, 'レシピ')
  await addPaperRecipe(source)
  await addCookLog(source, '2026-09-21', 'バックアップ対象の記録', true)
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
  await expect(restored.getByRole('heading', { name: /わたしのレシピ帳/ })).toBeVisible()
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
  await expect(paperDetail.getByAltText('レシピ 1ページ目')).toBeVisible()
  await expect(paperDetail.getByAltText('レシピ 2ページ目')).toBeVisible()
  await expect(paperDetail.getByText('バックアップ対象の記録')).toBeVisible()
  await expect(paperDetail.getByRole('button', { name: '料理写真を拡大' })).toBeVisible()
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
      version: 1,
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
      .getByRole('button', { name: 'レシピを追加', exact: true })
      .evaluate((button) => {
        const label = [...button.childNodes].find(
          (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.includes('レシピを追加'),
        )!
        const range = document.createRange()
        range.selectNodeContents(label)
        return range.getClientRects().length
      })
    expect(labelLines).toBe(1)
    await expect(page.getByRole('heading', { name: /わたしのレシピ帳/ })).toBeVisible()
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1)
  }
})
