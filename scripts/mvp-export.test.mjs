import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { saveSnapshot } from "../lib/mvp-snapshot.mjs";
import { buildRelease } from "./mvp-export.mjs";

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
    assert.ok(html.includes('href="./styles.css"'));
    const manifest = JSON.parse(await readFile(path.join(first, "manifest.json"), "utf8"));
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
