# ComfyLabo 新システムの開発ルール

## 目的と進め方

- このリポジトリを ComfyLabo 新システムの開発拠点とする。最終目標は Sanity の Publish を起点とした Xserver への自動公開。
- 最初は記事1本だけの MVP を作る。KISS・YAGNI を重視し、小さな実装・確認・改善を繰り返す。
- 過剰な抽象化、不要な依存追加、複雑な承認フローを作らない。
- 「次に何をする？」「これを直して」など自然な日本語の依頼から、現状確認、必要な調査、実装、適切なテストまで自律的に進める。通常のローカル変更で逐一承認を求めない。
- 作業前に既存コードと差分を確認し、ユーザーの未コミット変更を保護する。完了時は変更内容・検証結果・未解決事項・次の一歩を簡潔な日本語で伝える。

## デザイン

- 余白を大切にした、シンプルで読みやすいデザインにする。日本語本文の行間、行長、スマートフォンでの読みやすさを確認する。
- 既存 ComfyLabo ロゴを使用する。素材が見つからなければ所在を確認し、独自のロゴを作って代用しない。
- 使用するロゴはユーザー提供の `public/comfylabo-logo.jpg`。Sanity 上では管理せず、縦横比と画像全体を保って表示する。

## 保護するものと事前承認

- 既存 Xserver 本番、旧記事、現行 Publisher を勝手に変更しない。設定の上書き、削除、移行の実行も含む。
- **Sanity の Publish、記事削除、本番配備、費用が発生する操作は、必ず実行前にユーザーの明示的な承認を得る。** ローカルで実装・検証を済ませ、対象と影響を具体的に示して承認を求める。
- 自動公開が最終目標でも、現時点で Publish や本番配備が包括承認されたとは解釈しない。自動運用へ進む際は承認対象と範囲を明確にする。
- 秘密情報をソース、ログ、回答、Git に残さない。公開画面に下書きや認証情報を含めない。
- 旧記事は新システムが安定した後、必要なものだけ段階的に移行する。

## 公開と復旧

- 取得・生成・検証が失敗した場合は公開先を更新せず、直前の正常版を維持する。エラーを空の記事や空のサイトとして公開しない。
- 配備処理は公開領域とは別に成果物を生成・検証し、正常版を保存してから切り替える。Xserver の実際の制約を確認して最小の方式を選ぶ。
- 直前の正常版への復旧手順を配備前に用意して検証する。復旧のために Sanity の記事削除や旧記事の変更を必要としない構造にする。
- Webhook や転送処理は必要になった段階で追加する。ホスティング方式や外部サービスを推測で確定しない。

## 現在の構成と確認方法

