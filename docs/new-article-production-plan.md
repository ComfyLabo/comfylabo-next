# 新規記事の本番公開への拡張

状態：2026-11-25、生成・ZIP・受信・移行／復旧・表示をローカル実装／検証済み。本番への導入と範囲拡大は未承認。現行の本番はObsidian1本のversion3を維持している。

## 承認を求める範囲

- 一覧を `https://comfylabo.com/readings/` に追加する。新規記事は `/posts/<slug>/` に追加する。
- これからStudioで新規作成する記事を、ユーザーがPublishしたら本番にも自動反映する。対象は `publicationSystem: comfylabo-next` が新規作成時に初期設定された公開済み記事だけ。既存文書への識別情報の追加・旧記事の一括移行は含めない。
- 既存Obsidianは `/4484/`、本文・公開日時・検索／共有情報を維持する。記事一覧へ戻るリンクと素材の参照先を新一覧へ変更する。旧素材URLも引き続き配信する。
- トップと他の旧記事、旧Publisher、確認用nextは維持する。本番設定を書き換えるCronを2系統にせず、既存の本番処理を更新する。
- エージェントが記事をPublishする場合は、引き続き対象と内容の個別承認が必要。記事削除・非公開化・slug変更の自動反映は含めない。

## 記事の選別

Studioのpostに非表示・読み取り専用のpublicationSystem初期値を追加した。ユーザーの追加操作や承認スイッチは増やさない。既存記事を編集しても自動で移行対象にする処理は入れない。

`scripts/new-production-content.mjs` は固定Sanity `0lwnb6yi / production` を匿名で読み、下書き・versions・既存welcome／Obsidian・未選別の旧記事・重複ID／slug・危険なURL・空本文・不正日時を拒否する。新規対象0件でも既存Obsidianを残した一覧を生成する。本番で公開済みになった記事が次の取得から欠けた場合は停止し、空のサイトや記事削除として反映しない。

新規作成時の初期値は、インストール済みSanityの `createSchema` とStudio用initial-value resolverで確認した。ネットワーク呼び出し・Sanity書き込みは0件。実際にStudioで新しい原稿を保存する確認は、最初の新規記事で行う。既に作られていた下書きは、対象を確認してから個別に扱う。

## 生成と形式

```sh
npm run articles:production:build
python3 -B scripts/production_bundle.py <候補ディレクトリ> <新規ZIP出力先> --collection
```

`production-collection.mjs` は公開済みObsidianと選別済み新規記事を取得し、既存の `blog-export.mjs` を本番オプションで使う。確認用のversion2・noindex既定は維持する。生成先はGit対象外 `.mvp/production-collections/`。

本番一覧はversion4/kind=production-collection。現行のversion3とは別形式で、通常の単一記事受信モードは拒否する。新モードの `COMFYLABO_PRODUCTION_AUTO_DEPLOY=new-articles` をGitHubとXserverの両方に明示した場合だけ使う。GitHubとXserverにSSH秘密鍵やSanity書き込みトークンを追加する必要はない。

一覧・記事・CSS・ロゴ・画像を同じ版としてまとめる。最大で既存1本＋新規100本、1記事あたり画像10枚、全体10MiB。ZIPには公開ファイルとmanifestだけを含め、親設定・計画・復旧用データは含めない。JSON-LD、説明文、Open Graph、canonicalを生成する。本番用HTMLにはnoindexを付けず、ローカル確認サーバーにはHTTPヘッダーで検索除外を付ける。

## 受信・切り替え・復旧

- 既存production_deploy.py／production_bundle.py／production_pull.pyに明示的なcollectionオプションを追加し、production_collection.pyで記事・ファイル・公開ルートを検証する。既定の単一記事モードは変えない。
- サーバー上で元の親設定から対象ブロックだけを生成する。既存の `/posts/`／`/readings/` ルールと競合すれば停止する。その他の元ルールは同じバイト列を維持する。
- 新一覧／新記事／素材だけの完全一致ルールを追加し、内部ディレクトリへの直接アクセスは404にする。新しい記事・一覧の末尾スラッシュなしURLは301で統一する。
- 現在の親設定が記録した現在版と一致した場合だけ原子的に切り替える。公開済み記事の欠落・slug変更は拒否する。取得・コピー・HTTPS照合・状態保存に失敗すれば、直前の正常版を維持するかその設定に戻す。他の公開処理の変更は上書きしない。
- 現在版と直前版を保存し、一覧形式から元のversion3へも復旧できる。復旧した同じ版を次のCronで繰り返し適用しない。旧版の自動削除は行わない。
- 専用領域100MiBの保守的な事前上限、専用ログ64KiB×2、既存のロックを継続使用する。

復旧は本番専用Cronを止め、現在の設定と状態を確認し、明示承認後に実施する。

