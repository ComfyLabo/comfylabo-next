import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * @typedef {object} MvpPost
 * @property {string} _id
 * @property {string} _rev
 * @property {string} title
 * @property {string} slug
 * @property {import("./sanity").SanityPostBody} body
 * @property {string | null} [author]
 * @property {string | null} [publishedAt]
 */

/** @param {unknown} post @returns {MvpPost} */
export function validatePost(post) {
  if (!post || typeof post !== "object") {
    throw new Error("公開済み記事が見つかりません。");
  }
  for (const key of ["_id", "_rev", "title", "slug"]) {
    if (typeof post[key] !== "string" || !post[key].trim()) {
      throw new Error(`記事の ${key} が未設定です。保存を中止しました。`);
    }
  }
  if (post._id.startsWith("drafts.")) throw new Error("下書きは保存できません。");
  if (Array.isArray(post.body) && !post.body.every((block) =>
    block?._type === "block" && Array.isArray(block.children) &&
    block.children.every((child) => typeof child?.text === "string"),
  )) {
    throw new Error("未対応の本文ブロックがあります。本文を欠落させないため生成を中止しました。");
  }
  const hasBody = typeof post.body === "string"
    ? Boolean(post.body.trim())
    : Array.isArray(post.body) && post.body.some((block) =>
      block?._type === "block" && Array.isArray(block.children) &&
      block.children.some((child) => typeof child?.text === "string" && child.text.trim()),
    );
  if (!hasBody) throw new Error("記事本文が空です。保存を中止しました。");
  return post;
}

export async function saveSnapshot(post, directory) {
  validatePost(post);
  // 検証済みデータだけを新規ファイルに保存する。既存の正常版は上書きしない。
  const content = JSON.stringify({
    version: 1,
    capturedAt: new Date().toISOString(),
    post,
  }, null, 2) + "\n";
  await mkdir(directory, { recursive: true });
  const filename = `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}.json`;
  const destination = path.join(directory, filename);
  await writeFile(destination, content, { flag: "wx", mode: 0o600 });
  return destination;
}

/** @param {string} filename @param {string} directory */
export async function readSnapshot(filename, directory) {
  // サーバー側の設定だけで選択し、指定ディレクトリ以外は読み込まない。
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/.test(filename) || filename.length > 255) {
    throw new Error("MVP_SNAPSHOT にはスナップショットのファイル名だけを指定してください。");
  }
  const source = path.join(directory, filename);
  let snapshot;
  try {
    if (!(await lstat(source)).isFile()) throw new Error("Not a regular file");
    snapshot = JSON.parse(await readFile(source, "utf8"));
  } catch {
    throw new Error("指定したスナップショットを読み込めません。ファイルの存在とJSON形式を確認してください。");
  }
  if (!snapshot || snapshot.version !== 1 || typeof snapshot.capturedAt !== "string" ||
      Number.isNaN(Date.parse(snapshot.capturedAt))) {
    throw new Error("スナップショットの形式またはバージョンが不正です。");
  }
  // 壊れたデータをサンプル記事に置き換えて、成功したように表示しない。
  const post = validatePost(snapshot.post);
  return { capturedAt: snapshot.capturedAt, post };
}

