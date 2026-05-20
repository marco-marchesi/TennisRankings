import { describe, it, expect, beforeAll } from "vitest";
import { buildMetadata } from "./seo";

beforeAll(() => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://tennisrankings.example";
});

describe("buildMetadata", () => {
  it("composes a canonical URL from path and SITE_URL", () => {
    const meta = buildMetadata({ title: "ATP", path: "/rankings/atp" });
    expect(meta.alternates?.canonical).toBe("https://tennisrankings.example/rankings/atp");
  });

  it("appends the site name to the title for branded SERP", () => {
    const meta = buildMetadata({ title: "Carlos Alcaraz", path: "/players/carlos-alcaraz" });
    expect(meta.title).toMatch(/Carlos Alcaraz — TennisRankings/);
  });

  it("sets robots noindex when noindex is true", () => {
    const meta = buildMetadata({ title: "Draft", path: "/draft", noindex: true });
    expect(meta.robots).toMatchObject({ index: false, follow: true });
  });

  it("emits OG image at /og-default.png when no path is provided", () => {
    const meta = buildMetadata({ title: "Home", path: "/" });
    const og = meta.openGraph as { images?: Array<{ url: string }> };
    expect(og.images?.[0]?.url).toContain("/og-default.png");
  });

  it("emits OG image at the provided path when supplied", () => {
    const meta = buildMetadata({
      title: "Sinner",
      path: "/players/jannik-sinner",
      ogImagePath: "/players/jannik-sinner/opengraph-image",
    });
    const og = meta.openGraph as { images?: Array<{ url: string }> };
    expect(og.images?.[0]?.url).toContain("/players/jannik-sinner/opengraph-image");
  });

  it("includes hreflang alternates when provided", () => {
    const meta = buildMetadata({
      title: "ATP",
      path: "/rankings/atp",
      alternates: { es: "https://tennisrankings.example/es/rankings/atp" },
    });
    expect(meta.alternates?.languages?.es).toBeTruthy();
  });
});
