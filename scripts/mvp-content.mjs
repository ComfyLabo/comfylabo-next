import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

import { saveSnapshot } from "../lib/mvp-snapshot.mjs";
export { saveSnapshot, validatePost } from "../lib/mvp-snapshot.mjs";

const { loadEnvConfig } = createRequire(import.meta.url)("@next/env");

export async function queryPublished(query, parameters = {}) {
  const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
  const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET;
  if (!projectId || !dataset) throw new Error("Sanity の project ID / dataset が未設定です。");
  if (!/^[a-z0-9]+$/.test(projectId) || !/^[a-zA-Z0-9_-]+$/.test(dataset)) {
    throw new Error("Sanity の接続設定が不正です。");
  }
  const url = new URL(`https://${projectId}.api.sanity.io/v2023-01-01/data/query/${dataset}`);
  url.searchParams.set("perspective", "published");
  url.searchParams.set("query", query);
  for (const [key, value] of Object.entries(parameters)) {
    url.searchParams.set(`$${key}`, JSON.stringify(value));
  }
  // 公開サイトと同じ匿名読み取り。開発用の下書きトークンは使用しない。
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  } catch {
    throw new Error("Sanity へ接続できません。通信環境を確認してください。既存スナップショットは変更していません。");
  }
  if (!response.ok) throw new Error(`Sanity 読み取り失敗 (HTTP ${response.status})。保存は行いません。`);
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("Sanity の応答を解析できません。保存は行いません。");
  }
  if (!data || typeof data !== "object" || data.error || !("result" in data)) throw new Error("Sanity の応答が不正です。保存は行いません。");
  return data.result;
}

export async function fetchPublishedPost(slug) {
  if (typeof slug !== "string" || !slug.trim()) throw new Error("対象記事のslugを指定してください。");
  const posts = await queryPublished(`*[_type == "post" && !(_id in path("drafts.**")) && slug.current == $slug][0...2]{_id,_rev,title,"slug":slug.current,"body":coalesce(markdownBody,body),"author":author->name,publishedAt}`, { slug });
  if (!Array.isArray(posts) || posts.length !== 1) {
    throw new Error("対象の公開済み記事が一意に見つかりません。保存を中止しました。");
  }
  return posts[0];
}

async function main() {
  loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
  const [command, slug, ...extra] = process.argv.slice(2);
  if (extra.length || (command !== "list" && command !== "snapshot") ||
      (command === "list" && slug) || (command === "snapshot" && !slug?.trim())) {
    throw new Error("使い方: npm run mvp:articles / npm run mvp:snapshot -- '<slug>'");
  }
  if (command === "list") {
    const posts = await queryPublished(`*[_type == "post" && !(_id in path("drafts.**"))] | order(publishedAt desc)[0...20]{title,"slug":slug.current,"hasMarkdown":defined(markdownBody),"hasBody":defined(body)}`);
    if (!Array.isArray(posts)) throw new Error("記事一覧の応答が不正です。");
    console.log(JSON.stringify(posts, null, 2));
    return;
  }
  const post = await fetchPublishedPost(slug);
  const destination = await saveSnapshot(post, path.resolve(".mvp/snapshots"));
  console.log(`記事1本のローカルスナップショットを保存しました: ${path.relative(process.cwd(), destination)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "記事取得に失敗しました。");
    process.exitCode = 1;
  });
}
