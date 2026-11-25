# Obsidian記事1本の本番自動反映

2026-11-25時点：ローカル実装・検証済み、GitHubへの反映・Xserverへの導入・自動運用の有効化は未実施。既存の本番記事は初回配備した版を維持している。通常の「続けて」は本番自動配備の包括承認と解釈しない。

## 有効化の承認対象

- 取得元：Sanity `0lwnb6yi / production` の公開済みpost。記事ID `6a6732df-f6d2-434e-9fca-7e745ad0b11a`、slug `4484` の1本だけ。
- 配備先：既存URL `https://comfylabo.com/4484/` と記事専用の素材。トップ・他記事・旧Publisherは変更しない。確認用nextの自動反映も維持する。
- 既存の `sanity-publish` 通知を使い、GitHubで対象1本だけを生成する。現在の通知には記事IDが含まれないため、他の記事のPublishでも生成は動くが、取り込む記事は4484だけで、同じ成果物なら本番は切り替えない。Webhook追加・変更は不要。
- Xserverには本番専用の受信処理を追加し、2分間隔で新しい成果物を確認する。新しい記事や別のslugへの拡大、Sanityの記事削除・非公開化への連動は含めない。
- ユーザー自身のPublish後の自動配備を対象とする。エージェントがSanityのPublishを実行する際は、引き続きその都度明示承認を得る。

## 経路と停止設定

`Sanity Publish → 既存Webhook → GitHub Actions production.yml → 本番専用Release → Xserver受信 → 検証・切替・HTTPS照合`

- `.github/workflows/production.yml` は既存previewのworkflowと別。記事を匿名取得するため、Sanity書き込みトークンやSSH秘密鍵はGitHubへ渡さない。
- GitHub Variable `COMFYLABO_PRODUCTION_AUTO_DEPLOY=obsidian-4484` が明示されない限り、Releaseを公開しない。既定値はdisabled。push時は生成・検証だけで、本番用Release公開は既存通知または手動の `publish-production` 操作時に限る。
- 本番専用Release名は `comfylabo-production-4484`。ZIPを先に、SHA-256を最後に更新する。途中失敗やZIP不一致では受信側は切り替えない。
- Xserver側も `COMFYLABO_PRODUCTION_AUTO_DEPLOY=obsidian-4484` がない限り自動受信を実行しない。GitHub側を止めただけでは既に公開済みの未受信版が残るため、完全停止時はまず本番専用Cronを止める。previewや他のCronを止めない。

ZIPにはmanifestと公開ファイルだけを入れる。現在の実記事では計6ファイル。親 `.htaccess`、復旧用データ、計画ファイル、環境変数、下書きは公開しない。最大14ファイル・展開後10MiB、許可した通常ファイル名・記事ID・slug・取得元・公開先・全ハッシュを受信前に確認する。

## 切り替えと復旧

`production_pull.py` は初回本番配備の保存済みパッケージを起点とする。公開領域外の `comfylabo-next-production/incoming/<manifest SHA-256>/` に、受信した公開ファイルと、そのサーバーで生成した設定前後・計画を保存する。公開する素材は `public_html/_comfy_next_4484/<manifest SHA-256>/` に別版として保存する。

設定案は、初回調査時の元設定から対象記事のブロックだけを生成する。現在の親設定が保存された現在版と一致する場合だけ、同じディレクトリ内のrenameで切り替える。対象外のルールは元のバイト列を維持し、旧Publisher等の変更を検出したら停止する。同時に旧Publisherの配備を実行しない。

全公開ファイルをHTTPSで取得して照合した後だけ、現在版／直前版の記録を更新する。取得・コピー・設定・HTTPS照合・状態保存の失敗では、切り替え前の版を維持するか、その設定へ戻す。他の処理による設定変更を検出した場合は上書きせず停止する。

失敗後や手動復旧後に同じ版を2分ごとに再適用しない。受信済みのZIPハッシュを記録するため、再開には原因調査と、新しい版または記録を確認した個別の復旧操作が必要になる。通信切断や電源断で結果が不明な場合も、設定と状態を確認してから操作する。

直前の自動配備版への手動復旧は、事前承認と状態確認後に以下の処理で行う。

