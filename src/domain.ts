export type Photo = {
  id: string
  dataUrl: string
  name: string
}

export type CookLog = {
  id: string
  date: string
  note: string
  photos: Photo[]
}

export type Recipe = {
  id: string
  kind: 'link' | 'paper'
  title: string
  titleSource?: 'auto' | 'manual'
  url: string
  ingredients: string[]
  searchText?: string
  contentSource?: 'auto' | 'manual'
  note: string
  source: string
  photos: Photo[]
  paperPhotos: Photo[]
  logs: CookLog[]
  favorite: boolean
  cooked: boolean
  imageUrl?: string
  createdAt: string
  updatedAt: string
}

export type RecipeBackup = {
  format: 'recipe-box'
  version: 2
  exportedAt: string
  recipes: Recipe[]
}

const MAX_FILE_BYTES = 15 * 1024 * 1024
const MAX_PHOTOS_PER_GROUP = 12
const MAX_RECIPES = 2_000
const MAX_LOGS_PER_RECIPE = 2_000
const MAX_INGREDIENTS = 200
const MAX_DATA_URL_BYTES = 15 * 1024 * 1024

export const RECIPE_LIMITS = {
  id: 128,
  title: 300,
  url: 4_096,
  ingredient: 120,
  note: 30_000,
  searchText: 30_000,
  source: 300,
  photoName: 255,
} as const

const INGREDIENT_ALIASES = new Map<string, string>([
  ['たまねぎ', '玉ねぎ'],
  ['タマネギ', '玉ねぎ'],
  ['玉葱', '玉ねぎ'],
  ['じゃが芋', 'じゃがいも'],
  ['ジャガイモ', 'じゃがいも'],
  ['馬鈴薯', 'じゃがいも'],
  ['ニンジン', 'にんじん'],
  ['人参', 'にんじん'],
  ['ダイコン', '大根'],
  ['だいこん', '大根'],
])

