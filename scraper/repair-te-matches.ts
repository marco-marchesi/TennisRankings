// Re-attributes every stored TennisExplorer match row to the right player
// and re-derives its tournament level.
//
// WHY
//
// Until 2026-09-29 scrape-daily-matches resolved TE players against BOTH
// tours at once, on the surname alone, returning `candidates[0]` on a
// collision. The stored rows therefore include WTA matches on ATP players
// ("Porto WTA", "Seoul WTA" under men), ATP Challengers on WTA players, and
// siblings swapped (Trevor / Zachary Svajda). Every level was also derived
// from the bare name, so ITFs, Challengers and exhibitions were stored as "A"
// (a 250).
//
// HOW
//
// For each day that holds TE rows, re-list that day from TE for both tours
// (one request each — no per-match detail fetches), resolve both sides with
// the tour-scoped resolver, and compare with what is stored for that match:
//
//   - a stored row whose player is not one of the match's two resolved
//     players is DELETED (misattributed);
//   - a resolved player without a row gets one, copied from the other side's
//     stored row (round / surface / score are properties of the match, not of
//     the perspective) with `won` and the opponent flipped;
//   - every kept row gets the re-derived tournament_level.
//
// Matches for which nothing is stored are left alone: creating them would
// need a detail fetch per match, which is what the normal hourly run does.
//
//   pnpm scraper:repair-te-matches                  # dry run, report only
//   pnpm scraper:repair-te-matches -- --apply       # write
//   pnpm scraper:repair-te-matches -- --from 2026-09-01 --to 2026-09-28

import { db, schema } from "@/db";
import { sql } from "drizzle-orm";
import { fetchDailyMatchList, type TEMatchRef, type Tour } from "./sources/tennis-explorer";
import { buildTePlayerIndex, resolveTePlayer, type TePlayerIndex } from "./te-player-resolver";
import { loadOfficialLevels, teTournamentLevel } from "./te-tournament-level";
import { loadChallengerEvents } from "./sources/atp-challenger-calendar";

type Row = typeof schema.playerRecentMatches.$inferSelect;

interface Totals {
  days: number;
  matchesListed: number;
  matchesStored: number;
  rowsDeleted: number;
  rowsInserted: number;
  levelsChanged: number;
  wonFlipped: number;
  unlisted: number;
}

function matchNum(teMatchId: string): number {
  const n = Number(teMatchId);
  return Number.isFinite(n) && n < 2_000_000_000 ? n : Math.floor(n % 2_000_000_000);
}

