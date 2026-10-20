/**
 * Finds and merges phantom duplicate player rows.
 *
 * Cause: `reorderName()` in `sources/tennis-explorer-rankings.ts` rotates name
 * tokens instead of reordering them, so TennisExplorer's surname-first
 * "Cerundolo Juan Manuel" became "Manuel Cerundolo Juan". The order-sensitive
 * name lookup in `expand-rankings.ts` then missed the real player and inserted
 * a second row. Because `rankings_snapshots` is unique on
 * (tour, week_of, player_id, is_race) and NOT on rank, both rows survived and
 * two players ended up claiming the same rank — 203 rows in the ATP top-200
 * across five duplicated ranks.
 *
 * `expand-rankings.ts` no longer creates these. This cleans up the ones
 * already stored.
 *
 * Survivor choice: the row that owns official-scrape fields
 * (points_move / drop_points), else the one with more match history, else the
 * lower id. Everything referencing the loser is repointed, then the loser is
 * deleted.
 *
 *   pnpm scraper:merge-dupes            # report only
 *   pnpm scraper:merge-dupes -- --apply # actually merge
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { namesMatch } from "./sources/live-tennis";
import { runEntrypoint } from "./exit";

interface Candidate {
  id: number;
  slug: string;
  fullName: string;
  tour: string;
  officialRows: number;
  matchRows: number;
  snapshotRows: number;
}

async function rows<T = Record<string, unknown>>(q: ReturnType<typeof sql>): Promise<T[]> {
  const r = await db.execute<Record<string, unknown>>(q);
  return (((r as unknown as { rows: unknown[] }).rows ?? r) as unknown) as T[];
}

/**
 * Human-confirmed aliases that the provable rules cannot establish.
 *
 * Both of these are one player, but neither is derivable safely:
 *   - "Daniel Merida" / "Daniel Merida Aguilar" — an extra surname. Cannot be
 *     auto-merged, because "Maria Gonzalez" and "Maria Gonzalez Daniele" are
 *     two different players with the same shape.
 *   - "Aleksandr Shevchenko" / "Alexander Shevchenko" — transliteration. The
 *     same edit-distance rule that would catch it also paired "Ekaterina
 *     Maklakova" with "Ekaterina Makarova", who are two different people.
 *
 * So they are listed explicitly, by a person, rather than guessed.
 */
const KNOWN_ALIASES: Array<[string, string]> = [
  ["daniel-merida", "daniel-merida-aguilar"],
  ["aleksandr-shevchenko", "alexander-shevchenko"],
  // Official ATP name "Diego Dedura"; TennisExplorer and Tennis Abstract
  // carry his full surname "Dedura-Palomero".
  ["diego-dedura", "diego-dedura-palomero"],
];

function isKnownAlias(slugA: string, slugB: string): boolean {
  return KNOWN_ALIASES.some(
    ([x, y]) => (slugA === x && slugB === y) || (slugA === y && slugB === x),
  );
}

