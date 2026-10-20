// Maps a TennisExplorer listing player ("Svajda T.", slug "svajda-cce6f") to
// one of our players.
//
// TennisExplorer's daily lists carry only SURNAME + INITIAL(S), a surname slug
// (sometimes with a hash suffix), and no country. The previous resolver in
// scrape-daily-matches.ts:
//
//   - looked players up across BOTH tours, so a WTA "Zhang S." could land on
//     the ATP's Zhizhen Zhang and ATP challenger rows landed on WTA players;
//   - matched on the surname alone and, on a collision, returned
//     `candidates[0]` — whichever same-surname player the table happened to
//     list first. Its country tie-break compared TE's 2-letter codes with our
//     3-letter ones, and TE's listings carry no country anyway, so it never
//     fired;
//   - indexed only the last 1-3 slug segments, so a surname that is not the
//     final token ("Daniel Merida Aguilar" -> TE "Merida D.") never matched.
//
// This resolver is tour-scoped by construction (the caller builds one index
// per tour), requires the given-name initial to agree, and returns null
// rather than guessing when more than one player still fits.

export interface TeIndexPlayer {
  id: number;
  fullName: string;
  /** TennisExplorer's player id, when learned (players.te_slug). */
  teSlug?: string | null;
}

interface Entry {
  id: number;
  /** First letters of the given-name tokens, in order. */
  givenInitials: string[];
}

export interface TePlayerIndex {
  bySurname: Map<string, Entry[]>;
  /** TE player id -> our id, for players whose TE id is known. */
  bySlug: Map<string, number>;
  /** Our id -> its known TE player id. */
  slugOf: Map<number, string>;
}

function tokens(s: string): string[] {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .split(/[\s-]+/)
    .filter(Boolean);
}

export function buildTePlayerIndex(players: TeIndexPlayer[]): TePlayerIndex {
  const bySurname = new Map<string, Entry[]>();
  const bySlug = new Map<string, number>();
  const slugOf = new Map<number, string>();
  for (const p of players) {
    if (!p.teSlug) continue;
    bySlug.set(p.teSlug, p.id);
    slugOf.set(p.id, p.teSlug);
  }
  const add = (key: string, e: Entry) => {
    const list = bySurname.get(key) ?? [];
    if (!list.some((x) => x.id === e.id)) list.push(e);
    bySurname.set(key, list);
  };
  for (const p of players) {
    const t = tokens(p.fullName);
    if (t.length === 0) continue;
    if (t.length === 1) {
      add(t[0]!, { id: p.id, givenInitials: [] });
      continue;
    }
    // Any contiguous run of tokens may be the surname TE prints.
    for (let i = 0; i < t.length; i++) {
      for (let j = i; j < t.length; j++) {
        if (i === 0 && j === t.length - 1) continue; // whole name is not a surname
        const key = t.slice(i, j + 1).join(" ");
        // Given names precede the surname in the usual "First Last" storage;
        // a run starting at token 0 means the name is stored surname-first
        // ("Zhang Shuai"), so the given names are what follows it.
        const given = i > 0 ? t.slice(0, i) : t.slice(j + 1);
        add(key, { id: p.id, givenInitials: given.map((g) => g[0]!) });
      }
    }
  }
  return { bySurname, bySlug, slugOf };
}

/** "Cerundolo J. M." -> { surname: "cerundolo", initials: ["j","m"] } */
function splitTeName(teName: string): { surname: string; initials: string[] } {
  const parts = teName.trim().split(/\s+/);
  const initials: string[] = [];
  while (parts.length > 1 && /^[A-Za-z]{1,2}\.$/.test(parts[parts.length - 1]!)) {
    initials.unshift(parts.pop()!.charAt(0).toLowerCase());
  }
  return { surname: tokens(parts.join(" ")).join(" "), initials };
}

function stripIdSuffix(slug: string): string {
  const parts = slug.split("-");
  if (parts.length < 2) return slug;
  const last = parts[parts.length - 1]!;
  if (last.length >= 4 && /\d/.test(last)) return parts.slice(0, -1).join("-");
  return slug;
}

export function resolveTePlayer(
  index: TePlayerIndex,
  teSlug: string | null,
  teName: string,
): number | null {
  // A known TE player id settles it outright.
  if (teSlug) {
    const known = index.bySlug.get(teSlug);
    if (known != null) return known;
  }
  const { surname: nameSurname, initials } = splitTeName(teName);
  const slugSurname = teSlug ? tokens(stripIdSuffix(teSlug)).join(" ") : "";
  const keys = [...new Set([nameSurname, slugSurname].filter(Boolean))];

  const ids = new Set<number>();
  for (const key of keys) {
    for (const e of index.bySurname.get(key) ?? []) {
      if (initials.length > 0) {
        if (e.givenInitials.length === 0) continue;
        if (e.givenInitials[0] !== initials[0]) continue;
        // A second TE initial ("J. M.") must agree too when we hold one.
        if (initials[1] && e.givenInitials[1] && e.givenInitials[1] !== initials[1]) continue;
      }
      ids.add(e.id);
    }
    if (ids.size > 0) break; // the name-derived surname is the stronger key
  }
  if (ids.size !== 1) return null;
  const id = [...ids][0]!;
  // The name fits, but we know this player's TE id and it is a different
  // one: the listing is a namesake we do not hold (Bryce vs Brandon Nakashima).
  const knownSlug = index.slugOf.get(id);
  if (teSlug && knownSlug && knownSlug !== teSlug) return null;
  return id;
}
