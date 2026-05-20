import { describe, it, expect } from "vitest";
import { POST } from "./route";

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/predictions", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/predictions", () => {
  it("returns 400 for missing required fields", async () => {
    const res = await POST(makeRequest({ playerA: "x" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for an unknown surface", async () => {
    const res = await POST(makeRequest({ playerA: "x", playerB: "y", surface: "lava" }));
    expect(res.status).toBe(400);
  });

  it("returns probabilities summing to 1", async () => {
    const res = await POST(makeRequest({ playerA: "a", playerB: "b" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { playerA: { winProb: number }; playerB: { winProb: number } };
    expect(body.playerA.winProb + body.playerB.winProb).toBeCloseTo(1, 2);
  });

  it("sets a 5-minute cache header", async () => {
    const res = await POST(makeRequest({ playerA: "a", playerB: "b" }));
    expect(res.headers.get("Cache-Control")).toMatch(/max-age=300/);
  });
});
