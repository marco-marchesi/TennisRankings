-- TennisExplorer's own player id ("nakashima-7ab12"), learned from its ranking
-- page for players the official ranking also places (same rank, same points,
-- same week). TE's match lists name players only as "Surname I.", so without
-- this a lower-ranked sibling we do not hold (Bryce Nakashima, ~#700) was
-- resolved to the only "Nakashima B." we do (Brandon, #17), and Brandon was
-- shown playing the Columbus Challenger while he was in Tokyo.
-- See src/db/schema.ts (players.teSlug) and scraper/te-player-resolver.ts.

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS te_slug TEXT;

CREATE INDEX IF NOT EXISTS players_te_slug_idx ON players (te_slug);