```sh
COMFYLABO_PRODUCTION_APPROVED=new-articles /usr/bin/python3 -B \
  /home/comfylabo/comfylabo-next-production/bin/production_pull.py rollback
```

元の単一記事形式へ戻す場合は、GitHub側の範囲とCronの環境変数も状態に合わせて戻す。素材やSanity文書を削除する必要はない。

## 初回配備候補と画面

新規対象は現在0件。初回候補は既存Obsidian1本を載せる一覧で、公開ファイル6件・完全一致ルート10件（旧素材URLの別名配信を含む）。本番ではまだ使用していない。

- 候補：`.mvp/production-collections/2026-11-25T13-56-01.985Z-570bc72f-45e5-4d1f-aa91-5a1aff8d97a4/`
- 配備用ローカル記録：`.mvp/collection-package-initial/`
- manifest SHA-256：`21163caeffc45f3a489b1fde233450af0a5b965f17ffa06203401dc879c977b0`
- ZIP SHA-256：`4ad91b2ba063884aa8d13d355f18fe03f02a9f06a58adc72eeffa1ac9caf5c8a`
- 設定案SHA-256：`68e9a9122996998d8f5b0252603bb62a6c7b88736070a1fe1b45ad8397b52d9f`
- 実記事の未配備表示：`http://127.0.0.1:4183/readings/`
- ローカル専用サンプル：`http://127.0.0.1:4184/readings/`。架空の新規記事を表示するだけで、Sanity登録・Publish・本番配備はしていない。初回配備の候補とは別。

## 承認後の導入手順

1. 本番の現在版f8c7ad…／親設定1fee24…、退避データ、既存Cronを読み取り確認する。他の公開処理と同時実行しない。変わっていれば候補を再評価する。
2. 検証済みソースだけを専用リポジトリへ反映する。GitHub側の範囲はまだobsidian-4484のままにする。既存単一記事／previewのCIを確認し、手動 `build-collection` で一覧の生成・ZIPも確認する。この操作だけではReleaseへ公開しない。
3. GitHubの範囲をnew-articlesに変更し、手動publish-productionで専用Release `comfylabo-production-collection` のZIPを生成・照合する。現行のXserverは旧Releaseを見ているため、この時点で本番は切り替わらない。
4. `.mvp/ops/upgrade-production-collection-remote.py` の準備済み導入処理を実行する。既存の本番ロックを取得し、現在版・親設定・設置済み3ファイル・新ZIPと上記manifest／設定案／記事一覧を照合する。新規記事が0件だった初期候補と異なれば停止する。
5. 元のbin、Cron、状態JSONを非公開保存し、受信処理4ファイルへ更新する。既存Cron1行の範囲指定だけをnew-articlesへ変更し、他Cronを維持する。導入途中でCron変更に失敗したら元のbin／Cronへ戻す。導入処理自体は公開設定を変えない。
6. Cronの自然受信で最初の一覧版へ切り替わることを確認し、全公開URL・素材・旧素材URL・トップ／別記事・転送／内部パス拒否をHTTPSで検証する。SanityのPublishは不要。

導入処理の生成元は `.mvp/ops/prepare-collection-upgrade.py`。設置済み旧コードはコミット9166bdf…の3ファイルに固定して照合する。コード・候補を変更したら再生成する。現行の単一記事Cronと、別の本番更新Cronを並行運用しない。

## 検証結果

- Node28件、Python64件、計92件が成功。lint、TypeScript、workflowのYAML／shell、XserverのPython3.6構文も成功。
- 元の実公開設定と現在の記事を再現した隔離Apacheで、単一記事→一覧→単一記事への復旧、新規2記事の追加、一覧内の復旧、HTTPS全ルート、末尾スラッシュ301、内部パス404、トップ／別記事維持、検証失敗時の復旧、同じ版の再適用防止を確認。
- 新形式の取り違え、未選別の旧記事、既存Obsidian欠落、記事削除／slug変更、危険なファイル、競合する既存URLを拒否する試験に成功。
- 導入処理も隔離したファイルシステムとCron／通信の代替処理で試し、成功時とCron書き込み失敗時の両方で現在の公開設定と状態を維持した。
- ブラウザーで一覧と記事の往復、既存画像3枚と表、新規記事の表、390px／1280pxで横はみ出しなしを確認。新規サンプルはSanityへ登録していない。
- 証跡：`.mvp/evidence/production-collection-apache-check.json`、collection-display-check.json、new-article-initial-value-check.json、collection-initial-list.jpg、collection-sample-mobile.jpg。

この作業では本番用変数・Release・Xserver設定・Sanity文書を変更していない。新規記事をユーザーがStudioで作成し、Publishして本番へ反映する実通し確認は、導入承認後に最初の新規記事で行う。
