import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) {
  // Don't crash at import time in environments that don't need DB access
  // (e.g. building static OG images). Callers that actually query will hit
  // a clear runtime error.
  // eslint-disable-next-line no-console
  console.warn("DATABASE_URL not set — DB queries will fail at runtime.");
}

const sql = neon(url ?? "postgres://invalid/invalid");
export const db = drizzle(sql, { schema });
export { schema };
