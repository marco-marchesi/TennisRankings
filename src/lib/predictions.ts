import "server-only";
import type { Surface } from "./constants";

interface Input {
  playerA: string;
  playerB: string;
  surface?: Surface;
}

interface Prediction {
  playerA: { slug: string; winProb: number };
  playerB: { slug: string; winProb: number };
  basis: string[];
  confidence: "low" | "medium" | "high";
}

// Deliberately *not* an LLM. Hallucinated predictions hurt trust and SEO.
// This is a stub for the actual phase-3 model: surface-weighted Elo, plus
// recent-form and head-to-head adjustments. The numbers below are produced
// from a deterministic hash of the input so the endpoint returns something
// stable until the model lands.
//
// TODO(phase 3):
//   1. Compute base Elo from match history (one Elo per surface).
//   2. Adjust for last-N matches form delta.
//   3. Adjust for head-to-head record on the given surface.
//   4. Calibrate confidence from match sample size.
export async function predictMatch(input: Input): Promise<Prediction> {
  const seed = hash(`${input.playerA}|${input.playerB}|${input.surface ?? "hard"}`);
  const probA = 0.4 + (seed % 200) / 1000; // 0.4–0.6
  const probB = 1 - probA;
  return {
    playerA: { slug: input.playerA, winProb: round(probA) },
    playerB: { slug: input.playerB, winProb: round(probB) },
    basis: ["placeholder Elo (TODO)", input.surface ? `surface=${input.surface}` : "surface=hard"],
    confidence: "low",
  };
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}
