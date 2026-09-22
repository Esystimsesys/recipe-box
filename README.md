# ひとさじ — わたしのレシピ帳

「ひとさじ」は、気になるレシピと料理写真を自分の端末に保存する、個人向けのレシピ管理PWAです。

- Web上のレシピURLや手元のレシピを保存
- 取得可能なリンクはタイトルとプレビュー画像を自動入力
- 名前・材料・メモ・出典から検索
- 「作った」「お気に入り」で整理
- 料理写真・メモを追加
- 写真を含むJSONバックアップの書き出しと復元
- インストール後のオフライン利用
- Androidの共有メニューからURLを受け取り、確認して登録

外部レシピの本文・動画は取り込みません。YouTubeなどのoEmbed対応サービスや、ブラウザからの取得を許可している公開ページでは、タイトルとプレビュー画像のURLだけを取得します。取得できない場合もURLは保存でき、作り方は元サイトを開いて確認します。レシピ、写真、メモはブラウザのIndexedDBに保存され、サーバーへの送信や自動同期は行いません。

公開先：[GitHub Pages](https://esystimsesys.github.io/recipe-box/)
リポジトリ：[Esystimsesys/recipe-box](https://github.com/Esystimsesys/recipe-box)

## 共有メニューから登録

AndroidではChromeで公開版をホーム画面にインストールすると、他のアプリやサイトの「共有」に「ひとさじ」が表示されます。選ぶとURLと共有タイトルが登録フォームに入り、「保存する」で登録できます。共有元がURLを渡さない場合は、フォームで入力できます。共有先に表示されないアプリもあるため、その場合は従来どおりURLを貼り付けてください。

iPhoneのSafariはPWAを共有先として登録できません。設定画面の「ショートカットを追加」から[ひとさじに登録](https://www.icloud.com/shortcuts/f78f1b3c4d8749bfa6b7e631159f7ae3)をiPhoneに追加すると、SafariやChromeなどの共有メニューからレシピのURLを登録画面に渡せます。共有URLは `#share_target=1&url=...` の形式でブラウザ版に渡します。URLはフラグメントとして渡すため、ページのリクエストには含まれません。ホーム画面のPWAとブラウザ版は保存領域が分かれるため、同じレシピ帳に記録を集める場合はブラウザ版を使い、必要ならバックアップから記録を復元してください。

## 開発

Node.js 24で確認しています。依存バージョンは `package-lock.json` を参照してください。

```sh
npm ci
npm run dev
```

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

## データとバックアップ

保存先はブラウザとオリジンごとに分かれます。ブラウザデータの消去や公開URLの変更に備え、設定画面から定期的にバックアップを書き出してください。バックアップには写真やメモも含まれます。

写真は1枚15MB、各グループ12枚までです。JPEG、PNG、WebPを読み込み、ブラウザ内で縮小・JPEG変換して保存します。HEIC／HEIFはブラウザが読み込める場合に限り変換できます。

## ドキュメント

- [プロダクト設計](docs/plan.md)
- [ロードマップ](docs/roadmap.md)
