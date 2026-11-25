# Obsidian記事を確認用サイトへ反映する計画

状態：ローカルの画像対応と表示確認は完了。Publish・対象変更・配備は未実施。
この文書は実行承認ではない。

## 確認できたこと

2026-11-25にSanityのWebhook一覧と記事の識別情報を読み取り確認した。

- Webhookは `ComfyLabo next preview` の1件。公開ID `comfylabo-mvp-welcome` とslug `comfylabo-welcome` が一致する記事のcreate/updateだけが対象で、下書きは除外されている。
- Obsidian記事は `drafts.6a6732df-f6d2-434e-9fca-7e745ad0b11a`、slug `4484` の下書きが存在する。対応する公開文書は現在のSanityに存在しない。
- 旧公開ページは https://comfylabo.com/4484/ にある。Sanityに公開文書がないことは、旧サイトが非公開であることを意味しない。
- Webhook一覧だけでは、Mac版Publisherによる定期取得・手動取得の有無は判断できない。旧BlogAutoPostのコードを現行Publisherの根拠として扱わない。
- ユーザー指定のMac版Publisherと登録済み補助処理を読み取り確認した。起動時・更新ボタンは下書き一覧の読み取りで、公開準備は手動。本番配備は別の確認画面での本人認証・承認・実行要求を必要とする。確認した経路にSanity Publishから旧本番配備を起動する処理はない。
- 登録済みPublisher関連LaunchDaemonには定期起動のStartIntervalやWatchPathsがなく、書き込み側は要求駆動のMachService、起動常駐するread3aは読み取り専用ソケット要求の待機だった。サービス自体は起動・停止していない。
- 調査スクリプトと認証情報を含まない結果はGit対象外の `.mvp/ops/audit-publish-links.cjs` と `.mvp/evidence/publish-link-audit.json` に保存した。

## 提案する反映範囲

| 項目 | 対象 |
| --- | --- |
| 記事 | 【Obsidian】新規ノートと添付ファイルの保存場所を固定する設定方法｜迷子防止Tips |
| Sanity | `0lwnb6yi / production` |
| 公開文書ID候補 | `6a6732df-f6d2-434e-9fca-7e745ad0b11a`（既存下書きに対応） |
| slug | `4484` を維持 |
| 表示先 | `https://next.comfylabo.com/` の1記事を置き換える。検索除外を維持 |
| 本文の調整案 | 太字の区切り1か所と、設定画像の原寸リンク。原稿全体の書き換えはしない |
| 公開日時の案 | 下書きの `2026-03-20T01:08:00.000Z` を維持。実行時刻へ変更しない |
| デザイン | 採用済みの中央配置ロゴ、スマホ256px / PC288px、既存の余白と本文幅 |
| 保護対象 | `comfylabo.com/4484/`、旧本番の設定、現行Publisher、他の記事、旧GitHub/Vercel |
| 復旧先 | 確認用サイトの直前の正常版。「ようこそ」のSanity文書は削除しない |

本文調整案は `.mvp/editorial-preview/obsidian.proposed.md`、画像同梱版の確認先は
http://127.0.0.1:4174/ 。原稿・生成物はGitやGitHub Releaseに含めていない。

## Mac版Publisherへの影響確認（完了）

指定された保存場所は、iCloud Driveの `書類/ChatGPT/AI経営会議/ComfyLabo Publisher`。
読み取りだけで次を確認した。

1. `Sources/PublisherModel.swift` のinitはrefreshLiveを呼び、refreshLiveは専用リーダーのlistで下書きを取得する。候補生成や配備を呼ばない。
2. `Sources/PublisherApp.swift` の公開準備はボタン操作。`Stage3E/TrustedReview.swift` の公開承認と配備開始も別々のボタン操作で、配備に本人署名を伴う明示要求が必要。
3. 実際の保護領域 `/Library/Application Support/ComfyPublisherWrite3B/handoff.py` でも、公開対象・版・期限に一致する承認記録と実行署名を検証してから配備する。単にSanityへ公開文書が作られるだけではこの要求を満たさない。
4. 読み取り常駐サービスと登録済みlaunchd設定に、Sanityの公開イベントを受けて旧本番へ自動配備する経路は見つからなかった。

結論：確認したMac版Publisherと登録済み補助処理では、今回のSanity公開が旧本番の4484を自動更新する経路はない。Publisherの停止・改修は不要。
これはソースと登録設定の静的確認であり、旧本番での実行試験を行ったという意味ではない。
証跡と確認したソースのハッシュは `.mvp/evidence/mac-publisher-audit.json` に保存した。

自動更新される可能性があれば、既存Publisherの停止や設定変更を無断で行わない。
元記事をPublishする案を見直し、旧本番と分離できる最小の方法を先に示す。
Publisher側の設定が変わった場合は、この確認結果を無条件に流用しない。

## 承認後の実施順序

以下は影響確認が終わり、具体的なSanity操作と確認用サイトへの配備が明示承認された後に行う。

1. 原稿リビジョンを再取得し、確認した修正案から変わっていないことを照合する。変更があれば差分を示し、古いコピーで上書きしない。
2. 新システム専用CronとWebhookの自動処理を一時停止し、GitHubのRelease自動更新も止める。他のCron・Webhook・現行Publisherは変更しない。進行中の更新がないことを確認し、設定とcurrent/previousを退避する。
3. Xserverの専用受信処理（`site_bundle.py` / `xserver_pull.py`）と、確認用サブドメインだけの `.htaccess` を画像対応版へ更新する。旧本番直下の `.htaccess` は変更しない。現在の画像なし版が維持されることも確認する。
4. GitHub生成対象、Xserver受信時の許可ID/slug、Webhookのフィルター、Studioの固定記事入口を同じ1記事へそろえる。複数記事や全記事を対象に広げない。
5. 承認された本文調整とSanity公開操作を行う。提案は、確認済みデータから対応する公開文書を作成し、元の下書きと公開日時を維持する方式。既存下書きを削除する通常のStudio Publishは、削除も含めた承認がない限り実行しない。実行直前に公開文書が既にできていれば上書きせず再確認する。
6. 画像付き成果物を生成・検証して確認用Releaseへ出し、専用の定期取得で切り替える。HTML・CSS・ロゴ・本文画像をHTTPSで全件照合し、内部パスの404とスマホ/PC表示を確認する。
7. 確認が通った範囲だけ自動反映を再開する。以後の自動反映対象もObsidian記事1本・確認用URLに限定する。

受信処理・公開設定を更新する前に画像付きReleaseだけを出さない。現行サーバーの旧受信処理は画像付きZIPを拒否する。

## 失敗時

- 取得・生成・ZIP検証で失敗したら、公開中の版を切り替えない。
- 切り替え後の画像を含むHTTPS照合が失敗したら、直前の正常版へ戻す。
- 手動復旧時は専用の自動取得を止め、同じ不良版が再適用されない状態を確認する。
- 記事削除や旧サイトの変更を復旧手段にしない。原因を確認するまで自動処理を再開しない。
