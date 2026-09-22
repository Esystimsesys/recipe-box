import { describe, expect, it } from 'vitest'
import {
  exportBackup,
  matchesRecipe,
  normalizeIngredient,
  normalizeStoredRecipe,
  duplicateKey,
  normalizeUrl,
  parseBackup,
  parseIngredients,
  sourceLabel,
  type Recipe,
} from './domain'

const sampleRecipe = (overrides: Partial<Recipe> = {}): Recipe => ({
  id: 'recipe-1',
  kind: 'link',
  title: '鶏肉のカレー',
  url: 'https://example.com/recipe?servings=2',
  ingredients: ['鶏肉', '玉ねぎ'],
  note: '辛さ控えめ',
  source: 'example.com',
  photos: [{ id: 'cover-1', name: 'dish.jpg', dataUrl: 'data:image/jpeg;base64,aA==' }],
  paperPhotos: [],
  logs: [
    {
      id: 'log-1',
      date: '2026-09-21',
      note: 'おいしかった',
      photos: [{ id: 'log-photo-1', name: 'log.webp', dataUrl: 'data:image/webp;base64,aA==' }],
    },
  ],
  favorite: true,
  cooked: true,
  imageUrl: '',
  createdAt: '2026-09-20T01:02:03.000Z',
  updatedAt: '2026-09-21T04:05:06.000Z',
  ...overrides,
})

const legacyRecipe = (overrides: Partial<Recipe> = {}) => {
  const { cooked: _cooked, imageUrl: _imageUrl, ...legacy } = sampleRecipe(overrides)
  return legacy
}

describe('normalizeUrl', () => {
  it('共有文から最初のHTTP URLを取り出し、クエリとフラグメントを残す', () => {
    expect(normalizeUrl('これを保存 https://example.com/r?id=1&q=Ａ#steps 。')).toBe(
      'https://example.com/r?id=1&q=%EF%BC%A1#steps',
    )
  })

  it('単独のURLでは末尾の記号とハッシュルートを保持する', () => {
    expect(normalizeUrl('https://example.com/#/recipes/1?label=delicious!')).toBe(
      'https://example.com/#/recipes/1?label=delicious!',
    )
    expect(normalizeUrl('https://example.com/r?q=foo)')).toBe('https://example.com/r?q=foo)')
  })

  it('裸のホスト名をHTTPS URLにする', () => {
    expect(normalizeUrl('cookpad.com?ref=share#photo')).toBe('https://cookpad.com/?ref=share#photo')
  })

  it.each([
    'javascript:alert(1)',
    'ftp://example.com/file',
    'https://user:secret@example.com/recipe',
  ])('危険または未対応のURLを拒否する: %s', (url) => {
    expect(() => normalizeUrl(url)).toThrow()
  })
})

describe('sourceLabel', () => {
  it.each([
    ['https://x.com/a/status/1', 'X'],
    ['https://www.instagram.com/p/1', 'Instagram'],
    ['https://m.tiktok.com/v/1', 'TikTok'],
    ['https://youtu.be/abcdefghijk', 'YouTube'],
    ['https://www.youtube.com/watch?v=abcdefghijk', 'YouTube'],
    ['https://cookpad.com/recipe/1', 'Cookpad'],
    ['https://www.kurashiru.com/recipes/example', 'クラシル'],
    ['https://recipes.example.jp/a', 'recipes.example.jp'],
  ])('%s を %s と表示する', (url, expected) => {
    expect(sourceLabel(url)).toBe(expected)
  })
})

describe('duplicateKey', () => {
  it('計測用のパラメーターを外し、同じレシピを同じ見分け方にする', () => {
    expect(duplicateKey('https://example.com/r?id=7&utm_source=line&ref=share')).toBe(
      duplicateKey('https://example.com/r?id=7'),
    )
    expect(duplicateKey('https://example.com/r?a=1&b=2')).toBe(
      duplicateKey('https://example.com/r?b=2&a=1'),
    )
  })

  it('意味のあるパラメーターとフラグメントは残す', () => {
    expect(duplicateKey('https://example.com/r?id=7')).not.toBe(
      duplicateKey('https://example.com/r?id=8'),
    )
    expect(duplicateKey('https://example.com/r#step-2')).not.toBe(
      duplicateKey('https://example.com/r#step-3'),
    )
  })
})

