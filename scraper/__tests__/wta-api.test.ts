/**
 * Contract tests for the WTA API source.
 *
 * Fixture-backed and offline, so they fail when the API's shape changes rather
 * than when the network is unavailable. Captured 2026-09-08:
 *
 *   wta-api-matches-1167-2026.json   Memphis Classic 2026 (WTA 250, 32 draw,
 *                                    complete, 2-round qualifying)
 *   wta-api-tournaments-2026-08.json calendar page for 2026-07-26..2026-08-03
 *
 * The round assertions are the point of this file. Every previous scoring bug
 * in this project came from a round that resolved to something adjacent and
 * silently mis-scored: R48 in the progression ladder, qualifying overwriting
 * the tier, the missing comma that killed the runner. A round mapping that is
 * only checked by eye is a round mapping that breaks in three months.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isTourLevel,
  mainDrawLadder,
  nominalDrawSize,
  parseTournamentList,
  eventName,
  parseWtaMatches,
  resolveWtaRound,
  wtaMatchesUrl,
  wtaTournamentLevel,
  WTA_API_SOURCE,
} from "@scraper/sources/wta-api";
import { inferCategory } from "@scraper/projections/category-inference";
import { stableMatchNumber } from "@scraper/stable-match-number";

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(join(process.cwd(), "scraper", "__fixtures__", name), "utf8"),
  ) as unknown;
}

const MEMPHIS = fixture("wta-api-matches-1167-2026.json");
const CALENDAR = fixture("wta-api-tournaments-2026-08.json");

describe("nominalDrawSize", () => {
  it("rounds a real entry list up to the power of two the points table uses", () => {
    // The 12-day WTA 1000s enter 96 or 94 players and give 32 seeds a bye, so
    // the SECOND round is the true Round of 64 and the first is the R128 slot.
    expect(nominalDrawSize(96)).toBe(128);
    expect(nominalDrawSize(94)).toBe(128);
    expect(nominalDrawSize(128)).toBe(128);
    expect(nominalDrawSize(56)).toBe(64);
    expect(nominalDrawSize(32)).toBe(32);
    expect(nominalDrawSize(28)).toBe(32);
    expect(nominalDrawSize(8)).toBe(8);
  });
});

describe("mainDrawLadder", () => {
  it("starts a 128 draw at R128 and a 32 draw at R32", () => {
    expect(mainDrawLadder(128)).toEqual(["R128", "R64", "R32", "R16", "QF", "SF", "F"]);
    expect(mainDrawLadder(32)).toEqual(["R32", "R16", "QF", "SF", "F"]);
  });

  it("gives a 96 draw the same ladder as a 128 draw", () => {
    // Not a coincidence to be tidied away: it is why a first-round loser at
    // Cincinnati is paid R128 points and a bye holder losing their opener is
    // paid R64.
    expect(mainDrawLadder(96)).toEqual(mainDrawLadder(128));
    expect(mainDrawLadder(28)).toEqual(mainDrawLadder(32));
  });

  it("starts an 8-player draw at the quarter-finals", () => {
    expect(mainDrawLadder(8)).toEqual(["QF", "SF", "F"]);
  });
});

describe("resolveWtaRound", () => {
  const main = (roundId: string, singlesDrawSize: number | null) =>
    resolveWtaRound({ roundId, drawLevelType: "M", singlesDrawSize });

  it("names numeric rounds from the draw size, not from their number", () => {
    expect(main("1", 32)).toEqual({ round: "R32", isQualifying: false });
    expect(main("2", 32)).toEqual({ round: "R16", isQualifying: false });
    // The same "1" is a completely different round at a 96-draw 1000.
    expect(main("1", 96)).toEqual({ round: "R128", isQualifying: false });
    expect(main("2", 96)).toEqual({ round: "R64", isQualifying: false });
    expect(main("4", 128)).toEqual({ round: "R16", isQualifying: false });
  });

  it("maps the letter rounds", () => {
    expect(main("Q", 32)).toEqual({ round: "QF", isQualifying: false });
    expect(main("S", 32)).toEqual({ round: "SF", isQualifying: false });
    expect(main("F", 32)).toEqual({ round: "F", isQualifying: false });
  });

  it("refuses to name a numeric round with no draw size", () => {
    // Guessing here would mis-score every match at the event.
    expect(main("1", null)).toBeNull();
  });

  it("refuses a numeric round past the end of the ladder", () => {
    expect(main("6", 32)).toBeNull();
  });

  it("anchors qualifying on the FINAL qualifying round", () => {
    const q = (roundId: string, present: number[]) =>
      resolveWtaRound({
        roundId,
        drawLevelType: "Q",
        singlesDrawSize: 32,
        qualifyingRoundIds: present,
      });
    // Three rounds (Slam-sized qualifying): straight through.
    expect(q("1", [1, 2, 3])).toEqual({ round: "Q1", isQualifying: true });
    expect(q("3", [1, 2, 3])).toEqual({ round: "Q3", isQualifying: true });
    // Two rounds: the last is still the final qualifying round, which is the
    // column the points tables are keyed on.
    expect(q("2", [1, 2])).toEqual({ round: "Q3", isQualifying: true });
    expect(q("1", [1, 2])).toEqual({ round: "Q2", isQualifying: true });
  });

  it("returns null for the empty RoundID Grand Slam qualifying carries", () => {
    expect(
      resolveWtaRound({ roundId: "", drawLevelType: "Q", singlesDrawSize: 128 }),
    ).toBeNull();
  });
});

describe("parseTournamentList", () => {
  const page = parseTournamentList(CALENDAR);

  it("reads the {pageInfo, content} envelope", () => {
    expect(page.tournaments.length).toBe(49);
    expect(page.numEntries).toBe(49);
    expect(page.pageSize).toBe(100);
  });

  it("carries level, surface and draw size", () => {
    const toronto = page.tournaments.find((t) => t.id === "806");
    expect(toronto).toMatchObject({
      year: 2026,
      level: "WTA 1000",
      surface: "Hard",
      singlesDrawSize: 96,
      startDate: "2026-08-02",
    });
  });

  it("separates tour-level events from ITF", () => {
    const tour = page.tournaments.filter((t) => isTourLevel(t.level));
    expect(tour.length).toBe(9);
    expect(new Set(tour.map((t) => t.level))).toEqual(
      new Set(["WTA 1000", "WTA 500", "WTA 250", "WTA 125"]),
    );
    // ITF is covered by the API but has no points table here, so it is
    // excluded rather than scored on the wrong tier.
    expect(page.tournaments.some((t) => t.level === "ITF")).toBe(true);
    expect(isTourLevel("ITF")).toBe(false);
  });
});

describe("parseWtaMatches", () => {
  const parsed = parseWtaMatches(MEMPHIS, { tourneyId: "1167", year: 2026 });

  it("takes the draw size from the tournament record embedded in the response", () => {
    // No calendar lookup needed, which is what lets --tournament <id> work.
    expect(parsed.tournament).toMatchObject({
      id: "1167",
      level: "WTA 250",
      singlesDrawSize: 32,
      startDate: "2026-07-27",
      endDate: "2026-08-02",
    });
  });

  it("keeps singles and skips doubles", () => {
    // 31 main-draw singles (a complete 32 draw) + 13 qualifying singles.
    expect(parsed.matches.length).toBe(44);
    expect(parsed.skippedDoubles).toBe(14);
    expect(parsed.unresolvedWinners).toEqual([]);
    expect(parsed.unresolvedRounds).toEqual([]);
  });

  it("resolves the full main draw ladder", () => {
    const counts = new Map<string, number>();
    for (const m of parsed.matches.filter((x) => !x.isQualifying)) {
      counts.set(m.round, (counts.get(m.round) ?? 0) + 1);
    }
    expect(Object.fromEntries(counts)).toEqual({
      R32: 16,
      R16: 8,
      QF: 4,
      SF: 2,
      F: 1,
    });
  });

  it("resolves two-round qualifying onto Q2 and Q3", () => {
    const counts = new Map<string, number>();
    for (const m of parsed.matches.filter((x) => x.isQualifying)) {
      counts.set(m.round, (counts.get(m.round) ?? 0) + 1);
    }
    expect(Object.fromEntries(counts)).toEqual({ Q2: 7, Q3: 6 });
  });

  it("reads the winner from the status code, not from the set scores", () => {
    const final = parsed.matches.find((m) => m.round === "F" && !m.isQualifying)!;
    expect(final.players.map((p) => p.fullName)).toEqual([
      "Kristina Liutova",
      "Darja Vidmanova",
    ]);
    // Winner="2" means side A. Side A lost the first set 1-6, so counting sets
    // from the front would have got this wrong.
    expect(final.winnerSide).toBe(0);
    expect(final.players[0].won).toBe(true);
    expect(final.players[1].won).toBe(false);
    expect(final.players[0].wtaId).toBe("335303");
    expect(final.retired).toBe(false);
    expect(final.walkover).toBe(false);
  });

  it("stores the score winner-first with tiebreak detail", () => {
    const final = parsed.matches.find((m) => m.round === "F" && !m.isQualifying)!;
    expect(final.scoreString).toBe("1-6 6-1 6-3");
    // ScoreSet* fields carry games only; the "(3)" survives only because the
    // ResultString tail is read when it agrees on set count.
    const tiebreak = parsed.matches.find((m) => m.scoreString.includes("("))!;
    expect(tiebreak.scoreString).toBe("7-6(3) 2-6 6-0");
  });

  it("uses the real per-match date, clamped to the tournament window", () => {
    const final = parsed.matches.find((m) => m.round === "F" && !m.isQualifying)!;
    expect(final.playedOn).toBe("2026-08-02");
    // Tennis Abstract stamps every match at an event with the START date. This
    // source must not: distinct dates are what a 52-week window needs.
    const dates = new Set(parsed.matches.map((m) => m.playedOn));
    expect(dates.size).toBeGreaterThan(3);
    for (const d of dates) {
      expect(d! >= "2026-07-27" && d! <= "2026-08-02").toBe(true);
    }
  });

  it("carries a stable WTA id for every player", () => {
    for (const m of parsed.matches) {
      for (const p of m.players) {
        expect(p.wtaId).toMatch(/^\d+$/);
        expect(p.slug.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("level to category", () => {
  it("keeps the API level verbatim for tour events", () => {
    expect(wtaTournamentLevel("WTA 500")).toBe("WTA 500");
    expect(wtaTournamentLevel("ITF")).toBeNull();
  });

  it("resolves the exact level without guessing from the event name", () => {
    // The Tennis Abstract letter "P" covers both 500 and 250, so this used to
    // depend on the event appearing in WTA_500_TOURNAMENTS. Monterrey and
    // Cleveland are both 2026 events; only one is a 500.
    expect(inferCategory("wta", "Abierto GNP Seguros - Monterrey, MEX", "WTA 500")).toBe("wta_500");
    expect(inferCategory("wta", "Tennis in the Land - Cleveland, OH", "WTA 250")).toBe("wta_250");
    expect(inferCategory("wta", "The Memphis Classic - Memphis, TN, USA", "WTA 250")).toBe("wta_250");
    expect(inferCategory("wta", "Warsaw T-Mobile Polish Open", "WTA 125")).toBe("wta_125");
  });

  it("still splits combined from non-combined 1000s by name", () => {
    expect(inferCategory("wta", "National Bank Open - Toronto, CAN", "WTA 1000")).toBe("wta_1000");
    expect(inferCategory("wta", "Qatar TotalEnergies Open - Doha", "WTA 1000")).toBe("wta_1000_nc");
  });

  it("does not let a WTA level string leak into the ATP path", () => {
    expect(inferCategory("atp", "Cincinnati Open", "WTA 1000")).toBe("masters_1000");
  });
});

describe("wtaMatchesUrl", () => {
  it("addresses an event by id and year", () => {
    expect(wtaMatchesUrl("905", 2026)).toBe(
      "https://api.wtatennis.com/tennis/tournaments/905/2026/matches",
    );
  });
});

describe("stableMatchNumber", () => {
  it("is orientation independent, so both sides of a match share it", () => {
    expect(stableMatchNumber("QF", ["335303", "329057"])).toBe(
      stableMatchNumber("QF", ["329057", "335303"]),
    );
  });

  it("separates rounds, so a rematch later in the draw is a different row", () => {
    expect(stableMatchNumber("QF", ["1", "2"])).not.toBe(stableMatchNumber("SF", ["1", "2"]));
  });
});

describe("WTA_API_SOURCE", () => {
  it("is the value the dedupe preference ordering knows about", () => {
    // Every reader of player_recent_matches ranks sources; a source string
    // that appears in the table but not in that CASE falls to the bottom and
    // loses to stale Tennis Abstract rows.
    expect(WTA_API_SOURCE).toBe("wta_api");
  });
});

/**
 * Record copied verbatim from
 * api.wtatennis.com/tennis/tournaments/2098/2025/matches (Guadalajara 125
 * 2025 final), trimmed to the fields the parser reads. Three matches in the
 * 13-month window look like this: finished, with a complete score, and
 * Winner="0" — the code was simply never entered. All three are FINALS, so
 * dropping them costs someone a title.
 */
