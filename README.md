# ComfyLabo 新システム

記事1本から始める、SanityとXserverのための小さな公開システムです。開発ルールは [AGENTS.md](AGENTS.md) を参照してください。

## 公開までの流れ

```text
SanityでPublish
  → GitHub Actionsへ通知
  → 指定した記事1本を取得
  → HTML・CSS・既存ロゴを生成して検証
  → GitHubの専用プレビューReleaseへ静的ファイルを保存
  → Xserverが2分ごとにHTTPS取得して再検証
  → currentを切り替え（previousで直前版を保持）
```

専用Macアプリ、確認票、承認トークンの発行機構は作りません。記事取得から生成までは1コマンドです。途中で失敗したら公開入口を切り替えません。

**Sanityの公開済み記事1本を取得・生成し、確認用サブドメインへ反映する一連の手動試験に成功しました。** ユーザー承認後にサブドメインを追加し、確認用フォルダーへ設定を配置しました。Xserverの反映と無料SSLの有効化が完了し、HTTPSでの内容一致とブラウザ表示も確認できました。Sanityの記事「ComfyLaboへようこそ」は個別承認後に公開済みです。GitHubへのpush、Actionsの実行、Webhookの登録は行っていません。継続的な配備と自動配備のフラグは両方とも無効のままです。既存Xserver本番・旧記事・現行Publisherは変更しません。

## 手元で確認する

依存関係が未導入の場合だけ `npm ci` を実行します。

```bash
# Sanityに接続しないサンプル記事で確認
npm run site:build -- --sample
# Sanityの公開済み記事1本を直接取得して生成
npm run site:build -- '対象記事のslug'
# 基本確認
npm run test:mvp
npm run test:pull
npm run lint
npx --no-install tsc --noEmit
# 公開入口の反映後に、HTTPSで配信された内容まで照合
npm run site:verify -- https://next.comfylabo.com/ '.mvp/releases/<版>'
```

生成先は `.mvp/releases/<日時とID>/` です。`index.html`、`styles.css`、`comfylabo-logo.jpg` と照合用ファイルを含みます。このフォルダーの `index.html` をブラウザで開けば確認できます。表示にはNext.jsやSanityへの接続は不要です。

MVPの公開先は確認用サブドメインなので、サンプルにも実際のSanity記事にも確認用の表示と `noindex` を付けます。検索除外を外す変更は本番公開の範囲を決めてから行います。本文は既存ライブラリの標準Markdown / Portable Text表示を使い、一時的なTSXコンパイルや短文を表と推測する処理は通しません。複雑な旧記事の再現はMVPの対象外です。

Sanityの接続情報は、既存の `.env.local` を変更せず利用できます。新しく設定する場合は `.env.example` を参考にしてください。匿名で公開済みの記事を取得し、下書き用トークンは使いません。非公開datasetは未対応です。

## ファイルの役割

| ファイル | 役割 |
| --- | --- |
| `scripts/site.mjs` | 記事1本の取得と生成をまとめる入口 |
| `scripts/mvp-content.mjs` | 公開済み記事の読み取り |
| `scripts/mvp-export.mjs` | HTML・CSS・ロゴの生成と検証 |
| `scripts/xserver.mjs` | 手元からの転送前の照合、SSH/SCPの実行 |
| `scripts/site_bundle.py` | 検証済み5ファイルだけを再現可能なZIPにする |
| `scripts/xserver_pull.py` | Xserver上での定期取得、記事範囲の確認、照合・切り替え・失敗時復旧 |
| `scripts/verify-site.mjs` | HTTPSでの3ファイルの一致と内部パスの拒否を検証 |
| `scripts/xserver-release.sh` | Xserver側での検証、版の切り替え、復旧 |
| `.github/workflows/site.yml` | Publish通知または手動操作から実行 |
| `app/mvp/export.css` | 静的記事のデザイン |

Next.jsの既存画面・Studio・`/mvp` は開発用として残しています。`npm run dev` で起動できます。Studioの認証は変更していません。従来の `mvp:articles` / `mvp:snapshot` / `mvp:export` も補助コマンドとして残していますが、通常の生成で保存ファイルの手渡しは不要です。

## Xserverでの保持と復旧

```text
/home/<サーバーID>/comfylabo-next/
  releases/<版>/     ← 新版を先に置いて検証
  current           ← 使用する版へのリンク
  previous          ← 直前版へのリンク
```

新システム専用の上記保存先に限定しています。すでに存在する管理対象外のフォルダーは変更しません。既存本番の `public_html` や公開入口を自動で書き換える処理はありません。

