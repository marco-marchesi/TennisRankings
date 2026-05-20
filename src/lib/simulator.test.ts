import { describe, it, expect } from "vitest";
import { simulate, type PointsLine } from "./simulator";

const lines: PointsLine[] = [
  { tournamentSlug: "australian-open", category: "grand_slam",   points: 2000, isMandatory: true,  expiresWeekOf: "2027-01-25" },
  { tournamentSlug: "roland-garros",   category: "grand_slam",   points: 200,  isMandatory: true,  expiresWeekOf: "2027-06-01" },
  { tournamentSlug: "wimbledon",       category: "grand_slam",   points: 400,  isMandatory: true,  expiresWeekOf: "2027-07-13" },
  { tournamentSlug: "us-open",         category: "grand_slam",   points: 800,  isMandatory: true,  expiresWeekOf: "2027-09-10" },
  { tournamentSlug: "indian-wells",    category: "masters_1000", points: 1000, isMandatory: false, expiresWeekOf: "2027-03-22" },
  { tournamentSlug: "miami",           category: "masters_1000", points: 600,  isMandatory: false, expiresWeekOf: "2027-03-29" },
  { tournamentSlug: "rome",            category: "masters_1000", points: 360,  isMandatory: false, expiresWeekOf: "2027-05-15" },
];

describe("simulate", () => {
  it("substitutes a scenario tournament's points and re-aggregates", () => {
    const result = simulate(lines, {
      playerSlug: "jannik-sinner",
      tour: "atp",
      scenario: [{ tournamentSlug: "roland-garros", pointsAfterScenario: 2000 }],
    });
    // Mandatory (2000 + 2000 + 400 + 800) + best optional (1000 + 600 + 360)
    expect(result.projectedPoints).toBe(7160);
  });

  it("returns the unchanged best-of total when scenario is empty", () => {
    const result = simulate(lines, {
      playerSlug: "jannik-sinner",
      tour: "atp",
      scenario: [],
    });
    // 2000 + 200 + 400 + 800 + 1000 + 600 + 360 = 5360
    expect(result.projectedPoints).toBe(5360);
  });

  it("preserves the playerSlug echo from input", () => {
    const result = simulate(lines, {
      playerSlug: "alcaraz",
      tour: "atp",
      scenario: [],
    });
    expect(result.playerSlug).toBe("alcaraz");
  });

  it("uses the WTA best-16 limit when tour is wta", () => {
    const many: PointsLine[] = Array.from({ length: 20 }, (_, i) => ({
      tournamentSlug: `wta-${i}`,
      category: "atp_500",
      points: 100,
      isMandatory: false,
      expiresWeekOf: "2027-01-01",
    }));
    const result = simulate(many, {
      playerSlug: "p",
      tour: "wta",
      scenario: [],
    });
    expect(result.projectedPoints).toBe(1600);
  });

  it("counts every mandatory result even beyond the best-N cap", () => {
    const many: PointsLine[] = [
      ...lines,
      ...Array.from({ length: 20 }, (_, i) => ({
        tournamentSlug: `extra-${i}`,
        category: "atp_500" as const,
        points: 10,
        isMandatory: false,
        expiresWeekOf: "2027-01-01",
      })),
    ];
    const result = simulate(many, { playerSlug: "p", tour: "atp", scenario: [] });
    expect(result.projectedPoints).toBe(5470);
  });
});
