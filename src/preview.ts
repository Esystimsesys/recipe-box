import { RECIPE_LIMITS } from './domain'

const LINK_METADATA_ENDPOINT = import.meta.env.VITE_LINK_METADATA_ENDPOINT || ''

/** Public OGP image URL used by Cookpad's recipe pages. No recipe HTML or images are copied. */
export function cookpadPreviewUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (
      !['cookpad.com', 'www.cookpad.com'].includes(parsed.hostname) ||
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password
    )
      return ''
    const match = /^\/jp\/recipes\/(\d+)(?:[-/]|$)/.exec(parsed.pathname)
    return match ? `https://og-image.cookpad.com/global/jp/recipe/${match[1]}` : ''
  } catch {
    return ''
  }
}

/** Kurashiru publishes a stable thumbnail path for its UUID-based recipe pages. */
export function kurashiruPreviewUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (
      parsed.protocol !== 'https:' ||
      !['kurashiru.com', 'www.kurashiru.com'].includes(parsed.hostname) ||
      parsed.username ||
      parsed.password
    )
      return ''
    const match =
      /^\/recipes\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/iu.exec(
        parsed.pathname,
      )
    return match
      ? `https://video.kurashiru.com/production/videos/${match[1]}/compressed_thumbnail_square_large.jpg`
      : ''
  } catch {
    return ''
  }
}

/** Instagram's public embed keeps its own media URLs fresh. */
export function instagramEmbedUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (
      parsed.protocol !== 'https:' ||
      !['instagram.com', 'www.instagram.com'].includes(parsed.hostname) ||
      parsed.username ||
      parsed.password
    )
      return ''
    const match = /^\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)\/?$/u.exec(parsed.pathname)
    return match ? `https://www.instagram.com/p/${match[1]}/embed/` : ''
  } catch {
    return ''
  }
}

export function directPreviewUrl(url: string): string {
  return cookpadPreviewUrl(url) || kurashiruPreviewUrl(url)
}

export function hasDynamicPreview(url: string): boolean {
  return Boolean(xPostId(url) || oEmbedUrl(url))
}

export function previewUrlExpiresSoon(url: string): boolean {
  try {
    const expires = Number(new URL(url).searchParams.get('x-expires'))
    return Number.isFinite(expires) && expires > 0 && expires * 1000 <= Date.now() + 60_000
  } catch {
    return false
  }
}

export type LinkMetadata = {
  title: string
  imageUrl: string
}

function cleanText(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/\s+/gu, ' ').trim().slice(0, RECIPE_LIMITS.title)
    : ''
}

function safeImageUrl(value: unknown, baseUrl: string): string {
  if (typeof value !== 'string') return ''
  try {
    const parsed = new URL(value, baseUrl)
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password
      ? parsed.toString()
      : ''
  } catch {
    return ''
  }
}

export function oEmbedUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./u, '')
    if (hostname === 'youtube.com' || hostname === 'youtu.be') {
      return `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`
    }
    if (hostname === 'tiktok.com' || hostname.endsWith('.tiktok.com')) {
      return `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`
    }
    return ''
  } catch {
    return ''
  }
}

async function request<T>(
  url: string,
  read: (response: Response) => Promise<T>,
  timeoutMs = 5_000,
): Promise<T> {
  const controller = new AbortController()
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      credentials: 'omit',
      referrerPolicy: 'strict-origin-when-cross-origin',
      signal: controller.signal,
    })
    return await read(response)
  } finally {
    globalThis.clearTimeout(timer)
  }
}

async function fetchOEmbed(endpoint: string, sourceUrl: string): Promise<LinkMetadata> {
  const data = await request(endpoint, async (response) => {
    if (!response.ok) throw new Error('oEmbedを取得できませんでした。')
    return (await response.json()) as { title?: unknown; thumbnail_url?: unknown }
  })
  return {
    title: cleanText(data.title),
    imageUrl: safeImageUrl(data.thumbnail_url, sourceUrl),
  }
}