転送前にローカルでハッシュを照合し、転送後にもサーバー上で照合します。全ファイルが一致してから `current` のリンクを一度に置き換えます。復旧では `previous` を再検証してから戻します。失敗した版や過去版は自動削除しません。

確認用のWeb公開入口をこの `current` に接続する設定を、ユーザー承認後に配置しました。既存本番の入口は流用していません。HTTPSの照合には `site:verify` を使い、証明書、HTML・CSS・ロゴの内容一致、内部パスが404になることを確認します。初期ページがHTTP 200を返しただけでは成功と扱いません。

確認用URLは `https://next.comfylabo.com/` です。2026-11-23にユーザーが新規追加し、無料独自SSLを選択しました。追加直後は「反映待ち」で初期ページ・対象名に不一致の証明書が返りましたが、その後反映が完了しました。通常の証明書検証を維持したHTTPS通信で、記事・CSS・ロゴのハッシュ一致と内部パスの404を確認しました。ブラウザでも表示を確認済みです。

新しい公開フォルダーは `/home/comfylabo/comfylabo.com/public_html/next.comfylabo.com` です。このフォルダー内だけに `config/preview.htaccess` と `site` リンク（新システムの `current` を参照）を配置しました。既存サイト直下の `.htaccess` はハッシュで変更されていないことを確認済みです。無料SSLの確認ファイルは許可し、記事・CSS・ロゴ以外の内部パスは拒否します。MacのローカルApacheで同じ親子構成を再現し、HTML・CSS・ロゴの内容一致、内部パスの404、SSL確認ファイルの配信、既存サイト相当ページへのアクセスが維持されることを確認しました。Xserverのフォルダー内には初期ファイルもありますが、削除や上書きはしていません。公開範囲は確認用記事1本です。公開後の検証記録とスクリーンショットはGit管理対象外の `.mvp/evidence/` に保存しました。既存9件と定期取得6件の計15件、Lint、TypeScript型検査が成功しています。WorkflowはYAMLとして読み込み確認済みで、Actions上での実行は未実施です。

手動で使う場合も、接続先の確認と事前承認後に環境変数を設定して実行します。

ローカルの入力場所はGit管理対象外の `.env.local` です。`XSERVER_HOST` にホスト名、`XSERVER_USER` にサーバーID、`XSERVER_PORT` にポート番号を入力します。既存の秘密鍵ファイルは `XSERVER_SSH_KEY_PATH` に絶対パスだけを指定できます。鍵本体・管理画面のパスワード・鍵のパスフレーズは `.env.local` に書きません。`XSERVER_RELEASE_ROOT` と有効化設定は公開先を確定するまで変更しません。

```bash
# 有効化変数がtrueでない限り、接続前に停止
node --env-file=.env.local scripts/xserver.mjs deploy '.mvp/releases/<版>'
node --env-file=.env.local scripts/xserver.mjs rollback
```

切り替え直後に通信が切れた場合は、成功とも失敗とも断定せず、サーバー上の `current` を読み取り確認してから次の操作を行います。自動再試行はしません。

## GitHub ActionsとSanityの接続（有効化は承認後）

XserverはSSHの国外アクセス制限がON、現在の鍵はユーザーがMacのSSHエージェントで解除する方式でした。この制約に合わせ、自動運用ではXserverからGitHubをHTTPS取得します。SSHの国外制限・鍵・既存Publisherは変更しません。サーバーのPython 3.6.8とGitHubへのHTTPS接続を読み取りで確認済みです。Pythonは標準ライブラリだけを使い、新しい依存関係を追加しません。

GitHub Actionsは対象を `0lwnb6yi / production / comfylabo-welcome` に固定し、記事生成と検証の後、専用の `comfylabo-preview` prereleaseにZIPとSHA-256を保存します。リポジトリは公開のため、このZIPも公開されます。内容は公開記事・CSS・ロゴ・照合情報だけで、認証情報や下書きは含めません。`comfylabo-preview` は調査時点では存在しませんでした。他のReleaseは操作しません。

GitHubのRepository Variable `COMFYLABO_AUTO_DEPLOY` が `true` のときだけ、既定ブランチmainのPublish通知または手動 `publish-preview` からReleaseを更新できます。初期状態の手動 `build` は生成・検証だけです。Actionsのキャッシュ・Artifact保管は追加せず、公開用ZIPは有効化後に専用Releaseだけへ保存します。GitHubにXserverのSSH鍵やパスフレーズを登録する必要はありません。Sanity匿名取得にトークンも使いません。