```sh
COMFYLABO_PRODUCTION_APPROVED=obsidian-4484 /usr/bin/python3 -B \
  /home/comfylabo/comfylabo-next-production/bin/production_pull.py rollback
```

復旧先のファイル、現在の設定、復旧後のHTTPSを照合する。Sanityの記事削除や再Publishは不要。自動配備後は初回用の `article:production:rollback` をそのまま実行しない。初回版からさらに旧デザインへ戻す場合は、先に本番専用Cronを止め、保存されている初回設定と現状を照合して個別に計画する。

## 容量とログ

- 専用の非公開領域と本番版ディレクトリの合計を調べ、次の版を両方へ保存する余裕を含めて100MiBを超える見込みなら新規更新を止める。現在の正常版は維持し、古い版を勝手に削除しない。これは取り込み前の保守的な上限確認で、ファイルシステムのハードクォータではない。
- 受信の専用ログは `automatic.log`。1ファイル64KiBまで、直前1ファイルを含め計128KiBまで保持する。正常な変更なしの確認ではログを増やさない。更新・復旧・エラーだけを記録し、原稿や認証情報は出力しない。
- Sanityバックアップの「正常版7件／1GB」とは別の領域・設定。100MiB付近に達した際の旧版整理は、その時点で必要なものを確認して行う。

## 承認後の導入順序

1. 現在の本番設定が初回配備済みの記録と一致し、退避データが存在することを読み取り確認する。
2. 検証済みソースを専用リポジトリ `ComfyLabo/comfylabo-next` へ反映する。既存のpreviewの挙動を維持し、本番用変数はまだ有効にしない。CIの生成・検証の成功を確認する。
3. 本番用変数の明示設定と手動 `publish-production` により、現在の本番と同じ公開済み記事のZIPを一度作る。記事のPublishや本文変更は必要ない。
4. Xserver専用領域の `bin/` に `production_deploy.py`、`production_bundle.py`、`production_pull.py` を配置する。元の公開設定・公開済み記事はこの導入時に変更しない。今回の導入計画はGit対象外 `.mvp/ops/install-production-auto-remote.py` に生成済み。ソース変更時は再生成する。
5. 導入処理は初期ZIPのmanifestが現在配備済みの `bc9be8f7a04aa98fca7403483d4b2645c02e108d09f0ccaf4e3a0f5a9f3863c1` と一致することを確認してから、本番専用Cronを1行だけ追加する。既存Cronは元のバイト列を保持し、変更前の全体を非公開領域の `automatic-cron.before` に退避する。現在と異なるZIPなら導入を止め、原因を確認する。
6. 最初の受信が「内容変更なし」となり、記事・素材・トップ／別記事が変わらないことを確認する。実際のPublish通知による変更テストが必要な場合は、変更内容を別途提示してPublishの個別承認を求める。

追加予定のCronは以下の1行。標準出力は保存せず、上記の上限付き専用ログを使う。

```cron
*/2 * * * * COMFYLABO_PRODUCTION_AUTO_DEPLOY=obsidian-4484 /usr/bin/python3 -B /home/comfylabo/comfylabo-next-production/bin/production_pull.py >/dev/null 2>&1
```

## 検証記録

- 初回配備・新規ZIP作成・受信・設定生成・切り替え・失敗時復旧・手動復旧を隔離ディレクトリで検証。
- 別記事／preview形式／壊れたZIP／余分な制御ファイル／パストラバーサル／重複名／シンボリックリンクを拒否。設定の競合・容量超過・状態保存失敗でも正常版を維持。同時実行をロックで抑止し、ログ保持数と容量も確認。
- 実際の本番設定と実記事を使ったローカルApacheで、2回の自動更新、追加素材の200と次版での404、全ファイルのHTTPS照合、トップ／別記事の維持、手動復旧、公開後の検証失敗時復旧、同じ版の再適用防止を確認。証跡 `.mvp/evidence/production-auto-apache-check.json`。信頼する試験用証明書を使い、証明書検証は無効にしていない。
- 初回実記事のパッケージから、公開ファイルだけのZIPを作成・再展開し検証。`.mvp/production-auto-bundle-check/` に保存、未公開。
- 本番でのGitHub→受信処理の実行結果は、導入承認後に検証する。今回のローカル成功を本番自動運用の成功とは扱わない。
