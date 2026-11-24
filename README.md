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

生成先は `.mvp/releases/`。`index.html`、`styles.css`、`comfylabo-logo.jpg` と照合情報を含みます。
環境設定は `.env.example` を参考に、Git対象外の `.env.local` へ置きます。
鍵本体・パスフレーズ・GitHubトークンはこのファイルへ記録しません。
下書き原稿 `.draft.json` と生成物・証跡は公開ソースに含めません。

Next.jsの既存画面とStudioは開発用として残しています。
`npm run dev` で起動でき、`/mvp` は開発時だけ表示し、本番では404です。
Studioの認証は弱めていません。

## ファイルの役割

| ファイル | 役割 |
| --- | --- |
| `scripts/site.mjs` | 公開記事1本の取得と静的生成の入口 |
| `scripts/mvp-content.mjs` | 匿名での公開記事取得 |
| `scripts/mvp-export.mjs` | HTML・CSS・ロゴの生成とハッシュ検証 |
| `scripts/site_bundle.py` | 検証済み5ファイルだけを再現可能なZIPにする |
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
