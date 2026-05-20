import "server-only";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

export interface TournamentDetail {
  id: number;
  slug: string;
  name: string;
  city: string | null;
  countryCode: string | null;
  category: string;
  surface: string;
  tour: "atp" | "wta" | "challenger" | "itf";
  drawSize: number | null;
  indoor: boolean | null;
  pointsWinner: number | null;
  prizeMoneyUsd: number | null;
}

const MOCK: TournamentDetail[] = [
  { id: 1, slug: "australian-open", name: "Australian Open", city: "Melbourne", countryCode: "AUS", category: "grand_slam", surface: "hard", tour: "atp", drawSize: 128, indoor: false, pointsWinner: 2000, prizeMoneyUsd: 3000000 },
  { id: 2, slug: "roland-garros", name: "Roland-Garros", city: "Paris", countryCode: "FRA", category: "grand_slam", surface: "clay", tour: "atp", drawSize: 128, indoor: false, pointsWinner: 2000, prizeMoneyUsd: 2700000 },
  { id: 3, slug: "wimbledon", name: "Wimbledon", city: "London", countryCode: "GBR", category: "grand_slam", surface: "grass", tour: "atp", drawSize: 128, indoor: false, pointsWinner: 2000, prizeMoneyUsd: 3300000 },
  { id: 4, slug: "us-open", name: "US Open", city: "New York", countryCode: "USA", category: "grand_slam", surface: "hard", tour: "atp", drawSize: 128, indoor: false, pointsWinner: 2000, prizeMoneyUsd: 3600000 },
];

export async function getTournamentBySlug(slug: string): Promise<TournamentDetail | null> {
  try {
    const [t] = await db
      .select()
      .from(schema.tournaments)
      .where(eq(schema.tournaments.slug, slug))
      .limit(1);
    if (t) return t as unknown as TournamentDetail;
  } catch {
    /* fall through */
  }
  return MOCK.find((t) => t.slug === slug) ?? null;
}

export async function listAllTournamentSlugs(): Promise<Array<{ slug: string }>> {
  try {
    const rows = await db.select({ slug: schema.tournaments.slug }).from(schema.tournaments);
    if (rows.length > 0) return rows;
  } catch {
    /* fall through */
  }
  return MOCK.map((m) => ({ slug: m.slug }));
}
