import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

import { revalidatePath, revalidateTag } from "next/cache";
import { POST } from "./route";

const json = (body: unknown) =>
  new Request("http://localhost/api/revalidate", {
    method: "POST",
    body: JSON.stringify(body),
  });

describe("POST /api/revalidate", () => {
  beforeEach(() => {
    process.env.REVALIDATE_SECRET = "shhh";
    vi.clearAllMocks();
  });
  afterEach(() => {
    delete process.env.REVALIDATE_SECRET;
  });

  it("returns 503 when no secret is configured", async () => {
    delete process.env.REVALIDATE_SECRET;
    const res = await POST(json({ secret: "anything" }));
    expect(res.status).toBe(503);
  });

  it("rejects requests with the wrong secret with 403", async () => {
    const res = await POST(json({ secret: "wrong", paths: ["/"] }));
    expect(res.status).toBe(403);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON with 400", async () => {
    const res = await POST(
      new Request("http://localhost/api/revalidate", {
        method: "POST",
        body: "{not json",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("revalidates supplied paths when the secret matches", async () => {
    const res = await POST(json({ secret: "shhh", paths: ["/", "/rankings/atp"] }));
    expect(res.status).toBe(200);
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(revalidatePath).toHaveBeenCalledWith("/rankings/atp");
  });

  it("revalidates supplied tags when the secret matches", async () => {
    const res = await POST(json({ secret: "shhh", tags: ["rankings:atp"] }));
    expect(res.status).toBe(200);
    expect(revalidateTag).toHaveBeenCalledWith("rankings:atp");
  });

  it("returns the list of revalidated paths/tags in the response body", async () => {
    const res = await POST(json({ secret: "shhh", paths: ["/x"], tags: ["t"] }));
    const body = (await res.json()) as { revalidated: { paths: string[]; tags: string[] } };
    expect(body.revalidated.paths).toEqual(["/x"]);
    expect(body.revalidated.tags).toEqual(["t"]);
  });
});
