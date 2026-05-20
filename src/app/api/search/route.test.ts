import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/players", () => ({
  searchPlayers: vi.fn(async (q: string) => {
    if (q.length < 2) return [];
    return [
      {
        slug: "jannik-sinner",
        fullName: "Jannik Sinner",
        countryCode: "ITA",
        tour: "atp",
        rank: 1,
      },
    ];
  }),
}));

import { GET } from "./route";

function makeRequest(path: string) {
  return new Request(`http://localhost${path}`);
}

describe("GET /api/search", () => {
  it("returns [] for queries shorter than 2 characters", async () => {
    const res = await GET(makeRequest("/api/search?q=a"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("returns [] when q is missing entirely", async () => {
    const res = await GET(makeRequest("/api/search"));
    expect(await res.json()).toEqual([]);
  });

  it("returns matching player hits for valid queries", async () => {
    const res = await GET(makeRequest("/api/search?q=sin"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ slug: string }>;
    expect(body[0]?.slug).toBe("jannik-sinner");
  });

  it("sets a short-lived cache header on hits", async () => {
    const res = await GET(makeRequest("/api/search?q=sin"));
    expect(res.headers.get("Cache-Control")).toMatch(/max-age/);
  });

  it("sets no-store on the empty short-query response (no cache poisoning)", async () => {
    const res = await GET(makeRequest("/api/search?q=a"));
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
