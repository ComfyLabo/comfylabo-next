import {createHash} from 'node:crypto';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {BASE_FILES, IMAGE_FILE} from '../lib/site-files.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const articleId = '6a6732df-f6d2-434e-9fca-7e745ad0b11a';
const targetUrl = 'https://comfylabo.com/4484/';
const namespace = '_comfy_next_4484';

export async function prepareProductionRouting(baseline, candidate) {
  const manifestBytes = await readFile(path.join(candidate, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.version !== 3 || manifest.kind !== 'production-article-candidate' || manifest.target !== targetUrl ||
      manifest.postId !== articleId || manifest.slug !== '4484' || typeof manifest.revision !== 'string' || !manifest.revision.trim() ||
      manifest.source?.kind !== 'sanity-published' || manifest.source.projectId !== '0lwnb6yi' || manifest.source.dataset !== 'production') {
    throw Error('本番候補の記事・取得元・公開先が対象と一致しません。');
  }
  const names = Object.keys(manifest.files || {}).sort();
  if (names.length > BASE_FILES.length + 10 || BASE_FILES.some(n => !names.includes(n)) ||
      names.some(n => !BASE_FILES.includes(n) && !IMAGE_FILE.test(n))) throw Error('候補ファイルが不正です。');
  let total = 0;
  for (const name of names) {
    const bytes = await readFile(path.join(candidate, name));
    total += bytes.length;
    if (!bytes.length || hash(bytes) !== manifest.files[name] ||
        (IMAGE_FILE.test(name) && hash(bytes) !== name.slice(6, 70))) throw Error('候補のハッシュ照合に失敗しました。');
  }
  if (total > 10 * 1024 * 1024) throw Error('候補の容量上限を超えています。');
  const original = await readFile(baseline);
  const text = original.toString('utf8');
  if (!Buffer.from(text).equals(original)) throw Error('元設定の文字コードを確認してください。');
  const pattern = /^RewriteCond %\{REQUEST_URI\} \^\/4484\/\$\r?\nRewriteRule \^ "\/_comfy_release_[a-f0-9]+\/public-files\.review\/4484\/index\.html" \[END\]/gm;
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1 || text.includes(namespace)) throw Error('既存の記事ルールが想定と異なります。再調査してください。');
  const version = hash(manifestBytes);
  const directory = `${namespace}/${version}`;
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const routes = names.map(name => ({url: name === 'index.html' ? '/4484/' : `/4484/${name}`, file: name}));
  const block = [
    '# BEGIN ComfyLabo article 4484',
    `RewriteRule ^${namespace}(?:/|$) - [R=404,END]`,
    ...routes.flatMap(({url, file}) => [
      `RewriteCond %{REQUEST_URI} ^${url.replaceAll('.', '\\.')}$`,
      `RewriteRule ^ "/${directory}/${file}" [END]`,
    ]),
    '# END ComfyLabo article 4484',
  ].join(newline);
  const replacement = text.replace(matches[0][0], () => block);
  if (replacement.replace(block, () => matches[0][0]) !== text) throw Error('対象外の公開設定が変更されています。');
  return {original, replacement, plan: {version: 1, kind: 'production-routing-plan', target: targetUrl,
    postId: articleId, revision: manifest.revision, directory, routes, candidate: path.resolve(candidate),
    beforeSha256: hash(original), afterSha256: hash(replacement), manifestSha256: version,
    rollback: '検証済みの元.htaccessを、現在のハッシュがafterSha256と一致する場合だけ戻す。', deployed: false}};
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const [baseline, candidate, destination, ...extra] = process.argv.slice(2);
    if (!baseline || !candidate || !destination || extra.length) throw Error('使い方: node scripts/production-routing.mjs <元.htaccess> <本番候補> <新しい出力先>');
    const prepared = await prepareProductionRouting(baseline, candidate);
    await mkdir(destination, {mode: 0o700});
    await writeFile(path.join(destination, 'before.htaccess'), prepared.original, {flag: 'wx', mode: 0o600});
    await writeFile(path.join(destination, 'after.htaccess'), prepared.replacement, {flag: 'wx', mode: 0o600});
    await writeFile(path.join(destination, 'plan.json'), JSON.stringify(prepared.plan, null, 2) + '\n', {flag: 'wx', mode: 0o600});
    console.log(JSON.stringify({output: destination, target: targetUrl, files: prepared.plan.routes.length, deployed: false}));
  } catch {
    console.error('本番設定案の作成を完了できませんでした。対象記事・候補・元設定・出力先を確認してください。本番は変更していません。');
    process.exitCode = 1;
  }
}
