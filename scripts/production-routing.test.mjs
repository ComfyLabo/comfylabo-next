import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import {buildPostRelease} from './mvp-export.mjs';
import {prepareProductionRouting} from './production-routing.mjs';

const post = {_id: '6a6732df-f6d2-434e-9fca-7e745ad0b11a', _rev: 'published-1', slug: '4484', title: '対象記事', body: '## 見出し\n\n本文です。'};
const oldRoute = 'RewriteCond %{REQUEST_URI} ^/4484/$\nRewriteRule ^ "/_comfy_release_abc123/public-files.review/4484/index.html" [END]';
const baseline = 'Options -Indexes\nRewriteEngine On\n# 他の記事を維持\n' + oldRoute + '\nRewriteCond %{REQUEST_URI} ^/4484$\nRewriteRule ^ https://comfylabo.com%{REQUEST_URI}/ [R=301,END]\nRewriteRule ^ - [R=404,END]\n';

test('本番記事の設定案は対象1ルールだけを置換し、完全な元設定を復旧用に保持する', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'comfy-routing-'));
  try {
    const source = path.join(temp, 'before.htaccess');
    await writeFile(source, baseline);
    const candidate = await buildPostRelease(post, {releaseDirectory: temp, preview: false, productionUrl: 'https://comfylabo.com/4484/'});
    const result = await prepareProductionRouting(source, candidate);
    assert.equal(result.original.toString(), baseline);
    assert.equal(await readFile(source, 'utf8'), baseline);
    const block = result.replacement.match(/# BEGIN ComfyLabo article 4484[\s\S]*?# END ComfyLabo article 4484/)[0];
    assert.equal(result.replacement.replace(block, () => oldRoute), baseline);
    assert.equal(result.plan.routes.length, 3);
    assert.ok(result.replacement.includes('RewriteCond %{REQUEST_URI} ^/4484/styles\\.css$'));
    assert.ok(result.replacement.includes('RewriteRule ^_comfy_next_4484(?:/|$) - [R=404,END]'));
    assert.match(result.plan.directory, /^_comfy_next_4484\/[a-f0-9]{64}$/);
    assert.equal(result.plan.deployed, false);
    await writeFile(source, baseline + '\n' + oldRoute);
    await assert.rejects(prepareProductionRouting(source, candidate));
    await writeFile(source, result.replacement);
    await assert.rejects(prepareProductionRouting(source, candidate));
    await writeFile(source, baseline);
    await writeFile(path.join(candidate, 'index.html'), 'changed');
    await assert.rejects(prepareProductionRouting(source, candidate));
    assert.equal(await readFile(source, 'utf8'), baseline);
  } finally { await rm(temp, {recursive: true, force: true}); }
});

test('確認用成果物を本番の公開設定案に使用しない', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'comfy-routing-preview-'));
  try {
    const source = path.join(temp, 'before.htaccess');
    await writeFile(source, baseline);
    const preview = await buildPostRelease(post, {releaseDirectory: temp});
    await assert.rejects(prepareProductionRouting(source, preview));
  } finally { await rm(temp, {recursive: true, force: true}); }
});
