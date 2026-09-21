import { describe, expect, it } from 'vitest'
import { cookpadPreviewUrl } from './preview'

const ogp = (id: string) => `https://og-image.cookpad.com/global/jp/recipe/${id}`

describe('cookpadPreviewUrl', () => {
  it.each([
    ['https://cookpad.com/jp/recipes/19303696', ogp('19303696')],
    ['https://www.cookpad.com/jp/recipes/19303696', ogp('19303696')],
    ['https://cookpad.com/jp/recipes/19303696-chicken-curry', ogp('19303696')],
    ['https://cookpad.com/jp/recipes/19303696/chicken-curry/', ogp('19303696')],
    ['https://cookpad.com/jp/recipes/19303696?ref=share', ogp('19303696')],
  ])('現行のレシピURL %s を公開OGP URLへ変換する', (url, expected) => {
    expect(cookpadPreviewUrl(url)).toBe(expected)
  })

  it.each([
    'http://cookpad.com/jp/recipes/19303696',
    'https://user:secret@cookpad.com/jp/recipes/19303696',
    'https://mobile.cookpad.com/jp/recipes/19303696',
    'https://cookpad.example/jp/recipes/19303696',
    'https://evilcookpad.com/jp/recipes/19303696',
    'https://cookpad.com/recipe/19303696',
    'https://cookpad.com/jp/recipes/not-a-number',
    'javascript:alert(1)',
    'not a url',
  ])('Cookpadの公開HTTPSレシピURL以外は拒否する: %s', (url) => {
    expect(cookpadPreviewUrl(url)).toBe('')
  })
})
