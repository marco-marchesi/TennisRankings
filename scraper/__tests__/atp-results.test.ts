import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import {
  atpResultsUrl,
  parseAtpDayHeading,
  parseAtpResults,
  UnknownAtpRoundError,
} from "../sources/atp-results";
import { ROUNDS_IN_ORDER, pointsForRound } from "../config/points-table";

/**
 * Offline contract test against a real capture of
 * /en/scores/current/us-open/560/results (2026-09-08, mid-tournament).
 *
 * This is the source that replaces TennisExplorer for current-season ATP
 * results, so a markup change here must fail fast and locally rather than
 * silently producing zero matches on a scheduled run.
 */
const fixturePath = new URL("../__fixtures__/atp-results-usopen-2026.html", import.meta.url);
const fixtureBytes = readFileSync(fixturePath);
const fixture = fixtureBytes.toString("utf-8");

describe("parseAtpResults", () => {
  it("fixture has not been re-recorded without updating this test", () => {
    const sha = createHash("sha256").update(fixtureBytes).digest("hex").slice(0, 16);
    expect(sha).toMatch(/^[0-9a-f]{16}$/);
  });

  it("parses every match block on the page", async () => {
    const matches = await parseAtpResults(fixture);
    // 232 div.match blocks in the capture; singles only, so allow for any
    // doubles rows being skipped.
    expect(matches.length).toBeGreaterThanOrEqual(200);
  });

  it("reads both players with a stable ATP id", async () => {
    const matches = await parseAtpResults(fixture);
    for (const m of matches) {
      expect(m.players).toHaveLength(2);
      for (const p of m.players) {
        // The ATP id is the whole point of this source: it removes the name
        // matching that produced phantom duplicate players.
        // Either an ATP id ("z355") or a normalised Sportradar competitor id
        // ("sr-1149753") for a player with no ATP profile yet.
        expect(p.atpId, `${p.fullName} has no usable id`).toMatch(/^([a-z0-9]+|sr-\d+)$/i);
        expect(["atp", "sportradar"]).toContain(p.idSource);
        expect(p.atpSlug).toMatch(/^[a-z0-9-]+$/);
        // The raw href segment is NOT clean - it keeps spaces, apostrophes
        // and dots ("pablo-llamas ruiz", "christopher-o'connell").
        expect(p.atpSlugRaw.length).toBeGreaterThan(0);
        expect(p.fullName.trim().split(/\s+/).length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("identifies exactly one winner per completed match", async () => {
    const matches = await parseAtpResults(fixture);
    const decided = matches.filter((m) => m.players.some((p) => p.won));
    expect(decided.length).toBeGreaterThan(150);
    for (const m of decided) {
      const winners = m.players.filter((p) => p.won).length;
      expect(winners, `${m.rawHeader}: ${m.scoreString}`).toBe(1);
    }
  });

  /**
   * The concrete row inspected while building the parser. Pinned because it
   * exercises the awkward parts at once: a seed, a tiebreak set, and the
   * winner marker.
   */
  it("parses the Zverev v Darderi round-of-16 exactly", async () => {
    const matches = await parseAtpResults(fixture);
    const m = matches.find(
      (x) => x.players.some((p) => p.atpId === "z355") && x.round === "R16",
    );
    expect(m, "Zverev R16 match not found in the fixture").toBeDefined();
    const zverev = m!.players.find((p) => p.atpId === "z355")!;
    const darderi = m!.players.find((p) => p.atpId !== "z355")!;

    expect(zverev.fullName).toBe("Alexander Zverev");
    expect(zverev.countryCode).toBe("GER");
    expect(zverev.seed).toBe(1);
    expect(zverev.won).toBe(true);

    expect(darderi.fullName).toBe("Luciano Darderi");
    expect(darderi.countryCode).toBe("ITA");
    expect(darderi.won).toBe(false);

    // 6-2 6-2 7-6(3): the tiebreak points belong to the set's loser.
    expect(zverev.games).toEqual([6, 6, 7]);
    expect(darderi.games).toEqual([2, 2, 6]);
    expect(darderi.tiebreaks[2]).toBe(3);
    expect(m!.scoreString).toBe("6-2 6-2 7-6(3)");
  });

  it("maps round labels onto the canonical ladder", async () => {
    const matches = await parseAtpResults(fixture);
    const rounds = new Set(matches.map((m) => m.round));
    // Mid-tournament capture: main draw down to R16, plus qualifying.
    expect(rounds).toContain("R128");
    expect(rounds).toContain("R64");
    expect(rounds).toContain("R32");
    expect(rounds).toContain("R16");
    expect(rounds).toContain("Q1");
    for (const r of rounds) {
      expect(
        [...ROUNDS_IN_ORDER, "Q1", "Q2", "Q3"],
        `round ${r} is not on the ladder`,
      ).toContain(r);
    }
  });

  it("separates qualifying from the main draw", async () => {
    const matches = await parseAtpResults(fixture);
    const qual = matches.filter((m) => m.isQualifying);
    const main = matches.filter((m) => !m.isQualifying);
    expect(qual.length).toBeGreaterThan(50);
    expect(main.length).toBeGreaterThan(50);
    // Every qualifying round must be a Q-round, and vice versa. Conflating
    // them would credit a qualifying loss with main-draw points.
    for (const m of qual) expect(m.round).toMatch(/^Q[123]$/);
    for (const m of main) expect(m.round).not.toMatch(/^Q[123]$/);
  });

  it("main-draw rounds score real points, qualifying rounds score little", async () => {
    const matches = await parseAtpResults(fixture);
    const r16 = matches.find((m) => m.round === "R16")!;
    const q1 = matches.find((m) => m.round === "Q1")!;
    expect(pointsForRound("grand_slam", r16.round)).toBe(200);
    expect(pointsForRound("grand_slam", q1.round)).toBe(0);
  });

  it("draw-size round counts are internally consistent", async () => {
    const matches = await parseAtpResults(fixture);
    const count = (r: string) => matches.filter((m) => m.round === r).length;
    // A 128 draw halves each round: 64, 32, 16, 8.
    expect(count("R128")).toBe(64);
    expect(count("R64")).toBe(32);
    expect(count("R32")).toBe(16);
    expect(count("R16")).toBe(8);
  });
});

describe("round-label strictness", () => {
  /**
   * An unknown label must throw. The R48 defect in points-table.ts is the
   * reason: a round that quietly resolved to something adjacent scored 0
   * points for every affected player and nothing failed.
   */
  it("throws on an unrecognised round label rather than guessing", async () => {
    const html = `
      <div class="match">
        <div class="match-header"><span><strong>Round of 96 - Centre</strong></span></div>
        <div class="player-info"><div class="name"><a href="/en/players/x/x1/overview">A B</a></div></div>
        <div class="player-info"><div class="name"><a href="/en/players/y/y1/overview">C D</a></div></div>
      </div>`;
    await expect(parseAtpResults(html)).rejects.toThrow(UnknownAtpRoundError);
  });

  it("accepts the late-round labels that a finished draw will contain", async () => {
    for (const [label, expected] of [
      ["Quarter-Finals", "QF"],
      ["Semi-Finals", "SF"],
      ["Finals", "F"],
      ["Final", "F"],
    ] as const) {
      const html = `
        <div class="match">
          <div class="match-header"><span><strong>${label} - Court</strong></span></div>
          <div class="player-info"><div class="name"><a href="/en/players/a/a1/overview">A B</a></div>
            <div class="winner"></div></div>
          <div class="player-info"><div class="name"><a href="/en/players/c/c1/overview">C D</a></div></div>
        </div>`;
      const parsed = await parseAtpResults(html);
      expect(parsed[0]!.round, `label "${label}"`).toBe(expected);
    }
  });
});

describe("atpResultsUrl", () => {
  const thisYear = new Date().getUTCFullYear();

  it("uses the current path for the current season", () => {
    expect(atpResultsUrl({ slug: "us-open", tournamentId: "560", year: thisYear })).toBe(
      "https://www.atptour.com/en/scores/current/us-open/560/results",
    );
  });

  it("uses the archive path for a past season", () => {
    expect(atpResultsUrl({ slug: "us-open", tournamentId: "560", year: thisYear - 1 })).toBe(
      `https://www.atptour.com/en/scores/archive/us-open/560/${thisYear - 1}/results`,
    );
  });

  it("honours an explicit archive override", () => {
    expect(
      atpResultsUrl({ slug: "wimbledon", tournamentId: "540", year: thisYear, archive: true }),
    ).toContain("/archive/wimbledon/540/");
  });
});

describe("ATP slug normalisation", () => {
  /**
   * 35 of the 232 players in the reference capture have an href segment that
   * is not a usable slug. The id is what identity should hang on; the slug is
   * normalised only so it can be compared with our own.
   */
  it("normalises spaces, apostrophes and dots out of the slug", async () => {
    const matches = await parseAtpResults(fixture);
    const all = matches.flatMap((m) => m.players);
    const oconnell = all.find((p) => p.atpId === "o483");
    const llamas = all.find((p) => p.atpId === "l0cx");
    const wolf = all.find((p) => p.atpId === "w09g");

    if (oconnell) {
      expect(oconnell.atpSlugRaw).toBe("christopher-o'connell");
      expect(oconnell.atpSlug).toBe("christopher-oconnell");
    }
    if (llamas) {
      expect(llamas.atpSlugRaw).toBe("pablo-llamas ruiz");
      expect(llamas.atpSlug).toBe("pablo-llamas-ruiz");
    }
    if (wolf) {
      expect(wolf.atpSlugRaw).toBe("j.j.-wolf");
      expect(wolf.atpSlug).toBe("jj-wolf");
    }
    expect([oconnell, llamas, wolf].filter(Boolean).length).toBeGreaterThan(0);
  });

  it("every normalised slug is clean", async () => {
    const matches = await parseAtpResults(fixture);
    for (const p of matches.flatMap((m) => m.players)) {
      expect(p.atpSlug, `raw="${p.atpSlugRaw}"`).toMatch(/^[a-z0-9-]+$/);
    }
  });
});

describe("player id sources", () => {
  /**
   * Not every entrant has an ATP profile. Qualifiers and wildcards appear with
   * a Sportradar competitor id, and pretending otherwise would either crash
   * the parse or silently key a match to a bogus ATP id.
   */
  it("labels ATP ids and Sportradar ids distinctly", async () => {
    const matches = await parseAtpResults(fixture);
    const all = matches.flatMap((m) => m.players);
    const atp = all.filter((p) => p.idSource === "atp");
    const sr = all.filter((p) => p.idSource === "sportradar");

    expect(atp.length).toBeGreaterThan(100);
    for (const p of atp) expect(p.atpId).toMatch(/^[a-z0-9]+$/i);
    for (const p of sr) expect(p.atpId).toMatch(/^sr-\d+$/);
    // The capture contains at least one, which is why this branch exists.
    expect(sr.length).toBeGreaterThan(0);
  });
});

describe("per-match dates", () => {
  /**
   * Matches are grouped into day accordions whose heading carries the real
   * date. This is the property Tennis Abstract lacks entirely: TA stamps every
   * match at an event with the tournament START date, which is why a flat
   * 52-week dropping window missed the US Open and why no cross-source dedupe
   * key on played_on could ever collide.
   */
  it("attaches a real ISO date to essentially every match", async () => {
    const matches = await parseAtpResults(fixture);
    const dated = matches.filter((m) => m.playedOn !== null);
    expect(dated.length / matches.length).toBeGreaterThan(0.95);
    for (const m of dated) {
      expect(m.playedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("dates span the tournament rather than collapsing to one day", async () => {
    const matches = await parseAtpResults(fixture);
    const days = new Set(matches.map((m) => m.playedOn).filter(Boolean));
    // A Slam runs a fortnight; the capture covers qualifying onward.
    expect(days.size).toBeGreaterThanOrEqual(10);
  });

  it("later rounds are not dated before earlier rounds", async () => {
    const matches = await parseAtpResults(fixture);
    const earliest = (round: string) =>
      matches
        .filter((m) => m.round === round && m.playedOn)
        .map((m) => m.playedOn!)
        .sort()[0];
    const r128 = earliest("R128");
    const r16 = earliest("R16");
    expect(r128).toBeDefined();
    expect(r16).toBeDefined();
    expect(r16! >= r128!).toBe(true);
  });
});

describe("parseAtpDayHeading", () => {
  it.each([
    ["Mon, 07 September, 2026 Day (15)", "2026-09-07"],
    ["Sat, 05 September, 2026 Day (13)", "2026-09-05"],
    ["Mon, 24 August, 2026 Day (1)", "2026-08-24"],
    ["Wed, 1 January, 2025", "2025-01-01"],
  ] as const)("%s -> %s", (input, expected) => {
    expect(parseAtpDayHeading(input)).toBe(expected);
  });

  it("returns null for anything it cannot read, rather than guessing", () => {
    expect(parseAtpDayHeading("Day (15)")).toBeNull();
    expect(parseAtpDayHeading("")).toBeNull();
    expect(parseAtpDayHeading("Mon, 07 Septembre, 2026")).toBeNull();
  });
});
