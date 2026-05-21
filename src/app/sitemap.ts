import type { MetadataRoute } from "next";
import { listAllPlayerSlugs } from "@/lib/players";
import { listAllTournamentSlugs } from "@/lib/tournaments";
import { SITE_URL } from "@/lib/constants";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [players, tournaments] = await Promise.all([
    listAllPlayerSlugs(),
    listAllTournamentSlugs(),
  ]);

  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`,                       changeFrequency: "daily" as const,   priority: 1.0 },
    { url: `${SITE_URL}/rankings/atp`,           changeFrequency: "weekly" as const,  priority: 0.9 },
    { url: `${SITE_URL}/rankings/wta`,           changeFrequency: "weekly" as const,  priority: 0.9 },
    { url: `${SITE_URL}/race/atp`,               changeFrequency: "weekly" as const,  priority: 0.7 },
    { url: `${SITE_URL}/race/wta`,               changeFrequency: "weekly" as const,  priority: 0.7 },
    { url: `${SITE_URL}/explainers/atp-points`,  changeFrequency: "yearly" as const,  priority: 0.5 },
  ].map((e) => ({ ...e, lastModified: now }));

  const playerEntries = players.map((p) => ({
    url: `${SITE_URL}/players/${p.slug}`,
    lastModified: p.updatedAt,
    changeFrequency: "weekly" as const,
    priority: 0.6,
  }));

  const tournamentEntries = tournaments.map((t) => ({
    url: `${SITE_URL}/tournaments/${t.slug}`,
    lastModified: now,
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));

  return [...staticEntries, ...playerEntries, ...tournamentEntries];
}
