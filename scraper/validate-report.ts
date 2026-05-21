// Local quality gate for the scraper.
//
// Fetches live HTML (Playwright), runs the production parser on it, then
// reports row counts, schema validity, country/points distributions, and
// anomalies. Exits 1 if any tour fails the readiness check.
//
// Usage:
//   pnpm scraper:validate              # both tours, use cached HTML if present
//   pnpm scraper:validate -- --fresh   # force a fresh live fetch
//   pnpm scraper:validate -- atp       # one tour only
//   pnpm scraper:validate -- --fresh wta

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseAtpRankings } from "./sources/atp";
import { parseWtaRankings } from "./sources/wta";
import { RankingSnapshot } from "./validate";
import { fetchLive, type Tour } from "./fetch-live";

const DEBUG_DIR = resolve(import.meta.dirname, "__debug__");

const argv = process.argv.slice(2);
const fresh = argv.includes("--fresh");
const tourArg = argv.find((a) => a === "atp" || a === "wta") as Tour | undefined;

interface Report {
  tour: Tour;
  htmlBytes: number;
  htmlSource: string;
  rowsParsed: number;
  parseError?: string;
  schemaOk: boolean;
  schemaError?: string;
  countries: Map<string, number>;
  pointsRange: { min: number; max: number; median: number } | null;
  topFive: { rank: number; fullName: string; countryCode: string | null; points: number }[];
  anomalies: string[];
}

async function getHtml(tour: Tour): Promise<{ html: string; source: string }> {
  if (fresh) {
    const { html, savedTo } = await fetchLive(tour);
    return { html, source: `live → ${savedTo}` };
  }
  if (existsSync(DEBUG_DIR)) {
    const files = readdirSync(DEBUG_DIR)
      .filter((f) => f.startsWith(`${tour}-`) && f.endsWith(".html"))
      .sort();
    if (files.length > 0) {
      const latest = files[files.length - 1]!;
      const file = resolve(DEBUG_DIR, latest);
      console.log(`[validate] reusing cached ${latest} (pass --fresh to refetch)`);
      return { html: readFileSync(file, "utf-8"), source: `cached → ${latest}` };
    }
  }
  console.log(`[validate] no cached ${tour} HTML — fetching live`);
  const { html, savedTo } = await fetchLive(tour);
  return { html, source: `live → ${savedTo}` };
}

function analyze(tour: Tour, html: string, source: string): Report {
  const today = new Date().toISOString().slice(0, 10);
  const r: Report = {
    tour,
    htmlBytes: html.length,
    htmlSource: source,
    rowsParsed: 0,
    schemaOk: false,
    countries: new Map(),
    pointsRange: null,
    topFive: [],
    anomalies: [],
  };

  let snap;
  try {
    snap =
      tour === "atp"
        ? parseAtpRankings({ html, weekOf: today })
        : parseWtaRankings({ html, weekOf: today });
  } catch (err) {
    r.parseError = err instanceof Error ? err.message : String(err);
    r.anomalies.push("parser threw — see parseError above");
    return r;
  }
  r.rowsParsed = snap.entries.length;

  const fullCheck = RankingSnapshot.safeParse(snap);
  r.schemaOk = fullCheck.success;
  if (!fullCheck.success) {
    r.schemaError = fullCheck.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .slice(0, 3)
      .join("; ");
  }

  if (snap.entries.length === 0) {
    r.anomalies.push("ZERO entries parsed — parser regex likely doesn't match live HTML");
    return r;
  }

  for (const e of snap.entries) {
    const c = e.countryCode ?? "(null)";
    r.countries.set(c, (r.countries.get(c) ?? 0) + 1);
  }

  const sortedPts = snap.entries.map((e) => e.points).sort((a, b) => a - b);
  r.pointsRange = {
    min: sortedPts[0]!,
    max: sortedPts[sortedPts.length - 1]!,
    median: sortedPts[Math.floor(sortedPts.length / 2)]!,
  };

  r.topFive = snap.entries.slice(0, 5).map((e) => ({
    rank: e.rank,
    fullName: e.fullName,
    countryCode: e.countryCode,
    points: e.points,
  }));

  // anomaly checks
  if (snap.entries.length < 100) {
    r.anomalies.push(`only ${snap.entries.length} entries (schema floor is 100)`);
  }
  const nullCountries = snap.entries.filter((e) => !e.countryCode).length;
  if (nullCountries === snap.entries.length) {
    r.anomalies.push("every row has a null countryCode (parser likely broken)");
  } else if (nullCountries / snap.entries.length > 0.1) {
    r.anomalies.push(`${nullCountries} rows (${Math.round((nullCountries / snap.entries.length) * 100)}%) have null countryCode`);
  }
  const ranks = snap.entries.map((e) => e.rank);
  const dupes = ranks.length - new Set(ranks).size;
  if (dupes > 0) r.anomalies.push(`${dupes} duplicate rank(s)`);
  const sortedRanks = [...ranks].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < sortedRanks.length; i++) {
    if (sortedRanks[i]! > sortedRanks[i - 1]! + 1) gaps.push(sortedRanks[i - 1]! + 1);
  }
  if (gaps.length > 0) r.anomalies.push(`rank gaps detected (e.g. missing rank ${gaps.slice(0, 3).join(", ")})`);
  if (r.pointsRange.min < 0) r.anomalies.push(`negative points found (min=${r.pointsRange.min})`);
  if (r.pointsRange.max > 20000) r.anomalies.push(`points exceed sanity ceiling (max=${r.pointsRange.max})`);

  return r;
}

