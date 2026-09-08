/**
 * Stable, date-free match number for `player_recent_matches.external_match_num`.
 *
 * Shared by every writer that keys matches itself, because the value has to be
 * IDENTICAL across runs — a re-run must upsert, not insert a second row. Two
 * private copies of this would drift, and the drift would be invisible: the
 * table would just quietly grow duplicate rows and every points sum over it
 * would be too high.
 *
 * Deliberately NOT derived from the date. A match can be rescheduled, and a
 * date-dependent key then inserts a second row — the exact failure that made
 * the documented `played_on` dedupe useless (see CLAUDE.md).
 *
 * FNV-1a, 32-bit, then clamped into int range. Collisions are possible in
 * principle; scoped to one tournament and one round they are not a practical
 * concern, and the primary key includes the tournament id.
 */
export function stableMatchNumber(round: string, playerIds: readonly string[]): number {
  // Sorted so the pairing is orientation independent: whichever side the
  // source lists first, both rows get the same number.
  const key = `${round}|${[...playerIds].sort().join("|")}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 2_000_000_000;
}
