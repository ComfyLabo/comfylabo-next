import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import {buildBlogRelease} from './blog-export.mjs';
import {publicFiles, publishedBlogFiles} from '../lib/site-files.mjs';
import {LEGACY_ID} from './collection-metadata.mjs';

const source = {kind: 'sanity-published', projectId: '0lwnb6yi', dataset: 'production'};
const legacy = {_id: LEGACY_ID, _rev: 'published-legacy', slug: '4484', title: '既存記事', publishedAt: '2026-03-20T01:08:00.000Z', body: '## 既存\n\n既存の本文。'};
const article = {_id: 'new-article', _rev: 'published-new', slug: 'new-article', title: '新しい記事', publicationSystem: 'comfylabo-next', seoDescription: '新しい記事の説明', body: '## 見出し\n\n| 項目 | 内容 |\n| --- | --- |\n| 新規 | 確認 |'};

test('本番一覧は既存URLを維持し、新しいURL・正規URL・共有素材を生成する', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'comfy-collection-'));
  try {
    const release = await buildBlogRelease([legacy, article], {production: true, source, releaseDirectory: temp});
    const manifest = JSON.parse(await readFile(path.join(release, 'manifest.json'), 'utf8'));
    assert.equal(manifest.version, 4);
    assert.equal(manifest.kind, 'production-collection');
    assert.equal(manifest.posts.length, 2);
    assert.throws(() => publicFiles(manifest));
    assert.throws(() => publishedBlogFiles(manifest));
    const listing = await readFile(path.join(release, 'index.html'), 'utf8');
    assert.ok(listing.includes('href="/4484/"'));
    assert.ok(listing.includes('href="/posts/new-article/"'));
    assert.ok(listing.includes('rel="canonical" href="https://comfylabo.com/readings/"'));
    assert.ok(!listing.includes('noindex'));
    const html = await readFile(path.join(release, 'posts/new-article/index.html'), 'utf8');
    assert.ok(html.includes('href="/readings/"'));
    assert.ok(html.includes('src="/readings/comfylabo-logo.jpg"'));
    assert.ok(html.includes('href="/readings/styles.css?v='));
    assert.ok(html.includes('https://comfylabo.com/posts/new-article/'));
    assert.ok(html.includes('新しい記事の説明'));
    assert.ok(html.includes('<table>'));
    const old = await readFile(path.join(release, 'legacy/4484/index.html'), 'utf8');
    assert.ok(old.includes('rel="canonical" href="https://comfylabo.com/4484/"'));
    assert.ok(old.includes('2026-03-20T01:08:00.000Z'));
    const preview = await buildBlogRelease([legacy, article], {source, releaseDirectory: temp});
    assert.equal(JSON.parse(await readFile(path.join(preview, 'manifest.json'))).version, 2);
    assert.ok((await readFile(path.join(preview, 'index.html'), 'utf8')).includes('noindex, nofollow'));
  } finally {await rm(temp, {recursive: true, force: true});}
});

test('既存記事の欠落・未選別の旧記事・ローカル取得元を本番一覧に混ぜない', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'comfy-collection-invalid-'));
  try {
    for (const [posts, changedSource] of [
      [[article], source], [[legacy, {...article, publicationSystem: undefined}], source],
      [[legacy], {kind: 'sample'}], [[legacy, {...article, slug: '4484'}], source],
    ]) await assert.rejects(buildBlogRelease(posts, {production: true, source: changedSource, releaseDirectory: temp}));
  } finally {await rm(temp, {recursive: true, force: true});}
});
