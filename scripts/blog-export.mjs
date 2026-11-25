import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { validatePost } from "../lib/mvp-snapshot.mjs";
import { renderArticle } from "./mvp-export.mjs";
import { collectArticleImages } from "./article-images.mjs";
import {validateNewProductionPosts} from './new-production-content.mjs';
import {SITE, LEGACY_ID, articleRoute, collectionMetadata} from './collection-metadata.mjs';

const root = path.resolve(import.meta.dirname, "..");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const articlePath = (slug) => `posts/${slug}/index.html`;

function dateLabel(value) {
  return new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Tokyo" }).format(new Date(value));
}

function renderIndex(posts, cssVersion, production = false) {
  return "<!doctype html>\n" + renderToStaticMarkup(h("html", { lang: "ja" },
    h("head", null,
      h("meta", { charSet: "utf-8" }),
      h("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }),
      h("meta", { name: "robots", content: production ? "max-image-preview:large" : "noindex, nofollow" }),
      production ? h('link', {rel: 'canonical', href: SITE + '/readings/'}) : null,
      h("title", null, "記事一覧 | ComfyLabo"),
      h("link", { rel: "stylesheet", href: `./styles.css?v=${cssVersion}` }),
    ),
    h("body", null, h("main", null,
      production ? null : h("p", { className: "preview-note" }, "新システムの表示確認用"),
      h("header", null,
        h("img", { className: "logo", src: "./comfylabo-logo.jpg", alt: "ComfyLabo", width: 1179, height: 883 }),
        h("h1", null, "読みもの"),
        h("p", { className: "list-intro" }, "ComfyLaboの記事一覧です。"),
      ),
      h("section", { className: "post-list", "aria-label": "記事一覧" },
        h("p", { className: "post-count" }, `全${posts.length}記事`),
        h("ul", null, posts.map((post) => h("li", { key: post._id },
          post.publishedAt ? h("time", { dateTime: post.publishedAt }, dateLabel(post.publishedAt)) : null,
          h("h2", null, h("a", { href: production ? articleRoute(post) : `./posts/${post.slug}/` }, post.title)),
        ))),
      ),
      h("footer", null, "ComfyLabo"),
    )),
  ));
}

export async function buildBlogRelease(input, {
  releaseDirectory = path.join(root, ".mvp/blog-releases"),
  imageOptions,
  source = { kind: "local" },
  production = false,
} = {}) {
  if (!Array.isArray(input) || !input.length || input.length > (production ? 101 : 100)) throw new Error("公開記事の件数が不正です。");
  let legacyMetadata;
  if (production) {
    if (source.kind !== 'sanity-published' || source.projectId !== '0lwnb6yi' || source.dataset !== 'production' || Object.keys(source).length !== 3 ||
        input.filter(p => p._id === LEGACY_ID && p.slug === '4484').length !== 1) throw Error('本番の取得元または既存記事が不正です。');
    validateNewProductionPosts(input.filter(p => p._id !== LEGACY_ID));
    legacyMetadata = JSON.parse(await readFile(path.join(root, 'config/obsidian-production-metadata.json'), 'utf8'));
    if (legacyMetadata.target !== SITE + '/4484/') throw Error('既存の正規URLが不正です。');
  }
  const slugs = new Set();
  const ids = new Set();
  for (const post of input) {
    validatePost(post);
    if (post._id.startsWith("versions.") || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(post.slug) ||
        slugs.has(post.slug) || ids.has(post._id) ||
        (post.publishedAt != null && (typeof post.publishedAt !== "string" || !Number.isFinite(Date.parse(post.publishedAt))))) {
      throw new Error("記事のID・slug・公開日時が不正、または重複しています。");
    }
    slugs.add(post.slug);
    ids.add(post._id);
  }
  const posts = [...input].sort((a, b) =>
    (Date.parse(b.publishedAt || "1970-01-01") - Date.parse(a.publishedAt || "1970-01-01")) || a._id.localeCompare(b._id),
  );
  const styles = await readFile(path.join(root, "app/mvp/export.css"));
  const cssVersion = hash(styles).slice(0, 12);
  const files = {
    "index.html": Buffer.from(renderIndex(posts, cssVersion, production)),
    "styles.css": styles,
    "comfylabo-logo.jpg": await readFile(path.join(root, "public/comfylabo-logo.jpg")),
  };
  for (const post of posts) {
    const metadata = production ? collectionMetadata(post, legacyMetadata) : undefined;
    const collected = await collectArticleImages(renderArticle(post, !production, cssVersion, production ? '/readings/' : "../../",
      production ? SITE + articleRoute(post) : undefined, metadata), imageOptions);
    let html = collected.html;
    const assetPrefix = production ? '/readings/' : '../../';
    // 画像とスタイルはルートで共有し、深い記事URLからも参照できるようにする。
    for (const name of ["styles.css", "comfylabo-logo.jpg", ...Object.keys(collected.files)]) {
      html = html.replaceAll(`src="./${name}"`, `src="${assetPrefix}${name}"`)
        .replaceAll(`href="./${name}"`, `href="${assetPrefix}${name}"`);
    }
    html = html.replace(`href="./styles.css?v=${cssVersion}"`, `href="${assetPrefix}styles.css?v=${cssVersion}"`);
    files[production && post._id === LEGACY_ID ? 'legacy/4484/index.html' : articlePath(post.slug)] = Buffer.from(html);
    Object.assign(files, collected.files);
    if (Object.values(files).reduce((sum, bytes) => sum + bytes.length, 0) > 10 * 1024 * 1024) {
      throw new Error("記事一覧を含む成果物全体の10MiB上限を超えています。");
    }
  }
  // 全記事を検証してから新しい版を作る。1件の失敗でも部分的な一覧を公開しない。
  await mkdir(releaseDirectory, { recursive: true });
  const staging = await mkdtemp(path.join(releaseDirectory, ".building-"));
  try {
    const legacy = production ? posts.find(p => p._id === LEGACY_ID) : null;
    const manifest = { version: production ? 4 : 2, kind: production ? 'production-collection' : "article-list", source,
      ...(production ? {target: SITE, postId: LEGACY_ID, revision: legacy._rev} : {}),
      posts: posts.map((post) => ({ id: post._id, revision: post._rev, slug: post.slug,
        ...(production && post._id !== LEGACY_ID ? {publicationSystem: post.publicationSystem} : {})})), files: {} };
    for (const name of Object.keys(files).sort()) {
      const bytes = files[name];
      await mkdir(path.dirname(path.join(staging, name)), { recursive: true });
      await writeFile(path.join(staging, name), bytes, { flag: "wx" });
      if (hash(await readFile(path.join(staging, name))) !== hash(bytes)) throw new Error("生成したファイルの照合に失敗しました。");
      manifest.files[name] = hash(bytes);
    }
    await writeFile(path.join(staging, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    await writeFile(path.join(staging, "SHA256SUMS"), Object.entries(manifest.files).map(([name, digest]) => `${digest}  ${name}\n`).join(""));
    const destination = path.join(releaseDirectory, `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}`);
    await rename(staging, destination);
    return destination;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}
