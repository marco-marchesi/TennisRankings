import { NextResponse } from "next/server";
import { z } from "zod";
import { predictMatch } from "@/lib/predictions";

const Body = z.object({
  playerA: z.string().min(1),
  playerB: z.string().min(1),
  surface: z.enum(["hard", "clay", "grass"]).optional(),
});

export async function POST(request: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const prediction = await predictMatch(body);
  return NextResponse.json(prediction, {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
