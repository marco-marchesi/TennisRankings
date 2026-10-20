// Add past seasons' ATP Challenger tiers to scraper/config/challenger-calendar.json
// from Wikipedia's "<YEAR> ATP Challenger Tour" schedule (atptour.com lists the
// current season only).
//   pnpm scraper:challenger-history -- --years 2023,2024,2025
import { politeFetch } from "./http";
import { saveChallengerEvents } from "./sources/atp-challenger-calendar";
import { parseWikiChallengerSeason } from "./sources/wikipedia-challenger";

const i = process.argv.indexOf("--years");
const years = (i > 0 ? process.argv[i + 1]! : "2023,2024,2025").split(",").map(Number);

for (const year of years) {
  const url = `https://en.wikipedia.org/w/index.php?title=${year}_ATP_Challenger_Tour&action=raw`;
  const res = await politeFetch(url);
  if (!res.ok) throw new Error(`[challenger-history] ${year}: HTTP ${res.status}`);
  const events = parseWikiChallengerSeason(await res.text(), year);
  // A season has ~200 editions; far fewer means the page layout changed.
  if (events.length < 150) throw new Error(`[challenger-history] ${year}: parsed only ${events.length} events`);
  const total = saveChallengerEvents(events);
  const tiers = new Map<number, number>();
  for (const e of events) tiers.set(e.tier, (tiers.get(e.tier) ?? 0) + 1);
  console.log(`[challenger-history] ${year}: ${events.length} events (${[...tiers].sort((a, b) => b[0] - a[0]).map(([t, n]) => `${t}:${n}`).join(" ")}); ${total} stored`);
}
process.exit(0);
