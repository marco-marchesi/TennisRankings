// Auth.js v5 stub. The Drizzle adapter is wired but the actual
// configuration (callbacks, magic-link email template) is deferred to
// the user-accounts implementation step in phase 2.
//
// Usage:
//   import { auth, signIn, signOut } from "@/lib/auth";
//   const session = await auth();
//
// Once enabled, set AUTH_SECRET and AUTH_TRUST_HOST in env, and add the
// /api/auth/[...nextauth]/route.ts handler that re-exports `handlers`.

import NextAuth from "next-auth";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import Resend from "next-auth/providers/resend";
import { db, schema } from "@/db";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: schema.users,
    accountsTable: schema.accounts,
    sessionsTable: schema.sessions,
    verificationTokensTable: schema.verificationTokens,
  }),
  providers: [
    Resend({
      apiKey: process.env.RESEND_API_KEY,
      from: process.env.EMAIL_FROM,
    }),
  ],
  session: { strategy: "database" },
  pages: { signIn: "/account/sign-in" },
});
