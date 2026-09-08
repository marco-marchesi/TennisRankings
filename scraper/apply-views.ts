/**
 * Applies the hand-maintained DDL in `drizzle/views/` .
 *
 * `drizzle-kit push` does not create views, and it cannot infer the PK swaps,
 * added columns and custom-ordering indexes these files carry. Until now the
 * only instructions for applying them were a comment at the top of each file
 * telling you to pipe it into `psql` yourself — so a clean `pnpm db:push`
 * produced a schema the app could not fully query, and the failure showed up
 * later as a confusing "column does not exist" at request time.
 *
 * Every statement in these files is idempotent (`IF NOT EXISTS` /
 * `CREATE OR REPLACE`), so this is safe to re-run.
 *
 *   pnpm db:views
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * Explicit order, because dependencies matter and alphabetical does not
 * respect them: columns must exist before the views that select them.
 *   1. table / column definitions
 *   2. indexes and PK swaps
 *   3. views (depend on 1)
 */
const FILES = [
  "players-extra-cols.sql",
  "leaderboards.sql",
  "player-upcoming-matches.sql",
  "live-projections-live-cols.sql",
  "matches-multisource.sql",
  "race-views.sql",
] as const;

/**
 * Split a file into individual statements.
 *
 * The Neon HTTP driver rejects multiple statements in one query, so we cannot
 * hand a whole file over at once. These files contain no dollar-quoted bodies
 * and no semicolons inside string literals, so splitting on a semicolon that
 * ends a line is sufficient — and we assert that assumption below rather than
 * trusting it silently.
 */
function splitStatements(text: string, file: string): string[] {
  if (text.includes("$$")) {
    throw new Error(
      `${file} contains a dollar-quoted body; the naive statement splitter ` +
        `in apply-views.ts would break it. Split it manually or switch to a ` +
        `real SQL lexer.`,
    );
  }
  return text
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    // Drop anything that is only comments/whitespace.
    .filter((s) => s.length > 0 && !s.split(/\r?\n/).every((l) => l.trim() === "" || l.trim().startsWith("--")));
}

async function main() {
  const dir = join(process.cwd(), "drizzle", "views");

  // Fail loudly if someone adds a .sql file and forgets to place it in FILES,
  // rather than silently not applying it.
  const onDisk = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const missing = onDisk.filter((f) => !(FILES as readonly string[]).includes(f));
  if (missing.length > 0) {
    throw new Error(
      `drizzle/views contains ${missing.join(", ")}, which is not listed in ` +
        `FILES in scraper/apply-views.ts. Add it in the right dependency ` +
        `position (columns before the views that select them).`,
    );
  }

  let applied = 0;

  for (const file of FILES) {
    const text = readFileSync(join(dir, file), "utf8");
    const statements = splitStatements(text, file);
    process.stdout.write(`${file} — ${statements.length} statement(s)\n`);

    for (const statement of statements) {
      try {
        await db.execute(sql.raw(statement));
        applied++;
      } catch (err) {
        const firstLine = statement.split(/\r?\n/).find((l) => !l.trim().startsWith("--")) ?? statement;
        throw new Error(
          `${file}: statement failed — ${firstLine.slice(0, 120)}\n  ${
            err instanceof Error ? err.message : String(err)
          }`,
          { cause: err },
        );
      }
    }
  }

  process.stdout.write(`\nApplied ${applied} statement(s) across ${FILES.length} file(s).\n`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
