import { useEffect, useRef } from 'react'

const KEY = 'hitosajiLayer'
let pendingBack: number | undefined
let backInFlight = false
let afterBack: (() => void)[] = []

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    if (!backInFlight) return
    backInFlight = false
    const queued = afterBack
    afterBack = []
    queued.forEach((run) => run())
  })
}

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
    let depth = 0
    let popped = false
    const onPopState = () => {
      if (layerDepth(history.state) >= depth) return
      if (onBackRef.current()) popped = true
      else history.pushState({ ...history.state, [KEY]: depth }, '')
    }
    const push = () => {
      depth = layerDepth(history.state) + 1
      history.pushState({ ...history.state, [KEY]: depth }, '')
      window.addEventListener('popstate', onPopState)
    }
    if (pendingBack !== undefined && layerDepth(history.state) > 0) {
      // 閉じた直後に開き直した（StrictModeの再実行や別レシピへの切り替え）ので、同じ履歴を使い回す。
      window.clearTimeout(pendingBack)
      pendingBack = undefined
      depth = layerDepth(history.state)
      window.addEventListener('popstate', onPopState)
    } else if (backInFlight) {
      // 前の履歴を戻している途中に積むと、戻った先で閉じてしまうため、戻り終えてから積む。
      afterBack.push(push)
    } else {
      push()
    }
    return () => {
      afterBack = afterBack.filter((run) => run !== push)
      window.removeEventListener('popstate', onPopState)
      if (popped || !depth || layerDepth(history.state) !== depth) return
      // ボタンなどで閉じたときは、積んだ履歴を戻して取り除く。
      pendingBack = window.setTimeout(() => {
        pendingBack = undefined
        backInFlight = true
        history.back()
      })
    }
  }, [enabled])
}
