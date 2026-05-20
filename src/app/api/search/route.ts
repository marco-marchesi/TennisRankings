import { NextResponse } from "next/server";
import { searchPlayers } from "@/lib/players";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  if (q.length < 2) {
    return NextResponse.json([], {
      headers: { "Cache-Control": "no-store" },
    });
  }
  const hits = await searchPlayers(q, 8);
  return NextResponse.json(hits, {
    headers: { "Cache-Control": "public, max-age=30, s-maxage=60" },
  });
}
