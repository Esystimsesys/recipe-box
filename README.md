# ひとさじ — わたしのレシピ帳

「ひとさじ」は、気になるレシピと料理写真を自分の端末に保存する、個人向けのレシピ管理PWAです。

- Web上のレシピURLや手元のレシピを保存
- リンクのタイトルとプレビュー画像を自動入力、既存の空欄のレシピ名・材料などを設定から一括再取得
- 名前・材料など・メモ・出典から検索、追加順・更新順・名前順で並び替え
- 「作った」「お気に入り」で整理
- 料理写真・メモを追加
- 写真を含むJSONバックアップの書き出しと復元
- インストール後のオフライン利用
- Androidの共有メニューからURLを受け取り、確認して登録

料理サイトは構造化データにある材料を「材料など」に自動入力し、検索に使います。料理サイトの作り方は取り込まず、元サイトで確認します。YouTubeの概要欄は作り方を含むことが多いため取り込みません（「材料など」に手で書けます）。X・Instagram・TikTokなどのSNS本文は取り込みません。YouTubeやTikTokのoEmbed、クラシル公式レシピ（`/recipes/`）の公開サムネイル、Instagramの公開埋め込みを使ってプレビューを表示します。Xの公開投稿は[FxEmbedの公開API](https://github.com/FxEmbed/FxEmbed/blob/main/docs/src/content/docs/api/introduction.mdx)に投稿IDを送って画像URLを取得します。TikTokの画像URLが期限切れになった場合は再取得します。非公開・削除済みの投稿など、画像やタイトルを取得できない場合もURLは保存できます。レシピ、料理写真、メモはブラウザのIndexedDBに保存され、アプリ独自のサーバーへの送信や自動同期は行いません。

以前のバージョンで取得したYouTubeの概要欄は、そのまま端末に残ります。不要なものはレシピを編集して消せます。

公開先：[GitHub Pages](https://esystimsesys.github.io/recipe-box/)
リポジトリ：[Esystimsesys/recipe-box](https://github.com/Esystimsesys/recipe-box)

## 共有メニューから登録

AndroidではChromeで公開版をホーム画面にインストールすると、他のアプリやサイトの「共有」に「ひとさじ」が表示されます。選ぶとURLと共有タイトルが登録フォームに入り、「保存する」で登録できます。共有元がURLを渡さない場合は、フォームで入力できます。共有先に表示されないアプリもあるため、その場合は従来どおりURLを貼り付けてください。

iPhoneのSafariはPWAを共有先として登録できません。設定画面の「ショートカットを追加」から[ひとさじに登録](https://www.icloud.com/shortcuts/f78f1b3c4d8749bfa6b7e631159f7ae3)をiPhoneに追加すると、SafariやChromeなどの共有メニューからレシピのURLを登録画面に渡せます。共有URLは `#share_target=1&url=...` の形式でブラウザ版に渡します。URLはフラグメントとして渡すため、ページのリクエストには含まれません。ホーム画面のPWAとブラウザ版は保存領域が分かれるため、同じレシピ帳に記録を集める場合はブラウザ版を使い、必要ならバックアップから記録を復元してください。

## 開発

Node.js 24で確認しています。依存バージョンは `package-lock.json` を参照してください。

```sh
npm ci
cp .env.example .env.local
npm run dev
```

`VITE_LINK_METADATA_ENDPOINT` はリンクのタイトル・材料を取得するエンドポイントです。未設定でもURLは保存できます。

開発時だけX・Instagram・TikTok・Cookpadのサンプルを各2件、既存データを上書きせず一度だけ追加します。削除したサンプルは自動復活しません。本番ビルドと公開版には含まれません。

開発サーバーは `http://localhost:5188/` で起動します。Service Workerは本番ビルドで有効になります。

```sh
npm run build
npm run preview
npm test
npm run test:e2e
npm run format:check
```

Playwrightのブラウザが未導入の場合は、最初に次を実行します。

```sh
npx playwright install chromium webkit
```

GitHub Pages向けの本番ビルドではベースパスを指定します。

```sh
BASE_PATH=/recipe-box/ npm run build
```

## リンクのタイトル取得（Cloudflare Worker）

レシピサイトの多くはCORSヘッダーを返さないため、ブラウザからはページを読めません。[worker/](worker/) のWorkerがタイトル・画像に加え、構造化データの材料だけを返します。料理サイトの作り方や動画、YouTubeの概要欄は取得しません。

- 参照元は `worker/wrangler.jsonc` の `ALLOWED_ORIGINS` と、tailnet（`*.ts.net`）のオリジンだけ許可します。Originは詐称できるため、これは認証ではなく無料枠を守るための目印です。
- 取得先は公開DNS名のみで、IPアドレス・`.local`・`.internal`・`.ts.net` 宛ては拒否します。
- 結果は6時間、取得元のHTMLは1時間キャッシュします。読み取りは512KBで打ち切ります。
- Workerが落ちても、タイトルが入らないだけでURLの保存は続きます。

```sh
npm --prefix worker ci
npm run worker:dev        # http://localhost:8787 で動かす
npm run worker:deploy     # Cloudflareへ反映する
npm --prefix worker run typecheck
```

`worker-configuration.d.ts` は `wrangler types` が生成するため追跡していません（`typecheck` が先に生成します）。

Cloudflare Workersの無料枠（100,000リクエスト/日、CPU 10ms/リクエスト）で動きます。

## データとバックアップ

保存先はブラウザとオリジンごとに分かれます。ブラウザデータの消去や公開URLの変更に備え、設定画面から定期的にバックアップを書き出してください。バックアップには写真やメモも含まれます。

設定画面下部の「情報の取得」では、空欄のレシピ名・材料などを取得できます。再取得はキャッシュを使わず取得元を確認し、自動取得と記録された項目だけを更新します。手入力した内容と取得元を判別できない旧データは保護します。例外として、旧データに残ったYouTubeの共通案内文は修正対象です。取得元の区別もバックアップに含まれます。

写真は1枚15MB、各グループ12枚までです。JPEG、PNG、WebPを読み込み、ブラウザ内で縮小・JPEG変換して保存します。HEIC／HEIFはブラウザが読み込める場合に限り変換できます。

## ドキュメント

- [プロダクト設計](docs/plan.md)
- [ロードマップ](docs/roadmap.md)
