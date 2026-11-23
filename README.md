# ComfyLabo next

Sanityの記事1本から始める、Xserver向けの小さな公開システムです。
既存のブログ、Vercel、旧記事、Mac Publisherは変更しません。

## 現在の公開範囲

- 記事：「ComfyLaboへようこそ」（ID `comfylabo-mvp-welcome` / slug `comfylabo-welcome`）
- 確認用URL：https://next.comfylabo.com/
- 既存ロゴを使用し、検索除外を維持します。
- 下書き原稿・環境設定・SSH鍵は公開ソースに含めません。

## 仕組み

```text
SanityのPublish
  → GitHub repository_dispatch
  → 公開済み記事を匿名取得してHTML・CSS・ロゴを生成・検証
  → 専用のcomfylabo-preview ReleaseにZIPとハッシュを保存
  → Xserverが2分ごとにHTTPS取得・照合
  → currentを切り替え、previousで直前版を保持
```

GitHubからXserverへSSH接続せず、SSH鍵やパスフレーズをGitHubへ預けません。
専用リポジトリのmainへのコード反映も、承認済みのこの記事1本の再生成を行います。
他のリポジトリ・ブランチからはReleaseを公開しません。

## 検証と実装状況（2026-11-24）

- GitHub Actionsでテスト15件、記事生成、ZIP生成、Release保存に成功。
- Xserverでの取得・検証・切り替え、HTTPSでの内容一致と内部パスの非公開を確認。
- 実サーバー上の復旧と、復旧後に同じ版を勝手に再適用しないことを確認。
- 2分間隔の専用Cronを登録。既存Cronはバックアップして元のバイト列を保持。
- Sanity Webhookは対象記事のcreate/updateだけに限定して作成済み。通知用GitHubトークンの入力と有効化は未完了。

トークンはユーザーがGitHubで作成し、SanityのWebhook設定へ直接入力します。
チャット・ソース・ログには残しません。Publishや削除を検証目的で無断実行しません。

## 手元で確認

```bash
npm ci
npm run test:mvp
npm run test:pull
npm run lint
npx --no-install tsc --noEmit
npm run site:build -- --sample
# 公開済み記事を匿名で取得する場合：
npm run site:build -- comfylabo-welcome
```

Sanity接続には `.env.example` を参考にローカル環境を設定します。
Pythonは標準ライブラリのみで、XserverのPython 3.6に対応しています。
Next.jsのStudioは開発用として残しています。自動公開にStudioの認証情報は使いません。

## 停止と復旧

専用Cronを先に無効化し、currentとpreviousの対象を確認してから
`scripts/xserver-release.sh` のrollbackで直前版へ戻します。
途中で取得・照合に失敗した場合は使用版を維持し、
反映後のHTTPS照合に失敗した場合は直前版へ戻します。

GitHubのRepository Variable `COMFYLABO_AUTO_DEPLOY=false` でRelease更新も停止できます。
未設定時の有効化は、2026-11-24にユーザーが承認したこの1記事・確認用URLに限定しています。
