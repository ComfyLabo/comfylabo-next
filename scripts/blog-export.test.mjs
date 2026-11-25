import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildBlogRelease } from "./blog-export.mjs";
import { publicFiles } from "../lib/site-files.mjs";

const first = { _id: "post-a", _rev: "rev-a", slug: "welcome", title: "最初の記事", body: "## 見出し\n\n本文です。", publishedAt: "2026-11-24T12:00:00Z" };
const second = { ...first, _id: "post-b", _rev: "rev-b", slug: "next", title: "次の記事 <script>test</script>", publishedAt: "2026-11-24T16:00:00Z" };

test("記事追加で一覧と個別ページを生成し、全リンクとファイルハッシュが一致する", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "comfy-blog-"));
  try {
    const previous = await buildBlogRelease([first], { releaseDirectory: directory });
    const original = await readFile(path.join(previous, "index.html"), "utf8");
    const release = await buildBlogRelease([first, second], { releaseDirectory: directory });
    const index = await readFile(path.join(release, "index.html"), "utf8");
    assert.ok(index.indexOf('href="./posts/next/"') < index.indexOf('href="./posts/welcome/"'));
    assert.ok(index.includes("2026年11月25日"));
    assert.ok(index.includes("&lt;script&gt;"));
    assert.ok(!index.includes("<script>"));
    for (const slug of ["welcome", "next"]) {
      const article = await readFile(path.join(release, `posts/${slug}/index.html`), "utf8");
      assert.ok(article.includes('href="../../"'));
      assert.ok(article.includes('href="../../styles.css?v='));
      assert.ok(article.includes('src="../../comfylabo-logo.jpg"'));
      assert.ok(article.includes('content="noindex, nofollow"'));
    }
    const manifest = JSON.parse(await readFile(path.join(release, "manifest.json"), "utf8"));
    for (const [file, digest] of Object.entries(manifest.files)) {
      assert.equal(createHash("sha256").update(await readFile(path.join(release, file))).digest("hex"), digest);
    }
    // 複数記事版を既存の1記事用転送処理へ誤って渡さない。
    assert.throws(() => publicFiles(manifest));
    assert.equal(await readFile(path.join(previous, "index.html"), "utf8"), original);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("下書き・重複slug・危険なパス・不正な記事を部分生成せず正常版を保持する", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "comfy-blog-fail-"));
  try {
    const release = await buildBlogRelease([first], { releaseDirectory: directory });
    for (const posts of [[], [null], [first, { ...second, slug: first.slug }],
      [first, { ...second, _id: first._id }], [{ ...first, _id: "drafts.test" }],
      [{ ...first, _id: "versions.test" }], [{ ...first, slug: "../escape" }],
      [{ ...first, slug: "a%2fb" }], [{ ...first, publishedAt: "invalid" }],
      [first, { ...second, body: "" }], Array(101).fill(first)]) {
      await assert.rejects(buildBlogRelease(posts, { releaseDirectory: directory }));
    }
    await assert.rejects(buildBlogRelease([first, { ...second, body: "![画像](https://cdn.sanity.io/images/test/production/abc-1x1.png)" }], {
      releaseDirectory: directory, imageOptions: { projectId: "test", dataset: "production", fetcher: async () => new Response("missing", { status: 404 }) },
    }));
    assert.deepEqual(await readdir(directory), [path.basename(release)]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("記事ページの画像と原寸リンクは共有する同梱画像へ解決する", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "comfy-blog-images-"));
  const source = "https://cdn.sanity.io/images/test/production/abc-1x1.png";
  try {
    const release = await buildBlogRelease([{ ...first, body: `![画像](${source})\n\n[原寸](${source})` }], {
      releaseDirectory: directory, imageOptions: { projectId: "test", dataset: "production", fetcher: async () =>
        new Response(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), { headers: { "content-type": "image/png" } }),
      },
    });
    const html = await readFile(path.join(release, "posts/welcome/index.html"), "utf8");
    const src = html.match(/src="(\.\.\/\.\.\/image-[^"]+)"/)[1];
    assert.ok(html.includes(`href="${src}"`));
    assert.ok((await readFile(path.resolve(release, "posts/welcome", src))).length > 0);
    assert.ok(!html.includes("cdn.sanity.io"));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