const WINNER_NOT_RECORDED = {
  tournament: {
    liveScoringId: "2098",
    year: 2025,
    title: "Guadalajara 125 Open - Guadalajara, MEX",
    level: "WTA 125",
    surface: "Hard",
    startDate: "2025-09-01",
    endDate: "2025-09-06",
    singlesDrawSize: 32,
  },
  matches: [
    {
      MatchID: "LS001",
      DrawLevelType: "M",
      DrawMatchType: "S",
      RoundID: "F",
      MatchState: "F",
      Winner: "0",
      MatchTimeStamp: "2025-09-06T17:50:49.45+00:00",
      PlayerIDA: "325956",
      PlayerNameFirstA: "Panna",
      PlayerNameLastA: "Udvardy",
      PlayerCountryA: "HUN",
      PlayerIDB: "330332",
      PlayerNameFirstB: "Alexandra",
      PlayerNameLastB: "Eala",
      PlayerCountryB: "PHI",
      ScoreSet1A: "6",
      ScoreSet1B: "1",
      ScoreSet2A: "5",
      ScoreSet2B: "7",
      ScoreSet3A: "3",
      ScoreSet3B: "6",
      ScoreString: "1-6,7-5,6-3",
    },
    {
      MatchID: "LS002",
      DrawLevelType: "M",
      DrawMatchType: "S",
      RoundID: "S",
      MatchState: "F",
      Winner: "0",
      MatchTimeStamp: "2025-09-05T17:50:49.45+00:00",
      PlayerIDA: "1",
      PlayerNameFirstA: "Retired",
      PlayerNameLastA: "Playerone",
      PlayerIDB: "2",
      PlayerNameFirstB: "Advancing",
      PlayerNameLastB: "Playertwo",
      ScoreSet1A: "0",
      ScoreSet1B: "6",
      ScoreSet2A: "0",
      ScoreSet2B: "3",
    },
  ],
};

