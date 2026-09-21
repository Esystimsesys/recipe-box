import { describe, expect, it } from 'vitest'
import {
  exportBackup,
  matchesRecipe,
  normalizeIngredient,
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
  wantToCook: false,
  createdAt: '2026-09-20T01:02:03.000Z',
  updatedAt: '2026-09-21T04:05:06.000Z',
  ...overrides,
})

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
    ['https://cookpad.com/recipe/1', 'Cookpad'],
    ['https://recipes.example.jp/a', 'recipes.example.jp'],
  ])('%s を %s と表示する', (url, expected) => {
    expect(sourceLabel(url)).toBe(expected)
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

  it('本文検索と材料のAND検索を組み合わせる', () => {
    const recipe = sampleRecipe()
    expect(matchesRecipe(recipe, 'カレー', ['タマネギ', '鶏肉'])).toBe(true)
    expect(matchesRecipe(recipe, '辛さ', ['玉葱'])).toBe(true)
    expect(matchesRecipe(recipe, 'カレー', ['玉ねぎ', 'じゃがいも'])).toBe(false)
    expect(matchesRecipe(recipe, 'シチュー', [])).toBe(false)
  })
})

describe('backup validation', () => {
  it('エクスポートしたレシピを検証して読み戻せる', () => {
    const backup = exportBackup([
      sampleRecipe({
        url: 'https://example.com/recipe?servings=2#method',
        createdAt: '2026-09-20T10:02:03+09:00',
      }),
    ])

    expect(parseBackup(backup)).toEqual([
      sampleRecipe({
        url: 'https://example.com/recipe?servings=2#method',
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
    const recipeWithExtra = { ...sampleRecipe(), secret: 'unexpected' }
    expect(() =>
      parseBackup({ format: 'recipe-box', version: 1, recipes: [recipeWithExtra] }),
    ).toThrow(/未対応の項目/)

    const recipe = sampleRecipe()
    recipe.logs[0].date = '2026-02-30'
    expect(() => parseBackup(exportBackup([recipe]))).toThrow(/正しい日付/)
  })
})
