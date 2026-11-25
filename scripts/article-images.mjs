import { createHash } from "node:crypto";
import { MAX_IMAGES } from "../lib/site-files.mjs";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;

function imageFormat(bytes) {
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "jpg";
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "webp";
  throw new Error("本文画像はJPEG・PNG・WebPだけに対応しています。");
}

export async function collectArticleImages(html, {
  projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID,
  dataset = process.env.NEXT_PUBLIC_SANITY_DATASET,
  fetcher = fetch,
} = {}) {
  const sources = [...new Set([...html.matchAll(/<img\b[^>]*\bsrc="([^"]*)"/g)]
    .map((match) => match[1]).filter((src) => src !== "./comfylabo-logo.jpg"))];
  if (sources.length > MAX_IMAGES) throw new Error("本文画像は10枚以内にしてください。");
  if (sources.length && (!/^[a-z0-9]+$/.test(projectId || "") || !/^[A-Za-z0-9_-]+$/.test(dataset || ""))) {
    throw new Error("本文画像のSanity接続先を確認してください。");
  }
  const files = {};
  let total = 0;
  for (const source of sources) {
    const url = new URL(source, "https://invalid.local/");
    const prefix = `/images/${projectId}/${dataset}/`;
    if (url.origin !== "https://cdn.sanity.io" || url.username || url.password || url.search || url.hash ||
        !url.pathname.startsWith(prefix) ||
        !/^[a-f0-9]+-[1-9][0-9]*x[1-9][0-9]*\.(jpg|png|webp)$/.test(url.pathname.slice(prefix.length))) {
      throw new Error("本文画像は同じSanityプロジェクトの元画像URLを指定してください。");
    }
    const response = await fetcher(url, { redirect: "error", signal: AbortSignal.timeout(15000) });
    if (response.status !== 200 || !response.body) throw new Error("本文画像を取得できません。生成を中止しました。");
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        total += value.length;
        if (size > MAX_IMAGE_BYTES || total > MAX_TOTAL_BYTES) throw new Error("本文画像の容量上限を超えています。");
        chunks.push(Buffer.from(value));
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    const bytes = Buffer.concat(chunks);
    const format = imageFormat(bytes);
    const mime = format === "jpg" ? "image/jpeg" : `image/${format}`;
    if (response.headers.get("content-type")?.split(";")[0].trim() !== mime || !url.pathname.endsWith(`.${format}`)) {
      throw new Error("本文画像の形式が応答内容と一致しません。");
    }
    const name = `image-${createHash("sha256").update(bytes).digest("hex")}.${format}`;
    files[name] = bytes;
    html = html.replaceAll(`src="${source}"`, `src="./${name}"`)
      .replaceAll(`href="${source}"`, `href="./${name}"`);
  }
  return { html, files };
}
