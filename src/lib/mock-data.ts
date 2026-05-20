import type { Tour } from "./constants";
import type { RankingRow } from "./rankings";

const ATP_TOP: Array<Omit<RankingRow, "rank" | "weekOf">> = [
  { player: m(1, "jannik-sinner", "Jannik Sinner", "ITA", "right"), points: 11830, prevRank: 1, prevPoints: 11830, tournamentsPlayed: 19 },
  { player: m(2, "carlos-alcaraz", "Carlos Alcaraz", "ESP", "right"), points: 8390, prevRank: 2, prevPoints: 8420, tournamentsPlayed: 20 },
  { player: m(3, "alexander-zverev", "Alexander Zverev", "GER", "right"), points: 7915, prevRank: 4, prevPoints: 7475, tournamentsPlayed: 22 },
  { player: m(4, "daniil-medvedev", "Daniil Medvedev", "—", "right"), points: 6230, prevRank: 3, prevPoints: 6380, tournamentsPlayed: 24 },
  { player: m(5, "novak-djokovic", "Novak Djokovic", "SRB", "right"), points: 5560, prevRank: 5, prevPoints: 5560, tournamentsPlayed: 14 },
  { player: m(6, "taylor-fritz", "Taylor Fritz", "USA", "right"), points: 4810, prevRank: 7, prevPoints: 4615, tournamentsPlayed: 23 },
  { player: m(7, "casper-ruud", "Casper Ruud", "NOR", "right"), points: 4500, prevRank: 6, prevPoints: 4720, tournamentsPlayed: 23 },
  { player: m(8, "andrey-rublev", "Andrey Rublev", "—", "right"), points: 4275, prevRank: 8, prevPoints: 4275, tournamentsPlayed: 22 },
  { player: m(9, "hubert-hurkacz", "Hubert Hurkacz", "POL", "right"), points: 3960, prevRank: 9, prevPoints: 3960, tournamentsPlayed: 21 },
  { player: m(10, "grigor-dimitrov", "Grigor Dimitrov", "BUL", "right"), points: 3775, prevRank: 10, prevPoints: 3800, tournamentsPlayed: 22 },
];

const WTA_TOP: Array<Omit<RankingRow, "rank" | "weekOf">> = [
  { player: m(101, "iga-swiatek", "Iga Świątek", "POL", "right"), points: 10715, prevRank: 1, prevPoints: 10715, tournamentsPlayed: 18 },
  { player: m(102, "aryna-sabalenka", "Aryna Sabalenka", "—", "right"), points: 8725, prevRank: 2, prevPoints: 8725, tournamentsPlayed: 19 },
  { player: m(103, "coco-gauff", "Coco Gauff", "USA", "right"), points: 7150, prevRank: 3, prevPoints: 7150, tournamentsPlayed: 22 },
  { player: m(104, "elena-rybakina", "Elena Rybakina", "KAZ", "right"), points: 5871, prevRank: 4, prevPoints: 5871, tournamentsPlayed: 21 },
  { player: m(105, "jessica-pegula", "Jessica Pegula", "USA", "right"), points: 5705, prevRank: 5, prevPoints: 5705, tournamentsPlayed: 21 },
  { player: m(106, "jasmine-paolini", "Jasmine Paolini", "ITA", "right"), points: 4068, prevRank: 7, prevPoints: 3920, tournamentsPlayed: 24 },
  { player: m(107, "qinwen-zheng", "Qinwen Zheng", "CHN", "right"), points: 4515, prevRank: 6, prevPoints: 4515, tournamentsPlayed: 22 },
  { player: m(108, "emma-navarro", "Emma Navarro", "USA", "right"), points: 3589, prevRank: 8, prevPoints: 3589, tournamentsPlayed: 23 },
  { player: m(109, "barbora-krejcikova", "Barbora Krejčíková", "CZE", "right"), points: 3214, prevRank: 9, prevPoints: 3214, tournamentsPlayed: 18 },
  { player: m(110, "danielle-collins", "Danielle Collins", "USA", "right"), points: 3035, prevRank: 10, prevPoints: 3035, tournamentsPlayed: 22 },
];

function m(
  id: number,
  slug: string,
  fullName: string,
  countryCode: string,
  plays: "right" | "left",
): RankingRow["player"] {
  return { id, slug, fullName, countryCode, photoUrl: null, plays };
}

export function mockTopRanked(tour: Tour, limit: number): RankingRow[] {
  const week = mostRecentMonday();
  const rows = tour === "atp" ? ATP_TOP : WTA_TOP;
  return rows.slice(0, limit).map((row, i) => ({
    rank: i + 1,
    weekOf: week,
    ...row,
  }));
}

export function mostRecentMonday(d = new Date()): string {
  const date = new Date(d);
  const day = date.getUTCDay();
  const diff = (day + 6) % 7; // days since Monday
  date.setUTCDate(date.getUTCDate() - diff);
  return date.toISOString().slice(0, 10);
}
