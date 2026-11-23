import { appendFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fetchPublishedPost } from "./mvp-content.mjs";
import { buildPostRelease } from "./mvp-export.mjs";

const { loadEnvConfig } = createRequire(import.meta.url)("@next/env");
loadEnvConfig(process.cwd(), false, { info() {}, error() {} });

const args = process.argv.slice(2);
const sample = {
  _id: "local-sample", _rev: "local-sample-2", slug: "welcome",
  title: "ComfyLaboへようこそ（表示確認用）",
  body: "暮らしや学びを、少し心地よく。ComfyLaboは、日々気になったことを自分のペースで楽しむブログです。\n\n## まずは、ひとつの読みものから\n\n余白のある、読みやすい場所を少しずつ育てていきます。\n\n- 気になったことを調べる\n- 自分で試してみる\n- 分かったことをやさしく伝える\n\n> コーヒーを片手に、ゆったりと。\n\nこれは新システムの表示を確認するためのサンプル記事です。",
};

try {
  if (args.length > 1 || (args[0]?.startsWith("--") && args[0] !== "--sample")) {
    throw new Error("使い方: npm run site:build -- <slug> または --sample");
  }
  const post = args[0] === "--sample" ? sample
    : await fetchPublishedPost(args[0] || process.env.COMFYLABO_ARTICLE_SLUG);
  // MVPの公開先は確認用サブドメイン。実記事でも検索除外を維持する。
  const release = await buildPostRelease(post);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `release=${release}\n`);
  console.log(`確認用ファイルを生成しました: ${path.relative(process.cwd(), release)}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "記事生成に失敗しました。");
  process.exitCode = 1;
}