function printReport(r: Report) {
  const line = "─".repeat(64);
  console.log("");
  console.log(line);
  console.log(`${r.tour.toUpperCase()}    source: ${r.htmlSource}`);
  console.log(line);
  console.log(`  HTML size       : ${(r.htmlBytes / 1024).toFixed(1)} KB`);
  console.log(`  Rows parsed     : ${r.rowsParsed}`);
  console.log(`  Schema valid    : ${r.schemaOk ? "yes" : "NO"}`);
  if (r.parseError) console.log(`  Parse error     : ${r.parseError}`);
  if (r.schemaError) console.log(`  Schema error    : ${r.schemaError}`);

  if (r.pointsRange) {
    console.log(`  Points range    : ${r.pointsRange.min} … ${r.pointsRange.max} (median ${r.pointsRange.median})`);
  }
  if (r.countries.size > 0) {
    const top = [...r.countries.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    console.log(`  Countries       : ${r.countries.size} distinct  (top: ${top.map(([c, n]) => `${c}=${n}`).join(", ")})`);
  }
  if (r.topFive.length > 0) {
    console.log(`  Top 5:`);
    for (const t of r.topFive) {
      console.log(
        `    #${String(t.rank).padStart(3)}  ${t.fullName.padEnd(30)} ${(t.countryCode ?? "---").padEnd(4)} ${String(t.points).padStart(6)} pts`,
      );
    }
  }
  if (r.anomalies.length > 0) {
    console.log(`  Anomalies:`);
    for (const a of r.anomalies) console.log(`    ! ${a}`);
  } else if (r.rowsParsed > 0) {
    console.log(`  Anomalies       : none`);
  }
}

async function main() {
  const tours: Tour[] = tourArg ? [tourArg] : ["atp", "wta"];
  console.log(`[validate] tours: ${tours.join(", ")}   mode: ${fresh ? "fresh fetch" : "cached if available"}`);

  const reports: Report[] = [];
  for (const t of tours) {
    const { html, source } = await getHtml(t);
    reports.push(analyze(t, html, source));
  }

  for (const r of reports) printReport(r);

  console.log("");
  console.log("═".repeat(64));
  console.log("VERDICT");
  console.log("═".repeat(64));
  let allGreen = true;
  for (const r of reports) {
    const ready = !r.parseError && r.schemaOk && r.anomalies.length === 0 && r.rowsParsed >= 100;
    console.log(`  ${r.tour.toUpperCase()}  ${ready ? "READY for production" : "NOT READY"}`);
    if (!ready) allGreen = false;
  }
  console.log("");
  process.exit(allGreen ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
