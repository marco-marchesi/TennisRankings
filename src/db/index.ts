import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { neon } from "@neondatabase/serverless";
import { Pool } from "pg";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) {
  // eslint-disable-next-line no-console
  console.warn("DATABASE_URL not set — DB queries will fail at runtime.");
}

// Both drivers expose the same Drizzle query surface for our usage. Picking
// a single concrete type (NodePgDatabase) keeps the .insert().values().
// returning() chain inferable everywhere downstream — a union of the two
// driver types causes TS to lose generic constraints on .returning().
type Db = NodePgDatabase<typeof schema>;

export const db: Db = (
  url?.includes("neon.tech")
    ? drizzleNeon(neon(url), { schema })
    : drizzlePg(new Pool({ connectionString: url ?? "postgresql://invalid/invalid" }), { schema })
) as unknown as Db;

export { schema };
