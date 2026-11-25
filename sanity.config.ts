import { defineConfig, defineField, defineType } from "sanity";
import { structureTool } from "sanity/structure";

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET;

if (!projectId || !dataset) {
  throw new Error("Missing Sanity Studio environment variables");
}

const createReadableSlug = (value: string) =>
  value
    .normalize("NFKC")
    .replace(/(?<=\d),(?=\d)/g, "")
    .replace(/[【】「」『』（）()［］[\]{}]/g, "")
    .replace(/[&/_,.:;!?]+/g, " ")
    .replace(/[ー―‐‑‒–—―]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}-]/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 96) || "post";

const author = defineType({
  name: "author",
  title: "Author",
  type: "document",
  fields: [
    defineField({
      name: "name",
      title: "Name",
      type: "string",
      validation: (rule) => rule.required(),
    }),
  ],
  preview: {
    select: {
      title: "name",
    },
  },
});

const post = defineType({
  name: "post",
  title: "記事",
  fieldsets: [
    { name: "optional", title: "画像・検索・著者（任意）", options: { collapsible: true, collapsed: true } },
    { name: "legacy", title: "旧記事・移行情報（必要なときだけ）", options: { collapsible: true, collapsed: true } },
  ],
  type: "document",
  fields: [
    defineField({
      name: "title",
      title: "タイトル",
      type: "string",
      description: "記事の見出しです。自動反映は現在、確認用の記事1本だけが対象です。",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "slug",
      title: "URL識別名（slug）",
      type: "slug",
      description: "確認用の記事では comfylabo-welcome のまま使ってください。変更すると自動反映の対象外になります。",
      options: {
        source: "title",
        maxLength: 96,
        slugify: createReadableSlug,
      },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "markdownBody",
      title: "本文（Markdown）",
      type: "text",
      rows: 24,
      description: "新システムで優先して使う本文です。Obsidianなどで書いたMarkdownをそのまま貼り付けられます。",
    }),
    defineField({
      name: "publishedAt",
      title: "公開日時（任意）",
      type: "datetime",
      description: "公開日時の記録です。日時を入力するだけで公開予約されることはありません。",
    }),
    defineField({
      name: "seoDescription",
      fieldset: "optional",
      title: "検索・共有用の説明文",
      type: "text",
      rows: 3,
      description: "検索や共有に使う説明文です。MVPの確認用ページにはまだ反映しません。",
      validation: (rule) => rule.max(160).warning("160文字以内を目安にしてください。"),
    }),
    defineField({
      name: "author",
      fieldset: "optional",
      title: "著者",
      type: "reference",
      description: "MVPの確認用ページでは表示しません。",
      to: [{ type: "author" }],
    }),
    defineField({
      name: "mainImage",
      fieldset: "optional",
      title: "アイキャッチ画像",
      type: "image",
      description: "MVPの確認用ページでは表示しません。",
      options: { hotspot: true },
      fields: [
        defineField({ name: "alt", title: "画像の説明", type: "string" }),
      ],
    }),
    defineField({
      name: "articleImages",
      fieldset: "optional",
      title: "本文用の画像",
      type: "array",
      description: "保存した画像のURLをMarkdown本文へ貼り付けて使います。保存するだけでは本文に表示されません。",
      of: [
        {
          type: "image",
          fields: [
            defineField({ name: "alt", title: "画像の説明", type: "string" }),
          ],
        },
      ],
    }),
    defineField({
      name: "body",
      fieldset: "legacy",
      title: "旧本文（従来の編集欄）",
      type: "array",
      description: "旧本文。Markdown 本文がある場合はそちらが優先表示されます。",
      of: [{ type: "block" }],
    }),
    defineField({
      name: "legacyWordPressId",
      fieldset: "legacy",
      title: "元WordPress記事ID",
      type: "string",
      description: "移行元の記事ID。slugやSanityの文書IDとは別に記録します。",
      validation: (rule) =>
        rule.regex(/^[0-9]+$/).error("WordPress記事IDを半角数字で入力してください。"),
    }),
    defineField({
      name: "legacyUrls",
      fieldset: "legacy",
      title: "元WordPress URL",
      type: "array",
      description: "確認できた旧URLを記録します。複数形式を保持でき、転送設定には使用しません。",
      of: [
        {
          type: "url",
          validation: (rule) => rule.uri({ scheme: ["http", "https"] }),
        },
      ],
      validation: (rule) => rule.unique(),
    }),
    defineField({
      name: "migrationNotes",
      fieldset: "legacy",
      title: "移行作業メモ（本文・SEOには使用しません）",
      type: "text",
      rows: 6,
      description: "未確認事項や内部リンク案を記録します。非公開を保証する欄ではありません。秘密情報は入力しないでください。",
    }),
  ],
  preview: {
    select: {
      title: "title",
      subtitle: "author.name",
    },
  },
});

const about = defineType({
  name: "about",
  title: "About",
  type: "document",
  fields: [
    defineField({
      name: "title",
      title: "Title",
      type: "string",
      initialValue: "About ComfyLabo",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "body",
      title: "Body",
      type: "array",
      of: [{ type: "block" }],
    }),
    defineField({
      name: "socialLinks",
      title: "Social links",
      type: "array",
      of: [
        defineField({
          name: "socialLink",
          title: "Social link",
          type: "object",
          fields: [
            defineField({
              name: "name",
              title: "Name",
              type: "string",
              validation: (rule) => rule.required(),
            }),
            defineField({
              name: "href",
              title: "URL",
              type: "url",
              validation: (rule) => rule.required(),
            }),
          ],
          preview: {
            select: {
              title: "name",
              subtitle: "href",
            },
          },
        }),
      ],
    }),
  ],
  preview: {
    select: {
      title: "title",
    },
  },
});

export default defineConfig({
  name: "default",
  title: "ComfyLabo 新システム",
  projectId,
  dataset,
  basePath: "/studio",
  plugins: [
    structureTool({
      title: "記事管理",
      structure: (S) => S.list().id("content").title("コンテンツ").items([
        S.listItem().id("mvp-welcome").title("確認用の記事（MVP）").child(
          S.document().schemaType("post").documentId("comfylabo-mvp-welcome"),
        ),
        S.divider(),
        S.documentTypeListItem("post").title("すべての記事"),
        S.documentTypeListItem("author").title("著者"),
        S.documentTypeListItem("about").title("運営者情報"),
      ]),
    }),
  ],
  schema: {
    types: [post, author, about],
  },
});
