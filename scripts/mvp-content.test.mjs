import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { fetchPublishedPost, fetchPublishedPosts, saveSnapshot, validatePost } from "./mvp-content.mjs";
import { readSnapshot } from "../lib/mvp-snapshot.mjs";

const post = { _id: "post-1", _rev: "revision-1", title: "検証用", slug: "example", body: "記事本文" };

test("空本文・下書き・識別情報の欠落を保存対象から除外する", () => {
  for (const invalid of [null, { ...post, _id: "drafts.post-1" }, { ...post, _rev: "" },
    { ...post, slug: " " }, { ...post, body: " " }, { ...post, body: [] },
    { ...post, body: [{ _type: "block", children: [{ text: " " }] }] },
    { ...post, body: [{ _type: "image" }, { _type: "block", children: [{ text: "本文" }] }] }]) {
    assert.throws(() => validatePost(invalid));
  }
  assert.equal(validatePost(post), post);
  assert.doesNotThrow(() => validatePost({ ...post, body: [{ _type: "block", children: [{ text: "本文" }] }] }));
});

test("Sanityは公開済みを匿名取得し、未取得・不正応答はエラーにする", async (t) => {
  const keys = ["NEXT_PUBLIC_SANITY_PROJECT_ID", "NEXT_PUBLIC_SANITY_DATASET"];
  const original = keys.map(key => process.env[key]);
  process.env.NEXT_PUBLIC_SANITY_PROJECT_ID = "testproject";
  process.env.NEXT_PUBLIC_SANITY_DATASET = "production";
  let response = () => Response.json({ result: [post] });
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url.searchParams.get("perspective"), "published");
    assert.ok(url.searchParams.get("query").includes('path("drafts.**")'));
    assert.equal(options.headers, undefined);
    return response();
  });
  try {
    assert.deepEqual(await fetchPublishedPost("example"), post);
    assert.deepEqual(await fetchPublishedPosts(), [post]);
    for (const result of [[], [post, post], null]) {
      response = () => Response.json({ result });
      await assert.rejects(fetchPublishedPost("example"));
    }
    response = () => new Response("Unavailable", { status: 503 });
    await assert.rejects(fetchPublishedPost("example"));
    for (const result of [[], null, Array(101).fill(post)]) {
      response = () => Response.json({ result });
      await assert.rejects(fetchPublishedPosts());
    }
    response = () => Response.json(null);
    await assert.rejects(fetchPublishedPost("example"));
    response = () => { throw new Error("Connection failed"); };
    await assert.rejects(fetchPublishedPost("example"));
  } finally {
    keys.forEach((key, index) => {
      if (original[index] === undefined) delete process.env[key]; else process.env[key] = original[index];
    });
  }
});

test("保存した記事を読み込め、不正なファイルでは代替記事を返さない", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "comfylabo-preview-"));
  try {
    const saved = await saveSnapshot(post, directory);
    assert.deepEqual((await readSnapshot(path.basename(saved), directory)).post, post);
    for (const filename of ["../outside.json", "/tmp/outside.json", "missing.json"]) {
      await assert.rejects(readSnapshot(filename, directory));
    }
    await symlink(saved, path.join(directory, "linked.json"));
    await assert.rejects(readSnapshot("linked.json", directory));
    for (const invalid of ["{", "null", JSON.stringify({ version: 2 }), JSON.stringify({
      version: 1, capturedAt: "invalid", post,
    }), JSON.stringify({ version: 1, capturedAt: new Date().toISOString(), post: { ...post, body: "" } })]) {
      await writeFile(path.join(directory, "invalid.json"), invalid);
      await assert.rejects(readSnapshot("invalid.json", directory));
    }
    assert.deepEqual((await readSnapshot(path.basename(saved), directory)).post, post);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("失敗時も次の正常版の保存時も、既存の正常版を維持する", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "comfylabo-mvp-"));
  try {
    const first = await saveSnapshot(post, directory);
    const original = await readFile(first, "utf8");
    await assert.rejects(saveSnapshot({ ...post, body: "" }, directory));
    assert.deepEqual(await readdir(directory), [path.basename(first)]);
    assert.equal(await readFile(first, "utf8"), original);
    const second = await saveSnapshot({ ...post, _rev: "revision-2", body: "更新後" }, directory);
    assert.notEqual(first, second);
    assert.equal(await readFile(first, "utf8"), original);
    assert.equal(JSON.parse(await readFile(second, "utf8")).post.body, "更新後");
    assert.equal((await readdir(directory)).length, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
