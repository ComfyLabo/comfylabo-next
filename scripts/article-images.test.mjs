import assert from "node:assert/strict";
import test from "node:test";
import { collectArticleImages } from "./article-images.mjs";

const source = "https://cdn.sanity.io/images/test123/production/abcdef-1x1.png";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
const config = { projectId: "test123", dataset: "production" };
const response = () => new Response(png, { headers: { "content-type": "image/png" } });

test("本文画像を一度だけ取得し、画像と原寸リンクを同梱ファイルへ置き換える", async () => {
  let calls = 0;
  const result = await collectArticleImages(`<img src="${source}"/><img src="${source}"/><a href="${source}">原寸</a>`, {
    ...config, fetcher: async (url, options) => {
      calls++;
      assert.equal(url.href, source);
      assert.equal(options.redirect, "error");
      return response();
    },
  });
  assert.equal(calls, 1);
  const [name] = Object.keys(result.files);
  assert.match(name, /^image-[a-f0-9]{64}\.png$/);
  assert.deepEqual(result.files[name], png);
  assert.ok(!result.html.includes("cdn.sanity.io"));
  assert.ok(result.html.includes(`href="./${name}"`));
});

test("外部URL・別プロジェクト・相対画像・SVG・認証付きURLは取得しない", async () => {
  for (const url of ["http://127.0.0.1/private.png", "https://example.com/a.png", "./missing.png",
    source.replace("test123", "other"), source + "?download=1", source.replace(".png", ".svg"),
    source.replace("https://", "https://user:secret@")]) {
    await assert.rejects(collectArticleImages(`<img src="${url}"/>`, {
      ...config, fetcher: () => assert.fail("must not fetch"),
    }));
  }
});

test("画像の欠落・形式不一致・容量超過・枚数超過を失敗にする", async () => {
  for (const fetcher of [
    async () => new Response("missing", { status: 404 }),
    async () => new Response("<html>error</html>", { headers: { "content-type": "image/png" } }),
    async () => new Response(png, { headers: { "content-type": "text/html" } }),
    async () => new Response(Buffer.alloc(5 * 1024 * 1024 + 1), { headers: { "content-type": "image/png" } }),
    async () => { throw new Error("network unavailable"); },
  ]) {
    await assert.rejects(collectArticleImages(`<img src="${source}"/>`, { ...config, fetcher }));
  }
  const html = Array.from({ length: 11 }, (_, i) => `<img src="${source.replace("abcdef", i.toString(16))}"/>`).join("");
  await assert.rejects(collectArticleImages(html, { ...config, fetcher: () => assert.fail("must not fetch") }));
  const threeImages = Array.from({ length: 3 }, (_, i) => `<img src="${source.replace("abcdef", i.toString(16))}"/>`).join("");
  const largePng = Buffer.concat([png, Buffer.alloc(3 * 1024 * 1024)]);
  await assert.rejects(collectArticleImages(threeImages, { ...config, fetcher: async () =>
    new Response(largePng, { headers: { "content-type": "image/png" } }),
  }), /容量上限/);
});
