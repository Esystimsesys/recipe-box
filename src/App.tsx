import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  BookOpen,
  Plus,
  Search,
  Heart,
  Settings,
  Share2,
  Smartphone,
  ArrowUpRight,
  X,
  Link as LinkIcon,
  FileImage,
  Utensils,
  Download,
  Upload,
  ChevronRight,
  Trash2,
  Pencil,
  Check,
  ImagePlus,
  Leaf,
  HardDrive,
  RefreshCw,
  CookingPot,
  Grid2X2,
} from 'lucide-react'
import {
  RECIPE_LIMITS,
  duplicateKey,
  exportBackup,
  matchesRecipe,
  newId,
  normalizeUrl,
  parseBackup,
  parseIngredients,
  readPhotos,
  sourceContentKind,
  sourceLabel,
  type Photo,
  type Recipe,
} from './domain'
import {
  directPreviewUrl,
  fetchLinkMetadata,
  hasDynamicPreview,
  instagramEmbedUrl,
  previewUrlExpiresSoon,
  type LinkMetadata,
} from './preview'
import { friendlyError, listRecipes, removeRecipe, restoreRecipes, saveRecipe } from './store'
import { takeSharedLink, type SharedLink } from './shared-link'
import { version } from '../package.json'
import { isGenericYouTubeDescription } from '../worker/src/extract'

type Page = 'recipes' | 'settings'
type RecipeLayout = 'small' | 'medium' | 'large' | 'list'
type RecipeOrder = 'added' | 'updated' | 'title'
type RefreshProgress = {
  done: number
  total: number
  updated: number
  failed: number
  finished: boolean
}
function needsSourceContent(recipe: Recipe): boolean {
  if (recipe.kind !== 'link' || !recipe.url) return false
  const sourceKind = sourceContentKind(recipe.url)
  if (sourceKind === 'description')
    return (
      !recipe.searchText?.trim() ||
      (recipe.contentSource !== 'manual' && isGenericYouTubeDescription(recipe.searchText || ''))
    )
  if (sourceKind === 'ingredients') return recipe.ingredients.length === 0
  return false
}
function canRefreshSourceContent(recipe: Recipe): boolean {
  return (
    needsSourceContent(recipe) ||
    (recipe.kind === 'link' &&
      !!recipe.url &&
      recipe.contentSource === 'auto' &&
      sourceContentKind(recipe.url) !== 'none')
  )
}
const ORDER_LABELS: Record<RecipeOrder, string> = {
  added: '最近追加した順',
  updated: '最近更新した順',
  title: '名前順',
}
const IOS_SHORTCUT_URL = 'https://www.icloud.com/shortcuts/f78f1b3c4d8749bfa6b7e631159f7ae3'
/** 共有の手順は端末で違うため、当てはまるものだけを出す。判別できなければ両方を並べる。 */
function sharePlatform(): 'ios' | 'android' | 'unknown' {
  const agent = navigator.userAgent
  if (/iPhone|iPad|iPod/u.test(agent)) return 'ios'
  // iPadOSはMacを名乗るため、タッチの有無で見分ける。
  if (/Macintosh/u.test(agent) && navigator.maxTouchPoints > 1) return 'ios'
  if (/Android/u.test(agent)) return 'android'
  return 'unknown'
}
/** ホーム画面版として開いているか。共有の手順は開き方でも変わる。 */
function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}
type ModalState =
  | { type: 'recipe'; recipe?: Recipe; shared?: SharedLink }
  | { type: 'detail'; id: string }
  | { type: 'restore'; recipes: Recipe[] }
  | null
const today = () => {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const dateLabel = (date: string) =>
  new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' }).format(
    new Date(`${date.slice(0, 10)}T12:00:00`),
  )
const titleOf = (recipe: Recipe) =>
  recipe.title || (recipe.kind === 'paper' ? '手動登録のレシピ' : `${recipe.source}のレシピ`)
const changed = (recipe: Recipe): Recipe => ({
  ...recipe,
  updatedAt: new Date(Math.max(Date.now(), Date.parse(recipe.updatedAt) + 1)).toISOString(),
})

function Dialog({
  title,
  children,
  onClose,
  busy = false,
  className = '',
  focusTitle = false,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  busy?: boolean
  className?: string
  focusTitle?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    ref.current?.showModal()
    if (focusTitle) titleRef.current?.focus({ preventScroll: true })
    return () => ref.current?.close()
  }, [focusTitle])
  return (
    <dialog
      ref={ref}
      className={`app-dialog ${className}`}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onClose()
      }}
    >
      <header className="dialog-header">
        <h2 ref={titleRef} tabIndex={focusTitle ? -1 : undefined}>
          {title}
        </h2>
        <button
          className="icon-button"
          type="button"
          aria-label="閉じる"
          disabled={busy}
          onClick={onClose}
        >
          <X />
        </button>
      </header>
      {children}
    </dialog>
  )
}

