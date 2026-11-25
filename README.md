# ComfyLabo next

記事1本から始める、SanityとXserverのための小さな公開システムです。
開発方針と承認ルールは [AGENTS.md](AGENTS.md) を参照してください。

**2026-11-24、Sanityの公開更新からXserverへの自動反映まで、実データで確認できました。**

- 確認用サイト：[next.comfylabo.com](https://next.comfylabo.com/)
- 専用リポジトリ：[ComfyLabo/comfylabo-next](https://github.com/ComfyLabo/comfylabo-next)
- 対象記事：「ComfyLaboへようこそ」（ID `comfylabo-mvp-welcome`、slug `comfylabo-welcome`）
- 対象Sanity：`0lwnb6yi / production`

既存Xserver本番・旧記事・旧GitHub/Vercel・Mac Publisherは変更しません。
公開範囲はこの記事1本と確認用サイトに限定し、検索除外を維持します。

## 自動反映の流れ

```text
Sanityで公開済み記事を更新
  → Sanity WebhookがGitHubへrepository_dispatchを送信
  → GitHub Actionsが公開記事1本を匿名取得・生成・検証
  → 専用comfylabo-preview ReleaseへZIPとSHA-256を保存
  → XserverのCronが2分ごとにHTTPS取得・照合
  → currentを切り替え、previousで直前の正常版を保持
```

専用リポジトリのmainへのコード反映でも、承認済みのこの記事だけを再生成します。
GitHubにXserverのSSH鍵やパスフレーズを預けません。Sanityの下書き用トークンも生成に使いません。
Pythonは標準ライブラリだけを使い、XserverのPython 3.6に対応しています。

## 実環境で確認したこと

[実通知からのGitHub Actions実行](https://github.com/ComfyLabo/comfylabo-next/actions/runs/45399857651)で、
テスト15件・記事生成・ZIP検証・Release更新が成功しました。
Sanityの配送ログはHTTP 204で成功し、Xserverの定期実行が同じ記事リビジョンへ切り替えたことを照合しました。
HTTPSでHTML・CSS・既存ロゴの内容一致と、内部ファイルが404になることも確認済みです。

この試験は個別承認後に公開日時だけを更新しました。本文・タイトル・slug・下書きは維持しました。
下書きを削除する通常のStudio Publish操作そのものは、この試験では行っていません。
以前の実サーバー試験で、直前版への復旧と、復旧後に同じ版を勝手に再適用しないことも確認しています。
既存本番設定はハッシュで不変を確認し、既存Cronの元のバイト列も保持しました。

## 開発と検証

```bash
npm ci
npm run test:mvp
npm run test:pull
npm run lint
npx --no-install tsc --noEmit

# Sanityに接続しない表示確認
npm run site:build -- --sample
# 公開済み記事を匿名取得して生成
npm run site:build -- comfylabo-welcome
# 生成済み成果物と実配信の照合
npm run site:verify -- https://next.comfylabo.com/ '.mvp/releases/<版>'
```

記事の表示は白い背景と読みやすい本文幅を基本に、スマホ17px・PC18pxで調整しています。
CSSの読み込みURLには内容ハッシュを付け、更新後に古いデザインが残ることを防ぎます。

生成先は `.mvp/releases/`。`index.html`、`styles.css`、`comfylabo-logo.jpg` と照合情報を含みます。
本文画像は同じSanityプロジェクト・データセットのJPEG/PNG/WebP元画像URLだけを取得し、
`image-<SHA-256>.<拡張子>` として同梱します。画像への原寸リンクも同梱先へ置き換えます。
画像は最大10枚、1枚5MiB、画像合計8MiB、成果物全体10MiB以内です。
取得失敗・形式不一致・容量超過では生成を止め、以前の正常版を変更しません。
画像もZIP・切り替え時・HTTPS配信後のハッシュ照合に含めます。

この画像対応はローカル実装済みで、Xserverには未反映です。
配備前に専用Cronを停止し、`site_bundle.py` / `xserver_pull.py` と確認用サブドメインだけの
`config/preview.htaccess` を承認後に更新・検証してから再開します。
サーバー上の旧版は本文画像を含むZIPを拒否するため、先に画像付きReleaseだけを公開しないでください。
記事範囲は引き続き「ComfyLaboへようこそ」1本です。Obsidian記事への切り替えは未承認で、
Mac Publisherの読み取り調査は完了しており、確認した経路ではSanity Publishだけで旧本番を自動更新しません。
Obsidian記事のPublishは、具体的な公開対象の承認を済ませてから行います。
確認済みの影響範囲、残る確認事項、反映と復旧の順序は
[Obsidian記事の確認用反映計画](docs/obsidian-preview-plan.md) にまとめています。
環境設定は `.env.example` を参考に、Git対象外の `.env.local` へ置きます。
鍵本体・パスフレーズ・GitHubトークンはこのファイルへ記録しません。
下書き原稿 `.draft.json` と生成物・証跡は公開ソースに含めません。

Next.jsの既存画面とStudioは開発用として残しています。
`npm run dev` で起動でき、`/mvp` は開発時だけ表示し、本番では404です。
Studioの認証は弱めていません。

## 記事一覧と個別ページ（ローカル実装）

Sanityに追加・公開された記事を一度の匿名クエリで取得し、トップの一覧と
`/posts/<slug>/` の個別ページをまとめて生成できます。
一覧は公開日時の新しい順で、各記事から一覧へ戻れます。既存ロゴ・本文表示・画像同梱を再利用します。

```bash
# 公開済みの実記事だけを取得（Sanityへの書き込みなし）
npm run blog:build
# Sanityに接続せず、明示したサンプル2件で記事追加後の構成を確認
npm run blog:build -- --sample
# 上のコマンドが表示する生成先を指定
npm run blog:preview -- .mvp/blog-releases/<版>
```

確認先は http://127.0.0.1:4175/ です。ループバックだけで待ち受け、検証済みのHTML・素材だけを配信します。
認証情報・manifest・チェックサム一覧は配信しません。サンプル記事はSanityへ登録されません。
下書き・バージョン・空本文・重複ID/slug・危険なパス・不正な日付を拒否し、1件でも失敗したら以前の生成版を保持します。
現段階は100記事・成果物全体10MiBまでで、上限超過を黙って切り捨てず停止します。

この複数記事版は `.mvp/blog-releases/` に分け、形式をversion 2にしています。
既存の1記事用ZIP・転送処理はこの形式を拒否します。現在のWebhook・GitHub・Xserverの
自動反映対象は引き続き「ようこそ」1本です。複数記事のZIP・受信・配信照合とGitHubのモード切り替えは
ローカル実装済みで、配備・運用範囲の拡大は未承認です。`COMFYLABO_PREVIEW_MODE` は未指定ならsingleで、
明示的にblogへ変更するまで一覧版を受け付けません。サンプルはblogモードでも配備対象として拒否します。
Sanityの公開済み実記事は確認時点で1件。サンプル2件の画面はユーザーが確認済みです。
現在の4175は実際の公開済み1件の配備候補を表示しています。
[一覧版の配備範囲・切り替えと復旧](docs/blog-preview-deployment.md) を確認し、承認後に外部へ反映します。

## 新システムの記事入力画面

`npm run studio:dev` で起動し、http://localhost:3333/studio を開きます。
Sanityで既に許可されているlocalhost:3333を使い、既存の認証を維持します。
Basic認証には `.env.local` のSTUDIO_USERNAME / STUDIO_PASSWORDを使用し、続いて必要に応じてSanityへログインします。値をチャットへ送らないでください。

「確認用の記事（MVP）」から対象記事を直接開けます。通常の入力はタイトル・URL識別名・Markdown本文・公開日時の順です。
画像・検索・著者と旧記事・移行情報は折りたたみ、既存データの保存名・型・検証条件は維持しています。
この入力画面の変更はローカル用です。旧VercelのStudioには配備していません。

## この作業フォルダーのGit接続

開発ブランチは `codex/comfylabo-next-dev`、originは専用の `ComfyLabo/comfylabo-next` です。
旧リポジトリはlegacyとして保持し、ローカルからのpushを無効化しました。旧ブランチlegacy-mainも保持しています。
切り替え前の変更はGit stashと `.mvp/latest-workspace-backup.txt` が指すバックアップに保存済みです。
環境設定や下書きなどのGit対象外ファイルは移動していません。`.mvp` はTypeScriptの検査対象からも除外します。

## ファイルの役割

| ファイル | 役割 |
| --- | --- |
| `scripts/site.mjs` | 公開記事1本の取得と静的生成の入口 |
| `scripts/mvp-content.mjs` | 匿名での公開記事取得 |
| `scripts/mvp-export.mjs` | HTML・CSS・ロゴ・本文画像の生成とハッシュ検証 |
| `scripts/article-images.mjs` | Sanity画像の制限付き取得と同梱先への置換 |
| `lib/site-files.mjs` | 公開ファイル名とハッシュ一覧の検証 |
| `scripts/site_bundle.py` | 基本5ファイルと検証済み本文画像を再現可能なZIPにする |
| `scripts/xserver_pull.py` | 定期取得・記事範囲の確認・切り替え・配信異常時の復旧 |
| `scripts/xserver-release.sh` | 検証済みの版の切り替えと復旧 |
| `scripts/verify-site.mjs` | HTTPSの内容一致・内部パス拒否の検証 |
| `scripts/xserver.mjs` | 承認後に手元からSSH/SCPで反映・復旧する補助処理 |
| `.github/workflows/site.yml` | 通知とmainへの反映からの生成・Release更新 |
| `config/preview.htaccess` | 確認用サブドメインだけの公開範囲設定 |

## 停止と復旧

専用保存先は `/home/<サーバーID>/comfylabo-next` です。
`releases/` に版を保持し、`current` と `previous` で使用版・直前版を管理します。
生成・取得・照合が失敗したら使用版を維持し、切り替え後のHTTPS照合に失敗したら直前版へ戻します。
不良版や過去版を自動削除しません。

停止・手動復旧・手動反映の前には、この専用Cronだけを無効化してください。
既存の別ジョブを上書き・削除せず、current / previousとログを確認してから復旧します。
復旧はSanityの記事削除や旧記事の変更を必要としません。
ローカルの `scripts/xserver.mjs rollback` は、接続先確認と個別承認後に
`COMFYLABO_DEPLOY_ENABLED=true` を渡して実行します。既存のホスト鍵照合は省略しません。

GitHub Repository Variable `COMFYLABO_AUTO_DEPLOY=false` でRelease更新も停止できます。
未設定時の有効化は、ユーザーが承認したこの専用リポジトリ・この記事・確認用URLだけです。
Sanity側で公開済みの記事を取得できなくなっても、確認用サイトを空にせず直前版を保持します。

Sanity Webhook名は `ComfyLabo next preview`。対象記事のcreate/updateだけを通知し、draft/version/deleteは除外します。
GitHubトークンはユーザーがSanityのAuthorizationヘッダーへ直接入力済みです。
トークンの設定済み有効期限が来る前に、ユーザー操作で更新する必要があります。
SanityのPublish・記事削除・別の本番への配備・費用発生は、引き続き個別の事前承認が必要です。