const TRAILING_SHARE_PUNCTUATION = /[。、「」『』【】（）［］｛｝〈〉《》！？；：、，．,.!?)\]}]+$/u
const HTTP_URL = /https?:\/\/[^\s<>"'`]+/iu
const BARE_HOST_URL =
  /(?:^|[\s（(\[「『【])((?:www\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{1,5})?(?:[/?#][^\s<>"'`]*)?)/iu

export function newId(): string {
  return globalThis.crypto.randomUUID()
}

function trimSharedUrl(value: string): string {
  return value.replace(TRAILING_SHARE_PUNCTUATION, '')
}

export function normalizeUrl(input: string): string {
  // URLのクエリ値は全角・半角にも意味があり得るため、URL自体にはNFKCをかけない。
  const value = input.trim()
  if (!value) throw new Error('URLを入力してください。')

  const httpMatch = value.match(HTTP_URL)
  let candidate = httpMatch?.[0]

  if (!candidate) {
    if (/[a-z][a-z0-9+.-]*:\/\//iu.test(value) || /^[a-z][a-z0-9+.-]*:/iu.test(value)) {
      throw new Error('http または https のURLだけ登録できます。')
    }
    candidate = value.match(BARE_HOST_URL)?.[1]
    if (candidate) candidate = `https://${candidate}`
  }

  if (!candidate) throw new Error('URLを見つけられませんでした。')
  // A standalone URL is authoritative; punctuation and fragments can be meaningful.
  if (candidate !== value && `https://${value}` !== candidate) candidate = trimSharedUrl(candidate)

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    throw new Error('URLの形式が正しくありません。')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('http または https のURLだけ登録できます。')
  }
  if (parsed.username || parsed.password) {
    throw new Error('ユーザー名やパスワードを含むURLは登録できません。')
  }
  if (!parsed.hostname) throw new Error('URLのホスト名がありません。')

  return parsed.toString()
}

/**
 * 重複判定にだけ使う見分け方。計測用のパラメーターは同じレシピを別物にしてしまうため落とす。
 * 保存するURLは元のまま残す（クエリやフラグメントに意味があり得るため）。
 */
const TRACKING_PARAMS = [
  'fbclid',
  'gclid',
  'dclid',
  'msclkid',
  'yclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  'ref',
  'ref_src',
  'ref_url',
  '_ga',
]

export function duplicateKey(url: string): string {
  try {
    const parsed = new URL(url)
    for (const key of [...parsed.searchParams.keys()]) {
      const name = key.toLowerCase()
      if (name.startsWith('utm_') || TRACKING_PARAMS.includes(name)) parsed.searchParams.delete(key)
    }
    parsed.searchParams.sort()
    return parsed.toString()
  } catch {
    return url
  }
}

export function sourceLabel(url: string): string {
  const hostname = new URL(normalizeUrl(url)).hostname.toLowerCase().replace(/^www\./u, '')
  if (
    hostname === 'x.com' ||
    hostname.endsWith('.x.com') ||
    hostname === 'twitter.com' ||
    hostname.endsWith('.twitter.com')
  )
    return 'X'
  if (hostname === 'instagram.com' || hostname.endsWith('.instagram.com')) return 'Instagram'
  if (hostname === 'tiktok.com' || hostname.endsWith('.tiktok.com')) return 'TikTok'
  if (hostname === 'youtu.be' || hostname === 'youtube.com' || hostname.endsWith('.youtube.com'))
    return 'YouTube'
  if (hostname === 'cookpad.com' || hostname.endsWith('.cookpad.com')) return 'Cookpad'
  if (hostname === 'kurashiru.com' || hostname.endsWith('.kurashiru.com')) return 'クラシル'
  return hostname
}

/**
 * 自動で取り込む「材料など」の種類。
 * YouTubeの概要欄は作り方を含むことが多いため取り込まない（手入力はできる）。
 */
export function sourceContentKind(url: string): 'ingredients' | 'none' {
  const hostname = new URL(normalizeUrl(url)).hostname.toLowerCase().replace(/^www\./u, '')
  if (hostname === 'youtu.be' || hostname === 'youtube.com' || hostname.endsWith('.youtube.com'))
    return 'none'
  const socialHosts = [
    'x.com',
    'twitter.com',
    'instagram.com',
    'tiktok.com',
    'facebook.com',
    'threads.net',
    'pinterest.com',
    'bsky.app',
    'reddit.com',
    'snapchat.com',
  ]
  if (socialHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`))) return 'none'
  return 'ingredients'
}

export function normalizeIngredient(input: string): string {
  const normalized = input.normalize('NFKC').trim().toLocaleLowerCase('ja-JP')
  return INGREDIENT_ALIASES.get(normalized) ?? normalized
}

/**
 * 「材料など」の本文。入力した文章をそのまま searchText に保存する。
 * 以前の版は区切って ingredients に保存していたため、残っている場合は読点でつなげて見せる。
 */
export function recipeContent(recipe: Recipe): string {
  return [recipe.ingredients.join('、'), recipe.searchText || ''].filter(Boolean).join('\n')
}

function normalizeSearchText(value: string): string {
  let text = value.normalize('NFKC').trim().toLocaleLowerCase('ja-JP')
  // 文章の中の表記ゆれも同じ語として探せるようにする。
  for (const [alias, name] of INGREDIENT_ALIASES) text = text.replaceAll(alias, name)
  return text.replace(/[ァ-ヶ]/gu, (kana) => String.fromCharCode(kana.charCodeAt(0) - 0x60))
}

export function matchesRecipe(recipe: Recipe, query: string, ingredients: string[] = []): boolean {
  const terms = query
    .split(/[\s,，、]+/u)
    .map(normalizeSearchText)
    .filter(Boolean)
  const searchableValues = [
    recipe.title,
    recipe.note,
    recipe.source,
    recipe.searchText || '',
    ...recipe.ingredients,
  ].map(normalizeSearchText)
  if (!terms.every((term) => searchableValues.some((value) => value.includes(term)))) return false

  const content = normalizeSearchText(recipeContent(recipe))
  return ingredients
    .map(normalizeSearchText)
    .filter(Boolean)
    .every((ingredient) => content.includes(ingredient))
}

type DecodedImage = {
  source: CanvasImageSource
  width: number
  height: number
  close?: () => void
}

async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      }
    } catch {
      // Safariの対応範囲を含め、下のimg要素でもう一度デコードを試す。
    }
  }

  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    throw new Error('この環境では画像を読み込めません。')
  }

  const objectUrl = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.decoding = 'async'
    image.src = objectUrl
    await image.decode()
    return { source: image, width: image.naturalWidth, height: image.naturalHeight }
  } catch {
    throw new Error(`「${file.name}」を画像として読み込めませんでした。`)
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

function resizeDimensions(width: number, height: number, maxSide: number): [number, number] {
  if (width <= 0 || height <= 0) throw new Error('画像の大きさを確認できませんでした。')
  const scale = Math.min(1, maxSide / Math.max(width, height))
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))]
}

export async function readPhotos(files: File[], kind: 'dish' | 'paper'): Promise<Photo[]> {
  if (files.length > MAX_PHOTOS_PER_GROUP) {
    throw new Error(`写真は一度に${MAX_PHOTOS_PER_GROUP}枚まで選べます。`)
  }

  const allowedTypes = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
  ])
  for (const file of files) {
    if (!allowedTypes.has(file.type.toLowerCase())) {
      const isHeic = /\.hei[cf]$/iu.test(file.name) || /hei[cf]/iu.test(file.type)
      throw new Error(
        isHeic
          ? `「${file.name}」はHEIC形式です。端末でJPEGまたはPNGに変換してから選んでください。`
          : `「${file.name}」は対応していない画像形式です。JPEG、PNG、WebPを選んでください。`,
      )
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new Error(`「${file.name}」は15MBを超えています。小さい画像を選んでください。`)
    }
  }

  if (typeof document === 'undefined') throw new Error('この環境では画像を処理できません。')
  const maxSide = kind === 'paper' ? 2_600 : 1_800
  const photos: Photo[] = []

  for (const file of files) {
    let decoded: DecodedImage
    try {
      decoded = await decodeImage(file)
    } catch (error) {
      if (/hei[cf]/iu.test(file.type) || /\.hei[cf]$/iu.test(file.name))
        throw new Error(
          `「${file.name}」はこのブラウザでは読み込めないHEIC形式です。JPEGまたはPNGに変換してから選んでください。`,
        )
      throw error
    }
    try {
      const [width, height] = resizeDimensions(decoded.width, decoded.height, maxSide)
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('画像を変換できませんでした。')
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, width, height)
      context.drawImage(decoded.source, 0, 0, width, height)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.88)
      if (!dataUrl.startsWith('data:image/jpeg;base64,')) {
        throw new Error(`「${file.name}」をJPEGに変換できませんでした。`)
      }
      photos.push({ id: newId(), dataUrl, name: file.name })
    } finally {
      decoded.close?.()
    }
  }

  return photos
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  const allowedSet = new Set(allowed)
  const unknown = Object.keys(value).find((key) => !allowedSet.has(key))
  if (unknown) throw new Error(`${path}.${unknown} は未対応の項目です。`)
}

function readString(value: unknown, path: string, max: number, allowEmpty = true): string {
  if (typeof value !== 'string') throw new Error(`${path} は文字列である必要があります。`)
  if (!allowEmpty && !value.trim()) throw new Error(`${path} は空にできません。`)
  if (value.length > max) throw new Error(`${path} が長すぎます。`)
  return value
}

function readBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${path} は真偽値である必要があります。`)
  return value
}

function readContentSource(value: unknown, path: string): 'auto' | 'manual' {
  if (value !== 'auto' && value !== 'manual') throw new Error(`${path} が正しくありません。`)
  return value
}

function readImageUrl(value: unknown, path: string): string {
  if (value === undefined || value === '') return ''
  const raw = readString(value, path, RECIPE_LIMITS.url, false).trim()
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error(`${path} は正しい画像URLではありません。`)
  }
  if (parsed.protocol !== 'https:') throw new Error(`${path} はHTTPSのURLである必要があります。`)
  if (parsed.username || parsed.password) {
    throw new Error(`${path} にユーザー名やパスワードは指定できません。`)
  }
  if (!parsed.hostname) throw new Error(`${path} にホスト名がありません。`)
  return parsed.toString()
}

function readIsoDate(value: unknown, path: string): string {
  const raw = readString(value, path, 64, false)
  const parts =
    /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.exec(raw)
  if (!parts) throw new Error(`${path} は正しいISO日時ではありません。`)
  const calendarDate = new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])))
  if (
    calendarDate.getUTCFullYear() !== Number(parts[1]) ||
    calendarDate.getUTCMonth() !== Number(parts[2]) - 1 ||
    calendarDate.getUTCDate() !== Number(parts[3])
  )
    throw new Error(`${path} は正しい日時ではありません。`)
  const timestamp = Date.parse(raw)
  if (!Number.isFinite(timestamp)) throw new Error(`${path} は正しい日時ではありません。`)
  return new Date(timestamp).toISOString()
}

