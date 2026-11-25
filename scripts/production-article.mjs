import {createRequire} from 'node:module';
import path from 'node:path';
import {readFile, appendFile} from 'node:fs/promises';
import {fetchPublishedPost} from './mvp-content.mjs';
import {buildPostRelease} from './mvp-export.mjs';

const {loadEnvConfig} = createRequire(import.meta.url)('@next/env');
loadEnvConfig(process.cwd(), false, {info() {}, error() {}});

try {
  if (process.argv.length !== 2 || process.env.NEXT_PUBLIC_SANITY_PROJECT_ID !== '0lwnb6yi' || process.env.NEXT_PUBLIC_SANITY_DATASET !== 'production') {
    throw Error('使い方: npm run article:production:build（対象Sanityと記事は固定です）');
  }
  const post = await fetchPublishedPost('4484');
  const metadata = JSON.parse(await readFile(new URL('../config/obsidian-production-metadata.json',import.meta.url),'utf8'));
  if (metadata.target !== 'https://comfylabo.com/4484/' || !Number.isFinite(Date.parse(post.publishedAt))) throw Error('Invalid publication metadata');
  const productionMetadata = {description: metadata.description,
    openGraph: {'og:type':'article','og:description':metadata.description,'og:title':post.title,
      'og:url':metadata.target,'og:image':metadata.image.url,'og:site_name':metadata.siteName,'og:locale':metadata.locale},
    structuredData: {'@context':'https://schema.org','@type':'Article',
      mainEntityOfPage:{'@type':'WebPage','@id':metadata.target},headline:post.title,image:metadata.image,
      datePublished:post.publishedAt,author:metadata.author,description:metadata.description}};
  const release = await buildPostRelease(post, {
    preview: false, productionUrl: 'https://comfylabo.com/4484/',
    productionMetadata,
    releaseDirectory: path.resolve('.mvp/production-candidates'),
  });
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `release=${release}\n`);
  console.log(`本番未配備のローカル候補を生成しました: ${path.relative(process.cwd(), release)}`);
} catch {
  console.error('本番候補の生成が完了しませんでした。取得元・対象記事・画像を確認してください。本番への配備やSanityの変更は行っていません。');
  process.exitCode = 1;
}
