import {queryPublished} from './mvp-content.mjs';
import {validatePost} from '../lib/mvp-snapshot.mjs';

export const PUBLICATION_SYSTEM = 'comfylabo-next';
const existingArticles = new Set(['comfylabo-mvp-welcome', '6a6732df-f6d2-434e-9fca-7e745ad0b11a']);

export function validateNewProductionPosts(posts) {
  if (!Array.isArray(posts) || posts.length > 100) throw Error('新規公開記事の応答が不正です。');
  const ids = new Set(), slugs = new Set();
  for (const post of posts) {
    validatePost(post);
    if (post.publicationSystem !== PUBLICATION_SYSTEM || existingArticles.has(post._id) ||
        !/^[A-Za-z0-9_.-]{1,128}$/.test(post._id) || /^(drafts|versions)\./.test(post._id) ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(post.slug) || post.slug.length > 96 ||
        ids.has(post._id) || slugs.has(post.slug) ||
        (post.publishedAt != null && (typeof post.publishedAt !== 'string' || !Number.isFinite(Date.parse(post.publishedAt))))) {
      throw Error('新システムの記事識別情報が不正です。既存記事は変更しません。');
    }
    ids.add(post._id); slugs.add(post.slug);
  }
  return posts;
}

export async function fetchNewProductionPosts() {
  if (process.env.NEXT_PUBLIC_SANITY_PROJECT_ID !== '0lwnb6yi' || process.env.NEXT_PUBLIC_SANITY_DATASET !== 'production') {
    throw Error('新規公開記事の取得元が承認対象と異なります。');
  }
  const posts = await queryPublished(`*[_type == "post" && publicationSystem == "comfylabo-next" && !(_id in path("drafts.**")) && !(_id in path("versions.**"))] | order(publishedAt desc, _id asc)[0...101]{_id,_rev,title,"slug":slug.current,"body":coalesce(markdownBody,body),"author":author->name,publishedAt,seoDescription,publicationSystem}`);
  // Empty means there are no eligible new articles, not an instruction to empty the live site.
  return validateNewProductionPosts(posts);
}
