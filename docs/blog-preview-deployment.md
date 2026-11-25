# 記事一覧版の確認用配備

状態：ローカル実装・検証済み、外部への反映は未実施。以下の運用範囲は承認待ち。

## 承認を求める範囲

- 配備先は `https://next.comfylabo.com/` だけ。トップを記事一覧にし、記事本文を `/posts/<slug>/` に配置する。全ページの検索除外を維持する。
- Sanity `0lwnb6yi / production` の公開済み `post` を匿名取得する。下書き・versions・他の文書種別は対象外。
- 以後、このSanityで公開・更新された記事を一覧と個別ページへ自動反映する。現段階は最大100記事・全体10MiB。取得・検証に1件でも失敗したら既存の正常版を維持する。
- 現在の配備候補は「ComfyLaboへようこそ」1件。Obsidianの記事は下書きのままで、この配備ではPublishしない。
- エージェントによる今後のSanity Publish・記事削除は、引き続き個別の事前承認が必要。この配備承認を記事公開承認に広げない。
- 旧 `comfylabo.com`、旧記事、Mac Publisher、旧GitHub/Vercelは変更しない。新しいサービス契約・費用が発生する操作は含めない。

ローカル候補：http://127.0.0.1:4175/ 。生成先とハッシュはGit対象外の
`.mvp/evidence/blog-mode-bundle-check.json` に記録した。
サンプル2記事は別の表示確認用データで、Sanity登録・Release公開はしていない。

## 実装と検証

- `COMFYLABO_PREVIEW_MODE` は未指定なら `single`。GitHub VariableとXserverの専用Cronで `blog` を明示した場合だけ一覧版を使う。
- 1記事版（version 1）と一覧版（version 2）を区別する。各モードは他方の成果物を拒否する。
- 一覧版は出所が上記Sanityの公開データであること、記事ID・版・slug・ファイル構成を確認する。サンプル・ローカル専用データ・別プロジェクト・下書き・重複・危険なパスを拒否する。
- ZIPは検証済みの通常ファイルだけで作る。受信時は展開前に名前・件数・容量・ハッシュを確認し、新しい作業領域へ保存する。
- 全記事・画像のSHA-256を照合してからcurrentを切り替える。公開後にも全ページと素材を照合し、異常時はpreviousへ戻す。手動復旧後に同じ版を繰り返し適用しない。
- Node19件・Python14件のテスト、Lint、型検査が成功。GitHub ActionsのYAMLとシェル構文、Xserver用Python 3.6構文も確認済み。
- 公開済み実記事から一覧版を生成し、ZIP作成・展開・再現性を確認。単一記事モードでは拒否されることも確認済み。
- 隔離したローカルApache 2.4.67で、一覧・個別記事・CSS・ロゴと画像2枚の書き換え、内部ファイル404、別Hostの404を確認した。実XserverでのHTTPS・権限・Cronの確認は承認後に行う。

確認コマンド：

```sh
npm run blog:build
python3 scripts/site_bundle.py '.mvp/blog-releases/<版>' .mvp/blog-bundle --blog
npm run site:verify -- https://next.comfylabo.com/ '.mvp/blog-releases/<版>' --blog
```

最後のコマンドは候補を配備した後の照合用。未配備の候補と現サイトが異なるのは正常。

## 承認後の切り替え順序

1. 現在のGitHub Variable・進行中のActions・Webhook・専用Cron・current/previous・専用公開設定を読み取り、バックアップを取る。SSH鍵が未読込ならユーザーに再読込を依頼する。パスフレーズは保存しない。
2. 新システム専用Cronだけを停止し、既存Webhookを一時無効、`COMFYLABO_AUTO_DEPLOY=false` とする。進行中のRelease更新が完了したことを確認する。他のCronやPublisherは変更しない。
3. 専用リポジトリ `ComfyLabo/comfylabo-next` に検証したソースだけを反映する。旧リポジトリへpushしない。原稿・`.mvp`・秘密情報をステージしない。
4. Xserver専用領域の `site_bundle.py` / `xserver_pull.py` と、`next.comfylabo.com` の専用 `.htaccess` を更新する。旧本番直下の `.htaccess` のハッシュ不変を確認する。現行の正常版の表示も維持する。
5. GitHub Variableを `COMFYLABO_PREVIEW_MODE=blog` とし、Actionsをbuildだけで実行して一覧版の生成・ZIP検証を確認する。
6. 既存Webhookを更新する。送り先と認証ヘッダーは維持し、下記のpost条件、create/update、下書き・versions除外を使う。deleteは対象に追加しない。認証情報を回答・ログへ出さない。
7. `COMFYLABO_AUTO_DEPLOY=true` として一覧版Releaseを生成する。専用Cronを止めた状態で、Xserver側に `COMFYLABO_AUTO_DEPLOY=true COMFYLABO_PREVIEW_MODE=blog` を指定して一度取得する。受信処理の更新前に一覧版を渡さない。
8. HTTPSで全記事・画像・素材の一致、内部パス404を確認し、一覧と記事の往復を確認する。通った場合だけ、blogモードを指定した専用CronとWebhookを再開する。他のCronの元のバイト列は維持する。

Webhookの提案フィルター：

```groq
_type == "post" && !(_id in path("drafts.**")) && !(_id in path("versions.**"))
```

公開済み記事を取得して再生成する方式で、下書きから公開文書を作る処理は含まない。
記事削除・非公開化の操作や、その通知の自動化はこの手順では追加しない。

## 復旧

問題があれば新システム専用の自動処理を止め、current/previousと実行記録を確認する。
必要なら検証済みのpreviousへ戻し、専用公開設定をバックアップから戻す。
モードの混在を避け、自動処理を停止したまま原因を調査する。
新しい受信処理はsingleモードも残しているため、記事削除や旧本番の変更を復旧手段にする必要はない。
