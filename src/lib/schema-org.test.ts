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

/**
 * JSON-LD builders return narrow typed shapes, but these tests assert on
 * schema.org properties that are not part of those types. `obj()` widens a
 * value to an indexable record — previously each of these reads used `as any`,
 * which tripped @typescript-eslint/no-explicit-any and kept `pnpm lint` red.
 */
type JsonLdObject = { [key: string]: unknown };
const obj = (value: unknown): JsonLdObject => value as JsonLdObject;

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
    expect(obj(obj(json).potentialAction)["@type"]).toBe("SearchAction");
  });
});

describe("breadcrumbLd", () => {
  it("numbers items starting at position 1", () => {
    const ld = breadcrumbLd([
      { name: "Home", path: "/" },
      { name: "ATP", path: "/rankings/atp" },
    ]);
    const list = obj(ld).itemListElement as Array<{ position: number; name: string }>;
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ position: 1, name: "Home" });
    expect(list[1]).toMatchObject({ position: 2, name: "ATP" });
  });

  it("produces absolute URLs", () => {
    const ld = breadcrumbLd([{ name: "Home", path: "/" }]);
    const list = obj(ld).itemListElement as Array<{ item: string }>;
    expect(list[0]!.item).toMatch(/^https:\/\//);
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
    expect(obj(ld).name).toBe("Jannik Sinner");
    expect(obj(ld).url).toContain("/players/jannik-sinner");
    expect(obj(ld).jobTitle).toMatch(/tennis/i);
  });

  it("omits optional fields when not provided", () => {
    const ld = personLd({ name: "Anon", slug: "anon" });
    expect(obj(ld).image).toBeUndefined();
    expect(obj(ld).birthDate).toBeUndefined();
  });
});

describe("sportsEventLd", () => {
  it("composes name as 'Tournament Year' and points sport='Tennis'", () => {
    const ld = sportsEventLd({ name: "Roland-Garros", slug: "roland-garros", year: 2026 });
    expect(obj(ld).name).toBe("Roland-Garros 2026");
    expect(obj(ld).sport).toBe("Tennis");
  });

  it("attaches winner as a Person sub-object when provided", () => {
    const ld = sportsEventLd({
      name: "Australian Open",
      slug: "australian-open",
      year: 2026,
      winner: { name: "Jannik Sinner", slug: "jannik-sinner" },
    });
    expect(obj(obj(ld).winner)["@type"]).toBe("Person");
    expect(obj(obj(ld).winner).name).toBe("Jannik Sinner");
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
    const list = obj(ld).itemListElement as Array<{ position: number }>;
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
