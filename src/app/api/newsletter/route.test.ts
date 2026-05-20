import { describe, it, expect, vi, beforeEach } from "vitest";

const insert = vi.fn().mockReturnValue({
  values: vi.fn().mockReturnValue({
    onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
  }),
});

vi.mock("@/db", () => ({
  db: { insert },
  schema: { newsletterSubscribers: { email: "email" } },
}));

import { POST } from "./route";

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/newsletter", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/newsletter", () => {
  beforeEach(() => insert.mockClear());

  it("rejects an invalid email", async () => {
    const res = await POST(makeRequest({ email: "not-an-email" }));
    expect(res.status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects an email longer than 254 characters", async () => {
    const huge = "a".repeat(250) + "@x.io";
    const res = await POST(makeRequest({ email: huge }));
    expect(res.status).toBe(400);
  });

  it("rejects a malformed locale", async () => {
    const res = await POST(makeRequest({ email: "x@y.io", locale: "english" }));
    expect(res.status).toBe(400);
  });

  it("accepts a well-formed signup and inserts a row", async () => {
    const res = await POST(makeRequest({ email: "x@y.io" }));
    expect(res.status).toBe(200);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("returns 200 ok=true on success", async () => {
    const res = await POST(makeRequest({ email: "x@y.io" }));
    expect(await res.json()).toEqual({ ok: true });
  });
});
