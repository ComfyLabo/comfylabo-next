import path from "node:path";
import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";

import { PostBody } from "@/components/post-body";
import { readSnapshot } from "@/lib/mvp-snapshot.mjs";

export const metadata: Metadata = {
  title: "記事1本の表示確認 | ComfyLabo",
  robots: { index: false, follow: false },
};

const sampleBody = `毎日の暮らしや学びのなかで、気になったことを少しずつ。ComfyLabo は、ゆったり読める記事を届けていきます。

## 心地よく読める場所に

まずは記事を1本。見出しと本文の間に余白を設け、長い文章も無理なく読めるページを目指します。

これは表示確認のためのサンプル記事です。Sanity の記事や旧サイトの内容は使用していません。

### 小さく試して、少しずつ育てる

- スマートフォンでも文字を読みやすくする
- 見出しで文章の流れをつかめるようにする
- 必要な機能から一つずつ整える

> ひと息つきながら、自分のペースで。

**太字**や[ページ内のリンク](#reading-check)、箇条書きも確認できます。

---

本文の長さに合わせて自然にスクロールできる、シンプルな記事ページから始めます。`;

export default async function MvpPage() {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }

  const filename = process.env.MVP_SNAPSHOT;
  const snapshot = filename
    ? await readSnapshot(filename, path.resolve(".mvp/snapshots"))
    : null;
  const title = snapshot?.post.title ?? "心地よい読みものを、少しずつ";
  const body = snapshot?.post.body ?? sampleBody;

  return (
    <main className="min-h-screen bg-stone-50 px-5 py-10 text-stone-900 sm:py-16">
      <div className="mx-auto max-w-3xl">
        <p className="text-sm leading-6 text-stone-600">
          開発用プレビュー · {snapshot ? "保存済み記事1本" : "サンプル記事1本"} · Sanity 接続なし
        </p>
        <article aria-labelledby="article-title" className="mt-10 sm:mt-16">
          <header className="border-b border-stone-200 pb-8">
            <Image
              src="/comfylabo-logo.jpg"
              alt="ComfyLabo"
              width={1179}
              height={883}
              className="h-auto w-52 sm:w-60"
              unoptimized
            />
            <h1 id="article-title" className="mt-5 text-3xl leading-snug font-semibold tracking-tight sm:text-4xl">
              {title}
            </h1>
            <p className="mt-5 text-sm leading-6 text-stone-600">
              {snapshot ? "ローカル保存版の表示確認 · 本番への反映は行いません" : "表示確認用 · 公開記事ではありません"}
            </p>
          </header>
          <PostBody body={body} className="mt-10" />
        </article>
        <footer id="reading-check" className="mt-16 border-t border-stone-200 pt-6 text-sm leading-7 text-stone-600">
          <p>確認すること：本文の読みやすさ、見出しの余白、狭い画面での折り返し。</p>
        </footer>
      </div>
    </main>
  );
}
