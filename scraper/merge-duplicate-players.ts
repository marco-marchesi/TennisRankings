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
];

function isKnownAlias(slugA: string, slugB: string): boolean {
  return KNOWN_ALIASES.some(
    ([x, y]) => (slugA === x && slugB === y) || (slugA === y && slugB === x),
  );
}

async function main() {
  const apply = process.argv.slice(2).includes("--apply");

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
  `);
  const collides = new Set(rankCollisions.map((r) => `${r.a}:${r.b}`));
  const sharesRank = (idA: number, idB: number) =>
    collides.has(`${Math.min(idA, idB)}:${Math.max(idA, idB)}`);

  const players = await rows<Candidate>(sql`
    select p.id, p.slug, p.full_name as "fullName", p.tour,
           (select count(*) from rankings_snapshots rs
             where rs.player_id = p.id
               and (rs.points_move is not null or rs.drop_points is not null))::int
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

    process.stdout.write(
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
      // Move match history across, ignoring rows that would collide on the
      // composite PK (player_id, source, external_tourney_id, external_match_num).
      await db.execute(sql`
        update player_recent_matches m set player_id = ${keep.id}
        where m.player_id = ${d.id}
          and not exists (
            select 1 from player_recent_matches k
            where k.player_id = ${keep.id}
              and k.source = m.source
              and k.external_tourney_id = m.external_tourney_id
              and k.external_match_num = m.external_match_num
          )
      `);
      await db.execute(sql`delete from player_recent_matches where player_id = ${d.id}`);
      await db.execute(sql`delete from player_upcoming_matches where player_id = ${d.id}`);

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
        update rankings_snapshots s set player_id = ${keep.id}
        where s.player_id = ${d.id}
          and not exists (
            select 1 from rankings_snapshots k
            where k.player_id = ${keep.id}
              and k.tour = s.tour
              and k.week_of = s.week_of
              and k.is_race = s.is_race
          )
      `);
      await db.execute(sql`delete from rankings_snapshots where player_id = ${d.id}`);
      await db.execute(sql`delete from live_projections where player_id = ${d.id}`);
      await db.execute(sql`delete from players where id = ${d.id}`);
      merged++;
    }
  }

  process.stdout.write(
    apply
      ? `Merged and removed ${merged} duplicate player row(s).\n`
      : `Dry run only. Re-run with --apply to merge.\n`,
  );
}

runEntrypoint(main());
