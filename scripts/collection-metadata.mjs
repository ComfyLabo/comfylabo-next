export const SITE = 'https://comfylabo.com';
export const LEGACY_ID = '6a6732df-f6d2-434e-9fca-7e745ad0b11a';
export const articleRoute = post => post._id === LEGACY_ID ? '/4484/' : `/posts/${post.slug}/`;

export function collectionMetadata(post, legacy) {
  const existing = post._id === LEGACY_ID;
  const url = SITE + articleRoute(post);
  const description = existing ? legacy.description : post.seoDescription?.trim() || `${post.title} | ComfyLabo`;
  const image = existing ? legacy.image : {'@type': 'ImageObject', url: SITE + '/readings/comfylabo-logo.jpg', width: 1179, height: 883};
  const author = existing ? legacy.author : post.author ? {'@type': 'Person', name: post.author} : {'@type': 'Organization', name: 'ComfyLabo'};
  return {description, openGraph: {'og:type': 'article', 'og:description': description, 'og:title': post.title,
    'og:url': url, 'og:image': image.url, 'og:site_name': 'ComfyLabo', 'og:locale': 'ja_JP'},
    structuredData: {'@context': 'https://schema.org', '@type': 'Article', mainEntityOfPage: {'@type': 'WebPage', '@id': url},
      headline: post.title, image, ...(post.publishedAt ? {datePublished: post.publishedAt} : {}), author, description}};
}
