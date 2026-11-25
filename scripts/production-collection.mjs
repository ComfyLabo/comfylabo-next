import {createRequire} from 'node:module';
import {appendFile} from 'node:fs/promises';
import path from 'node:path';
import {fetchPublishedPost} from './mvp-content.mjs';
import {fetchNewProductionPosts} from './new-production-content.mjs';
import {buildBlogRelease} from './blog-export.mjs';
import {LEGACY_ID} from './collection-metadata.mjs';

createRequire(import.meta.url)('@next/env').loadEnvConfig(process.cwd(), false, {info() {}, error() {}});
try {
  if (process.argv.length !== 2) throw Error('引数は不要です。');
  const [legacy, posts] = await Promise.all([fetchPublishedPost('4484'), fetchNewProductionPosts()]);
  if (legacy._id !== LEGACY_ID) throw Error('既存記事が一致しません。');
  const release = await buildBlogRelease([legacy, ...posts], {production: true,
    releaseDirectory: path.resolve('.mvp/production-collections'),
    source: {kind: 'sanity-published', projectId: '0lwnb6yi', dataset: 'production'}});
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `release=${release}\n`);
  console.log(`未配備の本番一覧候補を生成しました: ${path.relative(process.cwd(), release)}`);
} catch {
  console.error('本番一覧候補を生成できませんでした。取得元・記事・画像を確認してください。公開先は変更していません。');
  process.exitCode = 1;
}
