import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { buildBlogRelease } from "./blog-export.mjs";
import { createBlogPreview } from "./blog-preview.mjs";

test("確認サーバーは照合済みの記事と素材だけを配信し、内部ファイルと書き込み要求を拒否する", async () => {
  const root = path.resolve(".mvp/blog-releases");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, ".preview-test-"));
  try {
    const release = await buildBlogRelease([{ _id: "test", _rev: "1", slug: "example", title: "確認", body: "本文" }], { releaseDirectory: directory });
    const server = await createBlogPreview(release);
    const request = (url, method = "GET") => {
      const result = {};
      server.emit("request", { url, method }, {
        writeHead(status, headers) { result.status = status; result.headers = headers; },
        end(body) { result.body = body; },
      });
      return result;
    };
    for (const url of ["/", "/posts/example/", "/posts/example/index.html", "/styles.css?v=test", "/comfylabo-logo.jpg"]) {
      const response = request(url);
      assert.equal(response.status, 200);
      assert.equal(response.headers["X-Robots-Tag"], "noindex, nofollow");
      assert.ok(response.body.length > 0);
    }
    for (const url of ["/manifest.json", "/SHA256SUMS", "/.env.local", "/posts/example/../../../.env.local", "/posts/missing/"]) {
      assert.equal(request(url).status, 404);
    }
    assert.equal(request("/", "POST").status, 404);
    assert.equal(request("/", "HEAD").body, undefined);
    const css = path.join(release, "styles.css");
    await writeFile(css, (await readFile(css, "utf8")) + "tampered");
    await assert.rejects(createBlogPreview(release));
    await assert.rejects(createBlogPreview(process.cwd()));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
