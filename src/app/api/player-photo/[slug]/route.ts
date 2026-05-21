import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

interface Params {
  params: Promise<{ slug: string }>;
}

/**
 * Serves the cached Wikipedia-Commons image bytes for a player. Returns 404
 * when the player has no cached photo (typical for ranks 101+, who are not
 * eligible for the enrichment fetcher). Cached aggressively at the edge — a
 * stored image is content-addressable: it never mutates within a row.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { slug } = await params;
  const [row] = await db
    .select({
      bytes: schema.players.photoBytes,
      contentType: schema.players.photoContentType,
    })
    .from(schema.players)
    .where(eq(schema.players.slug, slug))
    .limit(1);

  if (!row?.bytes) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(row.bytes as unknown as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": row.contentType ?? "image/jpeg",
      // Bytes never change within a row → safe to cache for a long time.
      // If a refresh stores a different image, we change the URL via a
      // ?v=<timestamp> query the consumer adds, so caches don't stick.
      "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}
