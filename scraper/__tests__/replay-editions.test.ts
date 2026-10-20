import { describe, expect, it } from "vitest";
import { buildEditions } from "@scraper/replay/editions";
import type { ArchiveMatch } from "@scraper/replay/types";

const m = (over: Partial<ArchiveMatch>): ArchiveMatch => ({
  tourneyId: "2026-0001", tourneyName: "Marseille", level: "A", drawSize: 28,
  tourneyDate: "2026-02-09", round: "R32", winnerId: "W", loserId: "L",
  winnerEntry: null, loserEntry: null, score: "6-1 6-1", ...over,
});
const pts = (results: ReturnType<typeof buildEditions>["results"], pid: string) =>
  results.find((r) => r.playerId === pid)!;

describe("buildEditions", () => {
  // ATP 250, 28 draw, 2-round qualifying.
  const marseille = [
    m({ round: "Q1", winnerId: "q", loserId: "q1loser", drawSize: 16 }),
    m({ round: "Q2", winnerId: "q", loserId: "q2loser", drawSize: 16 }),
    m({ round: "R32", winnerId: "q", loserId: "r32loser" }),
    m({ round: "R16", winnerId: "champ", loserId: "q" }),
    m({ round: "QF", winnerId: "champ", loserId: "qfloser" }),
    m({ round: "SF", winnerId: "champ", loserId: "sfloser" }),
    m({ round: "F", winnerId: "champ", loserId: "finalist" }),
  ];
  const { editions, results } = buildEditions("atp", marseille, []);

  it("builds one edition keyed by tour and tourney_id", () => {
    expect([...editions.keys()]).toEqual(["atp:2026-0001"]);
    expect(editions.get("atp:2026-0001")!.category).toBe("atp_250");
  });

  it("carries the edition's category on every result", () => {
    expect(pts(results, "champ").category).toBe("atp_250");
  });

  it("marks whether the player reached the main draw", () => {
    expect(pts(results, "q").mainDraw).toBe(true);
    expect(pts(results, "champ").mainDraw).toBe(true);
    expect(pts(results, "q2loser").mainDraw).toBe(false);
  });

  it("scores main-draw finishes from the points table", () => {
    expect(pts(results, "champ").points).toBe(250);
    expect(pts(results, "finalist").points).toBe(165);
    expect(pts(results, "sfloser").points).toBe(100);
    expect(pts(results, "qfloser").points).toBe(50);
    expect(pts(results, "r32loser").points).toBe(0);
  });

  it("adds the qualifier bonus to a qualifier's main-draw points", () => {
    // Lost in R16 (25) after qualifying (+12 at a 250).
    expect(pts(results, "q").points).toBe(25 + 12);
  });

  it("scores a non-Slam qualifying loss by its own round", () => {
    // docs/ranking-rules.md:96-98: ATP 250 Q2 6, Q1 0. The table's Q3 slot at
    // these tiers is the qualifying WINNER's value (12), which an earlier
    // version of this test wrongly expected for the Q2 loser.
    expect(pts(results, "q2loser").points).toBe(6);
    expect(pts(results, "q1loser").points).toBe(0);
  });

  it("scores 96-draw Masters qualifying per the rulebook", () => {
    // docs/ranking-rules.md:64-66 (2026): qualifying winner 25, Q2 16, Q1 8.
    // 2025 paid 20 / 10 / 0 (points-eras.ts, 2025_ATP_Tour); which of the two
    // the official 2026 totals reflect is decided by replay (Phase 2a Task 5).
    const iw = (id: string, date: string) => [
      m({ tourneyId: id, tourneyName: "Indian Wells Masters", level: "M", drawSize: 96, tourneyDate: date, round: "Q1", winnerId: "qq", loserId: "iwq1" }),
      m({ tourneyId: id, tourneyName: "Indian Wells Masters", level: "M", drawSize: 96, tourneyDate: date, round: "Q2", winnerId: "qq", loserId: "iwq2" }),
    ];
    const y26 = buildEditions("atp", iw("2026-0404", "2026-03-04"), []).results;
    expect(pts(y26, "iwq2").points).toBe(16);
    expect(pts(y26, "iwq1").points).toBe(8);
    const y25 = buildEditions("atp", iw("2025-0404", "2025-03-05"), []).results;
    expect(pts(y25, "iwq2").points).toBe(10);
    expect(pts(y25, "iwq1").points).toBe(0);
  });

  it("scores each result with its own season's table", () => {
    const final = (id: string, date: string, level = "A", name = "Marseille", drawSize = 28) =>
      buildEditions("atp", [m({ tourneyId: id, tourneyName: name, level, drawSize, tourneyDate: date, round: "F" })], []).results;
    expect(pts(final("2023-0001", "2023-02-13"), "L").points).toBe(150); // 2023 250 finalist
    expect(pts(final("2024-0001", "2024-02-12"), "L").points).toBe(165);
    expect(pts(final("2024-0001", "2024-02-12"), "L").gaps).toEqual([]);
    expect(pts(final("2023-0500", "2023-02-20", "A", "Rotterdam", 32), "L").points).toBe(300);
  });

  it("flags a tier no source covers for that season", () => {
    const old = [m({ tourneyId: "2021-0001", tourneyDate: "2021-11-08", round: "F" })];
    expect(pts(buildEditions("atp", old, []).results, "W").gaps).toContain("points_era:atp:atp_250:2021");
    const finals = [m({ tourneyId: "2023-0808", tourneyName: "Cancun Finals", level: "F", drawSize: 8, tourneyDate: "2023-10-29", round: "F" })];
    const r = pts(buildEditions("wta", finals, []).results, "W");
    expect(r.points).toBe(0);
    expect(r.gaps).toContain("points_era:wta:finals:2023");
    expect(pts(results, "champ").gaps).toEqual([]);
  });

  it("scores WTA ITF events by season and draw", () => {
    const w35 = [m({ tourneyId: "2024-W-1", tourneyName: "W35 Bath", level: "35", drawSize: 32, tourneyDate: "2024-04-01", round: "SF" })];
    const r = buildEditions("wta", w35, []).results;
    expect(pts(r, "L").points).toBe(14);
    expect(pts(r, "L").category).toBeNull();
    const w35in23 = [m({ tourneyId: "2023-W-1", tourneyName: "W35 Bath", level: "35", drawSize: 32, tourneyDate: "2023-04-03", round: "SF" })];
    expect(pts(buildEditions("wta", w35in23, []).results, "L").gaps).toContain("points_era:wta:itf_w35:2023");
  });

  it("enters the two lowest WTA ITF tiers a week late (replay evidence)", () => {
    const one = (level: string, name: string, date: string) =>
      pts(buildEditions("wta", [m({ tourneyId: `${date}-${level}`, tourneyName: name, level, drawSize: 32, tourneyDate: date, round: "F" })], []).results, "W");
    // W15 / W35 from 2024, W15 / W25 in 2023: the Monday after next.
    expect(one("35", "W35 Bath", "2024-04-01").entryWeek).toBe("2024-04-15");
    expect(one("15", "W15 Monastir", "2025-04-07").entryWeek).toBe("2025-04-21");
    expect(one("25", "W25 Bath", "2023-04-03").entryWeek).toBe("2023-04-17");
    expect(one("35", "W35 Bath", "2024-04-01").expiryWeek).toBe("2025-04-14");
    // Higher tiers count the Monday after.
    expect(one("50", "W50 Bath", "2024-04-01").entryWeek).toBe("2024-04-08");
    expect(one("40", "W40 Bath", "2023-04-03").entryWeek).toBe("2023-04-10");
    // ATP: M15 and M25 likewise (the ATP's whole ITF tier).
    const men = (level: string) =>
      pts(buildEditions("atp", [m({ tourneyId: `M-${level}`, tourneyName: `M${level} Monastir`, level, drawSize: 32, tourneyDate: "2025-04-07", round: "F" })], []).results, "W");
    expect(men("15").entryWeek).toBe("2025-04-21");
    expect(men("25").entryWeek).toBe("2025-04-21");
  });

  it("a WTA qualifier who loses her first main-draw match keeps only the qualifying points", () => {
    const ev = (tour: "atp" | "wta", level: string, name: string, extra: Partial<ArchiveMatch>[]) =>
      buildEditions(tour, [
        m({ tourneyId: "2024-Q", tourneyName: name, level, drawSize: 32, tourneyDate: "2024-04-01", round: "Q1", winnerId: "Q", loserId: "x1" }),
        m({ tourneyId: "2024-Q", tourneyName: name, level, drawSize: 32, tourneyDate: "2024-04-01", round: "Q2", winnerId: "Q", loserId: "x2" }),
        ...extra.map((e) => m({ tourneyId: "2024-Q", tourneyName: name, level, drawSize: 32, tourneyDate: "2024-04-01", ...e })),
      ], []).results;
    // W50 2024: qualifier 2, first round 1.
    expect(pts(ev("wta", "50", "W50 Bath", [{ round: "R32", winnerId: "y", loserId: "Q" }]), "Q").points).toBe(2);
    // Past the first round it is additive: R16 loser 6 + 2.
    expect(pts(ev("wta", "50", "W50 Bath", [{ round: "R32", winnerId: "Q", loserId: "y" }, { round: "R16", winnerId: "z", loserId: "Q" }]), "Q").points).toBe(8);
    // WTA 250 2024: qualifier 18, first round 1 -> 18.
    expect(pts(ev("wta", "I", "Bogota", [{ round: "R32", winnerId: "y", loserId: "Q" }]), "Q").points).toBe(18);
    // ATP keeps both: a 2024 Slam qualifier losing R128 earns 10 + 30.
    const slam = buildEditions("atp", [
      m({ tourneyId: "2024-580", tourneyName: "Australian Open", level: "G", drawSize: 128, tourneyDate: "2024-01-15", round: "Q3", winnerId: "Q", loserId: "x" }),
      m({ tourneyId: "2024-580", tourneyName: "Australian Open", level: "G", drawSize: 128, tourneyDate: "2024-01-15", round: "R128", winnerId: "y", loserId: "Q" }),
    ], []).results;
    expect(pts(slam, "Q").points).toBe(40);
  });

  it("scores the Paris 2024 Olympics with the WTA's medal table", () => {
    const o = [m({ tourneyId: "2024-0096", tourneyName: "Paris Olympics", level: "O", drawSize: 64, tourneyDate: "2024-07-27", round: "F" })];
    expect(pts(buildEditions("wta", o, []).results, "W").points).toBe(750);
    expect(pts(buildEditions("wta", o, []).results, "L").points).toBe(450);
  });

  it("dates entry the Monday after the event and expiry 52 weeks later", () => {
    expect(pts(results, "champ").entryWeek).toBe("2026-02-16");
    expect(pts(results, "champ").expiryWeek).toBe("2027-02-15");
  });

  it("merges qualifying from another file into the same edition", () => {
    const slam = [
      m({ tourneyId: "2025-580", tourneyName: "Australian Open", level: "G", drawSize: 128, tourneyDate: "2025-01-13", round: "Q3", winnerId: "qual", loserId: "q3loser" }),
      m({ tourneyId: "2025-580", tourneyName: "Australian Open", level: "G", drawSize: 128, tourneyDate: "2025-01-13", round: "R128", winnerId: "x", loserId: "qual" }),
    ];
    const built = buildEditions("atp", slam, []);
    expect(built.editions.size).toBe(1);
    expect(built.results.filter((r) => r.playerId === "qual")).toHaveLength(1);
    // R128 loss (10) + the 2025 Slam qualifier bonus (30, 2025_ATP_Tour;
    // docs/ranking-rules.md says 25 for 2026 — Phase 2a Task 5).
    expect(pts(built.results, "qual").points).toBe(40);
    expect(pts(built.results, "q3loser").points).toBe(16);
    expect(pts(built.results, "x").entryWeek).toBe("2025-01-27");
  });

  it("credits the next round and flags an incomplete draw", () => {
    const partial = [m({ tourneyId: "2025-9", round: "QF", winnerId: "alive", loserId: "out" })];
    const r = pts(buildEditions("atp", partial, []).results, "alive");
    expect(r.points).toBe(100); // reached SF at a 250
    expect(r.gaps).toContain("incomplete_edition");
  });

  it("scores the Finals additively", () => {
    const finals = [
      m({ tourneyId: "2025-605", tourneyName: "Tour Finals", level: "F", drawSize: 8, tourneyDate: "2025-11-09", round: "RR", winnerId: "A", loserId: "B" }),
      m({ tourneyId: "2025-605", tourneyName: "Tour Finals", level: "F", drawSize: 8, tourneyDate: "2025-11-09", round: "RR", winnerId: "A", loserId: "C" }),
      m({ tourneyId: "2025-605", tourneyName: "Tour Finals", level: "F", drawSize: 8, tourneyDate: "2025-11-09", round: "SF", winnerId: "A", loserId: "D" }),
      m({ tourneyId: "2025-605", tourneyName: "Tour Finals", level: "F", drawSize: 8, tourneyDate: "2025-11-09", round: "F", winnerId: "E", loserId: "A" }),
    ];
    const r = pts(buildEditions("atp", finals, []).results, "A");
    expect(r.points).toBe(2 * 200 + 400);
    expect(r.isFinals).toBe(true);
  });

  it("enters a two-week 1000 on the first Monday on or after its final, 11 days after its start", () => {
    // Cincinnati 2025: archive start Thu 7 Aug, final Mon 18 Aug. The official
    // ranking of 18 Aug already held it (Sinner 11480 on both 18 and 25 Aug).
    const cin = [m({ tourneyId: "2025-0422", tourneyName: "Cincinnati Masters", level: "M", drawSize: 96, tourneyDate: "2025-08-07", round: "F" })];
    expect(pts(buildEditions("atp", cin, []).results, "W").entryWeek).toBe("2025-08-18");
    // Canada 2025: Sun 27 Jul -> final Thu 7 Aug -> counts from 11 Aug.
    const can = [m({ tourneyId: "2025-0421", tourneyName: "Canada Masters", level: "M", drawSize: 96, tourneyDate: "2025-07-27", round: "F" })];
    expect(pts(buildEditions("atp", can, []).results, "W").entryWeek).toBe("2025-08-11");
  });

  it("treats a 56-draw 1000 as a one-week event", () => {
    // Canada 2023 was 56-draw, 7-13 Aug. Sinner's title counted from 14 Aug
    // (official 3815 -> 4725); as a two-week event it entered a week late.
    const can = [m({ tourneyId: "2023-0421", tourneyName: "Canada Masters", level: "M", drawSize: 56, tourneyDate: "2023-08-07", round: "F" })];
    expect(pts(buildEditions("atp", can, []).results, "W").entryWeek).toBe("2023-08-14");
  });

  it("expires the ATP Finals the Monday after the last regular event of the next season", () => {
    // docs/ranking-rules.md:11. The 2023 Finals left the official ranking on
    // 11 Nov 2024 (Sinner 11330 -> 10330), one week before its 52 weeks.
    const finals = [m({ tourneyId: "2023-0605", tourneyName: "Tour Finals", level: "A", drawSize: 8, tourneyDate: "2023-11-13", round: "F" })];
    const r = pts(buildEditions("atp", finals, []).results, "W");
    expect(r.entryWeek).toBe("2023-11-20");
    expect(r.expiryWeek).toBe("2024-11-11");
  });

  it("emits no result at all for an event that awards no points", () => {
    // Each Davis Cup tie is its own archive "edition": a win with no later
    // match looked like an incomplete draw (24,682 false flags in the first
    // run), and the 0-point rows then counted toward best_n.
    const tie = [m({ tourneyId: "2025-M-DC-2025-FLS-M-ITA-ARG-01", tourneyName: "Davis Cup Finals QF: ITA vs ARG", level: "D", drawSize: 2, round: "RR" })];
    expect(buildEditions("atp", tie, []).results).toEqual([]);
  });

  it("gives a gap edition's players zero points and the gap flag", () => {
    // The ATP Cup (2020-22) has no table here; the United Cup is scored by
    // united-cup.ts from 2024 (replay-united-cup.test.ts).
    const cup = [m({ tourneyId: "2022-8888", tourneyName: "ATP Cup", level: "A", drawSize: 16, tourneyDate: "2022-01-01", round: "RR" })];
    const r = pts(buildEditions("atp", cup, []).results, "W");
    expect(r.points).toBe(0);
    expect(r.gaps).toEqual(["united_cup"]);
  });
});
