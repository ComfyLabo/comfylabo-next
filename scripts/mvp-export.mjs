import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PortableText } from "@portabletext/react";

import { readSnapshot, validatePost } from "../lib/mvp-snapshot.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hash = (value) => createHash("sha256").update(value).digest("hex");

function renderArticle(post, preview, styleVersion) {
  const PostBody = ({ body }) => h("div", { className: "article-body" },
    typeof body === "string"
      ? h(ReactMarkdown, { remarkPlugins: [remarkGfm], children: body })
      : h(PortableText, { value: body }),
  );
  return "<!doctype html>\n" + renderToStaticMarkup(h("html", { lang: "ja" },
      h("head", null,
        h("meta", { charSet: "utf-8" }),
        h("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }),
        preview ? h("meta", { name: "robots", content: "noindex, nofollow" }) : null,
        h("title", null, `${post.title} | ComfyLabo`),
        h("link", { rel: "stylesheet", href: `./styles.css?v=${styleVersion}` }),
      ),
      h("body", null, h("main", null,
        preview ? h("p", { className: "preview-note" }, "新システムの表示確認用") : null,
        h("article", { "aria-labelledby": "article-title" },
          h("header", null,
            h("img", { className: "logo", src: "./comfylabo-logo.jpg", alt: "ComfyLabo", width: 1179, height: 883, loading: "lazy" }),
            h("h1", { id: "article-title" }, post.title),
          ),
          h(PostBody, { body: post.body }),
        ),
        h("footer", { id: "reading-check" }, "ComfyLabo"),
      )),
  ));
}

export async function buildRelease(filename, {
  snapshotDirectory = path.join(root, ".mvp/snapshots"),
  releaseDirectory = path.join(root, ".mvp/releases"),
  logoPath = path.join(root, "public/comfylabo-logo.jpg"),
} = {}) {
  const { post } = await readSnapshot(filename, snapshotDirectory);
  return buildPostRelease(post, { releaseDirectory, logoPath });
}

export async function buildPostRelease(post, {
  releaseDirectory = path.join(root, ".mvp/releases"),
  logoPath = path.join(root, "public/comfylabo-logo.jpg"),
  preview = true,
} = {}) {
  validatePost(post);
  const styles = await readFile(path.join(root, "app/mvp/export.css"));
  const html = renderArticle(post, preview, hash(styles).slice(0, 12));
  // 未収集の相対画像を含む、不完全な成果物は作らない。
  for (const [, src] of html.matchAll(/<img\b[^>]*\bsrc="([^"]*)"/g)) {
    if (src !== "./comfylabo-logo.jpg" && !/^https?:\/\//.test(src)) {
      throw new Error("本文に未対応の画像パスがあります。画像の配置を確認してください。");
    }
  }
  const files = {
    "index.html": Buffer.from(html),
    "styles.css": styles,
    "comfylabo-logo.jpg": await readFile(logoPath),
  };
  if (Object.values(files).some((value) => value.length === 0)) throw new Error("成果物が空です。");
  await mkdir(releaseDirectory, { recursive: true });
  const staging = await mkdtemp(path.join(releaseDirectory, ".building-"));
  try {
    const manifest = { version: 1, postId: post._id, revision: post._rev, slug: post.slug, files: {} };
    for (const [name, content] of Object.entries(files)) {
      await writeFile(path.join(staging, name), content, { flag: "wx" });
      if (hash(await readFile(path.join(staging, name))) !== hash(content)) throw new Error("成果物の検証に失敗しました。");
      manifest.files[name] = hash(content);
    }
    await writeFile(path.join(staging, "SHA256SUMS"), Object.entries(manifest.files).map(([name, hash]) => `${hash}  ${name}`).join("\n") + "\n", { flag: "wx" });
    await writeFile(path.join(staging, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
    const destination = path.join(releaseDirectory, `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}`);
    await rename(staging, destination);
    return destination;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [filename, ...extra] = process.argv.slice(2);
  if (!filename || extra.length) {
    console.error("使い方: npm run mvp:export -- '<スナップショットのファイル名.json>'");
    process.exitCode = 1;
  } else {
    buildRelease(filename).then((directory) => console.log(`ローカル成果物を生成しました: ${path.relative(root, directory)}`)).catch(() => {
      console.error("記事の書き出しに失敗しました。入力データ・本文の画像パス・ロゴを確認してください。以前の成果物は変更していません。");
      process.exitCode = 1;
    });
  }
}
