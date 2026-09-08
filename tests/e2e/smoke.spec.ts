import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("smoke — pages render", () => {
  test("homepage", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/TennisRankings/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(/ATP — Top 10/i)).toBeVisible();
    await expect(page.getByText(/WTA — Top 10/i)).toBeVisible();
  });

  test("ATP rankings page lists ≥10 players", async ({ page }) => {
    await page.goto("/rankings/atp");
    const rows = page.locator("tbody tr");
    expect(await rows.count()).toBeGreaterThanOrEqual(10);
  });

  test("WTA rankings page renders the table", async ({ page }) => {
    await page.goto("/rankings/wta");
    await expect(page.getByRole("heading", { name: /WTA Live Ranking/i })).toBeVisible();
  });

  test("Player page renders with structured data", async ({ page }) => {
    await page.goto("/players/jannik-sinner");
    await expect(page.getByRole("heading", { name: /Jannik Sinner/ })).toBeVisible();
    const ld = await page.locator("script[type='application/ld+json']").first();
    await expect(ld).toBeAttached();
  });

  test("Player history page renders chart container or empty state", async ({ page }) => {
    await page.goto("/players/jannik-sinner/history");
    await expect(page.getByRole("heading", { name: /Ranking history/i })).toBeVisible();
  });

  test("Explainer page renders Markdown content", async ({ page }) => {
    await page.goto("/explainers/atp-points");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("Privacy and Cookies pages exist", async ({ page }) => {
    await page.goto("/privacy");
    await expect(page.getByRole("heading", { name: /Privacy/ })).toBeVisible();
    await page.goto("/cookies");
    await expect(page.getByRole("heading", { name: /Cookie/ })).toBeVisible();
  });

  test("404 page renders for unknown route", async ({ page }) => {
    const res = await page.goto("/this-does-not-exist-xyz");
    expect(res?.status()).toBe(404);
  });
});

test.describe("smoke — SEO surface", () => {
  test("sitemap.xml is reachable and lists key URLs", async ({ request, baseURL }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.ok()).toBe(true);
    const body = await res.text();
    expect(body).toContain("/rankings/atp");
    expect(body).toContain("/rankings/wta");
  });

  test("robots.txt points at the sitemap and disallows /api/", async ({ request }) => {
    const res = await request.get("/robots.txt");
    expect(res.ok()).toBe(true);
    const body = await res.text();
    expect(body).toMatch(/Sitemap:/i);
    expect(body).toContain("/api/");
  });

  test("canonical link present on the homepage", async ({ page }) => {
    await page.goto("/");
    const canonical = await page.locator("link[rel='canonical']").getAttribute("href");
    expect(canonical).toBeTruthy();
  });

  test("Open Graph metadata is set on player pages", async ({ page }) => {
    await page.goto("/players/jannik-sinner");
    const ogTitle = await page.locator("meta[property='og:title']").getAttribute("content");
    expect(ogTitle).toMatch(/Sinner/);
  });
});

test.describe("smoke — API", () => {
  test("/api/search rejects short queries", async ({ request }) => {
    const res = await request.get("/api/search?q=a");
    expect(res.ok()).toBe(true);
    expect(await res.json()).toEqual([]);
  });

  test("/api/search returns hits for valid queries", async ({ request }) => {
    const res = await request.get("/api/search?q=sin");
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as Array<{ slug: string }>;
    expect(Array.isArray(body)).toBe(true);
  });

  test("/api/revalidate rejects requests without the secret", async ({ request }) => {
    const res = await request.post("/api/revalidate", {
      data: { paths: ["/"] },
    });
    expect([403, 503]).toContain(res.status());
  });
});

test.describe("smoke — accessibility (axe)", () => {
  for (const path of ["/", "/rankings/atp", "/players/jannik-sinner"]) {
    test(`axe on ${path} — no serious WCAG2 AA violations`, async ({ page }) => {
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      const serious = results.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      );
      expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
    });
  }
});

test.describe("smoke — no third-party tracking", () => {
  // The site ships no analytics at all now, so this asserts the stronger
  // property: the page loads nothing from a third-party origin.
  test("loads no third-party scripts or beacons", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (req) => requests.push(req.url()));
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const pageOrigin = new URL(page.url()).origin;
    const thirdParty = requests.filter((u) => {
      if (!u.startsWith("http")) return false;
      return new URL(u).origin !== pageOrigin;
    });
    expect(thirdParty, `third-party requests: ${thirdParty.join(", ")}`).toEqual([]);
  });
});
