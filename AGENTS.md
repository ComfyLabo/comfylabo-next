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

- 専用リポジトリは https://github.com/ComfyLabo/comfylabo-next 、確認先は https://next.comfylabo.com/ 。旧 sanity-blog-frontend はVercelに接続されているためpushしない。リモート名だけで判断せずURLを確認する。
- Next.js App Router / React / TypeScript / Tailwind CSSとSanity Studioを残す。Studio認証を弱めない。本番で認証用環境変数が未設定なら503にする。
- Next.jsの取得クライアントは開発時にトークンがあると下書きを参照する。自動生成の `scripts/mvp-content.mjs` は公開記事だけを匿名取得する。
- `npm run dev` で開発。基本確認は `npm run lint` と `npx --no-install tsc --noEmit`。変更に応じて `npm run test:mvp` / `npm run test:pull`・ビルド・画面確認を行い、未実行の確認を成功と報告しない。
- `/mvp` は開発時限定。本番では読み込み前に404。未指定ならサンプル、MVP_SNAPSHOT指定なら保存データを表示し、不正なデータを代替記事で隠さない。
- `npm run site:build -- comfylabo-welcome` が通常の取得・生成経路。`--sample` はSanityに接続しない。生成先は `.mvp/releases/`。旧snapshot経路は補助として残す。
- 本文は標準Markdown / Portable Text表示。未対応ブロックや未配置の相対画像は、欠落させて公開せず停止する。画像収集や複雑な旧記事の再現は後回しにする。

## 承認済みの自動反映範囲

- 記事は「ComfyLaboへようこそ」、公開ID `comfylabo-mvp-welcome`、slug `comfylabo-welcome`、Sanity `0lwnb6yi / production` の1本だけ。確認用URLと検索除外を維持する。別記事・既存本番への拡大は未承認。
- 有効なSanity Webhook `ComfyLabo next preview` がcreate/updateをGitHub repository_dispatchへ通知する。下書き・バージョン・deleteは対象外。
- 専用リポジトリのmainへのpushも同じ記事を再生成する。他のリポジトリ・ブランチからはReleaseを公開しない。
- GitHubは匿名取得→検証→専用 `comfylabo-preview` prereleaseへZIPとSHA-256を保存する。Xserverが2分ごとのCronでHTTPS取得・照合してcurrentを切り替える。GitHubへSSH鍵を預けず、国外SSH制限を解除しない。
- Pythonは標準ライブラリだけでXserverの3.6に対応。専用保存先 `/home/<サーバーID>/comfylabo-next` に限定し、管理マーカーとcurrent / previousを使う。既存本番の入口は自動変更しない。
- 自動反映はこの1記事・確認用URLに限って承認済み。GitHub Variable COMFYLABO_AUTO_DEPLOYは未設定時にtrueで、falseならRelease更新を停止する。Cronも限定承認後に有効化済み。手動SSH反映用COMFYLABO_DEPLOY_ENABLEDは初期false。
- 停止・手動復旧・手動反映の前に専用Cronを止め、既存の別ジョブを保持する。復旧後に同じ版を定期処理が勝手に再適用しないことを確認済み。
- トークンはユーザーがGitHubで作成しSanityへ直接入力した。値をチャット・ログ・Gitに残さない。有効期限前の更新はユーザー操作が必要。SSH鍵もパスフレーズを保存せず、ユーザーのエージェントへ一時的に読み込む。

## 確認済みの状態（2026-11-24）

- 個別の明示承認後、公開日時だけを更新し、Sanity実通知のHTTP204→GitHub Actionsのテスト15件・生成・Release更新→Xserverの定期取得・切り替え→HTTPS照合がすべて成功した。実行記録は https://github.com/ComfyLabo/comfylabo-next/actions/runs/45399857651 。
- 本文・タイトル・slug・下書きは維持した。通常のStudio Publishに含まれる下書き削除は行っていない。この承認を今後のPublishや削除へ広げない。SSH鍵の再読み込み結果だけをPublishの明示承認と解釈しない。
- currentは `releases/github-034cb42a405e9fcf4fc9d314d28d6dd6c4735a6d4f328def6a20291b9103eadf`、記事revisionは `UxqoYU4fBqLx1dyhI3bwLi`。previousに直前の正常版を保持する。
- 既存本番設定のハッシュ不変、既存Cronのバイト列保持、実サーバーでの復旧試験、公開3ファイルの一致と内部パスの404を確認済み。
- `content/*.draft.json` は公開ソースから除外した。ローカル一時cloneのコミットe9fdb94には下書きが含まれるためpush禁止。原稿・生成物・証跡はGit対象外の `.mvp/` などへ保存する。
- 旧BlogAutoPostは確認済みmainがClaude→WordPress構成。現行Mac Publisherと断定せず、その厳密な承認機構を新システムに再実装しない。