async function rowsFor(date: string): Promise<Row[]> {
  return db
    .select()
    .from(schema.playerRecentMatches)
    .where(
      sql`${schema.playerRecentMatches.source} = 'tennis_explorer' and ${schema.playerRecentMatches.playedOn} = ${date}`,
    );
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const showIdx = args.indexOf("--show");
  const show = showIdx >= 0 ? Number(args[showIdx + 1] ?? 20) : 0;
  const examples: Array<{ date: string; tournament: string; listing: string; wrong: number; right: number[] }> = [];
  const arg = (k: string) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : undefined;
  };

  const range = await db.execute<{ lo: string; hi: string }>(sql`
    select min(played_on)::text as lo, max(played_on)::text as hi
    from player_recent_matches where source = 'tennis_explorer'
  `);
  const r0 = ((range as unknown as { rows?: Array<{ lo: string; hi: string }> }).rows ??
    (range as unknown as Array<{ lo: string; hi: string }>))[0]!;
  const from = arg("--from") ?? r0.lo;
  const to = arg("--to") ?? r0.hi;

  const indexes: Record<Tour, TePlayerIndex> = { atp: null!, wta: null! };
  for (const tour of ["atp", "wta"] as const) {
    const players = await db
      .select({ id: schema.players.id, fullName: schema.players.fullName, teSlug: schema.players.teSlug })
      .from(schema.players)
      .where(sql`${schema.players.tour} = ${tour}`);
    indexes[tour] = buildTePlayerIndex(players);
  }
  const days = Math.ceil((Date.parse(to) - Date.parse(from)) / 86_400_000) + 14;
  const levelDeps = {
    challengerEvents: loadChallengerEvents(),
    officialLevels: await loadOfficialLevels(Math.ceil((Date.now() - Date.parse(from)) / 86_400_000) + 14),
  };

  console.log(
    `[repair-te] ${from} .. ${to} (${days - 14} days)${apply ? "" : "  DRY RUN — pass --apply to write"}`,
  );
  const t: Totals = {
    days: 0, matchesListed: 0, matchesStored: 0, rowsDeleted: 0,
    rowsInserted: 0, levelsChanged: 0, wonFlipped: 0, unlisted: 0,
  };

  for (let d = Date.parse(from); d <= Date.parse(to); d += 86_400_000) {
    const date = new Date(d).toISOString().slice(0, 10);
    const stored = await rowsFor(date);
    if (stored.length === 0) continue;
    t.days++;

    const byMatch = new Map<string, Row[]>();
    for (const r of stored) {
      const k = `${r.externalTourneyId}|${r.externalMatchNum}`;
      const list = byMatch.get(k) ?? [];
      list.push(r);
      byMatch.set(k, list);
    }

    const listed = new Map<string, { tour: Tour; ref: TEMatchRef }>();
    for (const tour of ["atp", "wta"] as const) {
      let refs: TEMatchRef[];
      try {
        refs = await fetchDailyMatchList(new Date(`${date}T12:00:00Z`), tour);
      } catch (err) {
        console.warn(`[repair-te] ${tour}/${date}: list fetch failed — ${err instanceof Error ? err.message : err}`);
        continue;
      }
      for (const ref of refs) {
        if (ref.status !== "finished") continue;
        listed.set(`${ref.tournamentSlug}|${matchNum(ref.teMatchId)}`, { tour, ref });
      }
    }

    let dayDeleted = 0;
    let dayInserted = 0;
    // Collected for the whole day and written in two statements: one round
    // trip per match to a remote Postgres made a full repair take hours.
    const dayUpserts: Row[] = [];
    const dayDeletes: Row[] = [];
    for (const [k, rows] of byMatch) {
      const hit = listed.get(k);
      if (!hit) {
        t.unlisted += rows.length;
        continue;
      }
      t.matchesStored++;
      const { tour, ref } = hit;
      const p1 = resolveTePlayer(indexes[tour], ref.p1Slug, ref.p1Name);
      let p2 = resolveTePlayer(indexes[tour], ref.p2Slug, ref.p2Name);
      if (p1 != null && p1 === p2) p2 = null; // never write self-vs-self
      const p1Won = ref.p1Sets != null && ref.p2Sets != null ? ref.p1Sets > ref.p2Sets : null;
      const template = rows[0]!;
      const level = teTournamentLevel(tour, ref.tournamentName, date, levelDeps);

      const desired: Row[] = [];
      for (const [pid, opp, oppCountry, won] of [
        [p1, ref.p2Name, ref.p2Country, p1Won],
        [p2, ref.p1Name, ref.p1Country, p1Won == null ? null : !p1Won],
      ] as const) {
        if (pid == null || won == null) continue;
        desired.push({
          ...template,
          playerId: pid,
          tournamentName: ref.tournamentName,
          tournamentLevel: level,
          opponentName: opp,
          opponentCountry: oppCountry,
          won,
        });
      }
      const desiredIds = new Set(desired.map((r) => r.playerId));

      const toDelete = rows.filter((r) => !desiredIds.has(r.playerId));
      const existingById = new Map(rows.map((r) => [r.playerId, r]));
      const toUpsert = desired.filter((r) => {
        const e = existingById.get(r.playerId);
        if (!e) return true;
        if (e.tournamentLevel !== r.tournamentLevel) t.levelsChanged++;
        if (e.won !== r.won) t.wonFlipped++;
        return (
          e.tournamentLevel !== r.tournamentLevel ||
          e.won !== r.won ||
          e.opponentName !== r.opponentName
        );
      });
      const inserts = toUpsert.filter((r) => !existingById.has(r.playerId)).length;
      dayDeleted += toDelete.length;
      if (examples.length < show) {
        for (const r of toDelete) {
          examples.push({
            date,
            tournament: `${ref.tournamentName} [${tour}]`,
            listing: `${ref.p1Name} v ${ref.p2Name}`,
            wrong: r.playerId,
            right: [...desiredIds],
          });
        }
      }
      dayInserted += inserts;

      if (!apply) continue;
      dayUpserts.push(...toUpsert);
      dayDeletes.push(...toDelete);
    }

    if (apply) {
      // Upsert BEFORE deleting, so an interrupted run never leaves a match
      // with its wrong row gone and the right one not yet written.
      for (let i = 0; i < dayUpserts.length; i += 500) {
        await db
          .insert(schema.playerRecentMatches)
          .values(dayUpserts.slice(i, i + 500))
          .onConflictDoUpdate({
            target: [
              schema.playerRecentMatches.playerId,
              schema.playerRecentMatches.source,
              schema.playerRecentMatches.externalTourneyId,
              schema.playerRecentMatches.externalMatchNum,
            ],
            set: {
              tournamentLevel: sql`excluded.tournament_level`,
              won: sql`excluded.won`,
              opponentName: sql`excluded.opponent_name`,
              opponentCountry: sql`excluded.opponent_country`,
            },
          });
      }
      for (let i = 0; i < dayDeletes.length; i += 500) {
        const chunk = dayDeletes.slice(i, i + 500);
        await db.execute(sql`
          delete from player_recent_matches
          where source = 'tennis_explorer'
            and (player_id, external_tourney_id, external_match_num) in (${sql.join(
              chunk.map((r) => sql`(${r.playerId}, ${r.externalTourneyId}, ${r.externalMatchNum})`),
              sql`, `,
            )})
        `);
      }
    }
    t.matchesListed += listed.size;
    t.rowsDeleted += dayDeleted;
    t.rowsInserted += dayInserted;
    if (dayDeleted || dayInserted) {
      console.log(`[repair-te] ${date}: stored=${stored.length} delete=${dayDeleted} insert=${dayInserted}`);
    }
  }

  if (examples.length > 0) {
    const ids = [...new Set(examples.flatMap((e) => [e.wrong, ...e.right]))];
    const names = await db
      .select({ id: schema.players.id, name: schema.players.fullName, tour: schema.players.tour })
      .from(schema.players)
      .where(sql`${schema.players.id} = any(array[${sql.join(ids.map((i) => sql`${i}`), sql`, `)}]::int[])`);
    const nm = new Map(names.map((n) => [n.id, `${n.name} (${n.tour})`]));
    for (const e of examples.slice(0, show)) {
      console.log(
        `  ${e.date} ${e.tournament.padEnd(34)} ${e.listing.padEnd(36)} ` +
          `stored on: ${nm.get(e.wrong)}  -> resolved: ${e.right.map((i) => nm.get(i)).join(", ") || "(nobody)"}`,
      );
    }
  }
  console.log(
    `[repair-te] days=${t.days} listed=${t.matchesListed} storedMatches=${t.matchesStored} ` +
      `delete=${t.rowsDeleted} insert=${t.rowsInserted} levelChanges=${t.levelsChanged} ` +
      `wonFlipped=${t.wonFlipped} unlistedRows=${t.unlisted}${apply ? "" : "  (dry run)"}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
