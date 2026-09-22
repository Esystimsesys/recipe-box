import { recipeIngredients, youtubeDescription } from './extract'

/**
 * 「ひとさじ」のリンクメタデータ取得。
 *
 * レシピサイトの多くは CORS ヘッダーを返さないため、ブラウザからは og:title を読めない。
 * この Worker はタイトル・画像と、料理サイトの構造化データの材料または
 * YouTube の概要欄を返す。料理サイトの手順・動画・SNS 本文は保存しない。
 */

const MAX_HTML_BYTES = 512 * 1024
const UPSTREAM_TIMEOUT_MS = 8_000
const UPSTREAM_CACHE_SECONDS = 3_600
const RESULT_CACHE_SECONDS = 21_600
/** 取り出し方を変えたら上げる。古いキャッシュを読まないようにするため。 */
const RESULT_CACHE_VERSION = 3
const MAX_TITLE_LENGTH = 300
const MAX_SEARCH_TEXT_LENGTH = 30_000
const USER_AGENT = 'hitosaji-link-metadata/1.0 (+https://github.com/Esystimsesys/recipe-box)'

/** 公開 DNS 名以外を取りに行かせない。 */
const PRIVATE_HOST_SUFFIXES = ['.local', '.internal', '.localhost', '.home.arpa', '.ts.net']
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/u

type Metadata = { title: string; imageUrl: string; ingredients: string[]; description: string }

const EMPTY: Metadata = { title: '', imageUrl: '', ingredients: [], description: '' }

/**
 * Origin はブラウザ以外からは詐称できるので、これは認証ではなく無料枠を守るための目印。
 * tailnet（*.ts.net）は手元の実機確認用に通す。ホスト名は tailnet の外から引けない。
 */
function isAllowedOrigin(origin: string, env: Env): boolean {
  if (!origin) return false
  const allowed = env.ALLOWED_ORIGINS.split(',').map((value) => value.trim())
  if (allowed.includes(origin)) return true
  try {
    const { protocol, hostname } = new URL(origin)
    return protocol === 'https:' && hostname.endsWith('.ts.net')
  } catch {
    return false
  }
}

/** 許可した参照元にだけ読み取りを許す。空文字は「許可しない」を表す。 */
function corsHeaders(origin: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
  if (origin) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

function jsonResponse(body: unknown, status: number, cacheSeconds = 0): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheSeconds ? `public, max-age=${cacheSeconds}` : 'no-store',
    },
  })
}

/** CORS ヘッダーは要求元ごとに変わるため、キャッシュした応答には後から付け替える。 */
function withCors(response: Response, origin: string): Response {
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(corsHeaders(origin))) headers.set(key, value)
  return new Response(response.body, { status: response.status, headers })
}

/** 取得先として安全に扱える公開 URL だけを通す。 */
function readTarget(raw: string | null): URL {
  if (!raw) throw new Error('url パラメーターが必要です。')
  let target: URL
  try {
    target = new URL(raw)
  } catch {
    throw new Error('URL の形式が正しくありません。')
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    throw new Error('http または https の URL だけ取得できます。')
  }
  if (target.username || target.password) {
    throw new Error('ユーザー名やパスワードを含む URL は取得できません。')
  }
  const hostname = target.hostname.toLowerCase()
  if (!hostname.includes('.') || hostname.endsWith('.')) {
    throw new Error('公開されたホスト名ではありません。')
  }
  if (IPV4.test(hostname) || hostname.includes(':') || hostname.startsWith('[')) {
    throw new Error('IP アドレス宛ては取得できません。')
  }
  if (PRIVATE_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new Error('公開されたホスト名ではありません。')
  }
  return target
}

/** HTMLRewriter に流す前に読み取り量を抑え、CPU 時間と転送量を一定に保つ。 */
function limitBytes(body: ReadableStream<Uint8Array>, max: number): ReadableStream<Uint8Array> {
  let seen = 0
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (seen >= max) return
        const remaining = max - seen
        if (chunk.byteLength <= remaining) {
          seen += chunk.byteLength
          controller.enqueue(chunk)
          return
        }
        seen = max
        controller.enqueue(chunk.subarray(0, remaining))
        controller.terminate()
      },
    }),
  )
}

function cleanText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim().slice(0, MAX_TITLE_LENGTH)
}

const SITE_NAME_SEPARATORS = '|｜:：\\-–—・'

/**
 * 「レシピ名 | クラシル」のような末尾のサイト名だけを落とす。推測はしない。
 * og:site_name にキャッチコピーが続くサイトがあるため、区切りまでの先頭部分でも照合する。
 */
function withoutSiteName(title: string, siteName: string): string {
  if (!siteName) return title
  const candidates = [siteName, siteName.split(new RegExp(`[${SITE_NAME_SEPARATORS}]`, 'u'))[0]]
  for (const candidate of candidates) {
    const name = candidate.trim()
    if (!name) continue
    const suffix = new RegExp(
      `\\s*[${SITE_NAME_SEPARATORS}]\\s*${name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`,
      'u',
    )
    const trimmed = title.replace(suffix, '').trim()
    if (trimmed && trimmed !== title) return trimmed
  }
  return title
}

