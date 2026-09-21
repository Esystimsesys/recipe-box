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

export type LinkMetadata = {
  title: string
  imageUrl: string
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim().slice(0, 300) : ''
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

async function request(url: string): Promise<Response> {
  const controller = new AbortController()
  const timer = globalThis.setTimeout(() => controller.abort(), 5_000)
  try {
    return await fetch(url, {
      credentials: 'omit',
      referrerPolicy: 'strict-origin-when-cross-origin',
      signal: controller.signal,
    })
  } finally {
    globalThis.clearTimeout(timer)
  }
}

async function fetchOEmbed(endpoint: string, sourceUrl: string): Promise<LinkMetadata> {
  const response = await request(endpoint)
  if (!response.ok) throw new Error('oEmbedを取得できませんでした。')
  const data = (await response.json()) as { title?: unknown; thumbnail_url?: unknown }
  return {
    title: cleanText(data.title),
    imageUrl: safeImageUrl(data.thumbnail_url, sourceUrl),
  }
}

async function fetchOpenGraph(url: string): Promise<LinkMetadata> {
  const response = await request(url)
  if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) {
    throw new Error('ページ情報を取得できませんでした。')
  }
  const html = await response.text()
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
  const endpoint = oEmbedUrl(url)
  if (endpoint) {
    try {
      return await fetchOEmbed(endpoint, url)
    } catch {
      // Some providers or individual posts do not expose oEmbed. Try the page itself next.
    }
  }
  try {
    return await fetchOpenGraph(url)
  } catch {
    return { title: '', imageUrl: '' }
  }
}
