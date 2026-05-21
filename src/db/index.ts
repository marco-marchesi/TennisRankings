import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { neon } from "@neondatabase/serverless";
import { Pool } from "pg";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) {
  // eslint-disable-next-line no-console
  console.warn("DATABASE_URL not set — DB queries will fail at runtime.");
}

// Use Neon HTTP driver for neon.tech, standard pg Pool for local/Docker
export const db = url?.includes("neon.tech")
  ? drizzleNeon(neon(url), { schema })
  : drizzlePg(new Pool({ connectionString: url ?? "postgresql://invalid/invalid" }), { schema });

export { schema };