function httpsImageUrl(value: string, baseUrl: string): string {
  if (!value) return ''
  try {
    const parsed = new URL(value, baseUrl)
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password
      ? parsed.toString()
      : ''
  } catch {
    return ''
  }
}

async function readMetadata(target: URL): Promise<Metadata> {
  const youtube = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(
    target.hostname,
  )
  const social = ['x.com', 'twitter.com', 'instagram.com', 'tiktok.com'].some(
    (host) => target.hostname === host || target.hostname.endsWith(`.${host}`),
  )
  const response = await fetch(target.toString(), {
    method: 'GET',
    redirect: 'follow',
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'ja,en;q=0.8',
      'User-Agent': USER_AGENT,
    },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    cf: { cacheTtl: UPSTREAM_CACHE_SECONDS },
  })
  if (!response.ok || !response.body) return EMPTY
  if (!(response.headers.get('content-type') ?? '').includes('text/html')) return EMPTY

  let ogTitle = ''
  let twitterTitle = ''
  let documentTitle = ''
  let siteName = ''
  let ogImage = ''
  let twitterImage = ''
  let description = ''
  let metaDescription = ''
  let structured = ''
  let ingredients: string[] = []
  let inStructured = false
  let inVideoScript = false

  const parsed = new HTMLRewriter()
    .on('meta', {
      element(element) {
        const key = (element.getAttribute('property') ?? element.getAttribute('name') ?? '')
          .trim()
          .toLowerCase()
        const content = element.getAttribute('content') ?? ''
        if (!content) return
        if (key === 'og:title') ogTitle ||= content
        else if (key === 'twitter:title') twitterTitle ||= content
        else if (key === 'og:site_name') siteName ||= content
        else if (key === 'og:image' || key === 'og:image:secure_url') ogImage ||= content
        else if (key === 'twitter:image') twitterImage ||= content
        else if (youtube && (key === 'description' || key === 'og:description'))
          metaDescription ||= content
      },
    })
    .on('script', {
      element(element) {
        inStructured =
          !youtube &&
          !social &&
          element.getAttribute('type')?.toLowerCase().startsWith('application/ld+json') === true
        inVideoScript = youtube
        structured = ''
      },
      text(chunk) {
        if (inStructured && structured.length < MAX_HTML_BYTES) structured += chunk.text
        if (inVideoScript && !description && structured.length < MAX_HTML_BYTES)
          structured += chunk.text
        if (chunk.lastInTextNode) {
          if (inStructured) {
            try {
              ingredients.push(...recipeIngredients(JSON.parse(structured)))
            } catch {
              // Ignore malformed structured data.
            }
          }
          if (inVideoScript) description = youtubeDescription(structured) || description
          inStructured = false
          inVideoScript = false
        }
      },
    })
    .on('title', {
      text(chunk) {
        documentTitle += chunk.text
      },
    })
    .transform(new Response(limitBytes(response.body, youtube ? 2 * 1024 * 1024 : MAX_HTML_BYTES)))

  // 本文は保存せず読み捨てる。ここで初めてページ全体が流れる。
  await parsed.body?.pipeTo(new WritableStream())

  const title = cleanText(ogTitle || twitterTitle || documentTitle)
  return {
    title: withoutSiteName(title, cleanText(siteName)),
    imageUrl: httpsImageUrl(ogImage || twitterImage, response.url || target.toString()),
    ingredients: [...new Set(ingredients)].slice(0, 200),
    description: youtube ? (description || metaDescription).slice(0, MAX_SEARCH_TEXT_LENGTH) : '',
  }
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const requestOrigin = request.headers.get('Origin') ?? ''
    const origin = isAllowedOrigin(requestOrigin, env) ? requestOrigin : ''

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: origin ? 204 : 403, headers: corsHeaders(origin) })
    }
    if (request.method !== 'GET') {
      return withCors(jsonResponse({ error: 'GET だけ受け付けます。' }, 405), origin)
    }
    if (!origin) {
      return withCors(jsonResponse({ error: '許可されていない参照元です。' }, 403), origin)
    }

    let target: URL
    try {
      target = readTarget(new URL(request.url).searchParams.get('url'))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'URL を読み取れませんでした。'
      return withCors(jsonResponse({ error: message }, 400), origin)
    }

    const cache = caches.default
    const cacheKey = new Request(
      `https://link-metadata.hitosaji.invalid/v${RESULT_CACHE_VERSION}?url=${encodeURIComponent(target.toString())}`,
    )
    const cached = await cache.match(cacheKey)
    if (cached) return withCors(cached, origin)

    let metadata: Metadata
    try {
      metadata = await readMetadata(target)
    } catch (error) {
      // 取得できなくても URL の保存は続けられるため、空の結果として返す。
      console.log(
        JSON.stringify({
          event: 'upstream_failed',
          host: target.hostname,
          message: error instanceof Error ? error.message : String(error),
        }),
      )
      return withCors(jsonResponse(EMPTY, 200), origin)
    }

    const response = jsonResponse(metadata, 200, RESULT_CACHE_SECONDS)
    if (metadata.title || metadata.imageUrl) {
      ctx.waitUntil(cache.put(cacheKey, response.clone()))
    }
    return withCors(response, origin)
  },
} satisfies ExportedHandler<Env>
