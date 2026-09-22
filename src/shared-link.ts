import { normalizeUrl } from './domain'

export type SharedLink = { url: string; title: string }

export function takeSharedLink(location: Location, history: History): SharedLink | null {
  const current = new URL(location.href)
  const fragment = new URLSearchParams(current.hash.slice(1))
  const fromQuery = current.searchParams.get('share_target') === '1'
  const fromFragment = fragment.get('share_target') === '1'
  if (!fromQuery && !fromFragment) return null
  const params = fromQuery ? current.searchParams : fragment

  const url = params.get('url') || ''
  const text = params.get('text') || ''
  const title = params.get('title') || ''
  for (const key of ['share_target', 'url', 'text', 'title']) params.delete(key)
  if (!fromQuery) current.hash = fragment.toString() ? `#${fragment}` : ''
  history.replaceState(history.state, '', `${current.pathname}${current.search}${current.hash}`)

  const candidates = [url, text].filter(Boolean)
  let sharedUrl = candidates[0] || ''
  for (const candidate of candidates) {
    try {
      sharedUrl = normalizeUrl(candidate)
      break
    } catch {
      // Leave the original shared text editable if neither value contains a URL.
    }
  }
  return { url: sharedUrl.slice(0, 4000), title: title.trim().slice(0, 200) }
}
