import { describe, it, expect } from "vitest";
import { POST } from "./route";

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/alerts", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/alerts", () => {
  it("rejects invalid payloads with 400", async () => {
    const res = await POST(makeRequest({ playerId: "not-a-number" }));
    expect(res.status).toBe(400);
  });

  it("rejects unknown actions", async () => {
    const res = await POST(makeRequest({ playerId: 1, action: "subscribe" }));
    expect(res.status).toBe(400);
  });

  it("returns 401 for a valid payload without an authenticated session", async () => {
    const res = await POST(makeRequest({ playerId: 1, action: "follow" }));
    expect(res.status).toBe(401);
  });
});