async function main() {
  const apply = process.argv.slice(2).includes("--apply");
  const pairsIdx = process.argv.indexOf("--pairs");
  if (pairsIdx >= 0) {
    const file = process.argv[pairsIdx + 1];
    if (!file) throw new Error("--pairs needs a JSON file of {keep, drop, evidence}");
    await mergePairsFile(file, apply);
    return;
  }

  /**
   * Pairs of player rows that hold the SAME rank in the SAME ranking week.
   *
   * A ranking position is almost always unique, so this is strong evidence of
   * duplication - but not proof on its own, because the tours do publish
   * shared ranks when two players have identical points. Combined with a
   * tolerant name match it becomes conclusive, which is what lets us merge
   * pairs the name rules alone could not settle:
   *   "Darya Kasatkina" / "Daria Kasatkina"
   *   "Greet Minnen"    / "Greetje Minnen"
   *   "Yulia Starodubtseva" / "Yuliia Starodubtseva"
   *
   * These appeared only after backfill-history wrote Tennis Abstract's
   * current-week ranks alongside the official scrape's, giving both spellings
   * a row at the same position. The daily compare-live report is what caught
   * them.
   */
  const rankCollisions = await rows<{ a: number; b: number }>(sql`
    select least(x.player_id, y.player_id)::int as a,
           greatest(x.player_id, y.player_id)::int as b
    from rankings_snapshots x
    join rankings_snapshots y
      on x.tour = y.tour and x.week_of = y.week_of
     and x.is_race = y.is_race and x.rank = y.rank
     and x.player_id < y.player_id
    group by 1, 2
    union
    -- The same ranking SLOT, one row official and one TennisExplorer's, where
    -- the TE row was written during the official row's week but filed under
    -- another week_of. Before expand-rankings wrote to TE's own stated week,
    -- TE's 2026-09-28 list went into the 2026-09-21 bucket, so a player TE
    -- spells differently ("Vaidehi" / "Vaidehee Chaudhari") held rank 450 with
    -- 142 points in "09-21" under one row and in 09-28 under the other — the
    -- same position, just not the same week_of.
    select least(o.player_id, t.player_id)::int, greatest(o.player_id, t.player_id)::int
    from rankings_snapshots o
    join rankings_snapshots t
      on t.tour = o.tour and t.is_race = o.is_race
     and t.rank = o.rank and t.points = o.points
     and t.player_id <> o.player_id
     and t.scrape_run_id is null
     and t.created_at >= o.week_of and t.created_at < o.week_of + 7
    where o.scrape_run_id is not null
  `);
  const collides = new Set(rankCollisions.map((r) => `${r.a}:${r.b}`));
  const sharesRank = (idA: number, idB: number) =>
    collides.has(`${Math.min(idA, idB)}:${Math.max(idA, idB)}`);

  const players = await rows<Candidate>(sql`
    select p.id, p.slug, p.full_name as "fullName", p.tour,
           -- Rows written by the OFFICIAL ATP/WTA scrape (scrape_run_id set).
           -- This used to test points_move / drop_points, which the WTA never
           -- publishes, so for every WTA pair the survivor fell through to
           -- "more match history" — and picked TennisExplorer's phantom
           -- ("Suh Lee Carol Young") over the row the official scrape upserts
           -- by slug, which the next refresh would simply have recreated.
           (select count(*) from rankings_snapshots rs
             where rs.player_id = p.id and rs.scrape_run_id is not null)::int
             as "officialRows",
           (select count(*) from player_recent_matches m where m.player_id = p.id)::int
             as "matchRows",
           (select count(*) from rankings_snapshots rs where rs.player_id = p.id)::int
             as "snapshotRows"
    from players p
    order by p.id
  `);

  // Group by tour, then pair up names that refer to the same person.
  const byTour = new Map<string, Candidate[]>();
  for (const p of players) {
    const arr = byTour.get(p.tour) ?? [];
    arr.push(p);
    byTour.set(p.tour, arr);
  }

  const groups: Candidate[][] = [];
  for (const list of byTour.values()) {
    const used = new Set<number>();
    for (let i = 0; i < list.length; i++) {
      const a = list[i]!;
      if (used.has(a.id)) continue;
      const group = [a];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j]!;
        if (used.has(b.id)) continue;
        const provable = namesMatch(a.fullName, b.fullName, { fuzzy: false });
        // Fuzzy name + a shared ranking position in the same week. Neither
        // signal is sufficient alone; together they are.
        const fuzzyAndSameRank =
          namesMatch(a.fullName, b.fullName) && sharesRank(a.id, b.id);
        if (provable || fuzzyAndSameRank || isKnownAlias(a.slug, b.slug)) {
          group.push(b);
          used.add(b.id);
        }
      }
      if (group.length > 1) {
        used.add(a.id);
        groups.push(group);
      }
    }
  }

  if (groups.length === 0) {
    process.stdout.write("No duplicate players found.\n");
    return;
  }

  process.stdout.write(
    `Found ${groups.length} duplicate group(s)${apply ? "" : " (dry run — pass --apply to merge)"}:\n\n`,
  );

  let merged = 0;
  for (const group of groups) {
    // Prefer the row that carries official-scrape fields, then the one with
    // the most match history, then the lowest id.
    const ranked = group.slice().sort((a, b) => {
      if (a.officialRows !== b.officialRows) return b.officialRows - a.officialRows;
      if (a.matchRows !== b.matchRows) return b.matchRows - a.matchRows;
      return a.id - b.id;
    });
    const keep = ranked[0]!;
    const drop = ranked.slice(1);

    const evidence = drop.map((d) => (sharesRank(keep.id, d.id) ? "same-rank" : "name-only"));
    process.stdout.write(
      `  [${evidence.join(",")}]
` +
      `  KEEP  #${keep.id} ${keep.fullName} (${keep.slug}) ` +
        `official=${keep.officialRows} matches=${keep.matchRows}\n`,
    );
    for (const d of drop) {
      process.stdout.write(
        `  DROP  #${d.id} ${d.fullName} (${d.slug}) ` +
          `official=${d.officialRows} matches=${d.matchRows} snapshots=${d.snapshotRows}\n`,
      );
    }
    process.stdout.write("\n");

    if (!apply) continue;

    for (const d of drop) {
      await mergeInto(keep.id, d.id);
      merged++;
    }
  }

  process.stdout.write(
    apply
      ? `Merged and removed ${merged} duplicate player row(s).\n`
      : `Dry run only. Re-run with --apply to merge.\n`,
  );
}

