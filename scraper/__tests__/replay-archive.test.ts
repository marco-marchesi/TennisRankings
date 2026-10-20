import { describe, expect, it } from "vitest";
import { parseMatches, parseOfficial, toArchiveMatch, toOfficialRow } from "@scraper/replay/archive";
import type { OfficialRow } from "@scraper/replay/types";

const MATCH_HEADER =
  "tourney_id,tourney_name,surface,draw_size,tourney_level,tourney_date,match_num,winner_id,winner_seed,winner_entry,winner_name,winner_hand,winner_ht,winner_ioc,winner_age,loser_id,loser_seed,loser_entry,loser_name,loser_hand,loser_ht,loser_ioc,loser_age,score,best_of,round,minutes";

describe("toArchiveMatch", () => {
  it("reads the fields the replay needs", () => {
    const m = toArchiveMatch({
      tourney_id: "2025-580", tourney_name: "Australian Open", draw_size: "128",
      tourney_level: "G", tourney_date: "20250113", winner_id: "1", loser_id: "2",
      winner_entry: "Q", loser_entry: "", score: "6-1 6-2 6-3", round: "R128",
      winner_rank: "120", loser_rank: "",
    });
    expect(m).toEqual({
      tourneyId: "2025-580", tourneyName: "Australian Open", level: "G", drawSize: 128,
      tourneyDate: "2025-01-13", round: "R128", winnerId: "1", loserId: "2",
      winnerEntry: "Q", loserEntry: null, score: "6-1 6-2 6-3",
      // Ranks entering the event: United Cup points depend on the opponent's.
      winnerRank: 120, loserRank: null,
    });
  });

  it("rejects a row without an edition id or date", () => {
    expect(toArchiveMatch({ tourney_id: "", tourney_date: "20250113", winner_id: "1", loser_id: "2", round: "F" })).toBeNull();
    expect(toArchiveMatch({ tourney_id: "x", tourney_date: "", winner_id: "1", loser_id: "2", round: "F" })).toBeNull();
  });
});

describe("parseMatches", () => {
  it("skips malformed rows and counts them", () => {
    const text = [
      MATCH_HEADER,
      "2025-580,Australian Open,Hard,128,G,20250113,1,1,,,A,R,,ITA,,2,,,B,R,,USA,,6-1 6-2 6-3,5,R128,90",
      ",Broken,Hard,128,G,20250113,2,1,,,A,R,,ITA,,2,,,B,R,,USA,,6-1,5,R128,90",
    ].join("\n");
    const { matches, skipped } = parseMatches(text);
    expect(matches).toHaveLength(1);
    expect(skipped).toBe(1);
  });
});

describe("toOfficialRow / parseOfficial", () => {
  it("reads rank, points and the optional tours column", () => {
    expect(toOfficialRow({ ranking_date: "20260105", rank: "1", player: "214544", points: "10490", tours: "17" }))
      .toEqual({ week: "2026-01-05", rank: 1, playerId: "214544", points: 10490, tours: 17 });
    expect(toOfficialRow({ ranking_date: "20260105", rank: "3", player: "9", points: "" })).toBeNull();
  });

  it("keeps only weeks inside the window", () => {
    const into = new Map<string, Map<string, OfficialRow>>();
    const text = "ranking_date,rank,player,points\n20221226,1,1,100\n20230102,1,1,110\n20230109,1,1,120";
    const skipped = parseOfficial(text, "2023-01-02", "2023-01-02", into);
    expect([...into.keys()]).toEqual(["2023-01-02"]);
    expect(into.get("2023-01-02")!.get("1")!.points).toBe(110);
    expect(skipped).toBe(0);
  });
});
