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
  "players-te-slug.sql",
  "leaderboards.sql",
  "player-upcoming-matches.sql",
  "live-projections-live-cols.sql",
  "matches-multisource.sql",
  "race-views.sql",
] as const;

/**
 * Split a file into individual statements.
 *
 * The Neon HTTP driver rejects multiple statements in one query, so a whole
 * file cannot be handed over at once.
 *
 * This has to be a small state machine rather than a split on ";". These
 * files contain `DO $$ BEGIN ... END $$;` guards whose bodies are full of
 * semicolons, and a naive split tears them in half. The first version of this
 * function detected `$$` and refused to run rather than corrupt the schema -
 * the right call at the time, but it meant matches-multisource.sql and
 * race-views.sql never applied at all.
 *
 * Tracked: dollar-quoted blocks (including tagged `$tag$`), single-quoted
 * string literals, and `--` line comments. Block comments are not used in
 * these files.
 */
function splitStatements(text: string): string[] {
  const statements: string[] = [];
  let buf = "";
  let i = 0;
  let dollarTag: string | null = null;
  let inString = false;
  let inLineComment = false;

  while (i < text.length) {
    const ch = text[i]!;
    const rest = text.slice(i);

    if (inLineComment) {
      buf += ch;
      if (ch === "\n") inLineComment = false;
      i++;
      continue;
    }

    if (dollarTag) {
      if (rest.startsWith(dollarTag)) {
        buf += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      buf += ch;
      i++;
      continue;
    }

    if (inString) {
      buf += ch;
      // '' is an escaped quote inside a string literal.
      if (ch === "'") {
        if (text[i + 1] === "'") {
          buf += "'";
          i += 2;
          continue;
        }
        inString = false;
      }
      i++;
      continue;
    }

    if (rest.startsWith("--")) {
      inLineComment = true;
      buf += ch;
      i++;
      continue;
    }

    if (ch === "'") {
      inString = true;
      buf += ch;
      i++;
      continue;
    }

    // Opening of a dollar-quoted block: $$ or $tag$
    const dollarOpen = rest.match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
    if (dollarOpen) {
      dollarTag = dollarOpen[0];
      buf += dollarTag;
      i += dollarTag.length;
      continue;
    }

    if (ch === ";") {
      statements.push(buf);
      buf = "";
      i++;
      continue;
    }

    buf += ch;
    i++;
  }
  if (buf.trim()) statements.push(buf);

  // Drop anything that is only comments or whitespace.
  const NEWLINE = /\r?\n/;
  return statements
    .map((st) => st.trim())
    .filter(
      (st) =>
        st.length > 0 &&
        !st.split(NEWLINE).every((l) => l.trim() === "" || l.trim().startsWith("--")),
    );
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
    const statements = splitStatements(text);
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
