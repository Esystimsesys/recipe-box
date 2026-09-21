import { afterEach, describe, expect, it, vi } from 'vitest'
import { cookpadPreviewUrl, fetchLinkMetadata, oEmbedUrl } from './preview'

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

describe('link metadata', () => {
  afterEach(() => vi.restoreAllMocks())

  it('YouTubeの短縮URLを公式oEmbed URLへ変換する', () => {
    expect(oEmbedUrl('https://youtu.be/abcdefghijk')).toBe(
      'https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fyoutu.be%2Fabcdefghijk',
    )
  })

  it('oEmbedからタイトルとHTTPS画像を取得する', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          title: '  かんたん料理  ',
          thumbnail_url: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    await expect(fetchLinkMetadata('https://youtu.be/abcdefghijk')).resolves.toEqual({
      title: 'かんたん料理',
      imageUrl: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg',
    })
  })
})