function PhotoInput({
  photos,
  onChange,
  kind,
  label,
  onBusy,
}: {
  photos: Photo[]
  onChange: (photos: Photo[]) => void
  kind: 'dish' | 'paper'
  label: string
  onBusy?: (busy: boolean) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const full = photos.length >= 12
  return (
    <div className="photo-input">
      <span className="field-label">{label}</span>
      <div className="photo-previews">
        {photos.map((photo, index) => (
          <div className="photo-preview" key={photo.id}>
            <img src={photo.dataUrl} alt={`${label} ${index + 1}`} />
            <button
              type="button"
              className="icon-button"
              aria-label={`${label} ${index + 1}を削除`}
              disabled={busy}
              onClick={() => onChange(photos.filter((item) => item.id !== photo.id))}
            >
              <X size={16} />
            </button>
            {kind === 'dish' && index > 0 && (
              <button
                className="cover-button"
                type="button"
                disabled={busy}
                onClick={() => onChange([photo, ...photos.filter((item) => item.id !== photo.id)])}
              >
                表紙にする
              </button>
            )}
          </div>
        ))}
      </div>
      <label
        className={`secondary upload-label ${busy ? 'is-disabled is-busy' : full ? 'is-disabled' : ''}`}
      >
        <ImagePlus size={18} />
        {busy ? '写真を準備中…' : full ? '写真は12枚までです' : '写真を選ぶ・撮る'}
        <input
          type="file"
          accept="image/*"
          multiple
          disabled={busy || full}
          aria-label={label}
          onChange={async (event) => {
            const files = Array.from(event.target.files || [])
            event.target.value = ''
            if (!files.length) return
            setError('')
            setBusy(true)
            onBusy?.(true)
            try {
              if (files.length + photos.length > 12) throw new Error('写真は12枚まで追加できます。')
              onChange([...photos, ...(await readPhotos(files, kind))])
            } catch (error) {
              setError(friendlyError(error))
            } finally {
              setBusy(false)
              onBusy?.(false)
            }
          }}
        />
      </label>
      <p className="fineprint">
        1枚15MBまで・12枚まで。
        {kind === 'paper' ? '画像を複数枚追加できます。' : '先頭の写真を表紙にします。'}
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  )
}

function RecipeForm({
  initial,
  shared,
  recipes,
  onSave,
  onClose,
  onOpen,
}: {
  initial?: Recipe
  shared?: SharedLink
  recipes: Recipe[]
  onSave: (recipe: Recipe, previous?: string) => Promise<void>
  onClose: () => void
  onOpen: (id: string) => void
}) {
  const [kind, setKind] = useState<'link' | 'paper'>(initial?.kind || 'link')
  const [title, setTitle] = useState(initial?.title || shared?.title || '')
  const [url, setUrl] = useState(initial?.url || shared?.url || '')
  const [ingredients, setIngredients] = useState(initial?.ingredients.join('、') || '')
  const [searchText, setSearchText] = useState(initial?.searchText || '')
  const [note, setNote] = useState(initial?.note || '')
  const [source, setSource] = useState(initial?.source || '')
  const [photos, setPhotos] = useState<Photo[]>(initial?.photos || [])
  const [paperPhotos, setPaperPhotos] = useState<Photo[]>(initial?.paperPhotos || [])
  const [busy, setBusy] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [paperBusy, setPaperBusy] = useState(false)
  const [error, setError] = useState('')
  const [duplicate, setDuplicate] = useState<Recipe>()
  const [lookup, setLookup] = useState<{ url: string; data: LinkMetadata }>()
  const [looking, setLooking] = useState(false)
  const lookupFor = useRef('')
  const lookupGeneration = useRef(0)
  const automaticTitle = useRef('')
  const automaticContent = useRef('')
  const titleEdited = useRef(false)
  const contentEdited = useRef(false)
  let isYouTubeInput = false
  if (kind === 'link' && url) {
    try {
      isYouTubeInput = sourceLabel(normalizeUrl(url)) === 'YouTube'
    } catch {
      // Keep the ordinary field while the URL is incomplete.
    }
  }
  function resetLookup() {
    lookupGeneration.current++
    lookupFor.current = ''
    setLookup(undefined)
    setLooking(false)
    const previousTitle = automaticTitle.current
    setTitle((current) => (current === previousTitle ? '' : current))
    automaticTitle.current = ''
    const previousContent = automaticContent.current
    if (previousContent) {
      setIngredients((current) => (current === previousContent ? '' : current))
      setSearchText((current) => (current === previousContent ? '' : current))
    }
    automaticContent.current = ''
  }
  const pending = busy || photoBusy || paperBusy

  // URLを入れた時点でタイトルを調べ、保存時に待たせない。結果はフォームに出して直せるようにする。
  async function lookupMetadata(raw: string, retry = false) {
    let cleanUrl = ''
    try {
      cleanUrl = normalizeUrl(raw)
      if (cleanUrl.length > RECIPE_LIMITS.url) return
    } catch {
      return
    }
    if (!retry && lookupFor.current === cleanUrl) return
    lookupFor.current = cleanUrl
    const generation = ++lookupGeneration.current
    setLooking(true)
    try {
      const data = await loadPreview(cleanUrl, retry)
      if (lookupGeneration.current !== generation) return
      setLookup({ url: cleanUrl, data })
      if (data.title) {
        automaticTitle.current = data.title
        setTitle((current) => current || data.title)
      }
      const content = data.description || data.ingredients?.join('\n') || ''
      if (content) {
        automaticContent.current = content
        if (data.description) setSearchText((current) => current || content)
        else setIngredients((current) => current || content)
      }
    } catch {
      // 取得できなくてもURLは保存できる。
    } finally {
      if (lookupGeneration.current === generation) setLooking(false)
    }
  }

  useEffect(() => {
    if (kind === 'link' && url && !title.trim()) void lookupMetadata(url)
    // 共有URLと、名前なしで保存されたレシピは開いた時点で調べ直す。
  }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setDuplicate(undefined)
    setBusy(true)
    try {
      const cleanUrl = kind === 'link' ? normalizeUrl(url) : ''
      if (kind === 'link' && !cleanUrl) throw new Error('レシピのURLを入力してください。')
      if (cleanUrl.length > RECIPE_LIMITS.url)
        throw new Error(`レシピのURLは${RECIPE_LIMITS.url}文字以内にしてください。`)
      const existing =
        kind === 'link'
          ? recipes.find(
              (recipe) =>
                recipe.id !== initial?.id && duplicateKey(recipe.url) === duplicateKey(cleanUrl),
            )
          : undefined
      if (existing) {
        setDuplicate(existing)
        throw new Error('このURLは登録済みです。')
      }
      if (kind === 'paper' && !title.trim() && !paperPhotos.length)
        throw new Error('レシピ名を入力するか、レシピの画像を追加してください。')
      const now = new Date().toISOString()
      // A changed URL invalidates the stored preview, so fetch it again for the new link.
      const urlChanged = kind === 'link' && !!initial && cleanUrl !== initial.url
      const needsMetadata =
        kind === 'link' &&
        (!title.trim() ||
          !initial?.imageUrl ||
          urlChanged ||
          (!ingredients.trim() && !searchText.trim() && !initial))
      const metadata = !needsMetadata
        ? { title: '', imageUrl: '', ingredients: [], description: '' }
        : lookup?.url === cleanUrl
          ? lookup.data
          : await loadPreview(cleanUrl)
      const isYouTube = kind === 'link' && sourceLabel(cleanUrl) === 'YouTube'
      const fetchedContent = metadata.description || metadata.ingredients?.join('\n') || ''
      const content = (isYouTube ? searchText : ingredients).trim() || fetchedContent
      const savedTitle = title.trim() || metadata.title
      const titleSource =
        kind === 'link' && savedTitle
          ? titleEdited.current
            ? 'manual'
            : initial && !urlChanged && title.trim() === initial.title
              ? initial.titleSource || 'manual'
              : savedTitle === automaticTitle.current || (!title.trim() && !!metadata.title)
                ? 'auto'
                : 'manual'
          : 'manual'
      const existingContent = isYouTube
        ? initial?.searchText || ''
        : initial?.ingredients.join('、') || ''
      const contentSource =
        kind === 'link' && content
          ? contentEdited.current
            ? 'manual'
            : initial && !urlChanged && (isYouTube ? searchText : ingredients) === existingContent
              ? initial.contentSource || 'manual'
              : content === automaticContent.current ||
                  (!(isYouTube ? searchText : ingredients).trim() && !!fetchedContent)
                ? 'auto'
                : 'manual'
          : 'manual'
      const recipe: Recipe = {
        id: initial?.id || newId(),
        kind,
        title: savedTitle,
        titleSource,
        url: cleanUrl,
        ingredients: isYouTube ? initial?.ingredients || [] : parseIngredients(content),
        searchText: isYouTube ? content.slice(0, RECIPE_LIMITS.searchText) : '',
        contentSource,
        note: note.trim(),
        source: kind === 'link' ? sourceLabel(cleanUrl) : source.trim(),
        photos,
        paperPhotos: kind === 'paper' ? paperPhotos : [],
        logs: initial?.logs || [],
        favorite: initial?.favorite || false,
        cooked: initial?.cooked || false,
        imageUrl: urlChanged ? metadata.imageUrl : initial?.imageUrl || metadata.imageUrl,
        createdAt: initial?.createdAt || now,
        updatedAt: now,
      }
      await onSave(
        initial ? changed({ ...recipe, updatedAt: initial.updatedAt }) : recipe,
        initial?.updatedAt,
      )
    } catch (error) {
      setError(friendlyError(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog title={initial ? 'レシピを編集' : '追加'} onClose={onClose} busy={pending}>
      <form className="form-stack" onSubmit={submit}>
        <div className="dialog-body">
          {!initial && (
            <div className="segmented" aria-label="登録方法">
              <button
                type="button"
                className={kind === 'link' ? 'active' : ''}
                disabled={pending}
                onClick={() => setKind('link')}
              >
                <LinkIcon size={18} />
                URLから
              </button>
              <button
                type="button"
                className={kind === 'paper' ? 'active' : ''}
                disabled={pending}
                onClick={() => {
                  resetLookup()
                  setKind('paper')
                }}
              >
                <FileImage size={18} />
                手動で登録
              </button>
            </div>
          )}
          {kind === 'link' ? (
            <div className="field">
              <label htmlFor="recipe-url">
                レシピのURL <span className="required">必須</span>
              </label>
              <input
                id="recipe-url"
                autoFocus
                required
                value={url}
                onChange={(event) => {
                  resetLookup()
                  setUrl(event.target.value)
                  setDuplicate(undefined)
                }}
                onBlur={(event) => void lookupMetadata(event.target.value)}
                placeholder="https://… または共有した文章"
                maxLength={RECIPE_LIMITS.url}
              />
              <small>
                {looking
                  ? 'レシピ名を調べています…'
                  : lookup && !lookup.data.title
                    ? 'レシピ名は取得できませんでした。入力できます。'
                    : 'URLだけでも保存できます。'}
              </small>
              {!title.trim() && (
                <button
                  type="button"
                  className="text-button"
                  disabled={pending || looking || !url.trim()}
                  onClick={() => void lookupMetadata(url, true)}
                >
                  <RefreshCw size={16} />
                  {looking ? 'レシピ名を取得中…' : 'レシピ名を再取得'}
                </button>
              )}
            </div>
          ) : null}
          <details className="optional-fields" open>
            <summary>
              {kind === 'paper' ? 'レシピの内容' : '名前・材料など・写真・メモ（任意）'}
            </summary>
            <div className="field">
              <label htmlFor="recipe-title">
                レシピ名
                {kind === 'paper' && !paperPhotos.length && <span className="required"> 必須</span>}
              </label>
              <input
                id="recipe-title"
                autoFocus={kind === 'paper'}
                required={kind === 'paper' && !paperPhotos.length}
                value={title}
                onChange={(event) => {
                  titleEdited.current = true
                  automaticTitle.current = ''
                  setTitle(event.target.value)
                }}
                placeholder="例：鶏肉と玉ねぎの甘酢炒め"
                maxLength={RECIPE_LIMITS.title}
              />
            </div>
            <div className="field">
              <label htmlFor="recipe-ingredients">材料など</label>
              <textarea
                id="recipe-ingredients"
                rows={2}
                value={isYouTubeInput ? searchText : ingredients}
                onChange={(event) => {
                  contentEdited.current = true
                  automaticContent.current = ''
                  if (isYouTubeInput) setSearchText(event.target.value)
                  else setIngredients(event.target.value)
                }}
                placeholder="材料や概要欄など、検索したい内容"
                maxLength={RECIPE_LIMITS.searchText}
              />
              <small>
                料理サイトは材料、YouTubeは概要欄を自動入力します。作り方は元のページで確認できます。
              </small>
            </div>
            {kind === 'paper' && (
              <div className="field">
                <label htmlFor="recipe-source">出典</label>
                <input
                  id="recipe-source"
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                  placeholder="本・雑誌・SNS・教えてくれた人など"
                  maxLength={RECIPE_LIMITS.source}
                />
              </div>
            )}
            {kind === 'paper' && (
              <PhotoInput
                label="レシピの画像"
                kind="paper"
                photos={paperPhotos}
                onChange={setPaperPhotos}
                onBusy={setPaperBusy}
              />
            )}
            <PhotoInput
              label="料理の写真"
              kind="dish"
              photos={photos}
              onChange={setPhotos}
              onBusy={setPhotoBusy}
            />
            <div className="field">
              <label htmlFor="recipe-note">自分用メモ</label>
              <textarea
                id="recipe-note"
                rows={3}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="おいしく作るコツ、試してみたいアレンジなど"
                maxLength={RECIPE_LIMITS.note}
              />
            </div>
          </details>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {duplicate && (
            <button type="button" className="secondary" onClick={() => onOpen(duplicate.id)}>
              登録済みのレシピを開く
              <ChevronRight size={18} />
            </button>
          )}
        </div>
        <footer className="dialog-footer">
          <button type="button" className="text-button" disabled={pending} onClick={onClose}>
            キャンセル
          </button>
          <button className="primary" disabled={pending}>
            <Check size={18} />
            {pending ? '準備中…' : '保存する'}
          </button>
        </footer>
      </form>
    </Dialog>
  )
}

const previewRequests = new Map<string, Promise<LinkMetadata>>()

function loadPreview(url: string, refresh = false): Promise<LinkMetadata> {
  if (refresh || !previewRequests.has(url)) {
    const request = fetchLinkMetadata(url, refresh)
    previewRequests.set(url, request)
    request.then((metadata) => {
      // 画像だけの代替結果でタイトル取得の失敗を固定しない。
      if (!metadata.title && previewRequests.get(url) === request) previewRequests.delete(url)
    })
  }
  return previewRequests.get(url)!
}

function RecipeImage({ recipe }: { recipe: Recipe }) {
  const embed = !recipe.photos.length ? instagramEmbedUrl(recipe.url) : ''
  const [remoteUrl, setRemoteUrl] = useState('')
  const [failed, setFailed] = useState('')
  const [retried, setRetried] = useState(false)
  const directUrl = directPreviewUrl(recipe.url)
  const storedUrl = recipe.imageUrl || ''
  const src =
    recipe.photos[0]?.dataUrl ||
    remoteUrl ||
    (failed === storedUrl && directUrl ? directUrl : storedUrl || directUrl)

  useEffect(() => {
    if (recipe.photos.length || embed || !hasDynamicPreview(recipe.url)) return
    if (src && !previewUrlExpiresSoon(src)) return
    let active = true
    loadPreview(recipe.url, previewUrlExpiresSoon(src)).then((metadata) => {
      if (active && metadata.imageUrl) setRemoteUrl(metadata.imageUrl)
    })
    return () => {
      active = false
    }
  }, [recipe.url, recipe.photos.length, embed, src])

  if (embed)
    return (
      <iframe
        className="instagram-preview"
        src={embed}
        title={`${titleOf(recipe)}のInstagram投稿`}
        loading="lazy"
        tabIndex={-1}
        aria-hidden="true"
      />
    )
  if (!src || failed === src)
    return (
      <div className={`photo-placeholder ${recipe.kind === 'paper' ? 'paper-placeholder' : ''}`}>
        <span className="placeholder-icon">
          <Utensils size={36} strokeWidth={1.2} />
        </span>
      </div>
    )
  return (
    <img
      src={src}
      loading="lazy"
      className={!recipe.photos.length ? 'source-preview' : undefined}
      alt={titleOf(recipe)}
      onError={() => {
        setFailed(src)
        if (!retried && !recipe.photos.length && hasDynamicPreview(recipe.url)) {
          setRetried(true)
          loadPreview(recipe.url, true).then((metadata) => {
            if (metadata.imageUrl !== src) setRemoteUrl(metadata.imageUrl)
          })
        }
      }}
    />
  )
}

function RecipeDetail({
  recipe,
  onClose,
  onEdit,
  onDelete,
  onToggle,
  onPhoto,
}: {
  recipe: Recipe
  onClose: () => void
  onEdit: () => void
  onDelete: () => Promise<void>
  onToggle: (field: 'favorite' | 'cooked') => Promise<void>
  onPhoto: (photo: Photo) => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function action(fn: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (error) {
      setError(friendlyError(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog title="レシピ" onClose={onClose} busy={busy} focusTitle>
      <div className="dialog-body">
        {recipe.photos[0] && (
          <button
            className="detail-cover"
            aria-label="料理写真を拡大"
            onClick={() => onPhoto(recipe.photos[0])}
          >
            <img src={recipe.photos[0].dataUrl} alt={titleOf(recipe)} />
          </button>
        )}
        {!recipe.photos.length &&
          (recipe.imageUrl ||
            directPreviewUrl(recipe.url) ||
            instagramEmbedUrl(recipe.url) ||
            hasDynamicPreview(recipe.url)) && (
            <a
              className="detail-cover"
              href={recipe.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="元のレシピを画像から開く"
            >
              <RecipeImage recipe={recipe} />
            </a>
          )}
        <div className="detail-head">
          <p className="eyebrow detail-source">
            {recipe.kind === 'paper' ? recipe.source || '手動登録' : recipe.source}
          </p>
          <h2 className="detail-title">{titleOf(recipe)}</h2>
          <p className="detail-meta">
            <span>追加 {dateLabel(recipe.createdAt)}</span>
            {recipe.cooked && <span>作った</span>}
          </p>
        </div>
        {recipe.kind === 'link' && (
          <a
            className="primary external-link"
            href={recipe.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            元のレシピを見る
            <ArrowUpRight size={20} />
          </a>
        )}
        <div className="button-row detail-actions">
          <button
            className={`secondary ${recipe.cooked ? 'is-on' : ''}`}
            disabled={busy}
            aria-pressed={recipe.cooked}
            onClick={() => action(() => onToggle('cooked'))}
          >
            <CookingPot size={17} />
            作った
          </button>
          <button
            className={`secondary ${recipe.favorite ? 'is-on' : ''}`}
            disabled={busy}
            aria-pressed={recipe.favorite}
            onClick={() => action(() => onToggle('favorite'))}
          >
            <Heart size={17} />
            お気に入り
          </button>
          <button className="secondary" onClick={onEdit} disabled={busy}>
            <Pencil size={17} />
            編集
          </button>
        </div>
        {!!recipe.ingredients.length && (
          <section className="detail-section">
            <h3>材料など</h3>
            <div className="ingredient-tags">
              {recipe.ingredients.map((ingredient) => (
                <span key={ingredient}>{ingredient}</span>
              ))}
            </div>
          </section>
        )}
        {recipe.searchText && (
          <section className="detail-section">
            <h3>材料など</h3>
            <p className="preserve-lines">{recipe.searchText}</p>
          </section>
        )}
        {recipe.note && (
          <section className="detail-section">
            <h3>自分用メモ</h3>
            <p className="preserve-lines">{recipe.note}</p>
          </section>
        )}
        {recipe.photos.length > 1 && (
          <section className="detail-section">
            <h3>料理の写真</h3>
            <div className="paper-grid">
              {recipe.photos.map((photo, index) => (
                <button
                  key={photo.id}
                  onClick={() => onPhoto(photo)}
                  aria-label={`料理写真 ${index + 1}を拡大`}
                >
                  <img src={photo.dataUrl} alt={`料理写真 ${index + 1}`} />
                </button>
              ))}
            </div>
          </section>
        )}
        {recipe.kind === 'paper' && !!recipe.paperPhotos.length && (
          <section className="detail-section">
            <h3>レシピの画像</h3>
            <div className="paper-grid">
              {recipe.paperPhotos.map((photo, index) => (
                <button
                  key={photo.id}
                  onClick={() => onPhoto(photo)}
                  aria-label={`レシピ画像 ${index + 1}を拡大`}
                >
                  <img src={photo.dataUrl} alt={`レシピ画像 ${index + 1}`} />
                </button>
              ))}
            </div>
            <p className="fineprint">写真を押すと拡大できます。</p>
          </section>
        )}
        <div className="confirm-panel">
          {confirmDelete ? (
            <>
              <p>このレシピと関連する写真を削除します。この操作は取り消せません。</p>
              <div className="button-row">
                <button className="danger" disabled={busy} onClick={() => action(onDelete)}>
                  レシピを削除する
                </button>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => setConfirmDelete(false)}
                >
                  キャンセル
                </button>
              </div>
            </>
          ) : (
            <button
              className="text-button danger-text"
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={16} />
              レシピを削除
            </button>
          )}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}

export default function App() {
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [page, setPage] = useState<Page>('recipes')
  const [filters, setFilters] = useState({ cooked: false, favorites: false })
  const [query, setQuery] = useState('')
  const [recipeLayout, setRecipeLayout] = useState<RecipeLayout>(() => {
    try {
      const saved = localStorage.getItem('hitosaji-card-size')
      if (saved === 'small' || saved === 'medium' || saved === 'large' || saved === 'list') {
        return saved
      }
      return saved === 'comfortable' ? 'large' : 'medium'
    } catch {
      return 'medium'
    }
  })
  const [recipeOrder, setRecipeOrder] = useState<RecipeOrder>(() => {
    try {
      const saved = localStorage.getItem('hitosaji-recipe-order')
      return saved === 'updated' || saved === 'title' ? saved : 'added'
    } catch {
      return 'added'
    }
  })
  const [modal, setModal] = useState<ModalState>(() => {
    const shared = takeSharedLink(window.location, window.history)
    return shared ? { type: 'recipe', shared } : null
  })
  const [lightbox, setLightbox] = useState<Photo>()
  const [toast, setToast] = useState('')
  const [settingsError, setSettingsError] = useState('')
  const [busy, setBusy] = useState(false)
  const [titleRefresh, setTitleRefresh] = useState<RefreshProgress>()
  const [contentRefresh, setContentRefresh] = useState<RefreshProgress>()
  const [updateReady, setUpdateReady] = useState(false)
  const [storage, setStorage] = useState<{ usage?: number; quota?: number }>()
  const [lastBackup, setLastBackup] = useState('')
  const [platform] = useState(sharePlatform)
  const [standalone] = useState(isStandalone)
  const channel = useRef<BroadcastChannel | null>(null)
  async function refresh() {
    try {
      setRecipes(await listRecipes())
      setLoadError('')
    } catch (error) {
      setLoadError(`記録を読み込めませんでした。${friendlyError(error)}`)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void (async () => {
      try {
        if (import.meta.env.DEV) {
          const { seedDemoRecipes } = await import('./demo')
          await seedDemoRecipes()
        }
        await refresh()
      } catch (error) {
        setLoadError(friendlyError(error))
        setLoading(false)
      }
    })()
    const onFocus = () => {
      void refresh()
    }
    const onUpdate = () => setUpdateReady(true)
    const onBlocked = () =>
      setLoadError(
        '保存領域を更新できません。ほかのタブで開いている「ひとさじ」を閉じて再読み込みしてください。',
      )
    if ('BroadcastChannel' in window) {
      channel.current = new BroadcastChannel('hitosaji')
      channel.current.onmessage = onFocus
    }
    window.addEventListener('focus', onFocus)
    window.addEventListener('recipe-update-ready', onUpdate)
    window.addEventListener('recipe-storage-blocked', onBlocked)
    try {
      setLastBackup(localStorage.getItem('hitosaji-last-backup') || '')
    } catch {
      /* IndexedDB remains the source of truth. */
    }
    return () => {
      channel.current?.close()
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('recipe-update-ready', onUpdate)
      window.removeEventListener('recipe-storage-blocked', onBlocked)
    }
  }, [])
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 4500)
    return () => window.clearTimeout(timer)
  }, [toast])
  useEffect(() => {
    if (page === 'settings' && navigator.storage?.estimate)
      void navigator.storage
        .estimate()
        .then(setStorage)
        .catch(() => {})
  }, [page, recipes])
  async function afterWrite(message: string) {
    await refresh()
    channel.current?.postMessage('changed')
    setToast(message)
  }
  async function save(recipe: Recipe, previous?: string) {
    await saveRecipe(recipe, previous)
    await afterWrite('保存しました')
    setModal({ type: 'detail', id: recipe.id })
  }
  async function toggle(recipe: Recipe, field: 'favorite' | 'cooked') {
    await saveRecipe(changed({ ...recipe, [field]: !recipe[field] }), recipe.updatedAt)
    await afterWrite('変更しました')
  }
  async function refreshMissingTitles(includeAuto = false) {
    setBusy(true)
    setSettingsError('')
    setTitleRefresh(undefined)
    try {
      // Read the latest records before starting; never replace a title entered in another tab.
      const candidates = (await listRecipes()).filter(
        (recipe) =>
          recipe.kind === 'link' &&
          recipe.url &&
          (!recipe.title.trim() || (includeAuto && recipe.titleSource === 'auto')),
      )
      let updated = 0
      let failed = 0
      setTitleRefresh({ done: 0, total: candidates.length, updated, failed, finished: false })
      for (let index = 0; index < candidates.length; index += 3) {
        await Promise.all(
          candidates.slice(index, index + 3).map(async (recipe) => {
            try {
              const metadata = await fetchLinkMetadata(recipe.url, includeAuto)
              if (!metadata.title) {
                failed++
                return
              }
              await saveRecipe(
                changed({ ...recipe, title: metadata.title, titleSource: 'auto' }),
                recipe.updatedAt,
              )
              updated++
            } catch {
              // A failed lookup or concurrent edit leaves the existing record untouched.
              failed++
            }
          }),
        )
        setTitleRefresh({
          done: Math.min(index + 3, candidates.length),
          total: candidates.length,
          updated,
          failed,
          finished: false,
        })
      }
      if (updated) await afterWrite(`${updated}件のレシピ名を更新しました`)
      else await refresh()
      setTitleRefresh({
        done: candidates.length,
        total: candidates.length,
        updated,
        failed,
        finished: true,
      })
    } catch (error) {
      setSettingsError(friendlyError(error))
    } finally {
      setBusy(false)
    }
  }
  async function refreshMissingContent(includeAuto = false) {
    setBusy(true)
    setSettingsError('')
    setContentRefresh(undefined)
    try {
      const candidates = (await listRecipes()).filter(
        includeAuto ? canRefreshSourceContent : needsSourceContent,
      )
      let updated = 0
      let failed = 0
      setContentRefresh({ done: 0, total: candidates.length, updated, failed, finished: false })
      for (let index = 0; index < candidates.length; index += 3) {
        await Promise.all(
          candidates.slice(index, index + 3).map(async (recipe) => {
            try {
              const metadata = await fetchLinkMetadata(recipe.url, includeAuto)
              const sourceKind = sourceContentKind(recipe.url)
              if (sourceKind === 'description') {
                const description =
                  metadata.description?.trim().slice(0, RECIPE_LIMITS.searchText) || ''
                if (!description && !isGenericYouTubeDescription(recipe.searchText || '')) {
                  failed++
                  return
                }
                await saveRecipe(
                  changed({ ...recipe, searchText: description, contentSource: 'auto' }),
                  recipe.updatedAt,
                )
              } else {
                const ingredients = parseIngredients(metadata.ingredients?.join('\n') || '')
                if (!ingredients.length) {
                  failed++
                  return
                }
                await saveRecipe(
                  changed({ ...recipe, ingredients, contentSource: 'auto' }),
                  recipe.updatedAt,
                )
              }
              updated++
            } catch {
              // A failed lookup or concurrent edit leaves the existing record untouched.
              failed++
            }
          }),
        )
        setContentRefresh({
          done: Math.min(index + 3, candidates.length),
          total: candidates.length,
          updated,
          failed,
          finished: false,
        })
      }
      if (updated) await afterWrite(`${updated}件の材料などを更新しました`)
      else await refresh()
      setContentRefresh({
        done: candidates.length,
        total: candidates.length,
        updated,
        failed,
        finished: true,
      })
    } catch (error) {
      setSettingsError(friendlyError(error))
    } finally {
      setBusy(false)
    }
  }
  function changeRecipeLayout(layout: RecipeLayout) {
    setRecipeLayout(layout)
    try {
      localStorage.setItem('hitosaji-card-size', layout)
    } catch {}
  }
  function changeRecipeOrder(order: RecipeOrder) {
    setRecipeOrder(order)
    try {
      localStorage.setItem('hitosaji-recipe-order', order)
    } catch {}
  }
  const filtered = recipes
    .filter(
      (recipe) =>
        matchesRecipe(recipe, query) &&
        (!filters.cooked || recipe.cooked) &&
        (!filters.favorites || recipe.favorite),
    )
    .sort((a, b) => {
      if (recipeOrder === 'title') return titleOf(a).localeCompare(titleOf(b), 'ja')
      if (recipeOrder === 'updated') return b.updatedAt.localeCompare(a.updatedAt)
      return b.createdAt.localeCompare(a.createdAt)
    })
  const allRecipesSelected = !filters.cooked && !filters.favorites
  const missingTitleCount = recipes.filter(
    (recipe) => recipe.kind === 'link' && recipe.url && !recipe.title.trim(),
  ).length
  const missingContentCount = recipes.filter(needsSourceContent).length
  const refreshTitleCount = recipes.filter(
    (recipe) => recipe.kind === 'link' && !!recipe.url && recipe.titleSource === 'auto',
  ).length
  const refreshContentCount = recipes.filter(
    (recipe) => recipe.contentSource === 'auto' && canRefreshSourceContent(recipe),
  ).length
  const filteredTitle = allRecipesSelected
    ? '集めたレシピ'
    : filters.cooked && filters.favorites
      ? '作った・お気に入り'
      : filters.cooked
        ? '作ったレシピ'
        : 'お気に入り'
  const selected =
    modal?.type === 'detail' ? recipes.find((recipe) => recipe.id === modal.id) : undefined
  async function backup() {
    setBusy(true)
    setSettingsError('')
    try {
      const current = await listRecipes()
      const data = exportBackup(current)
      parseBackup(data)
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
      const href = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = href
      anchor.download = `hitosaji-backup-${today()}.json`
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(href), 60000)
      setLastBackup(today())
      try {
        localStorage.setItem('hitosaji-last-backup', today())
      } catch {
        /* optional */
      }
      setToast('バックアップを書き出しました。保存先でファイルを確認してください。')
    } catch (error) {
      setSettingsError(friendlyError(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        本文へ移動
      </a>
      <div className="workspace">
        <header className="topbar">
          <a className="brand" href={import.meta.env.BASE_URL} aria-label="ひとさじ トップへ">
            <img
              className="brand-mark"
              src={`${import.meta.env.BASE_URL}icon.svg`}
              alt=""
              width="38"
              height="38"
            />
            <span className="brand-copy">
              <strong>ひとさじ</strong>
              <span>わたしのレシピ帳</span>
            </span>
          </a>
          {page === 'recipes' && (
            <div className="search-field topbar-search">
              <Search size={18} aria-hidden="true" />
              <input
                name="recipe-search"
                autoComplete="off"
                aria-label="レシピを検索"
                placeholder="レシピ名・材料など・メモを検索…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {query && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label="検索をクリア"
                  onClick={() => setQuery('')}
                >
                  <X size={16} />
                </button>
              )}
            </div>
          )}
          <div className="topbar-actions">
            <button
              className="icon-button"
              aria-label={page === 'settings' ? '一覧に戻る' : '設定を開く'}
              title={page === 'settings' ? '一覧に戻る' : '設定を開く'}
              onClick={() => setPage(page === 'settings' ? 'recipes' : 'settings')}
            >
              <Settings size={19} />
            </button>
          </div>
        </header>
        <main id="main-content" className="page">
          {updateReady && (
            <div className="update-banner">
              <span>新しいバージョンがあります。入力を保存してから更新してください。</span>
              <button
                className="secondary"
                disabled={!!modal || busy}
                onClick={() => window.dispatchEvent(new Event('recipe-apply-update'))}
              >
                <RefreshCw size={16} />
                更新する
              </button>
            </div>
          )}
          {loading ? (
            <div className="loading">レシピ帳を開いています…</div>
          ) : loadError ? (
            <div className="empty-state">
              <h1>記録を開けませんでした</h1>
              <p role="alert" className="error">
                {loadError}
              </p>
              <button className="primary" onClick={refresh}>
                もう一度読み込む
              </button>
            </div>
          ) : (
            <>
              {page === 'recipes' && (
                <>
                  <div className="filter-row" aria-label="レシピの絞り込み">
                    <button
                      className={`filter ${allRecipesSelected ? 'active' : ''}`}
                      aria-pressed={allRecipesSelected}
                      onClick={() => setFilters({ cooked: false, favorites: false })}
                    >
                      <BookOpen size={16} aria-hidden="true" />
                      すべて
                    </button>
                    <button
                      className={`filter ${filters.favorites ? 'active' : ''}`}
                      aria-pressed={filters.favorites}
                      onClick={() =>
                        setFilters((current) => ({ ...current, favorites: !current.favorites }))
                      }
                    >
                      <Heart size={16} aria-hidden="true" />
                      お気に入り
                    </button>
                    <button
                      className={`filter ${filters.cooked ? 'active' : ''}`}
                      aria-pressed={filters.cooked}
                      onClick={() =>
                        setFilters((current) => ({ ...current, cooked: !current.cooked }))
                      }
                    >
                      <CookingPot size={16} aria-hidden="true" />
                      作った
                    </button>
                  </div>
                  <div className="results-heading">
                    <h1>
                      {filteredTitle}
                      <span>{filtered.length}</span>
                    </h1>
                    <select
                      className="order-select"
                      aria-label="並び替え"
                      value={recipeOrder}
                      onChange={(event) => changeRecipeOrder(event.target.value as RecipeOrder)}
                    >
                      {(Object.keys(ORDER_LABELS) as RecipeOrder[]).map((order) => (
                        <option key={order} value={order}>
                          {ORDER_LABELS[order]}
                        </option>
                      ))}
                    </select>
                  </div>
                  {filtered.length ? (
                    <div className={`recipe-grid ${recipeLayout}`}>
                      {filtered.map((recipe) => (
                        <article className="recipe-card" key={recipe.id}>
                          <button
                            className="card-open"
                            onClick={() => setModal({ type: 'detail', id: recipe.id })}
                            aria-label={`${titleOf(recipe)}を開く`}
                          >
                            <div className="card-image">
                              <RecipeImage recipe={recipe} />
                              <span className="source-badge">
                                {recipe.kind === 'paper' ? (
                                  <>
                                    <FileImage size={12} />
                                    手動登録
                                  </>
                                ) : (
                                  <>
                                    <LinkIcon size={12} />
                                    {recipe.source}
                                  </>
                                )}
                              </span>
                            </div>
                            <div className="card-body">
                              <h3 className="card-title">{titleOf(recipe)}</h3>
                              <time className="card-meta" dateTime={recipe.createdAt}>
                                追加 {dateLabel(recipe.createdAt)}
                              </time>
                              <div className="ingredient-tags">
                                {recipe.ingredients.length ? (
                                  <>
                                    {recipe.ingredients.slice(0, 3).map((ingredient) => (
                                      <span key={ingredient}>{ingredient}</span>
                                    ))}
                                    {recipe.ingredients.length > 3 && (
                                      <span>+{recipe.ingredients.length - 3}</span>
                                    )}
                                  </>
                                ) : null}
                              </div>
                            </div>
                          </button>
                          <div className="card-actions">
                            <div>
                              <button
                                className={`icon-button ${recipe.cooked ? 'is-on' : ''}`}
                                aria-label={`${titleOf(recipe)}を作った`}
                                title="作った"
                                aria-pressed={recipe.cooked}
                                onClick={() => {
                                  void toggle(recipe, 'cooked').catch((error) =>
                                    setToast(friendlyError(error)),
                                  )
                                }}
                              >
                                <CookingPot size={18} />
                              </button>
                              <button
                                className={`icon-button ${recipe.favorite ? 'is-on' : ''}`}
                                aria-label={`${titleOf(recipe)}をお気に入り`}
                                aria-pressed={recipe.favorite}
                                onClick={() => {
                                  void toggle(recipe, 'favorite').catch((error) =>
                                    setToast(friendlyError(error)),
                                  )
                                }}
                              >
                                <Heart size={18} fill={recipe.favorite ? 'currentColor' : 'none'} />
                              </button>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : recipes.length || query || !allRecipesSelected ? (
                    <div className="empty-state">
                      <Search className="empty-icon" />
                      <h2>該当するレシピがありません</h2>
                      <p>別のキーワードや材料で探してみてください。</p>
                      <button
                        className="secondary"
                        onClick={() => {
                          setQuery('')
                          setFilters({ cooked: false, favorites: false })
                        }}
                      >
                        検索条件をリセット
                      </button>
                    </div>
                  ) : (
                    <div className="empty-state">
                      <BookOpen className="empty-icon" />
                      <h2>レシピはまだありません</h2>
                      <p>URLや手入力から追加できます。</p>
                    </div>
                  )}
                  <button className="primary add-fab" onClick={() => setModal({ type: 'recipe' })}>
                    <Plus size={21} aria-hidden="true" />
                    追加
                  </button>
                </>
              )}
              {page === 'settings' && (
                <>
                  <div className="page-heading">
                    <div>
                      <h1>
                        レシピ帳の設定<span className="heading-dot">.</span>
                      </h1>
                    </div>
                  </div>
                  <div className="settings-grid">
                    <section className="settings-card">
                      <div className="settings-card-head">
                        <Grid2X2 className="setting-icon" aria-hidden="true" />
                        <h2>一覧の見た目</h2>
                      </div>
                      <div className="card-size-control" role="group" aria-label="一覧の見た目">
                        <button
                          type="button"
                          className={recipeLayout === 'small' ? 'active' : ''}
                          aria-pressed={recipeLayout === 'small'}
                          onClick={() => changeRecipeLayout('small')}
                        >
                          小
                        </button>
                        <button
                          type="button"
                          className={recipeLayout === 'medium' ? 'active' : ''}
                          aria-pressed={recipeLayout === 'medium'}
                          onClick={() => changeRecipeLayout('medium')}
                        >
                          中
                        </button>
                        <button
                          type="button"
                          className={recipeLayout === 'large' ? 'active' : ''}
                          aria-pressed={recipeLayout === 'large'}
                          onClick={() => changeRecipeLayout('large')}
                        >
                          大
                        </button>
                        <button
                          type="button"
                          className={recipeLayout === 'list' ? 'active' : ''}
                          aria-pressed={recipeLayout === 'list'}
                          onClick={() => changeRecipeLayout('list')}
                        >
                          リスト
                        </button>
                      </div>
                    </section>
                    <section className="settings-card">
                      <div className="settings-card-head">
                        <HardDrive className="setting-icon" aria-hidden="true" />
                        <h2>記録とバックアップ</h2>
                      </div>
                      <p>
                        記録はこの端末の中だけにあります。ブラウザのデータを消すと消えるので、ときどきバックアップを書き出してください。
                      </p>
                      <div className="storage-stats">
                        <span>
                          <strong>{recipes.length}</strong> レシピ
                        </span>
                        <span>
                          <strong>{recipes.filter((recipe) => recipe.cooked).length}</strong> 作った
                        </span>
                        {storage?.usage !== undefined && (
                          <span>使用量 約{(storage.usage / 1024 / 1024).toFixed(1)} MB</span>
                        )}
                      </div>
                      <div className="settings-action">
                        <h3>書き出す</h3>
                        <button className="primary" disabled={busy} onClick={backup}>
                          <Download size={18} />
                          バックアップを書き出す
                        </button>
                        <p className="fineprint">
                          {lastBackup
                            ? `前回の書き出し：${dateLabel(lastBackup)}`
                            : 'まだ書き出していません。'}
                        </p>
                      </div>
                      <div className="settings-action">
                        <h3>取り込む</h3>
                        <p>別の端末への移行にも使えます。同じレシピは上書きしません。</p>
                        <label className={`secondary upload-label ${busy ? 'is-disabled' : ''}`}>
                          <Upload size={18} />
                          バックアップを選ぶ
                          <input
                            type="file"
                            accept=".json,application/json"
                            aria-label="バックアップを選ぶ"
                            disabled={busy}
                            onChange={async (event) => {
                              const file = event.target.files?.[0]
                              event.target.value = ''
                              if (!file) return
                              setBusy(true)
                              setSettingsError('')
                              try {
                                setModal({
                                  type: 'restore',
                                  recipes: parseBackup(JSON.parse(await file.text())),
                                })
                              } catch (error) {
                                setSettingsError(
                                  error instanceof SyntaxError
                                    ? '読み取れないファイルです。「ひとさじ」のバックアップを選んでください。'
                                    : friendlyError(error),
                                )
                              } finally {
                                setBusy(false)
                              }
                            }}
                          />
                        </label>
                      </div>
                      {settingsError && (
                        <p className="error" role="alert">
                          {settingsError}
                        </p>
                      )}
                      <details className="settings-note">
                        <summary>記録が別々になったとき</summary>
                        <p>
                          ホーム画面版とブラウザ版、ChromeとSafari、開くURLが違うと、記録はそれぞれ別になります。ひとつにまとめるときは、残したいほうでバックアップを書き出して、もう一方で取り込んでください。
                        </p>
                      </details>
                    </section>
                    <section className="settings-card">
                      <div className="settings-card-head">
                        <Share2 className="setting-icon" aria-hidden="true" />
                        <h2>共有メニューから登録</h2>
                      </div>
                      <p>
                        レシピのページを開いたまま「共有」から登録できます。URLをコピーして貼り付ける必要はありません。
                      </p>
                      {platform !== 'android' && (
                        <>
                          {platform === 'unknown' && <p className="device-label">iPhone・iPad</p>}
                          {standalone && platform === 'ios' ? (
                            <p>
                              いまのホーム画面版では使えません。SafariやChromeで「ひとさじ」を開くと、共有メニューから登録できます。
                            </p>
                          ) : (
                            <>
                              <p>
                                SafariやChromeで見ているときに使えます。ショートカットを追加すると、「共有」から「ひとさじ」へレシピを送れます。
                              </p>
                              <a
                                className="secondary"
                                href={IOS_SHORTCUT_URL}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                ショートカットを追加
                                <ArrowUpRight size={18} aria-hidden="true" />
                              </a>
                              <p className="fineprint">
                                リンクを開き、「ショートカットを入手」を押すと追加されます。送ったレシピはブラウザ版に届くため、ホーム画面版では受け取れません。
                              </p>
                            </>
                          )}
                        </>
                      )}
                      {platform !== 'ios' && (
                        <>
                          {platform === 'unknown' && <p className="device-label">Android</p>}
                          <p>
                            {standalone && platform === 'android'
                              ? 'レシピのページで「共有」を開くと「ひとさじ」が出ます。ほかの準備は要りません。'
                              : 'ホーム画面に追加すると、共有メニューに「ひとさじ」が出ます。ほかの準備は要りません。'}
                          </p>
                        </>
                      )}
                    </section>
                    <section className="settings-card">
                      <div className="settings-card-head">
                        <Smartphone className="setting-icon" aria-hidden="true" />
                        <h2>アプリとして使う</h2>
                      </div>
                      <p>
                        {standalone
                          ? 'いまホーム画面から開いています。'
                          : platform === 'ios'
                            ? 'Safariで「共有」→「ホーム画面に追加」を選ぶと、アプリと同じように開けます。'
                            : platform === 'android'
                              ? 'Chromeのメニューから「ホーム画面に追加」を選ぶと、アプリと同じように開けます。'
                              : 'ブラウザのメニューから「インストール」や「ホーム画面に追加」を選ぶと、アプリと同じように開けます。'}
                      </p>
                      <p className="fineprint">登録したレシピは、通信がなくても見られます。</p>
                      <div className="settings-caution">
                        <p>
                          ブラウザ側の記録は引き継がれません。先にバックアップを書き出して、ホーム画面版で取り込んでください。
                        </p>
                        {platform !== 'android' && (
                          <p>
                            {platform === 'ios' ? '' : 'iPhone・iPadでは、'}
                            ホーム画面版から「共有メニューから登録」は使えません。
                          </p>
                        )}
                      </div>
                    </section>
                    <section className="settings-card">
                      <div className="settings-card-head">
                        <Leaf className="setting-icon" aria-hidden="true" />
                        <h2>このアプリについて</h2>
                      </div>
                      <p>
                        外部のレシピは元のサイトを開いて読みます。作り方や動画は取り込みません。
                      </p>
                      <p className="fineprint">ひとさじ v{version}</p>
                    </section>
                  </div>
                  <section className="settings-card settings-fetch">
                    <div className="settings-card-head">
                      <RefreshCw className="setting-icon" aria-hidden="true" />
                      <h2>情報の取得</h2>
                    </div>
                    <div className="settings-action">
                      <h3>レシピ名をまとめて取得</h3>
                      <p>
                        名前が空欄のURLレシピを取得します。入力済みの名前は変更しません。対象は
                        {missingTitleCount}件です。
                      </p>
                      <button
                        className="secondary"
                        disabled={busy || missingTitleCount === 0}
                        onClick={() => void refreshMissingTitles()}
                      >
                        <RefreshCw size={18} />
                        {titleRefresh && !titleRefresh.finished
                          ? `取得中 ${titleRefresh.done}/${titleRefresh.total}件`
                          : 'レシピ名を一括取得'}
                      </button>
                      <button
                        className="secondary"
                        disabled={busy || refreshTitleCount === 0}
                        onClick={() => void refreshMissingTitles(true)}
                      >
                        <RefreshCw size={18} />
                        レシピ名を再取得（{refreshTitleCount}件）
                      </button>
                      {titleRefresh && (
                        <p className="fineprint" role="status">
                          {titleRefresh.finished
                            ? `完了：${titleRefresh.updated}件を更新、${titleRefresh.failed}件は更新できませんでした。`
                            : `${titleRefresh.done}/${titleRefresh.total}件を確認中…`}
                        </p>
                      )}
                    </div>
                    <div className="settings-action">
                      <h3>材料などをまとめて取得</h3>
                      <p>
                        料理サイトの材料とYouTubeの概要欄を、空欄の記録に追加します。誤って保存されたYouTubeの共通案内文も修正します。手入力した内容は変更しません。対象は
                        {missingContentCount}件です。
                      </p>
                      <button
                        className="secondary"
                        disabled={busy || missingContentCount === 0}
                        onClick={() => void refreshMissingContent()}
                      >
                        <RefreshCw size={18} />
                        {contentRefresh && !contentRefresh.finished
                          ? `取得中 ${contentRefresh.done}/${contentRefresh.total}件`
                          : '材料などを一括取得'}
                      </button>
                      <button
                        className="secondary"
                        disabled={busy || refreshContentCount === 0}
                        onClick={() => void refreshMissingContent(true)}
                      >
                        <RefreshCw size={18} />
                        材料などを再取得（{refreshContentCount}件）
                      </button>
                      {contentRefresh && (
                        <p className="fineprint" role="status">
                          {contentRefresh.finished
                            ? `完了：${contentRefresh.updated}件を更新、${contentRefresh.failed}件は更新できませんでした。`
                            : `${contentRefresh.done}/${contentRefresh.total}件を確認中…`}
                        </p>
                      )}
                    </div>
                    <p className="fineprint">
                      再取得は自動取得した情報が対象です。手入力した内容と、取得元を判別できない以前の入力済みデータは保護します。
                    </p>
                  </section>
                </>
              )}
            </>
          )}
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          {toast}
        </div>
      )}
      {modal?.type === 'recipe' && (
        <RecipeForm
          key={modal.recipe?.id || 'new'}
          initial={modal.recipe}
          shared={modal.shared}
          recipes={recipes}
          onClose={() => setModal(null)}
          onSave={save}
          onOpen={(id) => setModal({ type: 'detail', id })}
        />
      )}
      {modal?.type === 'detail' && selected && (
        <RecipeDetail
          key={selected.id}
          recipe={selected}
          onClose={() => setModal(null)}
          onEdit={() => setModal({ type: 'recipe', recipe: selected })}
          onDelete={async () => {
            await removeRecipe(selected)
            await afterWrite('レシピを削除しました')
            setModal(null)
          }}
          onToggle={(field) => toggle(selected, field)}
          onPhoto={setLightbox}
        />
      )}
      {modal?.type === 'detail' && !selected && !loading && (
        <Dialog title="レシピが見つかりません" onClose={() => setModal(null)}>
          <div className="dialog-body">
            <p>別の画面で削除された可能性があります。</p>
          </div>
        </Dialog>
      )}
      {modal?.type === 'restore' && (
        <Dialog
          title="バックアップを取り込む"
          onClose={() => {
            setModal(null)
            setSettingsError('')
          }}
          busy={busy}
        >
          <div className="dialog-body">
            <p>{modal.recipes.length}件のレシピが入っています。</p>
            <p>
              現在の記録は残し、未登録のレシピだけを写真と一緒に追加します。同じIDのレシピは上書きしません。
            </p>
            {settingsError && (
              <p className="error" role="alert">
                {settingsError}
              </p>
            )}
          </div>
          <footer className="dialog-footer">
            <button className="text-button" disabled={busy} onClick={() => setModal(null)}>
              キャンセル
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                setSettingsError('')
                try {
                  const count = await restoreRecipes(modal.recipes)
                  await afterWrite(`${count}件のレシピを取り込みました`)
                  setModal(null)
                } catch (error) {
                  setSettingsError(friendlyError(error))
                } finally {
                  setBusy(false)
                }
              }}
            >
              {busy ? '取り込み中…' : '取り込む'}
            </button>
          </footer>
        </Dialog>
      )}
      {lightbox && (
        <Dialog
          title={lightbox.name || '写真を拡大'}
          onClose={() => setLightbox(undefined)}
          className="lightbox"
        >
          <div className="lightbox-content">
            <img src={lightbox.dataUrl} alt={lightbox.name || '拡大した写真'} />
          </div>
        </Dialog>
      )}
    </div>
  )
}
