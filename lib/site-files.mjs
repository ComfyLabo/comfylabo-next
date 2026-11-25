export const BASE_FILES = ["index.html", "styles.css", "comfylabo-logo.jpg"];
export const MAX_IMAGES = 10;
export const IMAGE_FILE = /^image-[a-f0-9]{64}\.(?:jpg|png|webp)$/;

// Flat, bounded file names only. Shared by local transfer and HTTPS verification.
export function publicFiles(manifest) {
  const names = Object.keys(manifest?.files || {});
  if (manifest?.version !== 1 || names.length > BASE_FILES.length + MAX_IMAGES ||
      BASE_FILES.some((name) => !names.includes(name)) ||
      names.some((name) => !BASE_FILES.includes(name) && !IMAGE_FILE.test(name)) ||
      names.some((name) => !/^[a-f0-9]{64}$/.test(manifest.files[name])) ||
      names.some((name) => IMAGE_FILE.test(name) && manifest.files[name] !== name.slice(6, 70))) {
    throw new Error("成果物のファイル一覧が不正です。");
  }
  return [...BASE_FILES, ...names.filter((name) => !BASE_FILES.includes(name)).sort()];
}

// Requires an explicit blog-mode opt-in; the single-article transfer stays unchanged.
export function publishedBlogFiles(manifest) {
  const posts = manifest?.posts;
  const source = manifest?.source;
  if (manifest?.version !== 2 || manifest.kind !== "article-list" ||
      source?.kind !== "sanity-published" || source.projectId !== "0lwnb6yi" || source.dataset !== "production" || Object.keys(source).length !== 3 ||
      !Array.isArray(posts) || !posts.length || posts.length > 100) throw new Error("承認対象の公開記事一覧ではありません。");
  const ids = new Set();
  const slugs = new Set();
  for (const post of posts) {
    if (typeof post?.id !== "string" || !/^[A-Za-z0-9_.-]{1,128}$/.test(post.id) ||
        /^(drafts|versions)\./.test(post.id) || typeof post.revision !== "string" || !post.revision.trim() ||
        typeof post.slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(post.slug) ||
        ids.has(post.id) || slugs.has(post.slug)) throw new Error("記事一覧の識別情報が不正です。");
    ids.add(post.id); slugs.add(post.slug);
  }
  const required = [...BASE_FILES, ...posts.map((post) => `posts/${post.slug}/index.html`)];
  const names = Object.keys(manifest.files || {});
  if (names.length > required.length + posts.length * MAX_IMAGES || required.some((name) => !names.includes(name)) ||
      names.some((name) => !required.includes(name) && !IMAGE_FILE.test(name)) ||
      names.some((name) => !/^[a-f0-9]{64}$/.test(manifest.files[name])) ||
      names.some((name) => IMAGE_FILE.test(name) && manifest.files[name] !== name.slice(6, 70))) {
    throw new Error("公開記事一覧のファイル構成が不正です。");
  }
  return names.sort();
}