- Next.js App Router / React / TypeScript / Tailwind CSS。`app/(site)` に一覧・記事詳細・About、`app/studio` に Sanity Studio がある。
- `sanity.config.ts` に post / author / about のスキーマ、`lib/sanity.ts` に取得用クライアント、`components/post-body.tsx` に Markdown / Portable Text の表示処理がある。
- 現行クライアントは開発時に読み取りトークンがあると下書きを参照し、それ以外は公開済み記事を参照する。確認先を意識して作業する。
- `middleware.ts` の Studio 認証を弱めない。本番では認証用環境変数が未設定の場合に 503 を返す。
- `npm run dev` で開発、`npm run lint` と `npx --no-install tsc --noEmit` で基本確認。変更に応じてビルド・画面確認を行い、未実行の確認を成功と報告しない。
- `/mvp` は開発時限定の記事表示。未設定時はサンプル、`MVP_SNAPSHOT` にファイル名を指定すると `.mvp/snapshots/` の保存済み記事を表示する。指定ファイルの異常をサンプルで隠さない。Sanity 接続や Publish は行わず、本番では読み込み前に 404 を返す。
- `npm run mvp:articles` で公開済み記事を匿名読み取りし、`npm run mvp:snapshot -- '<slug>'` で1本のデータを `.mvp/snapshots/` に新規保存する。`npm run test:mvp` で空本文・下書き拒否と既存版保持を確認する。この保存処理は本番配備ではない。
- 通常の経路は `npm run site:build -- '<slug>'` で公開済み記事1本を取得して静的生成する。保存データの手渡しは不要。`--sample` ならSanityに接続せず確認できる。生成先は `.mvp/releases/`。本文はMarkdown / Portable Textの標準表示を使い、実行時のTSX変換や短文を表と推測する処理を増やさない。
- 自動化の入口は `.github/workflows/site.yml`。Sanity→GitHub repository_dispatch→記事1本の生成・照合→専用Release→XserverのCronによるHTTPS取得・照合→リンク切り替え、という小さな流れにする。新たな中継サーバーや承認票システムを作らない。
- `scripts/xserver.mjs` と `scripts/xserver-release.sh` は専用の `/home/<サーバーID>/comfylabo-next` 内だけを操作する。`current` / `previous` で使用版と直前版を管理する。既存本番の公開入口は自動変更しない。
- 手動SSH配備は `COMFYLABO_DEPLOY_ENABLED`、自動配備はGitHub VariableとXserver Cronの `COMFYLABO_AUTO_DEPLOY` の有効化が必要。いずれも初期無効。有効化やWebhook登録前に、対象・接続先・自動運用の承認範囲・費用を明確にして事前承認を得る。今回のローカル実装はその承認ではない。
- 生成・切り替え・復旧処理は隔離したローカル環境で試験済み。実Xserverへの読み取り専用SSH接続は2026-11-23に成功。ホスト鍵はユーザー承認済みのプロジェクト専用ファイルを使う。専用保存先の作成・テスト記事1本の転送・照合・current設定もユーザー承認後に成功。別接続で3ファイルのハッシュ一致を確認済み。新サブドメインの公開入口設定と、HTTPSでの3ファイル一致・内部パス拒否・ブラウザ表示も確認済み。実サーバー上の2版間復旧試験、Actions実行、Webhook連携は未実施。詳細は `README.md` を参照する。
- 上記の未実装はこのリポジトリについての記述。既存公開サイトの記事にはSanity→静的生成→XserverとMacアプリ「ComfyLabo Publisher」の運用記録がある。既存側の構成を新規実装の欠落と混同せず、ソース所在と接続先の境界を読み取りで確認する。`BlogAutoPost` はWordPress用の関連プロジェクトであり、現行Publisherとは断定しない。
- ユーザーは厳密な現行Mac Publisherより、旧 `ComfyLabo/BlogAutoPost` を参考にしたシンプルな新システムを希望している。現行Publisherのソース取得や承認方式の再実装をMVPの必須条件にしない。旧BlogAutoPostの確認済みmainはClaude→WordPress構成のため、Sanity連携コードと推測して流用しない。
- 確認用記事1本を `https://next.comfylabo.com/` に公開することはユーザー承認済み。サブドメイン追加と新しい子フォルダーの公開設定は実施済みで、反映・SSL・公開ファイルの一致・ブラウザ表示を確認済み。これは既存本番やSanityのPublish、自動配備の包括承認ではない。`npm run site:verify -- <HTTPSトップURL> <成果物フォルダー>` で実配信まで検証する。

- MVP記事「ComfyLaboへようこそ」（公開ID `comfylabo-mvp-welcome`、slug `comfylabo-welcome`）は、個別承認を受けてSanityに公開版を作成し、匿名取得→生成→確認用サイトへの反映→HTTPS照合まで成功。下書きは変更・削除せず保持している。今回の承認を別記事や自動公開全体へ広げない。

- 自動配備は国外SSH制限と暗号化された既存鍵を維持するため、Xserverから公開GitHub ReleaseをHTTPS取得する方式とする。`scripts/site_bundle.py` / `scripts/xserver_pull.py` はXserverのPython 3.6対応・標準ライブラリのみ。対象は公開ID `comfylabo-mvp-welcome` / slug `comfylabo-welcome` / `next.comfylabo.com` に固定する。GitHubへSSH鍵を預けない。`npm run test:pull` で失敗時維持・復旧・同じ版の再適用防止・多重起動を検証する。GitHub反映・Release公開・Cron設置・Webhook登録は未実施で、継続的な自動反映の承認が必要。

2026-11-24：ユーザーは記事1本・確認用URLに限定したGitHub反映、Release公開、Webhook設定、Xserver定期取得の有効化を承認した。実装を隔離した `.mvp/github-preview` で最新GitHub main（4655467）へ統合し、既存のNext 15.5.28・lockfile・画面修正を保持した状態でテスト15件、Lint、型検査に成功。公開記事の匿名取得と生成にも成功した。Xserverの鍵をユーザーが再読み込みし、現行版・既存Cron・既存本番 .htaccess のハッシュを読み取り確認した。既存GitHub mainにはVercel本番への自動配備接続があるため、GitHubへの書き込みは実行していない。専用の公開リポジトリ ComfyLabo/comfylabo-next の作成と、そこへの反映はユーザー承認済み。既存リポジトリへはpushしない。既存Cronには非UTF-8のコメントがあるため、追加時は元のバイト列をバックアップ・保持し、専用ジョブだけを追記する。