function xPostId(url: string): string {
  try {
    const parsed = new URL(url)
    if (
      parsed.protocol !== 'https:' ||
      !['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(parsed.hostname) ||
      parsed.username ||
      parsed.password
    )
      return ''
    return /^\/[A-Za-z0-9_]+\/status\/(\d+)(?:\/|$)/u.exec(parsed.pathname)?.[1] || ''
  } catch {
    return ''
  }
}

async function fetchXPost(url: string): Promise<LinkMetadata> {
  const id = xPostId(url)
  if (!id) throw new Error('Xの投稿URLではありません。')
  const data = await request(`https://api.fxtwitter.com/2/status/${id}`, async (response) => {
    if (!response.ok) throw new Error('Xの投稿情報を取得できませんでした。')
    return (await response.json()) as {
      code?: number
      status?: {
        text?: unknown
        media?: { photos?: { url?: unknown }[]; videos?: { thumbnail_url?: unknown }[] }
      }
    }
  })
  if (data.code !== 200) throw new Error('Xの投稿情報を取得できませんでした。')
  return {
    title: cleanText(data.status?.text),
    imageUrl: safeImageUrl(
      data.status?.media?.photos?.[0]?.url || data.status?.media?.videos?.[0]?.thumbnail_url,
      url,
    ),
  }
}

/**
 * 多くのレシピサイトは CORS ヘッダーを返さないため、ブラウザからは og:title を読めない。
 * 自前の取得用エンドポイント（worker/ を参照）が設定されていればそこへ問い合わせる。
 * 未設定なら従来どおり直接読みにいき、読めなければタイトルなしで保存を続ける。
 */
export function metadataProxyUrl(url: string, endpoint = LINK_METADATA_ENDPOINT): string {
  if (!endpoint) return ''
  try {
    const target = new URL(endpoint)
    if (target.protocol !== 'https:' && target.hostname !== 'localhost') return ''
    target.searchParams.set('url', url)
    return target.toString()
  } catch {
    return ''
  }
}

async function fetchViaProxy(proxyUrl: string, sourceUrl: string): Promise<LinkMetadata> {
  const data = await request(
    proxyUrl,
    async (response) => {
      if (!response.ok) throw new Error('ページ情報を取得できませんでした。')
      return (await response.json()) as { title?: unknown; imageUrl?: unknown }
    },
    // Workerの上流タイムアウト8秒に通信分の余裕を加える。
    10_000,
  )
  return { title: cleanText(data.title), imageUrl: safeImageUrl(data.imageUrl, sourceUrl) }
}

async function fetchOpenGraph(url: string): Promise<LinkMetadata> {
  const proxyUrl = metadataProxyUrl(url)
  if (proxyUrl) return await fetchViaProxy(proxyUrl, url)

  const html = await request(url, async (response) => {
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) {
      throw new Error('ページ情報を取得できませんでした。')
    }
    return await response.text()
  })
  const document = new DOMParser().parseFromString(html, 'text/html')
  const meta = (selector: string) => document.querySelector<HTMLMetaElement>(selector)?.content
  return {
    title: cleanText(
      meta('meta[property="og:title"]') || meta('meta[name="twitter:title"]') || document.title,
    ),
    imageUrl: safeImageUrl(
      meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]'),
      url,
    ),
  }
}

export async function fetchLinkMetadata(url: string): Promise<LinkMetadata> {
  if (instagramEmbedUrl(url)) return { title: '', imageUrl: '' }
  const directImage = directPreviewUrl(url)
  if (xPostId(url)) {
    try {
      return await fetchXPost(url)
    } catch {
      return { title: '', imageUrl: '' }
    }
  }
  const endpoint = oEmbedUrl(url)
  if (endpoint) {
    try {
      return await fetchOEmbed(endpoint, url)
    } catch {
      // Some providers or individual posts do not expose oEmbed. Try the page itself next.
    }
  }
  try {
    const metadata = await fetchOpenGraph(url)
    return { ...metadata, imageUrl: metadata.imageUrl || directImage }
  } catch {
    return { title: '', imageUrl: directImage }
  }
}