XserverはCronで2分ごとに小さなハッシュファイルを取得し、変化がある場合だけZIPを取得します。ZIPのハッシュ、5ファイルの名前・種類・サイズ、記事IDとslug、本文・CSS・ロゴのハッシュを検証してから切り替えます。ZIPとハッシュの公開途中や取得失敗では現状を維持します。切り替え後のHTTPS照合に失敗したら直前版へ戻し、同じ不良版を自動再適用しません。手動復旧後も、次の定期取得で同じ版へ戻ることはありません。重複したCron実行はロックで防ぎます。

承認後に設置するもの：

```text
/home/comfylabo/comfylabo-next/bin/
  xserver_pull.py
  site_bundle.py
  xserver-release.sh
```

Cronの予定コマンド（まだ登録しない）：

```bash
# 分: */2、時・日・月・曜日: *
COMFYLABO_AUTO_DEPLOY=true /usr/bin/python3 -B /home/comfylabo/comfylabo-next/bin/xserver_pull.py /home/comfylabo/comfylabo-next >> /home/comfylabo/comfylabo-next/pull.log 2>&1
```

[公式Cron手順](https://www.xserver.ne.jp/manual/man_program_cron.php)に沿って、この専用ジョブだけを追加します。GitHubへのコード反映、Release公開、Webhook登録、Cron設置と自動反映開始は未実施です。承認範囲は「この記事1本を確認用URLに継続反映」とし、Sanityの記事作成・Publish・削除や既存本番配備は含めません。

停止はこのCronだけを無効にします。復旧やSSHによる手動反映の前にも停止し、`current` / `previous` を確認してから `scripts/xserver.mjs rollback` を使います。異常終了やサーバー停止で結果が不明な場合は自動的に同じ版を再配備せず、リンクとログを確認します。すでに処理した版を再適用する必要がある場合は、失敗原因を修正し、承認範囲を確認してから対応します。通常はSanityの次の公開更新で新しい版を作ります。

GitHub標準ランナーからSSH接続する以前の案は採用しません。ローカル手動SSH用の `COMFYLABO_DEPLOY_ENABLED` は引き続き初期無効です。自動取得も環境変数 `COMFYLABO_AUTO_DEPLOY=true` がなければ接続前に停止します。

SanityのWebhookは、承認後に次の内容で設定します。

- URL：`https://api.github.com/repos/ComfyLabo/comfylabo-next/dispatches`
- Method：POST。Create / Updateを対象にし、Delete / Drafts / Versionsは対象外。
- Filter：`_type == "post" && !(_id in path("drafts.**")) && !(_id in path("versions.**")) && _id == "comfylabo-mvp-welcome" && slug.current == "comfylabo-welcome"`
- Projection：`{ "event_type": "sanity-publish" }`
- Header：`Authorization: Bearer <対象リポジトリ限定のトークン>`。トークンはSanityの管理画面だけに設定し、Gitへ保存しない。

Sanityは[Webhookのヘッダーと本文を設定可能](https://www.sanity.io/docs/content-lake/webhooks)です。GitHubの[repository_dispatch](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#repository_dispatch)へ直接通知するため、中継サーバーは追加しません。通知には対象リポジトリのContents書き込み権限が必要です（[公式API仕様](https://docs.github.com/en/rest/repos/repos#create-a-repository-dispatch-event)）。Workflowは既定ブランチに配置する必要があります。

## 確認できたことと残っていること

ローカルの隔離ディレクトリで、新版の切り替え、転送失敗・欠損・改変時の切り替え停止、直前版への復旧を試験しています。GitHub ActionsとSanityのWebhookをつないだ試験はまだです。

2026-11-23に、ユーザー承認済みのホスト鍵をプロジェクト専用の `.mvp/ssh/known_hosts` に登録し、ユーザーがSSHエージェントへ読み込んだ鍵でXserverへの読み取り専用接続に成功しました。Linux、sh / scp / sha256sum / readlink、リンクを置き換える `mv` のオプションを確認済みです。その後、ユーザーの事前承認を受けて `/home/comfylabo/comfylabo-next` を作成し、確認用記事1本を転送しました。サーバー側の照合と、別接続での読み戻し照合に成功しています。現在の使用版はSanityの公開記事から生成した `releases/2026-11-23T13-16-11.434Z-a4f32e15-7b70-407c-8a96-afccfd229ae7` です。`current` がこの版を指し、`previous` は直前の確認用版 `releases/2026-11-23T13-01-32.707Z-a189b1e5-4923-4a6f-a815-52ec09894678` を保持しています。実サーバー上での2版間の復旧試験は未実施です。既存公開領域の内容や公開入口は変更していません。今回だけ承認済み操作に有効化変数を渡して実行し、保存済みの配備・自動配備フラグは無効のまま維持しています。

2026-11-23の再確認で、設定済みのSanity `0lwnb6yi / production` への匿名読み取りに成功しました。公開済み `post` は0件で、`about` / `author` / `category` / `sanity.imageAsset` の存在を確認しました。これは新規記事の作成前の調査結果で、既存本番全体に記事がないという意味ではありません。その後、MVP用の新規下書きを作り、個別承認後に1本の公開版を作成しています。

ユーザーが `.env.local` にXserverの接続先を入力し、SSH秘密鍵と承認済みのホスト鍵のパスも設定しました。秘密鍵のパスフレーズはチャットやファイルに保存せず、ユーザーがSSHエージェントへ一時的に読み込む方式です。有効期限が切れた場合は再度読み込みが必要です。配備・自動配備の有効化フラグは引き続き無効です。

記事1本の匿名取得・生成・確認用公開先への反映は完了しました。画像の収集、旧記事の移行、内部リンクの移行は後回しにします。本文中のHTTP/HTTPS画像は外部参照のままです。未配置の相対画像や未対応のPortable Textブロックは、欠落させて公開せず生成を停止します。

参考として[旧BlogAutoPost](https://github.com/ComfyLabo/BlogAutoPost)を読み取りましたが、確認済みmainはClaude→WordPress構成でした。現行Mac Publisherは別の既存システムであり、そのコードや複雑な承認機構を再実装の必須条件にしません。旧記事の移行は新システム安定後に必要なものだけ行います。

## SanityのMVP記事

2026-11-23に `0lwnb6yi / production` へ新規下書き `drafts.comfylabo-mvp-welcome` を作成しました。タイトルは「ComfyLaboへようこそ」、slugは `comfylabo-welcome`、原稿は `content/mvp-welcome.draft.json` です。既存ID・slugに衝突がないことを確認し、上書きせず新規作成しました。下書きの原稿一致を確認後、ユーザーからこの1本のPublishと確認用サイトへの反映の承認を受けました。通常のPublishに含まれる下書き削除が自動承認レビューで停止されたため、安全な代替として下書きには変更を加えず、公開版 `comfylabo-mvp-welcome` だけを新規作成しました。下書きは保持されています。公開版の本文一致を読み戻して確認し、その公開版を匿名取得して生成・転送しました。HTTPSで3ファイルの一致、内部パスの拒否、ブラウザ表示を確認済みです。これは手動での一連の試験で、Publish通知による自動反映はまだ接続していません。

既存の認証済みSanity CLIを使用しています。CLIの環境ファイル読み込みに依存せず、`node --env-file=.env.local node_modules/.bin/sanity ...` で設定を明示的に読み込みます。現バージョンで `documents query --project` を指定すると共通APIホストへ向かう問題があったため、設定済みプロジェクトを使い、この上書きオプションは使用しません。認証情報の表示・コピーは行っていません。

2026-11-23の自動取得追加検証：公開済み記事からローカルでZIPを生成し、記事ID・slug・全ファイルのハッシュを再照合しました。Python 3.6の構文互換性を確認済みです。テスト15件では取得失敗・改変・対象外記事・不正ZIPの拒否、HTTPS照合失敗時の復旧、手動復旧後の同じ版の再適用防止、多重起動時の停止を確認しました。Lintでは一時実行ファイルも対象になる点を修正し、Git管理外の `.mvp/` を除外しています。サーバーへのスクリプト設置と実環境での定期取得・復旧試験は承認後に行います。

## 2026-11-24の作業状況

2026-11-24：ユーザーは記事1本・確認用URLに限定したGitHub反映、Release公開、Webhook設定、Xserver定期取得の有効化を承認した。実装を隔離した `.mvp/github-preview` で最新GitHub main（4655467）へ統合し、既存のNext 15.5.28・lockfile・画面修正を保持した状態でテスト15件、Lint、型検査に成功。公開記事の匿名取得と生成にも成功した。Xserverの鍵をユーザーが再読み込みし、現行版・既存Cron・既存本番 .htaccess のハッシュを読み取り確認した。既存GitHub mainにはVercel本番への自動配備接続があるため、GitHubへの書き込みは実行していない。専用の公開リポジトリ ComfyLabo/comfylabo-next の作成と、そこへの反映はユーザー承認済み。既存リポジトリへはpushしない。既存Cronには非UTF-8のコメントがあるため、追加時は元のバイト列をバックアップ・保持し、専用ジョブだけを追記する。
