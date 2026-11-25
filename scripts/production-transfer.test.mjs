import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, mkdir, rm, readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import {buildPostRelease} from './mvp-export.mjs';
import {prepareProductionRouting} from './production-routing.mjs';
import {packageProduction, validatePackage, transferProduction} from './production-transfer.mjs';

test('本番パッケージは対象ファイルだけを転送し、無承認・改変・誤接続先では接続しない', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'comfy-production-transfer-'));
  try {
    const baseline = path.join(temp, 'baseline');
    await writeFile(baseline, 'RewriteCond %{REQUEST_URI} ^/4484/$\nRewriteRule ^ "/_comfy_release_abc123/public-files.review/4484/index.html" [END]\n');
    const candidate = await buildPostRelease({_id: '6a6732df-f6d2-434e-9fca-7e745ad0b11a', _rev: 'published', slug: '4484', title: '公開済み記事', body: '## 本文\n\n確認'},
      {releaseDirectory: temp, preview: false, productionUrl: 'https://comfylabo.com/4484/'});
    await writeFile(path.join(candidate, '.env'), 'Never transfer');
    const routing = path.join(temp, 'routing'); await mkdir(routing);
    const prepared = await prepareProductionRouting(baseline, candidate);
    for (const [n, b] of Object.entries({'before.htaccess': prepared.original, 'after.htaccess': prepared.replacement, 'plan.json': JSON.stringify(prepared.plan)})) await writeFile(path.join(routing, n), b);
    const output = path.join(temp, 'package');
    const packaged = await packageProduction(routing, output);
    assert.equal(packaged.files.length, 7);
    assert.ok(!(await readdir(output)).includes('.env'));
    let calls = [];
    const execute = async (...args) => {calls.push(args);};
    await assert.rejects(transferProduction('deploy', output, {}, execute));
    assert.equal(calls.length, 0);
    const key = path.join(temp, 'key'), hosts = path.join(temp, 'hosts');
    await writeFile(key, 'test-only'); await writeFile(hosts, 'test-only');
    const env = {COMFYLABO_PRODUCTION_APPROVED: 'obsidian-4484', XSERVER_HOST: 'sv8869.xserver.jp', XSERVER_USER: 'comfylabo', XSERVER_SSH_KEY_PATH: key, XSERVER_KNOWN_HOSTS_PATH: hosts};
    await assert.rejects(transferProduction('deploy', output, {...env, XSERVER_HOST: 'other.example'}, execute));
    assert.equal(calls.length, 0);
    await transferProduction('deploy', output, env, execute);
    assert.deepEqual(calls.map(c => c[0]), ['ssh', 'scp', 'ssh']);
    assert.match(calls[0][1].at(-1), /python3 -B - prepare [a-f0-9]{64}$/);
    assert.match(calls[2][1].at(-1), /python3 -B - activate [a-f0-9]{64}$/);
    assert.ok(calls[1][1].includes('StrictHostKeyChecking=yes'));
    assert.ok(!calls[1][1].some(n => n.endsWith('/.env')));
    calls = [];
    await transferProduction('rollback', output, env, execute);
    assert.equal(calls.length, 1);
    assert.match(calls[0][1].at(-1), /python3 -B - rollback [a-f0-9]{64}$/);
    await writeFile(path.join(output, 'after.htaccess'), 'Unapproved config');
    await assert.rejects(validatePackage(output));
    await assert.rejects(transferProduction('deploy', output, env, execute));
    assert.equal(calls.length, 1);
    assert.equal(await readFile(baseline, 'utf8'), prepared.original.toString());
  } finally {await rm(temp, {recursive: true, force: true});}
});