function readLogDate(value: unknown, path: string): string {
  const raw = readString(value, path, 64, false)
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(raw)
  if (dateOnly) {
    const year = Number(dateOnly[1])
    const month = Number(dateOnly[2])
    const day = Number(dateOnly[3])
    const date = new Date(Date.UTC(year, month - 1, day))
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      throw new Error(`${path} は正しい日付ではありません。`)
    }
    return raw
  }
  return readIsoDate(raw, path).slice(0, 10)
}

function readId(value: unknown, path: string): string {
  return readString(value, path, RECIPE_LIMITS.id, false).trim()
}

function assertUniqueIds(values: { id: string }[], path: string): void {
  const ids = new Set<string>()
  for (const value of values) {
    if (ids.has(value.id)) throw new Error(`${path} に重複したID「${value.id}」があります。`)
    ids.add(value.id)
  }
}

function validateDataUrl(value: unknown, path: string): string {
  const dataUrl = readString(value, path, Math.ceil((MAX_DATA_URL_BYTES * 4) / 3) + 100, false)
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/u.exec(dataUrl)
  if (!match || match[2].length % 4 !== 0) {
    throw new Error(`${path} はJPEG、PNG、WebPの画像データである必要があります。`)
  }
  const padding = match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0
  const bytes = (match[2].length * 3) / 4 - padding
  if (bytes > MAX_DATA_URL_BYTES) throw new Error(`${path} は15MBを超えています。`)
  return dataUrl
}

