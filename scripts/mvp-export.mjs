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
import { collectArticleImages } from "./article-images.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hash = (value) => createHash("sha256").update(value).digest("hex");

export function renderArticle(post, preview, styleVersion, homeHref, canonicalUrl, metadata) {
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
        canonicalUrl ? h("link", { rel: "canonical", href: canonicalUrl }) : null,
        metadata ? h("meta", {name: "description", content: metadata.description}) : null,
        metadata ? h("meta", {name: "robots", content: "max-image-preview:large"}) : null,
        ...(metadata ? Object.entries(metadata.openGraph).map(([property, content]) => h("meta", {key: property, property, content})) : []),
        metadata ? h("script", {type: "application/ld+json", dangerouslySetInnerHTML: {
          __html: JSON.stringify(metadata.structuredData).replaceAll('<', '\\u003c'),
        }}) : null,
        h("link", { rel: "stylesheet", href: `./styles.css?v=${styleVersion}` }),
      ),
      h("body", null, h("main", null,
        preview ? h("p", { className: "preview-note" }, "新システムの表示確認用") : null,
        h("article", { "aria-labelledby": "article-title" },
          h("header", null,
            h("img", { className: "logo", src: "./comfylabo-logo.jpg", alt: "ComfyLabo", width: 1179, height: 883, loading: "lazy" }),
            h("h1", { id: "article-title" }, post.title),
          ),
          homeHref ? h("nav", { className: "article-nav", "aria-label": "記事の移動" }, h("a", { href: homeHref }, "← 記事一覧へ")) : null,
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
  imageOptions,
  productionUrl,
  productionMetadata,
} = {}) {
  validatePost(post);
  if (productionUrl !== undefined && (preview !== false || productionUrl !== "https://comfylabo.com/4484/" ||
      post._id !== "6a6732df-f6d2-434e-9fca-7e745ad0b11a" || post.slug !== "4484")) {
    throw new Error("本番候補は承認準備中のObsidian記事と既存URLだけに限定しています。");
  }
  if (productionMetadata && (!productionUrl || productionMetadata.openGraph?.['og:url'] !== productionUrl ||
      productionMetadata.structuredData?.mainEntityOfPage?.['@id'] !== productionUrl)) {
    throw new Error("本番メタデータの対象URLが一致しません。");
  }
  const styles = await readFile(path.join(root, "app/mvp/export.css"));
  const { html, files: images } = await collectArticleImages(
    renderArticle(post, preview, hash(styles).slice(0, 12), productionUrl ? "/" : undefined, productionUrl, productionMetadata), imageOptions,
  );
  const files = {
    "index.html": Buffer.from(html),
    "styles.css": styles,
    "comfylabo-logo.jpg": await readFile(logoPath),
    ...Object.fromEntries(Object.entries(images).sort(([a], [b]) => a.localeCompare(b))),
  };
  if (Object.values(files).some((value) => value.length === 0)) throw new Error("成果物が空です。");
  if (Object.values(files).reduce((sum, value) => sum + value.length, 0) > 10 * 1024 * 1024) {
    throw new Error("記事全体の容量上限を超えています。");
  }
  await mkdir(releaseDirectory, { recursive: true });
  const staging = await mkdtemp(path.join(releaseDirectory, ".building-"));
  try {
    // Production candidates cannot be passed into either existing preview deployment mode.
    const manifest = { version: productionUrl ? 3 : 1,
      ...(productionUrl ? {kind: "production-article-candidate", target: productionUrl,
        source: {kind: "sanity-published", projectId: "0lwnb6yi", dataset: "production"}} : {}),
      postId: post._id, revision: post._rev, slug: post.slug, files: {} };
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
