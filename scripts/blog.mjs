import { createRequire } from "node:module";
import { appendFile } from "node:fs/promises";
import path from "node:path";
import { fetchPublishedPosts } from "./mvp-content.mjs";
import { buildBlogRelease } from "./blog-export.mjs";

const { loadEnvConfig } = createRequire(import.meta.url)("@next/env");
loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const args = process.argv.slice(2);

try {
  if (args.length > 1 || (args.length === 1 && args[0] !== "--sample")) throw new Error("使い方: npm run blog:build -- [--sample]");
  const posts = args[0] === "--sample" ? [
    { _id: "sample-welcome", _rev: "local", slug: "welcome", title: "ComfyLaboへようこそ（表示確認用）", publishedAt: "2026-11-24T12:00:00Z", body: "## ひとつの読みものから\n\n余白のある、読みやすい場所を少しずつ育てていきます。\n\nこれは一覧と記事ページの移動を確かめるためのサンプルです。" },
    { _id: "sample-next", _rev: "local", slug: "next-reading", title: "記事を増やしていくために（表示確認用）", publishedAt: "2026-11-25T00:00:00Z", body: "## 書いたものを、読みやすく\n\n新しく追加した記事も、同じ一覧から開ける形にします。\n\n- 記事を選んで開く\n- 読み終わったら一覧へ戻る\n\nこれは実際の原稿ではなく、表示確認用のサンプルです。" },
  ] : await fetchPublishedPosts();
  const source = args[0] === "--sample" ? { kind: "sample" }
    : { kind: "sanity-published", projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID, dataset: process.env.NEXT_PUBLIC_SANITY_DATASET };
  const release = await buildBlogRelease(posts, { source });
  if (process.env.GITHUB_OUTPUT && source.kind === "sanity-published") await appendFile(process.env.GITHUB_OUTPUT, `release=${release}\n`);
  console.log(`ローカル確認用の一覧と${posts.length}記事を生成しました: ${path.relative(process.cwd(), release)}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "記事一覧の生成に失敗しました。");
  process.exitCode = 1;
}