function readPhoto(value: unknown, path: string): Photo {
  if (!isRecord(value)) throw new Error(`${path} は写真データである必要があります。`)
  assertKeys(value, ['id', 'dataUrl', 'name'], path)
  return {
    id: readId(value.id, `${path}.id`),
    dataUrl: validateDataUrl(value.dataUrl, `${path}.dataUrl`),
    name: readString(value.name, `${path}.name`, RECIPE_LIMITS.photoName),
  }
}

function readPhotosArray(value: unknown, path: string): Photo[] {
  if (!Array.isArray(value)) throw new Error(`${path} は配列である必要があります。`)
  if (value.length > MAX_PHOTOS_PER_GROUP)
    throw new Error(`${path} は${MAX_PHOTOS_PER_GROUP}枚までです。`)
  const photos = value.map((photo, index) => readPhoto(photo, `${path}[${index}]`))
  assertUniqueIds(photos, path)
  return photos
}

function readLog(value: unknown, path: string): CookLog {
  if (!isRecord(value)) throw new Error(`${path} は調理記録である必要があります。`)
  assertKeys(value, ['id', 'date', 'note', 'photos'], path)
  return {
    id: readId(value.id, `${path}.id`),
    date: readLogDate(value.date, `${path}.date`),
    note: readString(value.note, `${path}.note`, RECIPE_LIMITS.note),
    photos: readPhotosArray(value.photos, `${path}.photos`),
  }
}

