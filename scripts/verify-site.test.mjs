import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildPostRelease } from "./mvp-export.mjs";
import { verifySite } from "./verify-site.mjs";

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
