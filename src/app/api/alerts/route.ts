import { NextResponse } from "next/server";
import { z } from "zod";

const Body = z.object({
  playerId: z.number().int().positive(),
  notifyOnResult: z.boolean().optional(),
  notifyOnRankChange: z.boolean().optional(),
  action: z.enum(["follow", "unfollow"]),
});

// Toggle a follow/alert preference for the authenticated user.
// TODO: integrate Auth.js session lookup; until then this endpoint is
// short-circuited to 401. The handler shape is kept so the UI can wire up.
export async function POST(request: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  // const session = await auth();
  // if (!session?.user?.id) {
  return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  // }
  //
  // if (body.action === "follow") {
  //   await db.insert(schema.userFollowedPlayers).values({ … }).onConflictDoUpdate({ … });
  // } else {
  //   await db.delete(schema.userFollowedPlayers).where(…);
  // }
  // return NextResponse.json({ ok: true });
}