function readRecipe(value: unknown, path: string, version: 1 | 2): Recipe {
  if (!isRecord(value)) throw new Error(`${path} はレシピである必要があります。`)
  assertKeys(
    value,
    [
      'id',
      'kind',
      'title',
      'url',
      'ingredients',
      'note',
      'source',
      'photos',
      'paperPhotos',
      'logs',
      'favorite',
      // 旧バージョンが書いた項目。読み飛ばすだけで、新しいバックアップには含めない。
      'wantToCook',
      ...(version === 2
        ? ['cooked', 'imageUrl', 'searchText', 'titleSource', 'contentSource']
        : []),
      'createdAt',
      'updatedAt',
    ],
    path,
  )

  if (value.kind !== 'link' && value.kind !== 'paper')
    throw new Error(`${path}.kind が正しくありません。`)
  if (!Array.isArray(value.ingredients))
    throw new Error(`${path}.ingredients は配列である必要があります。`)
  if (value.ingredients.length > MAX_INGREDIENTS)
    throw new Error(`${path}.ingredients が多すぎます。`)
  const ingredients = value.ingredients.map((ingredient, index) => {
    const normalized = normalizeIngredient(
      readString(ingredient, `${path}.ingredients[${index}]`, RECIPE_LIMITS.ingredient, false),
    )
    if (!normalized) throw new Error(`${path}.ingredients[${index}] は空にできません。`)
    return normalized
  })
  if (new Set(ingredients).size !== ingredients.length)
    throw new Error(`${path}.ingredients に重複があります。`)

  const rawUrl = readString(value.url, `${path}.url`, RECIPE_LIMITS.url, value.kind === 'paper')
  const url = rawUrl ? normalizeUrl(rawUrl) : ''
  if (value.kind === 'link' && !url) throw new Error(`${path}.url は空にできません。`)

  if (!Array.isArray(value.logs)) throw new Error(`${path}.logs は配列である必要があります。`)
  if (value.logs.length > MAX_LOGS_PER_RECIPE) throw new Error(`${path}.logs が多すぎます。`)
  const logs = value.logs.map((log, index) => readLog(log, `${path}.logs[${index}]`))
  assertUniqueIds(logs, `${path}.logs`)

  return {
    id: readId(value.id, `${path}.id`),
    kind: value.kind,
    title: readString(value.title, `${path}.title`, RECIPE_LIMITS.title),
    ...(version === 2 && 'titleSource' in value
      ? { titleSource: readContentSource(value.titleSource, `${path}.titleSource`) }
      : {}),
    url,
    ingredients,
    ...(version === 2 && 'searchText' in value
      ? { searchText: readString(value.searchText, `${path}.searchText`, RECIPE_LIMITS.searchText) }
      : {}),
    ...(version === 2 && 'contentSource' in value
      ? { contentSource: readContentSource(value.contentSource, `${path}.contentSource`) }
      : {}),
    note: readString(value.note, `${path}.note`, RECIPE_LIMITS.note),
    source: readString(value.source, `${path}.source`, RECIPE_LIMITS.source),
    photos: readPhotosArray(value.photos, `${path}.photos`),
    paperPhotos: readPhotosArray(value.paperPhotos, `${path}.paperPhotos`),
    logs,
    favorite: readBoolean(value.favorite, `${path}.favorite`),
    cooked: version === 1 ? logs.length > 0 : readBoolean(value.cooked, `${path}.cooked`),
    imageUrl: version === 1 ? '' : readImageUrl(value.imageUrl, `${path}.imageUrl`),
    createdAt: readIsoDate(value.createdAt, `${path}.createdAt`),
    updatedAt: readIsoDate(value.updatedAt, `${path}.updatedAt`),
  }
}

export function parseBackup(input: unknown): Recipe[] {
  if (!isRecord(input)) throw new Error('バックアップの形式が正しくありません。')
  assertKeys(input, ['format', 'version', 'exportedAt', 'recipes'], 'backup')
  if (input.format !== 'recipe-box' || (input.version !== 1 && input.version !== 2)) {
    throw new Error('対応していないバックアップ形式です。')
  }
  if ('exportedAt' in input) readIsoDate(input.exportedAt, 'backup.exportedAt')
  if (!Array.isArray(input.recipes)) throw new Error('backup.recipes は配列である必要があります。')
  if (input.recipes.length > MAX_RECIPES)
    throw new Error(`レシピは${MAX_RECIPES}件まで取り込めます。`)

  const recipes = input.recipes.map((recipe, index) =>
    readRecipe(recipe, `backup.recipes[${index}]`, input.version as 1 | 2),
  )
  assertUniqueIds(recipes, 'backup.recipes')
  return recipes
}

export function exportBackup(recipes: Recipe[]): RecipeBackup {
  return {
    format: 'recipe-box',
    version: 2,
    exportedAt: new Date().toISOString(),
    recipes: recipes.map((recipe) => ({ ...recipe, imageUrl: recipe.imageUrl ?? '' })),
  }
}

/** Validate one record read from IndexedDB and fill fields added after v1. */
export function normalizeStoredRecipe(input: unknown): Recipe {
  if (!isRecord(input)) throw new Error('保存されたレシピの形式が正しくありません。')
  const version = 'cooked' in input ? 2 : 1
  const recipe = parseBackup({ format: 'recipe-box', version, recipes: [input] })[0]
  // Optimistic concurrency compares this exact stored token. Migration must not rewrite it.
  recipe.updatedAt = readString(input.updatedAt, 'recipe.updatedAt', 64, false)
  // 出典名は版ごとに増えるため、リンクはURLから引き直す。手動登録の出典は利用者の入力なので触らない。
  if (recipe.kind === 'link' && recipe.url) recipe.source = sourceLabel(recipe.url)
  return recipe
}
