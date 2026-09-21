import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  BookOpen,
  Plus,
  Search,
  Heart,
  Bookmark,
  Camera,
  Settings,
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
  CalendarDays,
  HardDrive,
  RefreshCw,
  CookingPot,
} from 'lucide-react'
import {
  exportBackup,
  matchesRecipe,
  newId,
  normalizeUrl,
  parseBackup,
  parseIngredients,
  readPhotos,
  sourceLabel,
  type Photo,
  type Recipe,
  type CookLog,
} from './domain'
import { friendlyError, listRecipes, removeRecipe, restoreRecipes, saveRecipe } from './store'

type Page = 'recipes' | 'records' | 'settings'
type Filter = 'all' | 'want' | 'favorites' | 'unorganized'
type ModalState =
  | { type: 'recipe'; recipe?: Recipe }
  | { type: 'detail'; id: string }
  | { type: 'log'; recipe: Recipe; log?: CookLog }
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
const titleOf = (recipe: Recipe) => recipe.title || 'あとで名前をつけるレシピ'
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
}: {
  title: string
  children: ReactNode
  onClose: () => void
  busy?: boolean
  className?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
    return () => ref.current?.close()
  }, [])
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
        <h2>{title}</h2>
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
      <label className={`secondary upload-label ${busy ? 'is-disabled' : ''}`}>
        <ImagePlus size={18} />
        {busy ? '写真を準備中…' : '写真を選ぶ・撮る'}
        <input
          type="file"
          accept="image/*"
          multiple
          disabled={busy || photos.length >= 12}
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
        {kind === 'paper' ? '複数ページを順番に追加できます。' : '先頭の写真を表紙にします。'}
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
  recipes,
  onSave,
  onClose,
  onOpen,
}: {
  initial?: Recipe
  recipes: Recipe[]
  onSave: (recipe: Recipe, previous?: string) => Promise<void>
  onClose: () => void
  onOpen: (id: string) => void
}) {
  const [kind, setKind] = useState<'link' | 'paper'>(initial?.kind || 'link')
  const [title, setTitle] = useState(initial?.title || '')
  const [url, setUrl] = useState(initial?.url || '')
  const [ingredients, setIngredients] = useState(initial?.ingredients.join('、') || '')
  const [note, setNote] = useState(initial?.note || '')
  const [source, setSource] = useState(initial?.source || '')
  const [photos, setPhotos] = useState<Photo[]>(initial?.photos || [])
  const [paperPhotos, setPaperPhotos] = useState<Photo[]>(initial?.paperPhotos || [])
  const [want, setWant] = useState(initial?.wantToCook ?? true)
  const [busy, setBusy] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [paperBusy, setPaperBusy] = useState(false)
  const [error, setError] = useState('')
  const [duplicate, setDuplicate] = useState<Recipe>()
  const pending = busy || photoBusy || paperBusy
  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setDuplicate(undefined)
    setBusy(true)
    try {
      const cleanUrl = kind === 'link' ? normalizeUrl(url) : ''
      if (kind === 'link' && !cleanUrl) throw new Error('レシピのURLを入力してください。')
      const existing =
        kind === 'link'
          ? recipes.find((recipe) => recipe.id !== initial?.id && recipe.url === cleanUrl)
          : undefined
      if (existing) {
        setDuplicate(existing)
        throw new Error('このURLは登録済みです。')
      }
      if (kind === 'paper' && !paperPhotos.length)
        throw new Error('紙のレシピの写真を追加してください。')
      const now = new Date().toISOString()
      const recipe: Recipe = {
        id: initial?.id || newId(),
        kind,
        title: title.trim(),
        url: cleanUrl,
        ingredients: parseIngredients(ingredients),
        note: note.trim(),
        source: kind === 'link' ? sourceLabel(cleanUrl) : source.trim(),
        photos,
        paperPhotos: kind === 'paper' ? paperPhotos : [],
        logs: initial?.logs || [],
        favorite: initial?.favorite || false,
        wantToCook: want,
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
    <Dialog title={initial ? 'レシピを編集' : 'レシピを追加'} onClose={onClose} busy={pending}>
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
                onClick={() => setKind('paper')}
              >
                <FileImage size={18} />
                紙のレシピから
              </button>
            </div>
          )}
          <p className="muted">
            {kind === 'link'
              ? 'まずはURLだけでも。名前や材料は、あとから追加できます。'
              : '本や手書きのレシピを、写真で手元に。'}
          </p>
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
                  setUrl(event.target.value)
                  setDuplicate(undefined)
                }}
                placeholder="https://… または共有した文章"
                maxLength={4000}
              />
              <small>作り方は元のサイトを開いて確認します。</small>
            </div>
          ) : (
            <PhotoInput
              label="紙のレシピ写真"
              kind="paper"
              photos={paperPhotos}
              onChange={setPaperPhotos}
              onBusy={setPaperBusy}
            />
          )}
          <div className="field">
            <label htmlFor="recipe-title">レシピ名</label>
            <input
              id="recipe-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例：鶏肉と玉ねぎの甘酢炒め"
              maxLength={200}
            />
          </div>
          <div className="field">
            <label htmlFor="recipe-ingredients">材料</label>
            <textarea
              id="recipe-ingredients"
              rows={2}
              value={ingredients}
              onChange={(event) => setIngredients(event.target.value)}
              placeholder="鶏肉、玉ねぎ、ピーマン"
              maxLength={3000}
            />
            <small>「、」や改行で区切って入力。材料で検索できるようになります。</small>
          </div>
          {kind === 'paper' && (
            <div className="field">
              <label htmlFor="recipe-source">出典</label>
              <input
                id="recipe-source"
                value={source}
                onChange={(event) => setSource(event.target.value)}
                placeholder="本の名前、ページなど"
                maxLength={200}
              />
            </div>
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
              maxLength={10000}
            />
          </div>
          <label className="check-field">
            <input
              type="checkbox"
              checked={want}
              onChange={(event) => setWant(event.target.checked)}
            />
            作りたいリストに入れる
          </label>
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

function LogForm({
  recipe,
  initial,
  onSave,
  onClose,
}: {
  recipe: Recipe
  initial?: CookLog
  onSave: (recipe: Recipe, previous?: string) => Promise<void>
  onClose: () => void
}) {
  const [date, setDate] = useState(initial?.date || today())
  const [note, setNote] = useState(initial?.note || '')
  const [photos, setPhotos] = useState<Photo[]>(initial?.photos || [])
  const [useCover, setUseCover] = useState(!recipe.photos.length)
  const [busy, setBusy] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const log: CookLog = { id: initial?.id || newId(), date, note: note.trim(), photos }
      await onSave(
        changed({
          ...recipe,
          logs: initial
            ? recipe.logs.map((item) => (item.id === initial.id ? log : item))
            : [...recipe.logs, log],
          photos:
            useCover && photos.length
              ? [photos[0], ...recipe.photos.filter((item) => item.id !== photos[0].id)].slice(
                  0,
                  12,
                )
              : recipe.photos,
        }),
        recipe.updatedAt,
      )
    } catch (error) {
      setError(friendlyError(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      title={initial ? '作った記録を編集' : '作った記録を残す'}
      onClose={onClose}
      busy={busy || photoBusy}
    >
      <form onSubmit={submit} className="form-stack">
        <div className="dialog-body">
          <p className="record-recipe-name">{titleOf(recipe)}</p>
          <div className="field">
            <label htmlFor="cook-date">作った日</label>
            <input
              id="cook-date"
              type="date"
              required
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
          <PhotoInput
            label="作った料理の写真"
            kind="dish"
            photos={photos}
            onChange={setPhotos}
            onBusy={setPhotoBusy}
          />
          {!!photos.length && (
            <label className="check-field">
              <input
                type="checkbox"
                checked={useCover}
                onChange={(event) => setUseCover(event.target.checked)}
              />
              この写真をレシピの表紙にも使う
            </label>
          )}
          <div className="field">
            <label htmlFor="cook-note">感想・アレンジ</label>
            <textarea
              id="cook-note"
              rows={4}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="少し甘めにしたら、おいしくできた。"
              maxLength={10000}
            />
          </div>
          {initial && (
            <div className="confirm-panel">
              {confirmDelete ? (
                <>
                  <p>この日の記録を削除します。表紙に使った写真は残ります。</p>
                  <div className="button-row">
                    <button
                      type="button"
                      className="danger"
                      disabled={busy || photoBusy}
                      onClick={async () => {
                        setBusy(true)
                        try {
                          await onSave(
                            changed({
                              ...recipe,
                              logs: recipe.logs.filter((item) => item.id !== initial.id),
                            }),
                            recipe.updatedAt,
                          )
                        } catch (error) {
                          setError(friendlyError(error))
                        } finally {
                          setBusy(false)
                        }
                      }}
                    >
                      記録を削除する
                    </button>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                    >
                      戻る
                    </button>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  className="text-button danger-text"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 size={16} />
                  この記録を削除
                </button>
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </div>
        <footer className="dialog-footer">
          <button
            className="text-button"
            type="button"
            disabled={busy || photoBusy}
            onClick={onClose}
          >
            キャンセル
          </button>
          <button className="primary" disabled={busy || photoBusy}>
            <Check size={18} />
            {busy || photoBusy ? '準備中…' : '記録を保存'}
          </button>
        </footer>
      </form>
    </Dialog>
  )
}

function RecipeDetail({
  recipe,
  onClose,
  onEdit,
  onLog,
  onDelete,
  onToggle,
  onPhoto,
}: {
  recipe: Recipe
  onClose: () => void
  onEdit: () => void
  onLog: (log?: CookLog) => void
  onDelete: () => Promise<void>
  onToggle: (field: 'favorite' | 'wantToCook') => Promise<void>
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
    <Dialog title="レシピ" onClose={onClose} busy={busy}>
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
        <div className="detail-head">
          <p className="eyebrow">{recipe.kind === 'paper' ? '紙のレシピ' : recipe.source}</p>
          <h2 className="detail-title">{titleOf(recipe)}</h2>
          <p className="detail-meta">
            {recipe.logs.length ? `${recipe.logs.length}回作りました` : 'まだ作っていないレシピ'}
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
            className={`secondary ${recipe.wantToCook ? 'is-on' : ''}`}
            disabled={busy}
            aria-pressed={recipe.wantToCook}
            onClick={() => action(() => onToggle('wantToCook'))}
          >
            <Bookmark size={17} />
            作りたい
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
          <button className="text-button" onClick={onEdit} disabled={busy}>
            <Pencil size={17} />
            編集
          </button>
        </div>
        <section className="detail-section">
          <h3>材料</h3>
          {recipe.ingredients.length ? (
            <div className="ingredient-tags">
              {recipe.ingredients.map((ingredient) => (
                <span key={ingredient}>{ingredient}</span>
              ))}
            </div>
          ) : (
            <p className="muted">
              材料はまだ登録されていません。編集から追加すると、材料で探せます。
            </p>
          )}
        </section>
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
        {recipe.kind === 'paper' && (
          <section className="detail-section">
            <h3>紙のレシピ</h3>
            {recipe.source && <p className="muted">{recipe.source}</p>}
            <div className="paper-grid">
              {recipe.paperPhotos.map((photo, index) => (
                <button
                  key={photo.id}
                  onClick={() => onPhoto(photo)}
                  aria-label={`レシピの${index + 1}ページ目を拡大`}
                >
                  <img src={photo.dataUrl} alt={`レシピ ${index + 1}ページ目`} />
                  <span>{index + 1}ページ</span>
                </button>
              ))}
            </div>
            <p className="fineprint">写真を押すと拡大できます。</p>
          </section>
        )}
        <section className="detail-section">
          <div className="section-heading">
            <h3>
              作った記録 <span>{recipe.logs.length}</span>
            </h3>
            <button className="secondary" disabled={busy} onClick={() => onLog()}>
              <Plus size={17} />
              記録する
            </button>
          </div>
          {!recipe.logs.length ? (
            <p className="muted">作った日の写真や感想を、ここに残していきましょう。</p>
          ) : (
            <div className="log-list">
              {[...recipe.logs]
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((log) => (
                  <article className="log-item" key={log.id}>
                    <div className="section-heading">
                      <h4>{dateLabel(log.date)}</h4>
                      <button
                        className="icon-button"
                        aria-label={`${log.date}の記録を編集`}
                        onClick={() => onLog(log)}
                      >
                        <Pencil size={17} />
                      </button>
                    </div>
                    <div className="log-images">
                      {log.photos.map((photo, index) => (
                        <button
                          key={photo.id}
                          onClick={() => onPhoto(photo)}
                          aria-label={`記録写真 ${index + 1}を拡大`}
                        >
                          <img src={photo.dataUrl} alt={`作った料理 ${index + 1}`} />
                        </button>
                      ))}
                    </div>
                    {log.note && <p className="preserve-lines">{log.note}</p>}
                  </article>
                ))}
            </div>
          )}
        </section>
        <div className="confirm-panel">
          {confirmDelete ? (
            <>
              <p>
                このレシピと、ひも付く{recipe.logs.length}
                件の調理記録・写真を削除します。この操作は取り消せません。
              </p>
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
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [ingredientInput, setIngredientInput] = useState('')
  const [ingredients, setIngredients] = useState<string[]>([])
  const [modal, setModal] = useState<ModalState>(null)
  const [lightbox, setLightbox] = useState<Photo>()
  const [toast, setToast] = useState('')
  const [settingsError, setSettingsError] = useState('')
  const [busy, setBusy] = useState(false)
  const [updateReady, setUpdateReady] = useState(false)
  const [storage, setStorage] = useState<{ usage?: number; quota?: number }>()
  const [lastBackup, setLastBackup] = useState('')
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
    void refresh()
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
  async function toggle(recipe: Recipe, field: 'favorite' | 'wantToCook') {
    await saveRecipe(changed({ ...recipe, [field]: !recipe[field] }), recipe.updatedAt)
    await afterWrite('変更しました')
  }
  function addIngredient(event: FormEvent) {
    event.preventDefault()
    const additions = parseIngredients(ingredientInput)
    setIngredients([...new Set([...ingredients, ...additions])])
    setIngredientInput('')
  }
  const filtered = recipes.filter(
    (recipe) =>
      matchesRecipe(recipe, query, ingredients) &&
      (filter === 'all' ||
        (filter === 'want' && recipe.wantToCook) ||
        (filter === 'favorites' && recipe.favorite) ||
        (filter === 'unorganized' && (!recipe.title || !recipe.ingredients.length))),
  )
  const logs = recipes
    .flatMap((recipe) => recipe.logs.map((log) => ({ recipe, log })))
    .sort((a, b) => b.log.date.localeCompare(a.log.date))
  const allIngredients = [...new Set(recipes.flatMap((recipe) => recipe.ingredients))].sort()
  const selected =
    modal?.type === 'detail' ? recipes.find((recipe) => recipe.id === modal.id) : undefined
  const navItems: { page: Page; label: string; icon: typeof BookOpen }[] = [
    { page: 'recipes', label: 'レシピ帳', icon: BookOpen },
    { page: 'records', label: '作った記録', icon: Camera },
    { page: 'settings', label: '設定', icon: Settings },
  ]
  function navigation() {
    return navItems.map((item) => (
      <button
        key={item.page}
        className={page === item.page ? 'active' : ''}
        aria-current={page === item.page ? 'page' : undefined}
        onClick={() => setPage(item.page)}
      >
        <item.icon size={21} />
        <span>{item.label}</span>
        {item.page === 'recipes' && <span className="nav-count">{recipes.length}</span>}
      </button>
    ))
  }
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
      <aside className="sidebar">
        <a className="brand" href={import.meta.env.BASE_URL} aria-label="ひとさじ ホーム">
          <span className="brand-mark">
            <CookingPot size={25} />
          </span>
          <div>
            <strong>ひとさじ</strong>
            <span>わたしのレシピ帳</span>
          </div>
        </a>
        <nav className="nav-list" aria-label="メインメニュー">
          {navigation()}
        </nav>
        <p className="sidebar-storage">
          <HardDrive size={14} />
          このブラウザに保存
        </p>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span className="eyebrow">ひとさじ</span>
          <div className="topbar-actions">
            <span className="local-indicator">
              <span />
              自分だけのレシピ帳
            </span>
            <button
              className="icon-button"
              aria-label="設定を開く"
              onClick={() => setPage('settings')}
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
                  <div className="page-heading">
                    <div>
                      <h1>
                        わたしのレシピ帳<span className="heading-dot">.</span>
                      </h1>
                    </div>
                    <button className="primary" onClick={() => setModal({ type: 'recipe' })}>
                      <Plus size={19} />
                      レシピを追加
                    </button>
                  </div>
                  <section className="search-panel" aria-label="レシピ検索">
                    <div className="search-field">
                      <Search size={20} />
                      <input
                        aria-label="レシピを検索"
                        placeholder="レシピ名やメモから探す"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                      />
                      {query && (
                        <button
                          className="icon-button"
                          aria-label="検索をクリア"
                          onClick={() => setQuery('')}
                        >
                          <X size={17} />
                        </button>
                      )}
                    </div>
                    <div className="ingredient-search">
                      <form className="ingredient-input" onSubmit={addIngredient}>
                        <Leaf size={18} />
                        <input
                          aria-label="検索する材料"
                          placeholder="材料から探す（例：玉ねぎ）"
                          list="ingredient-options"
                          value={ingredientInput}
                          onChange={(event) => setIngredientInput(event.target.value)}
                        />
                        <datalist id="ingredient-options">
                          {allIngredients.map((ingredient) => (
                            <option key={ingredient} value={ingredient} />
                          ))}
                        </datalist>
                        <button
                          className="text-button"
                          disabled={!ingredientInput.trim()}
                          aria-label="材料を検索条件に追加"
                        >
                          <Plus size={17} />
                          追加
                        </button>
                      </form>
                    </div>
                    {!!ingredients.length && (
                      <div className="selected-ingredients">
                        <span className="fineprint">すべて含む</span>
                        {ingredients.map((ingredient) => (
                          <button
                            className="chip"
                            key={ingredient}
                            onClick={() =>
                              setIngredients(ingredients.filter((item) => item !== ingredient))
                            }
                          >
                            {ingredient}
                            <X size={14} />
                            <span className="sr-only">を検索条件から外す</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </section>
                  <div className="filter-row" aria-label="レシピの絞り込み">
                    {(
                      [
                        { id: 'all', label: 'すべて', icon: BookOpen },
                        { id: 'want', label: '作りたい', icon: Bookmark },
                        { id: 'favorites', label: 'お気に入り', icon: Heart },
                        { id: 'unorganized', label: 'あとで整理', icon: Pencil },
                      ] as const
                    ).map((item) => (
                      <button
                        className={`filter ${filter === item.id ? 'active' : ''}`}
                        key={item.id}
                        aria-pressed={filter === item.id}
                        onClick={() => setFilter(item.id)}
                      >
                        <item.icon size={16} />
                        {item.label}
                      </button>
                    ))}
                  </div>
                  <div className="results-heading">
                    <h2>
                      {filter === 'all'
                        ? '集めたレシピ'
                        : filter === 'want'
                          ? '作りたいレシピ'
                          : filter === 'favorites'
                            ? 'お気に入り'
                            : 'あとで整理'}
                      <span>{filtered.length}</span>
                    </h2>
                    <span className="fineprint">新しく追加した順</span>
                  </div>
                  {filtered.length ? (
                    <div className="recipe-grid">
                      {filtered.map((recipe) => (
                        <article className="recipe-card" key={recipe.id}>
                          <button
                            className="card-open"
                            onClick={() => setModal({ type: 'detail', id: recipe.id })}
                            aria-label={`${titleOf(recipe)}を開く`}
                          >
                            <div className="card-image">
                              {recipe.photos[0] ? (
                                <img
                                  src={recipe.photos[0].dataUrl}
                                  loading="lazy"
                                  alt={titleOf(recipe)}
                                />
                              ) : (
                                <div
                                  className={`photo-placeholder ${recipe.kind === 'paper' ? 'paper-placeholder' : ''}`}
                                >
                                  <span className="placeholder-icon">
                                    <Utensils size={36} strokeWidth={1.2} />
                                  </span>
                                </div>
                              )}
                              <span className="source-badge">
                                {recipe.kind === 'paper' ? (
                                  <>
                                    <FileImage size={12} />
                                    紙のレシピ
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
                                ) : (
                                  <span className="muted-tag">材料をあとで登録</span>
                                )}
                              </div>
                            </div>
                          </button>
                          <div className="card-actions">
                            <span className="card-meta">
                              <CookingPot size={15} />
                              {recipe.logs.length
                                ? `${recipe.logs.length}回作った`
                                : 'まだ作っていません'}
                            </span>
                            <div>
                              <button
                                className={`icon-button ${recipe.wantToCook ? 'is-on' : ''}`}
                                aria-label={`${titleOf(recipe)}を作りたい`}
                                aria-pressed={recipe.wantToCook}
                                onClick={() => {
                                  void toggle(recipe, 'wantToCook').catch((error) =>
                                    setToast(friendlyError(error)),
                                  )
                                }}
                              >
                                <Bookmark
                                  size={18}
                                  fill={recipe.wantToCook ? 'currentColor' : 'none'}
                                />
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
                  ) : recipes.length || query || ingredients.length || filter !== 'all' ? (
                    <div className="empty-state">
                      <Search className="empty-icon" />
                      <h2>該当するレシピがありません</h2>
                      <p>別のキーワードや材料で探してみてください。</p>
                      <button
                        className="secondary"
                        onClick={() => {
                          setQuery('')
                          setIngredients([])
                          setIngredientInput('')
                          setFilter('all')
                        }}
                      >
                        検索条件をリセット
                      </button>
                    </div>
                  ) : (
                    <div className="empty-state">
                      <BookOpen className="empty-icon" />
                      <h2>レシピはまだありません</h2>
                      <p>URLや紙の写真から追加できます。</p>
                    </div>
                  )}
                </>
              )}
              {page === 'records' && (
                <>
                  <div className="page-heading">
                    <div>
                      <h1>
                        作った記録<span className="heading-dot">.</span>
                      </h1>
                    </div>
                    <span className="record-total">{logs.length}回の記録</span>
                  </div>
                  {logs.length ? (
                    <div className="records-grid">
                      {logs.map(({ recipe, log }) => (
                        <button
                          className="record-card"
                          key={`${recipe.id}-${log.id}`}
                          onClick={() => setModal({ type: 'log', recipe, log })}
                        >
                          {log.photos[0] ? (
                            <img src={log.photos[0].dataUrl} loading="lazy" alt={titleOf(recipe)} />
                          ) : (
                            <div className="record-placeholder">
                              <CookingPot size={36} strokeWidth={1.2} />
                            </div>
                          )}
                          <div className="record-body">
                            <span className="record-date">
                              <CalendarDays size={14} />
                              {dateLabel(log.date)}
                            </span>
                            <h2>{titleOf(recipe)}</h2>
                            <p>{log.note || 'この日に作りました。'}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state">
                      <Camera className="empty-icon" />
                      <h2>最初の「作った」を残そう</h2>
                      <p>
                        レシピを開いて「記録する」から、
                        <br />
                        写真と感想を残せます。
                      </p>
                      <button className="secondary" onClick={() => setPage('recipes')}>
                        レシピ帳を開く
                        <ChevronRight size={17} />
                      </button>
                    </div>
                  )}
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
                      <HardDrive className="setting-icon" />
                      <h2>このブラウザに保存しています</h2>
                      <p>
                        レシピと写真は、この端末のこのブラウザに保存されます。サーバーへの送信や、自動同期は行いません。
                      </p>
                      <p>
                        ブラウザのデータ削除やプライベートブラウズでは、記録が失われる場合があります。定期的にバックアップを保存してください。
                      </p>
                      <div className="storage-stats">
                        <span>
                          <strong>{recipes.length}</strong> レシピ
                        </span>
                        <span>
                          <strong>{logs.length}</strong> 調理記録
                        </span>
                        {storage?.usage !== undefined && (
                          <span>使用量 約{(storage.usage / 1024 / 1024).toFixed(1)} MB</span>
                        )}
                      </div>
                      <p className="fineprint">
                        同じ端末でも、ChromeとSafari、アクセスするURLが異なる場合は保存先が分かれます。
                      </p>
                    </section>
                    <section className="settings-card">
                      <Download className="setting-icon" />
                      <h2>バックアップ</h2>
                      <p>レシピ・写真・調理記録を、ひとつのファイルにまとめて書き出します。</p>
                      <button className="primary" disabled={busy} onClick={backup}>
                        <Download size={18} />
                        バックアップを書き出す
                      </button>
                      <p className="fineprint">
                        {lastBackup
                          ? `前回の書き出し操作：${dateLabel(lastBackup)}`
                          : 'まだバックアップを書き出していません。'}
                        <br />
                        ダウンロード後にファイルが保存されたことを確認してください。
                      </p>
                      <div className="settings-divider" />
                      <h3>バックアップから取り込む</h3>
                      <p>
                        別の端末への移行にも使えます。同じIDのレシピは上書きせず、新しいレシピだけを追加します。
                      </p>
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
                      {settingsError && (
                        <p className="error" role="alert">
                          {settingsError}
                        </p>
                      )}
                    </section>
                    <section className="settings-card">
                      <BookOpen className="setting-icon" />
                      <h2>ホーム画面から、すぐに</h2>
                      <p>
                        ブラウザのメニューにある「インストール」や「ホーム画面に追加」から、アプリとして使えます。表示名や操作はブラウザによって異なります。
                      </p>
                      <p className="fineprint">
                        Chrome・Safari向け。外部レシピの閲覧には通信が必要です。
                      </p>
                    </section>
                    <section className="settings-card">
                      <Leaf className="setting-icon" />
                      <h2>作り手への、ひとさじの敬意</h2>
                      <p>
                        外部のレシピは、元のサイトを開いて読みます。作り方の全文や動画は、このレシピ帳に取り込みません。
                      </p>
                      <p className="fineprint">ひとさじ v0.1 · 個人のためのレシピ帳</p>
                    </section>
                  </div>
                </>
              )}
            </>
          )}
        </main>
      </div>
      <nav className="mobile-nav" aria-label="モバイルメニュー">
        {navigation()}
      </nav>
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
          onLog={(log) => setModal({ type: 'log', recipe: selected, log })}
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
      {modal?.type === 'log' && (
        <LogForm
          key={modal.log?.id || modal.recipe.id}
          recipe={modal.recipe}
          initial={modal.log}
          onClose={() => setModal({ type: 'detail', id: modal.recipe.id })}
          onSave={save}
        />
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
              現在の記録は残し、未登録のレシピだけを写真・調理記録と一緒に追加します。同じIDのレシピは上書きしません。
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
