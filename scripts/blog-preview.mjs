import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function createBlogPreview(release) {
  const allowedRoot = await realpath(path.resolve(".mvp/blog-releases"));
  const directory = await realpath(release);
  const relative = path.relative(allowedRoot, directory);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("一覧版のローカル生成先を指定してください。");
  const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
  if (manifest.version !== 2 || manifest.kind !== "article-list") throw new Error("記事一覧版の成果物ではありません。");
  const routes = new Map();
  let total = 0;
  for (const [name, digest] of Object.entries(manifest.files)) {
    if (!/^(?:index\.html|styles\.css|comfylabo-logo\.jpg|image-[a-f0-9]{64}\.(?:jpg|png|webp)|posts\/[a-z0-9]+(?:-[a-z0-9]+)*\/index\.html)$/.test(name)) {
      throw new Error("確認用ファイル名が不正です。");
    }
    const file = await realpath(path.join(directory, name));
    if (file !== path.join(directory, name)) throw new Error("シンボリックリンクは使用できません。");
    const bytes = await readFile(file);
    total += bytes.length;
    if (total > 10 * 1024 * 1024 || createHash("sha256").update(bytes).digest("hex") !== digest) throw new Error("成果物の照合に失敗しました。");
    const type = name.endsWith(".html") ? "text/html; charset=utf-8" : name.endsWith(".css") ? "text/css; charset=utf-8" : name.endsWith(".png") ? "image/png" : name.endsWith(".webp") ? "image/webp" : "image/jpeg";
    routes.set("/" + name, { bytes, type });
    if (name.endsWith("index.html")) routes.set("/" + name.slice(0, -10), { bytes, type });
  }
  return createServer((req, res) => {
    const route = routes.get(new URL(req.url, "http://localhost").pathname);
    if (!route || !["GET", "HEAD"].includes(req.method)) {
      res.writeHead(404); res.end("Not found"); return;
    }
    res.writeHead(200, { "Content-Type": route.type, "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" });
    res.end(req.method === "HEAD" ? undefined : route.bytes);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [release, ...extra] = process.argv.slice(2);
  try {
    if (!release || extra.length) throw new Error("使い方: npm run blog:preview -- .mvp/blog-releases/<版>");
    const server = await createBlogPreview(release);
    server.on("error", () => { console.error("確認用サーバーを起動できません。ポート4175の使用状況を確認してください。"); process.exitCode = 1; });
    server.listen(4175, "127.0.0.1", () => console.log("ローカル確認: http://127.0.0.1:4175/"));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "確認用サーバーを起動できません。");
    process.exitCode = 1;
  }
}
