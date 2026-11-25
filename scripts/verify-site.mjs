import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { publicFiles, publishedBlogFiles } from "../lib/site-files.mjs";

export async function verifySite(address, release, fetcher = fetch, { blog = false } = {}) {
  const url = new URL(address);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("HTTPSの公開トップURLを指定してください。");
  }
  const manifest = JSON.parse(await readFile(path.join(release, "manifest.json"), "utf8"));
  const files = blog ? publishedBlogFiles(manifest) : publicFiles(manifest);
  for (const file of files) {
    const expected = manifest.files?.[file];
    if (typeof expected !== "string" || !/^[a-f0-9]{64}$/.test(expected)) throw new Error("照合情報が不正です。");
    const route = file === "index.html" ? "./" : file.endsWith("/index.html") ? file.slice(0, -10) : file;
    const response = await fetcher(new URL(route, url), {
      redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000),
    });
    if (response.status !== 200) throw new Error(`${file}: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== expected) throw new Error(`${file}: 内容が生成した版と一致しません。`);
  }
  for (const file of ["site/index.html", "manifest.json", "SHA256SUMS", ".env.local"]) {
    const response = await fetcher(new URL(file, url), { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (response.status !== 404) throw new Error("内部パスの公開範囲を確認してください。");
  }
  return { files: files.length, internalPathsBlocked: true };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [address, release, flag, ...extra] = process.argv.slice(2);
  if (!address || !release || extra.length || (flag && flag !== "--blog")) {
    console.error("使い方: npm run site:verify -- https://確認用URL/ <生成先> [--blog]");
    process.exitCode = 1;
  } else {
    verifySite(address, release, fetch, { blog: flag === "--blog" }).then(() => console.log("HTTPS検証成功：記事・CSS・ロゴ・本文画像の内容が一致し、内部パスは非公開です。")).catch((error) => {
      console.error(`HTTPS検証未完了：${error.message}`);
      process.exitCode = 1;
    });
  }
}
