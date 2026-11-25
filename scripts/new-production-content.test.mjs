import assert from 'node:assert/strict';
import test from 'node:test';
import {validateNewProductionPosts, fetchNewProductionPosts} from './new-production-content.mjs';

const post = {_id: 'new-article', _rev: 'published-1', title: '新しく書いた記事', slug: 'new-article', body: '## 本文\n\n新しい原稿。', publicationSystem: 'comfylabo-next'};

test('新システムの記事だけを選別し、旧記事・下書き・重複・危険なURLを拒否する', () => {
  assert.deepEqual(validateNewProductionPosts([]), []);
  assert.deepEqual(validateNewProductionPosts([post]), [post]);
  for (const changes of [
    {publicationSystem: undefined}, {publicationSystem: 'legacy'}, {_id: 'drafts.new-article'}, {_id: 'versions.release.new-article'},
    {_id: 'comfylabo-mvp-welcome'}, {_id: '6a6732df-f6d2-434e-9fca-7e745ad0b11a'},
    {slug: '../4484'}, {slug: '日本語'}, {slug: 'a'.repeat(97)}, {body: ''}, {publishedAt: 'invalid'}, {publishedAt: 0},
  ]) assert.throws(() => validateNewProductionPosts([{...post, ...changes}]));
  assert.throws(() => validateNewProductionPosts([post, {...post, _id: 'second'}]));
  assert.throws(() => validateNewProductionPosts([post, {...post, slug: 'second'}]));
  assert.throws(() => validateNewProductionPosts(Array(101).fill(post)));
});

test('新規本番記事の取得は固定Sanityの匿名公開クエリだけを使う', async () => {
  const oldFetch = globalThis.fetch;
  const oldProject = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
  const oldDataset = process.env.NEXT_PUBLIC_SANITY_DATASET;
  try {
    process.env.NEXT_PUBLIC_SANITY_PROJECT_ID = '0lwnb6yi';
    process.env.NEXT_PUBLIC_SANITY_DATASET = 'production';
    globalThis.fetch = async (input, options) => {
      const url = new URL(input);
      assert.equal(url.origin, 'https://0lwnb6yi.api.sanity.io');
      assert.equal(url.searchParams.get('perspective'), 'published');
      assert.match(url.searchParams.get('query'), /publicationSystem == "comfylabo-next"/);
      assert.match(url.searchParams.get('query'), /versions\.\*\*/);
      assert.ok(!options.headers?.Authorization);
      return Response.json({result: [post]});
    };
    assert.deepEqual(await fetchNewProductionPosts(), [post]);
    process.env.NEXT_PUBLIC_SANITY_PROJECT_ID = 'other';
    await assert.rejects(fetchNewProductionPosts());
  } finally {
    globalThis.fetch = oldFetch;
    if (oldProject === undefined) delete process.env.NEXT_PUBLIC_SANITY_PROJECT_ID; else process.env.NEXT_PUBLIC_SANITY_PROJECT_ID = oldProject;
    if (oldDataset === undefined) delete process.env.NEXT_PUBLIC_SANITY_DATASET; else process.env.NEXT_PUBLIC_SANITY_DATASET = oldDataset;
  }
});
