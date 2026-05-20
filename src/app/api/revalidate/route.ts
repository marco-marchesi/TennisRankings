import { NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";

// Called by the scraper worker after a successful snapshot write.
// Body: { secret: string, paths?: string[], tags?: string[] }
export async function POST(request: Request) {
  const expected = process.env.REVALIDATE_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "Revalidate disabled" }, { status: 503 });
  }

  let body: { secret?: string; paths?: string[]; tags?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.secret !== expected) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const revalidated: { paths: string[]; tags: string[] } = { paths: [], tags: [] };
  for (const p of body.paths ?? []) {
    revalidatePath(p);
    revalidated.paths.push(p);
  }
  for (const t of body.tags ?? []) {
    revalidateTag(t);
    revalidated.tags.push(t);
  }

  return NextResponse.json({ revalidated });
}
