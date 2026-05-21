import fs from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";
import { buildMetadata } from "@/lib/seo";

interface Params { params: Promise<{ slug: string }> }

const CONTENT_DIR = path.join(process.cwd(), "content", "explainers");

interface Explainer {
  title: string;
  description: string;
  author: string;
  publishedAt: string;
  updatedAt: string;
  readingMinutes: number;
  body: string;
}

async function loadExplainer(slug: string): Promise<Explainer | null> {
  try {
    const raw = await fs.readFile(path.join(CONTENT_DIR, `${slug}.md`), "utf-8");
    const match = raw.match(/^---\n([\s\S]+?)\n---\n([\s\S]+)$/);
    if (!match) return null;
    const [, frontmatter = "", body = ""] = match;
    const front = Object.fromEntries(
      frontmatter
        .split("\n")
        .map((line) => line.match(/^(\w+):\s*"?([^"]+?)"?$/))
        .filter((m): m is RegExpMatchArray => Boolean(m))
        .map((m) => [m[1], m[2]]),
    );
    return {
      title: front.title ?? slug,
      description: front.description ?? "",
      author: front.author ?? "TennisRankings",
      publishedAt: front.publishedAt ?? "",
      updatedAt: front.updatedAt ?? "",
      readingMinutes: Number(front.readingMinutes ?? 5),
      body: body.trim(),
    };
  } catch {
    return null;
  }
}

export async function generateStaticParams() {
  try {
    const files = await fs.readdir(CONTENT_DIR);
    return files
      .filter((f) => f.endsWith(".md"))
      .map((f) => ({ slug: f.replace(/\.md$/, "") }));
  } catch {
    return [];
  }
}

export async function generateMetadata({ params }: Params) {
  const { slug } = await params;
  const post = await loadExplainer(slug);
  if (!post) return buildMetadata({ title: "Explainer not found", path: `/explainers/${slug}`, noindex: true });
  return buildMetadata({
    title: post.title,
    description: post.description,
    path: `/explainers/${slug}`,
    lastUpdated: post.updatedAt ? new Date(post.updatedAt) : undefined,
  });
}

export default async function ExplainerPage({ params }: Params) {
  const { slug } = await params;
  const post = await loadExplainer(slug);
  if (!post) notFound();

  return (
    <article className="mx-auto max-w-2xl px-4 py-10 prose dark:prose-invert">
      <p className="text-xs uppercase tracking-wider text-[color:var(--muted-foreground)] no-prose">
        Explainer · {post.readingMinutes} min read
      </p>
      <h1>{post.title}</h1>
      <p className="lead text-[color:var(--muted-foreground)]">
        {post.description}
      </p>
      <p className="text-xs text-[color:var(--muted-foreground)]">
        By {post.author} · Published {post.publishedAt} · Updated {post.updatedAt}
      </p>
      <pre className="whitespace-pre-wrap font-sans not-prose leading-relaxed">
        {post.body}
      </pre>
    </article>
  );
}
