import { SITE_NAME, SITE_URL } from "./constants";

type Json = Record<string, unknown>;

export function organizationLd(): Json {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
    logo: `${SITE_URL}/logo.png`,
    sameAs: [],
  };
}

export function websiteLd(): Json {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: SITE_URL,
    potentialAction: {
      "@type": "SearchAction",
      target: `${SITE_URL}/search?q={query}`,
      "query-input": "required name=query",
    },
  };
}

export function breadcrumbLd(items: Array<{ name: string; path: string }>): Json {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: `${SITE_URL}${item.path}`,
    })),
  };
}

interface PersonInput {
  name: string;
  slug: string;
  birthDate?: string | null;
  nationality?: string | null;
  image?: string | null;
  description?: string;
  sameAs?: string[];
}

export function personLd(p: PersonInput): Json {
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    name: p.name,
    url: `${SITE_URL}/players/${p.slug}`,
    image: p.image ?? undefined,
    birthDate: p.birthDate ?? undefined,
    nationality: p.nationality ?? undefined,
    description: p.description,
    sameAs: p.sameAs,
    jobTitle: "Professional tennis player",
  };
}

interface SportsEventInput {
  name: string;
  slug: string;
  year: number;
  startDate?: string;
  endDate?: string;
  city?: string | null;
  country?: string | null;
  winner?: { name: string; slug: string } | null;
}

export function sportsEventLd(e: SportsEventInput): Json {
  return {
    "@context": "https://schema.org",
    "@type": "SportsEvent",
    name: `${e.name} ${e.year}`,
    sport: "Tennis",
    url: `${SITE_URL}/tournaments/${e.slug}/${e.year}`,
    startDate: e.startDate,
    endDate: e.endDate,
    location: {
      "@type": "Place",
      name: [e.city, e.country].filter(Boolean).join(", "),
    },
    ...(e.winner && {
      winner: {
        "@type": "Person",
        name: e.winner.name,
        url: `${SITE_URL}/players/${e.winner.slug}`,
      },
    }),
  };
}

interface ItemListInput {
  name: string;
  items: Array<{ position: number; name: string; url?: string }>;
}

export function itemListLd(input: ItemListInput): Json {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: input.name,
    itemListElement: input.items.map((i) => ({
      "@type": "ListItem",
      position: i.position,
      name: i.name,
      url: i.url,
    })),
  };
}

export function serializeLd(data: Json | Json[]) {
  const payload = Array.isArray(data) ? data : [data];
  return JSON.stringify(payload);
}
