import { describe, it, expect, beforeAll } from "vitest";
import {
  organizationLd,
  websiteLd,
  breadcrumbLd,
  personLd,
  sportsEventLd,
  itemListLd,
  serializeLd,
} from "./schema-org";

beforeAll(() => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://tennisrankings.example";
});

describe("organizationLd", () => {
  it("emits a valid Organization payload", () => {
    const json = organizationLd();
    expect(json["@type"]).toBe("Organization");
    expect(json.url).toContain("tennisrankings.example");
  });
});

describe("websiteLd", () => {
  it("includes a SearchAction so Google can show a sitelinks search box", () => {
    const json = websiteLd();
    expect(json["@type"]).toBe("WebSite");
    expect((json as any).potentialAction["@type"]).toBe("SearchAction");
  });
});

describe("breadcrumbLd", () => {
  it("numbers items starting at position 1", () => {
    const ld = breadcrumbLd([
      { name: "Home", path: "/" },
      { name: "ATP", path: "/rankings/atp" },
    ]);
    const list = (ld as any).itemListElement as Array<{ position: number; name: string }>;
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ position: 1, name: "Home" });
    expect(list[1]).toMatchObject({ position: 2, name: "ATP" });
  });

  it("produces absolute URLs", () => {
    const ld = breadcrumbLd([{ name: "Home", path: "/" }]);
    const list = (ld as any).itemListElement as Array<{ item: string }>;
    expect(list[0].item).toMatch(/^https:\/\//);
  });
});

describe("personLd", () => {
  it("yields a Person payload with required fields", () => {
    const ld = personLd({
      name: "Jannik Sinner",
      slug: "jannik-sinner",
      birthDate: "2001-08-16",
      nationality: "ITA",
      image: "https://example.com/photo.jpg",
    });
    expect(ld["@type"]).toBe("Person");
    expect((ld as any).name).toBe("Jannik Sinner");
    expect((ld as any).url).toContain("/players/jannik-sinner");
    expect((ld as any).jobTitle).toMatch(/tennis/i);
  });

  it("omits optional fields when not provided", () => {
    const ld = personLd({ name: "Anon", slug: "anon" });
    expect((ld as any).image).toBeUndefined();
    expect((ld as any).birthDate).toBeUndefined();
  });
});

describe("sportsEventLd", () => {
  it("composes name as 'Tournament Year' and points sport='Tennis'", () => {
    const ld = sportsEventLd({ name: "Roland-Garros", slug: "roland-garros", year: 2026 });
    expect((ld as any).name).toBe("Roland-Garros 2026");
    expect((ld as any).sport).toBe("Tennis");
  });

  it("attaches winner as a Person sub-object when provided", () => {
    const ld = sportsEventLd({
      name: "Australian Open",
      slug: "australian-open",
      year: 2026,
      winner: { name: "Jannik Sinner", slug: "jannik-sinner" },
    });
    expect((ld as any).winner["@type"]).toBe("Person");
    expect((ld as any).winner.name).toBe("Jannik Sinner");
  });
});

describe("itemListLd", () => {
  it("preserves position order from input", () => {
    const ld = itemListLd({
      name: "Top 3",
      items: [
        { position: 1, name: "A" },
        { position: 2, name: "B" },
        { position: 3, name: "C" },
      ],
    });
    const list = (ld as any).itemListElement as Array<{ position: number }>;
    expect(list.map((i) => i.position)).toEqual([1, 2, 3]);
  });
});

describe("serializeLd", () => {
  it("wraps single objects in an array for output", () => {
    const out = serializeLd({ "@type": "Thing" });
    expect(JSON.parse(out)).toHaveLength(1);
  });
  it("passes arrays through unchanged", () => {
    const out = serializeLd([{ a: 1 }, { b: 2 }]);
    expect(JSON.parse(out)).toEqual([{ a: 1 }, { b: 2 }]);
  });
});
