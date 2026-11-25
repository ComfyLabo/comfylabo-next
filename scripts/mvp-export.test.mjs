import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { saveSnapshot } from "../lib/mvp-snapshot.mjs";
import { buildRelease, buildPostRelease, renderArticle } from "./mvp-export.mjs";
import { publicFiles, publishedBlogFiles } from "../lib/site-files.mjs";

test('本番メタデータは検索・共有情報を保持し、構造化データからscriptを脱出できない', async () => {
  const url = 'https://comfylabo.com/4484/';
  const metadata = {description: '説明文 <確認>', openGraph: {'og:url': url, 'og:type': 'article', 'og:title': '記事',
    'og:description': '説明文', 'og:image': 'https://comfylabo.com/old.jpg', 'og:site_name': 'ComfyLabo', 'og:locale': 'ja_JP'},
    structuredData: {'@context': 'https://schema.org', '@type': 'Article', mainEntityOfPage: {'@id': url},
      headline: '</script><script>alert(1)</script>', datePublished: '2026-03-20T01:08:00.000Z'}};
  const post = {_id: '6a6732df-f6d2-434e-9fca-7e745ad0b11a', _rev: 'published', slug: '4484', title: '記事', body: '本文'};
  const html = renderArticle(post, false, 'style', '/', url, metadata);
  assert.match(html, /name="description" content="説明文 &lt;確認&gt;"/);
  assert.match(html, /name="robots" content="max-image-preview:large"/);
  assert.equal((html.match(/property="og:/g) || []).length, 7);
  const data = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1];
  assert.deepEqual(JSON.parse(data), metadata.structuredData);
  assert.ok(!data.includes('<'));
  assert.equal((html.match(/<script/g) || []).length, 1);
  await assert.rejects(buildPostRelease(post, {productionMetadata: metadata}));
  await assert.rejects(buildPostRelease(post, {preview: false, productionUrl: url,
    productionMetadata: {...metadata, openGraph: {'og:url': 'https://other.example/'}}}));
});

test("記事・CSS・ロゴを生成し、失敗時と再生成時に以前の正常版を維持する", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "comfylabo-export-"));
  const snapshotDirectory = path.join(directory, "snapshots");
  const releaseDirectory = path.join(directory, "releases");
  const options = { snapshotDirectory, releaseDirectory };
  const post = { _id: "local-test", _rev: "rev-1", slug: "example", title: "テスト <script>alert(1)</script>", body: "## 見出し\n\n**本文**\n\n<script>alert(2)</script>" };
  try {
    const snapshot = path.basename(await saveSnapshot(post, snapshotDirectory));
    const first = await buildRelease(snapshot, options);
    const html = await readFile(path.join(first, "index.html"), "utf8");
    assert.ok(html.includes("<strong>本文</strong>"));
    assert.ok(html.includes("&lt;script&gt;"));
    assert.ok(!html.includes("<script"));
    assert.ok(!html.includes("/_next/"));
    const manifest = JSON.parse(await readFile(path.join(first, "manifest.json"), "utf8"));
    // CSS更新時は読み込みURLも変え、ブラウザーに古いデザインを残さない。
    assert.ok(html.includes(`href="./styles.css?v=${manifest.files["styles.css"].slice(0, 12)}"`));
    for (const [name, hash] of Object.entries(manifest.files)) {
      assert.equal(createHash("sha256").update(await readFile(path.join(first, name))).digest("hex"), hash);
    }
    await assert.rejects(buildRelease("missing.json", options));
    await assert.rejects(buildRelease(snapshot, { ...options, logoPath: path.join(directory, "missing.jpg") }));
    const invalid = path.basename(await saveSnapshot({ ...post, body: "![画像](./missing.jpg)" }, snapshotDirectory));
    await assert.rejects(buildRelease(invalid, options));
    assert.deepEqual(await readdir(releaseDirectory), [path.basename(first)]);
    const second = await buildRelease(snapshot, options);
    assert.notEqual(first, second);
    assert.equal(await readFile(path.join(first, "index.html"), "utf8"), html);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("本番候補は既存URLを正規URLとし、確認用の配備形式へ混ぜない", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "comfylabo-production-"));
  const post = {_id: "6a6732df-f6d2-434e-9fca-7e745ad0b11a", _rev: "published", slug: "4484", title: "対象記事", body: "## 確認\n\n公開済みの本文です。"};
  const production = {releaseDirectory: directory, preview: false, productionUrl: "https://comfylabo.com/4484/"};
  try {
    const release = await buildPostRelease(post, production);
    const html = await readFile(path.join(release, "index.html"), "utf8");
    assert.ok(html.includes('<link rel="canonical" href="https://comfylabo.com/4484/"'));
    assert.ok(!html.includes('noindex'));
    assert.ok(!html.includes('新システムの表示確認用'));
    assert.ok(html.includes('href="/"'));
    const manifest = JSON.parse(await readFile(path.join(release, "manifest.json"), "utf8"));
    assert.equal(manifest.version, 3);
    assert.equal(manifest.target, production.productionUrl);
    assert.throws(() => publicFiles(manifest));
    assert.throws(() => publishedBlogFiles(manifest));
    const preview = await buildPostRelease(post, {releaseDirectory: directory});
    const previewHtml = await readFile(path.join(preview, "index.html"), "utf8");
    assert.ok(previewHtml.includes('noindex, nofollow'));
    assert.ok(!previewHtml.includes('rel="canonical"'));
    for (const [changedPost, changedOptions] of [
      [{...post, _id: 'another-post'}, production], [{...post, slug: 'another-slug'}, production],
      [post, {...production, preview: true}], [post, {...production, productionUrl: 'https://other.example/4484/'}],
    ]) await assert.rejects(buildPostRelease(changedPost, changedOptions));
    assert.equal((await readdir(directory)).length, 2);
  } finally { await rm(directory, {recursive: true, force: true}); }
});

test("画像を含む版を照合対象へ追加し、画像失敗・下書きでは正常版を保持する", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "comfylabo-images-"));
  const source = "https://cdn.sanity.io/images/test123/production/abcdef-1x1.png";
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const post = { _id: "published-test", _rev: "1", title: "画像あり", slug: "test", body: `![説明](${source})` };
  const options = { releaseDirectory: directory, imageOptions: {
    projectId: "test123", dataset: "production",
    fetcher: async () => new Response(bytes, { headers: { "content-type": "image/png" } }),
  } };
  try {
    const release = await buildPostRelease(post, options);
    const manifest = JSON.parse(await readFile(path.join(release, "manifest.json"), "utf8"));
    const name = Object.keys(manifest.files).find((name) => name.startsWith("image-"));
    assert.equal(manifest.files[name], createHash("sha256").update(bytes).digest("hex"));
    assert.ok((await readFile(path.join(release, "index.html"), "utf8")).includes(`src="./${name}"`));
    await assert.rejects(buildPostRelease(post, { ...options, imageOptions: { ...options.imageOptions,
      fetcher: async () => new Response("missing", { status: 404 }),
    } }));
    await assert.rejects(buildPostRelease({ ...post, _id: "drafts.test" }, options));
    assert.deepEqual(await readdir(directory), [path.basename(release)]);
    assert.deepEqual(await readFile(path.join(release, name)), bytes);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
