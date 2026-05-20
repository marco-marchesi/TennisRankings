import { NextResponse } from "next/server";
import { z } from "zod";
import crypto from "node:crypto";
import { db, schema } from "@/db";

const Body = z.object({
  email: z.string().email().max(254),
  locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).optional(),
});

export async function POST(request: Request) {
  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const token = crypto.randomBytes(24).toString("hex");

  try {
    await db
      .insert(schema.newsletterSubscribers)
      .values({ email: parsed.email, locale: parsed.locale ?? "en", confirmationToken: token })
      .onConflictDoNothing({ target: schema.newsletterSubscribers.email });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: "Could not save subscription" },
      { status: 500 },
    );
  }
}
