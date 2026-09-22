/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** リンクのタイトルを取得するエンドポイント。未設定なら自動取得を行わない（worker/ を参照）。 */
  readonly VITE_LINK_METADATA_ENDPOINT?: string
}
