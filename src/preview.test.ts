import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cookpadPreviewUrl,
  directPreviewUrl,
  fetchLinkMetadata,
  instagramEmbedUrl,
  kurashiruPreviewUrl,
  metadataProxyUrl,
  oEmbedUrl,
  previewUrlExpiresSoon,
} from './preview'

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

  it('Xの公開投稿から写真URLを取得する', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 200,
          status: {
            text: '  餅ボロネーゼ  ',
            media: { photos: [{ url: 'https://pbs.twimg.com/media/dish.jpg?name=orig' }] },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    await expect(
      fetchLinkMetadata('https://x.com/ore825/status/1089823055684091904'),
    ).resolves.toEqual({
      title: '餅ボロネーゼ',
      imageUrl: 'https://pbs.twimg.com/media/dish.jpg?name=orig',
    })
    expect(fetch).toHaveBeenCalledWith(
      'https://api.fxtwitter.com/2/status/1089823055684091904',
      expect.objectContaining({ credentials: 'omit' }),
    )
  })

  it('外部画像の期限切れを検知する', () => {
    expect(
      previewUrlExpiresSoon(
        `https://example.com/a.jpg?x-expires=${Math.floor(Date.now() / 1000) - 1}`,
      ),
    ).toBe(true)
    expect(
      previewUrlExpiresSoon(
        `https://example.com/a.jpg?x-expires=${Math.floor(Date.now() / 1000) + 3600}`,
      ),
    ).toBe(false)
  })
})

describe('direct previews', () => {
  const kurashiruUrl = 'https://www.kurashiru.com/recipes/9ab38152-75d5-4ef2-bc66-fc83bdfb0899'
  it('クラシルのレシピ画像を直接参照する', async () => {
    const expected =
      'https://video.kurashiru.com/production/videos/9ab38152-75d5-4ef2-bc66-fc83bdfb0899/compressed_thumbnail_square_large.jpg'
    expect(kurashiruPreviewUrl(kurashiruUrl)).toBe(expected)
    expect(directPreviewUrl(kurashiruUrl)).toBe(expected)
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('CORS'))
    await expect(fetchLinkMetadata(kurashiruUrl)).resolves.toEqual({
      title: '',
      imageUrl: expected,
    })
  })

  it('Instagramの公開埋め込みURLを作る', () => {
    expect(instagramEmbedUrl('https://www.instagram.com/reel/C6qVNUPyhRc/')).toBe(
      'https://www.instagram.com/p/C6qVNUPyhRc/embed/',
    )
    expect(instagramEmbedUrl('https://instagram.com/p/abc123/')).toBe(
      'https://www.instagram.com/p/abc123/embed/',
    )
    expect(instagramEmbedUrl('https://evilinstagram.com/p/abc123/')).toBe('')
  })
})

describe('metadataProxyUrl', () => {
  const endpoint = 'https://link-metadata.example.workers.dev/'

  it('取得エンドポイントに対象URLを付けて渡す', () => {
    expect(metadataProxyUrl('https://www.kurashiru.com/recipes/abc?x=1#y', endpoint)).toBe(
      'https://link-metadata.example.workers.dev/?url=https%3A%2F%2Fwww.kurashiru.com%2Frecipes%2Fabc%3Fx%3D1%23y',
    )
  })

  it('エンドポイント未設定なら自動取得を行わない', () => {
    expect(metadataProxyUrl('https://www.kurashiru.com/recipes/abc', '')).toBe('')
  })

  it('localhost以外の平文HTTPや壊れたエンドポイントは使わない', () => {
    expect(metadataProxyUrl('https://example.com/a', 'http://metadata.example.com/')).toBe('')
    expect(metadataProxyUrl('https://example.com/a', 'not a url')).toBe('')
    expect(metadataProxyUrl('https://example.com/a', 'http://localhost:8787/')).toBe(
      'http://localhost:8787/?url=https%3A%2F%2Fexample.com%2Fa',
    )
  })
})
