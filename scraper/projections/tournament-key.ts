import { sql } from "drizzle-orm";

/**
 * SQL expression that normalises a tournament name for COMPARISON.
 *
 * Case, whitespace, and the trailing TOUR marker ("Cincinnati WTA" ->
 * "cincinnati"). Deliberately narrower than the comment this replaces
 * claimed — see the warning below.
 *
 * Stripping the tour marker is safe because every query using this already
 * scopes by tour through the `players` join, so an ATP "Cincinnati" can never
 * meet a WTA "Cincinnati". Measured within each tour over 400 days, it merges
 * exactly 6 keys per tour and every one is the intended pair:
 *
 *   Athens | Athens WTA        Madrid | Madrid WTA
 *   Cincinnati | Cincinnati WTA    Rome | Rome WTA
 *   Hamburg | Hamburg WTA      US Open | Us Open
 *
 * Tier markers are NOT stripped — that is the dangerous part, below.
 *
 * WHY IT EXISTS
 *
 * Tournament names must never be compared as raw strings. Tennis Abstract
 * writes "Us Open", TennisExplorer writes "US Open", and the ATP results
 * writer derives "Us Open" from the URL slug. A pure casing difference
 * silently zeroed every dropping calculation once already — Sabalenka showed
 * 1,940 points too high because her 2025 US Open title never registered as
 * dropping.
 *
 * Shared rather than copied, because the copies had already diverged: only
 * the dropping deriver normalised at all, so `derive-live-state`'s
 * `finished_tournaments` exclusion joined on the RAW name. With 48 US Open
 * players stored as "Us Open" and 102 as "US Open", that exclusion would
 * have failed for a third of the field the moment the tournament ended, and
 * the whole purpose of the exclusion is to stop a finished event being
 * credited twice.
 *
 * ⚠ DO NOT ADD TIER-SUFFIX STRIPPING.
 *
 * The expression this replaces tried to, with
 * `'\s+(masters|wta|atp|itf|challenger)\b.*$'`, and its docstring claimed it
 * bridged "Rome Masters" (TA) and "Rome" (TE). It never did, for two reasons,
 * and the second one saved us:
 *
 *   1. In a JS string `'\s'` is just `s`, so the whole expression operated on
 *      the letter s — it rewrote "bnp paribas open" to "bnp pariba  open" and
 *      "Rome Masters" to "rome ma ter ". Equality joins still worked only
 *      because both sides were mangled identically.
 *   2. In Postgres regex `\b` is a BACKSPACE character, not a word boundary
 *      (that is `\y`), so the suffix alternation never matched anything.
 *
 * Measured on the real table (777 distinct names over 400 days), enabling the
 * strip properly collapses 776 keys to 729 by merging events that are NOT the
 * same event:
 *
 *   madrid   <- Madrid | Madrid Masters | Madrid WTA | Madrid challenger
 *   rome     <- Rome | Rome ITF | Rome Masters | Rome WTA
 *   hamburg  <- Hamburg | Hamburg WTA | Hamburg challenger
 *   dublin   <- Dublin ITF | Dublin challenger
 *
 * `derive-dropping-points` charges a player their result at "the same event"
 * 52 weeks ago, so merging a Challenger into a Masters charges the wrong
 * points. Tour scoping does not save it — the Madrid Challenger and the
 * Madrid Masters are both ATP.
 *
 * Bridging genuinely different spellings of the SAME event needs an explicit
 * alias table keyed on an edition, not a substring heuristic. That is tracked
 * in the plan as the `edition_key` work.
 *
 * Use for JOINs and GROUP BYs only. Category inference must still see the RAW
 * name, because it matches against real event names.
 */
export function normSql(col: string) {
  // \y is Postgres's word boundary. \b is a BACKSPACE character here — using
  // it is why the previous expression's suffix branch never matched.
  return sql.raw(
    `regexp_replace(regexp_replace(lower(${col}), '\\s+(wta|atp)\\y.*$', ''), '\\s+', ' ', 'g')`,
  );
}