/** Move everything referencing `dropId` onto `keepId`, then delete `dropId`. */
async function mergeInto(keepId: number, dropId: number): Promise<void> {
  // Carry external identities across when the survivor lacks them, so
  // the id-based resolvers keep finding this player after the merge.
  await db.execute(sql`
    update players k set
      atp_id = coalesce(k.atp_id, d.atp_id),
      atp_id_source = coalesce(k.atp_id_source, d.atp_id_source),
      wta_id = coalesce(k.wta_id, d.wta_id),
      wikidata_id = coalesce(k.wikidata_id, d.wikidata_id),
      -- When the loser carries the verified tour id the survivor lacks,
      -- its DOB belongs to that verified identity. Seen on the WTA's
      -- "Xin Yu Wang" -> "Xinyu Wang" rename: the old row held the real
      -- 2001-09-26 with wta_id 326376, the new one an unrelated 1997 date.
      --
      -- Likewise when the survivor only holds snapshot.ts's approximation
      -- (1 January of currentYear - age), which every row the official scrape
      -- creates carries, and the loser has a real date.
      date_of_birth = case
        when (k.wta_id is null and d.wta_id is not null)
          or (k.atp_id is null and d.atp_id is not null)
        then coalesce(d.date_of_birth, k.date_of_birth)
        when d.date_of_birth is not null
          and extract(month from k.date_of_birth) = 1 and extract(day from k.date_of_birth) = 1
          and not (extract(month from d.date_of_birth) = 1 and extract(day from d.date_of_birth) = 1)
        then d.date_of_birth
        else coalesce(k.date_of_birth, d.date_of_birth)
      end,
      country_code = coalesce(k.country_code, d.country_code),
      te_slug = coalesce(k.te_slug, d.te_slug)
    from players d
    where k.id = ${keepId} and d.id = ${dropId}
  `);
  // Move match history across, ignoring rows that would collide on the
  // composite PK (player_id, source, external_tourney_id, external_match_num).
  await db.execute(sql`
    update player_recent_matches m set player_id = ${keepId}
    where m.player_id = ${dropId}
      and not exists (
        select 1 from player_recent_matches k
        where k.player_id = ${keepId}
          and k.source = m.source
          and k.external_tourney_id = m.external_tourney_id
          and k.external_match_num = m.external_match_num
      )
  `);
  await db.execute(sql`delete from player_recent_matches where player_id = ${dropId}`);
  await db.execute(sql`delete from player_upcoming_matches where player_id = ${dropId}`);

  // Snapshots must be MIGRATED, not discarded.
  //
  // The first version of this deleted them, on the assumption that the
  // loser was always a freshly-created phantom holding two or three junk
  // rows. That held for the rotation duplicates but NOT for the aliases:
  // "Daniel Merida Aguilar" carried 218 weekly snapshots and
  // "Alexander Shevchenko" 323, while the survivors held only the current
  // official week. Deleting them destroyed years of ranking history.
  //
  // Now: move every week the survivor does not already have, then remove
  // only the genuinely colliding remainder.
  await db.execute(sql`
    update rankings_snapshots s set player_id = ${keepId}
    where s.player_id = ${dropId}
      and not exists (
        select 1 from rankings_snapshots k
        where k.player_id = ${keepId}
          and k.tour = s.tour
          and k.week_of = s.week_of
          and k.is_race = s.is_race
      )
  `);
  await db.execute(sql`delete from rankings_snapshots where player_id = ${dropId}`);
  await db.execute(sql`delete from live_projections where player_id = ${dropId}`);
  await db.execute(sql`delete from players where id = ${dropId}`);
}

/**
 * `--pairs <file>`: merge explicit {keep, drop} pairs, each backed by evidence
 * recorded in the file. For duplicates the name rules above cannot prove —
 * e.g. rows the official scrape created at ranks 101-500 under the ATP / WTA
 * spelling ("Vaidehee Chaudhari") beside our older row ("Vaidehi Chaudhari"),
 * paired because both held the same rank with the same points in the same
 * ranking week. Refuses a pair across tours or with a missing row.
 */
async function mergePairsFile(file: string, apply: boolean): Promise<void> {
  const { readFileSync } = await import("node:fs");
  const pairs = JSON.parse(readFileSync(file, "utf8")) as Array<{
    keep: number; drop: number; keepName?: string; dropName?: string; evidence?: string;
  }>;
  let merged = 0;
  for (const p of pairs) {
    const found = await rows<{ id: number; tour: string; full_name: string }>(sql`
      select id, tour, full_name from players where id in (${p.keep}, ${p.drop})
    `);
    const keep = found.find((f) => Number(f.id) === p.keep);
    const drop = found.find((f) => Number(f.id) === p.drop);
    if (!keep || !drop || keep.tour !== drop.tour) {
      process.stdout.write(`  SKIP  ${p.keep} <- ${p.drop}: missing row or tours differ
`);
      continue;
    }
    process.stdout.write(
      `  KEEP  #${keep.id} ${keep.full_name}  <-  DROP #${drop.id} ${drop.full_name}  (${p.evidence ?? "no evidence given"})
`,
    );
    if (!apply) continue;
    await mergeInto(p.keep, p.drop);
    merged++;
  }
  process.stdout.write(apply ? `Merged ${merged} pair(s).
` : `Dry run only. Re-run with --apply to merge.
`);
}

runEntrypoint(main());
