import { readFileSync } from "node:fs";
import { parseAtpRankings } from "./sources/atp";
import { writeRankingSnapshot } from "./snapshot";
import { db, schema } from "@/db";

async function main() {
  const html = readFileSync(
    new URL("./__fixtures__/atp-top10.html", import.meta.url),
    "utf-8",
  );
  const snap = parseAtpRankings({ html, weekOf: "2026-05-18" });
  const [run] = await db
    .insert(schema.scrapeRuns)
    .values({ source: "seed", status: "ok", fixtureHash: "atp-top10.html" })
    .returning({ id: schema.scrapeRuns.id });
  await writeRankingSnapshot(snap, run?.id ?? 0);
  console.log(`Seeded ${snap.entries.length} rows.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