describe('ingredient search', () => {
  it('表記ゆれを正規化し、順序を保って重複を除く', () => {
    expect(normalizeIngredient(' タマネギ ')).toBe('玉ねぎ')
    expect(parseIngredients('タマネギ、鶏肉，玉ねぎ\nジャガイモ')).toEqual([
      '玉ねぎ',
      '鶏肉',
      'じゃがいも',
    ])
  })

  it('本文検索と正規化した材料の部分一致AND検索を組み合わせる', () => {
    const recipe = sampleRecipe({ ingredients: ['鶏むね肉', '玉ねぎ'] })
    expect(matchesRecipe(recipe, 'カレー', ['タマネギ', '鶏'])).toBe(true)
    expect(matchesRecipe(recipe, '辛さ', ['玉葱'])).toBe(true)
    expect(matchesRecipe(recipe, '', ['鶏'])).toBe(true)
    expect(matchesRecipe(recipe, '', ['肉'])).toBe(true)
    expect(matchesRecipe(recipe, '', ['鶏', 'たまねぎ'])).toBe(true)
    expect(matchesRecipe(recipe, '', ['むね', '玉'])).toBe(true)
    expect(matchesRecipe(recipe, '', ['鶏', 'じゃがいも'])).toBe(false)
    expect(matchesRecipe(recipe, 'カレー', ['玉ねぎ', 'じゃがいも'])).toBe(false)
    expect(matchesRecipe(recipe, 'シチュー', [])).toBe(false)
  })

  it('ひとつの検索語入力でレシピ情報と材料を横断して探す', () => {
    const recipe = sampleRecipe({ title: 'いつもの炒め物', ingredients: ['鶏むね肉', '玉ねぎ'] })
    expect(matchesRecipe(recipe, '鶏')).toBe(true)
    expect(matchesRecipe(recipe, '鶏 タマネギ')).toBe(true)
    expect(matchesRecipe(recipe, '鶏 じゃがいも')).toBe(false)
  })

  it('ひらがな・カタカナ・半角カタカナを同じ読みとして検索する', () => {
    const recipe = sampleRecipe({
      title: 'チキンカレー',
      ingredients: ['じゃがいも'],
      note: 'スパイスを使う',
    })
    expect(matchesRecipe(recipe, 'ちきんかれー じゃがいも')).toBe(true)
    expect(matchesRecipe(recipe, 'ﾁｷﾝｶﾚｰ ジャガイモ')).toBe(true)
    expect(matchesRecipe(recipe, 'すぱいす')).toBe(true)
    expect(matchesRecipe(recipe, '', ['ジャガイモ'])).toBe(true)
    expect(matchesRecipe(recipe, 'ちきん シチュー')).toBe(false)
  })
})

