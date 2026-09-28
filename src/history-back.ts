import { useEffect, useRef } from 'react'

const KEY = 'hitosajiLayer'
let pendingBack: number | undefined

function layerDepth(state: unknown): number {
  const depth = (state as Record<string, unknown> | null)?.[KEY]
  return typeof depth === 'number' ? depth : 0
}

/**
 * 開いている間だけ履歴を1つ積み、ブラウザの「戻る」（端からのスワイプ・Androidの戻る操作）で
 * アプリから出ずに閉じられるようにする。onBackがfalseを返したら閉じずに履歴を積み直す。
 */
export function useHistoryBack(enabled: boolean, onBack: () => boolean) {
  const onBackRef = useRef(onBack)
  useEffect(() => {
    onBackRef.current = onBack
  })
  useEffect(() => {
    if (!enabled) return
    let depth = layerDepth(history.state)
    if (pendingBack !== undefined && depth > 0) {
      // 閉じた直後に開き直した（StrictModeの再実行や別レシピへの切り替え）ので、同じ履歴を使い回す。
      window.clearTimeout(pendingBack)
      pendingBack = undefined
    } else {
      depth += 1
      history.pushState({ ...history.state, [KEY]: depth }, '')
    }
    let popped = false
    const onPopState = () => {
      if (layerDepth(history.state) >= depth) return
      if (onBackRef.current()) popped = true
      else history.pushState({ ...history.state, [KEY]: depth }, '')
    }
    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('popstate', onPopState)
      if (popped || layerDepth(history.state) !== depth) return
      // ボタンなどで閉じたときは、積んだ履歴を戻して取り除く。
      pendingBack = window.setTimeout(() => {
        pendingBack = undefined
        history.back()
      })
    }
  }, [enabled])
}
