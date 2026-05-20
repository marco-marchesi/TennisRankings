import { describe, it, expect } from "vitest";
import { predictMatch } from "./predictions";

describe("predictMatch (stub)", () => {
  it("returns probabilities that sum to 1 (within rounding)", async () => {
    const p = await predictMatch({ playerA: "a", playerB: "b" });
    expect(p.playerA.winProb + p.playerB.winProb).toBeCloseTo(1, 2);
  });

  it("is deterministic for the same input", async () => {
    const a = await predictMatch({ playerA: "carlos-alcaraz", playerB: "jannik-sinner", surface: "hard" });
    const b = await predictMatch({ playerA: "carlos-alcaraz", playerB: "jannik-sinner", surface: "hard" });
    expect(a).toEqual(b);
  });

  it("changes with different surfaces", async () => {
    const hard = await predictMatch({ playerA: "a", playerB: "b", surface: "hard" });
    const clay = await predictMatch({ playerA: "a", playerB: "b", surface: "clay" });
    // Different deterministic seed → different probs (almost always)
    expect(hard.playerA.winProb).not.toBe(clay.playerA.winProb);
  });

  it("reports low confidence until the model lands", async () => {
    const p = await predictMatch({ playerA: "x", playerB: "y" });
    expect(p.confidence).toBe("low");
  });

  it("includes basis annotations for transparency", async () => {
    const p = await predictMatch({ playerA: "x", playerB: "y", surface: "grass" });
    expect(p.basis).toContain("surface=grass");
  });
});