describe("Winner not recorded", () => {
  const parsed = parseWtaMatches(WINNER_NOT_RECORDED, { tourneyId: "2098", year: 2025 });

  it("derives a decisive winner from the set scores", () => {
    const final = parsed.matches.find((m) => m.round === "F")!;
    expect(final.winnerSide).toBe(1);
    expect(final.players[1].fullName).toBe("Alexandra Eala");
    expect(final.players[1].won).toBe(true);
    expect(final.players[0].won).toBe(false);
  });

  it("reads the score from ScoreString when ResultString is absent", () => {
    const final = parsed.matches.find((m) => m.round === "F")!;
    expect(final.scoreString).toBe("1-6 7-5 6-3");
  });

  it("refuses to derive a winner from a partial scoreline", () => {
    // 6-0, 3-0 is one set to none: whoever retired, the score does not say.
    // Scoring this from a majority-of-one would invent a result.
    expect(parsed.matches.some((m) => m.round === "SF")).toBe(false);
    expect(parsed.unresolvedWinners).toEqual(['LS002 Winner="0"']);
  });
});

describe("eventName", () => {
  it("stores the short name that aligns with the other feeds, not the sponsor title", () => {
    // The sponsor title shares nothing with TennisExplorer's "Monterrey", so
    // storing it split every WTA event into two tournaments in the
    // projections and credited players twice.
    expect(
      eventName({
        id: "1039",
        title: "Abierto GNP Seguros - Monterrey, MEX",
        groupName: "MONTERREY",
      }),
    ).toBe("Monterrey");
    expect(
      eventName({ id: "1017", title: "Cincinnati Open - Cincinnati, OH, USA", groupName: "CINCINNATI" }),
    ).toBe("Cincinnati");
  });

  it("keeps acronyms upper-case", () => {
    expect(eventName({ id: "905", title: "US Open - New York, NY, USA", groupName: "US OPEN" })).toBe(
      "US Open",
    );
    expect(
      eventName({ id: "1045", title: "Mubadala DC Open - Washington, DC, USA", groupName: "WASHINGTON DC" }),
    ).toBe("Washington DC");
  });

  it("falls back to the title when no group name is supplied", () => {
    expect(eventName({ id: "9", title: "WTA 9", groupName: null })).toBe("WTA 9");
  });
});
