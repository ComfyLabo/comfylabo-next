import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildPostRelease } from "./mvp-export.mjs";
import { verifySite } from "./verify-site.mjs";
import { buildBlogRelease } from "./blog-export.mjs";
import { publishedBlogFiles } from "../lib/site-files.mjs";

test("公開ファイルの一致と内部パスの拒否を照合し、初期ページや公開範囲の異常を成功扱いしない", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "comfylabo-https-"));
  try {
    const release = await buildPostRelease({ _id: "test", _rev: "1", slug: "welcome", title: "確認", body: "本文" }, { releaseDirectory: directory });
    const fetcher = async (url, options) => {
      assert.equal(url.protocol, "https:");
      assert.equal(options.redirect, "error");
      const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      if (["index.html", "styles.css", "comfylabo-logo.jpg"].includes(name)) return new Response(await readFile(path.join(release, name)));
      return new Response("Not Found", { status: 404 });
    };
    assert.deepEqual(await verifySite("https://preview.example/", release, fetcher), { files: 3, internalPathsBlocked: true });
    await assert.rejects(verifySite("https://preview.example/", release, async () => new Response("初期ページ")));
    await assert.rejects(verifySite("https://preview.example/", release, async (url, options) => {
      if (url.pathname === "/manifest.json") return new Response("exposed");
      return fetcher(url, options);
    }));
    await assert.rejects(verifySite("http://preview.example/", release, fetcher));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("一覧版は明示モードで全記事を照合し、サンプルや別Sanityを公開版として受け付けない", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "comfy-blog-verify-"));
  const posts = ["first", "second"].map((slug) => ({ _id: `post-${slug}`, _rev: "1", slug, title: slug, body: "本文" }));
  const source = { kind: "sanity-published", projectId: "0lwnb6yi", dataset: "production" };
  try {
    const release = await buildBlogRelease(posts, { releaseDirectory: directory, source });
    const manifest = JSON.parse(await readFile(path.join(release, "manifest.json"), "utf8"));
    assert.equal(publishedBlogFiles(manifest).length, 5);
    for (const invalid of [
      { ...manifest, source: { kind: "sample" } },
      { ...manifest, source: { ...source, projectId: "other" } },
      { ...manifest, posts: [manifest.posts[0], manifest.posts[0]] },
      { ...manifest, posts: [{ ...manifest.posts[0], id: "drafts.test" }] },
      { ...manifest, files: { ...manifest.files, "posts/../secret/index.html": "a".repeat(64) } },
    ]) assert.throws(() => publishedBlogFiles(invalid));
    const seen = [];
    const fetcher = async (url) => {
      let file = url.pathname.slice(1);
      if (!file || file.endsWith("/")) file += "index.html";
      seen.push(file);
      if (["manifest.json", "SHA256SUMS"].includes(file)) return new Response("missing", { status: 404 });
      try { return new Response(await readFile(path.join(release, file))); }
      catch { return new Response("missing", { status: 404 }); }
    };
    await assert.rejects(verifySite("https://preview.example/", release, () => assert.fail("must not fetch without opt-in")));
    assert.deepEqual(await verifySite("https://preview.example/", release, fetcher, { blog: true }), { files: 5, internalPathsBlocked: true });
    assert.ok(seen.includes("posts/second/index.html"));
    await assert.rejects(verifySite("https://preview.example/", release, (url) => url.pathname === "/posts/second/"
      ? new Response("broken") : fetcher(url), { blog: true }));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("本文画像もHTTPSで照合し、不正なファイル名は取得前に拒否する", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "comfylabo-image-https-"));
  const image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  try {
    const release = await buildPostRelease({ _id: "test", _rev: "1", slug: "test", title: "画像", body: "![画像](https://cdn.sanity.io/images/test/production/abc-1x1.png)" }, {
      releaseDirectory: directory, imageOptions: { projectId: "test", dataset: "production",
        fetcher: async () => new Response(image, { headers: { "content-type": "image/png" } }),
      },
    });
    const fetcher = async (url) => {
      const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      try { return new Response(await readFile(path.join(release, name))); }
      catch { return new Response("missing", { status: 404 }); }
    };
    const safeFetcher = (url) => ["manifest.json", "SHA256SUMS"].some((name) => url.pathname.endsWith(name))
      ? new Response("missing", { status: 404 }) : fetcher(url);
    assert.deepEqual(await verifySite("https://preview.example/", release, safeFetcher), { files: 4, internalPathsBlocked: true });
    await assert.rejects(verifySite("https://preview.example/", release, (url) => url.pathname.startsWith("/image-")
      ? new Response("corrupted") : safeFetcher(url)));
    const manifestPath = path.join(release, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.files["../private.png"] = "a".repeat(64);
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(verifySite("https://preview.example/", release, () => assert.fail("must not fetch")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
