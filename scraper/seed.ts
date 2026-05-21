import { readFileSync } from "node:fs";
import { parseAtpRankings } from "./sources/atp";
import { writeRankingSnapshot } from "./snapshot";
import { db, schema } from "@/db";

function mostRecentMonday(): string {
  const d = new Date();
  const day = d.getUTCDay();
  const diff = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const html = readFileSync(
    new URL("./__fixtures__/atp-rankings.html", import.meta.url),
    "utf-8",
  );
  const snap = parseAtpRankings({ html, weekOf: mostRecentMonday() });
  const [run] = await db
    .insert(schema.scrapeRuns)
    .values({ source: "seed", status: "ok", fixtureHash: "atp-rankings.html" })
    .returning({ id: schema.scrapeRuns.id });
  await writeRankingSnapshot(snap, run?.id ?? 0);
  console.log(`Seeded ${snap.entries.length} rows.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