describe('backup validation', () => {
  it('v2で画像URLを含むレシピを書き出し、検証して読み戻せる', () => {
    const backup = exportBackup([
      sampleRecipe({
        url: 'https://example.com/recipe?servings=2#method',
        imageUrl: 'https://images.example.com/dish.jpg?width=800',
        createdAt: '2026-09-20T10:02:03+09:00',
      }),
    ])

    expect(backup.version).toBe(2)
    expect(parseBackup(backup)).toEqual([
      sampleRecipe({
        url: 'https://example.com/recipe?servings=2#method',
        imageUrl: 'https://images.example.com/dish.jpg?width=800',
        createdAt: '2026-09-20T01:02:03.000Z',
      }),
    ])
  })

  it('入れ子の不正な画像データが1件でもあれば全体を拒否する', () => {
    const recipe = sampleRecipe()
    recipe.logs[0].photos[0].dataUrl = 'data:image/svg+xml;base64,PHN2Zz4='
    expect(() => parseBackup(exportBackup([recipe]))).toThrow(/JPEG、PNG、WebP/)
  })

  it('レシピIDと配列内IDの重複を拒否する', () => {
    const duplicateRecipes = exportBackup([sampleRecipe(), sampleRecipe({ title: '別レシピ' })])
    expect(() => parseBackup(duplicateRecipes)).toThrow(/重複したID/)

    const duplicateLogs = sampleRecipe()
    duplicateLogs.logs.push({ ...duplicateLogs.logs[0] })
    expect(() => parseBackup(exportBackup([duplicateLogs]))).toThrow(/重複したID/)
  })

  it('余分な項目や存在しない日付を拒否する', () => {
    const recipeWithExtra = { ...legacyRecipe(), secret: 'unexpected' }
    expect(() =>
      parseBackup({ format: 'recipe-box', version: 1, recipes: [recipeWithExtra] }),
    ).toThrow(/未対応の項目/)

    const recipe = sampleRecipe()
    recipe.logs[0].date = '2026-02-30'
    expect(() => parseBackup(exportBackup([recipe]))).toThrow(/正しい日付/)
  })

  it('v1を読み込み、旧調理記録から調理済みを導出して旧フィールドも保持する', () => {
    const old = legacyRecipe()
    const [restored] = parseBackup({ format: 'recipe-box', version: 1, recipes: [old] })

    expect(restored.cooked).toBe(true)
    expect(restored.imageUrl).toBe('')
    expect(restored.logs).toEqual(old.logs)
  })

  it('旧バージョンが書いた wantToCook は読み飛ばし、書き出しに含めない', () => {
    const stored = { ...sampleRecipe(), wantToCook: true }
    const [restored] = parseBackup({ format: 'recipe-box', version: 2, recipes: [stored] })

    expect(restored).not.toHaveProperty('wantToCook')
    expect(exportBackup([restored]).recipes[0]).not.toHaveProperty('wantToCook')
  })

  it('v2の画像URLは認証情報なしのHTTPSだけを許可する', () => {
    expect(() =>
      parseBackup(exportBackup([sampleRecipe({ imageUrl: 'http://images.example.com/a.jpg' })])),
    ).toThrow(/HTTPS/)
    expect(() =>
      parseBackup(
        exportBackup([sampleRecipe({ imageUrl: 'https://user:secret@example.com/a.jpg' })]),
      ),
    ).toThrow(/ユーザー名やパスワード/)

    const withoutImageUrl = sampleRecipe()
    delete withoutImageUrl.imageUrl
    expect(parseBackup(exportBackup([withoutImageUrl]))[0].imageUrl).toBe('')
  })
})

describe('stored recipe migration', () => {
  it('旧レコードを補完してもupdatedAtを変更しない', () => {
    const old = legacyRecipe({ updatedAt: '2026-09-21T13:05:06+09:00' })
    const migrated = normalizeStoredRecipe(old)

    expect(migrated.cooked).toBe(true)
    expect(migrated.updatedAt).toBe('2026-09-21T13:05:06+09:00')
    expect(migrated.logs).toEqual(old.logs)
  })

  it('古い版で保存したリンクの出典名を現在の表示名に直す', () => {
    const stored = sampleRecipe({
      kind: 'link',
      url: 'https://www.kurashiru.com/recipes/226cd24c-6fb1-4102-b6b5-ba1357825a35',
      source: 'kurashiru.com',
    })

    expect(normalizeStoredRecipe(stored).source).toBe('クラシル')
  })

  it('手動登録の出典は利用者の入力のまま残す', () => {
    const stored = sampleRecipe({ kind: 'paper', url: '', source: '祖母のノート' })

    expect(normalizeStoredRecipe(stored).source).toBe('祖母のノート')
  })

  it('明示的に未調理へ戻したv2レコードを旧ログから再導出しない', () => {
    const migrated = normalizeStoredRecipe(legacyRecipe())
    const toggledOff = normalizeStoredRecipe({ ...migrated, cooked: false })

    expect(toggledOff.logs).toHaveLength(1)
    expect(toggledOff.cooked).toBe(false)
  })
})
