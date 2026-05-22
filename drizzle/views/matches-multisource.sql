-- Multi-source extension of player_recent_matches.
-- After this migration the table accepts rows from both Tennis Abstract and
-- Tennis Explorer (and any future source) without colliding on the PK.

BEGIN;

-- Add the source column, defaulted to tennis_abstract so existing rows
-- get the right tag without an UPDATE pass.
ALTER TABLE player_recent_matches
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'tennis_abstract';

-- Rename the TA-specific identifier columns to source-agnostic names.
-- The "IF EXISTS" + "DO $$" guards make this re-runnable.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'player_recent_matches'
             AND column_name = 'ta_tourney_id') THEN
    ALTER TABLE player_recent_matches RENAME COLUMN ta_tourney_id TO external_tourney_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'player_recent_matches'
             AND column_name = 'ta_match_num') THEN
    ALTER TABLE player_recent_matches RENAME COLUMN ta_match_num TO external_match_num;
  END IF;
END $$;

-- Swap the PK to include source. Drizzle names the original PK with the
-- column list baked in — find and drop whichever PK currently exists, then
-- add the new one.
DO $$
DECLARE
  pk_name TEXT;
BEGIN
  SELECT constraint_name INTO pk_name
  FROM information_schema.table_constraints
  WHERE table_name = 'player_recent_matches'
    AND constraint_type = 'PRIMARY KEY';
  IF pk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE player_recent_matches DROP CONSTRAINT %I', pk_name);
  END IF;
END $$;

ALTER TABLE player_recent_matches
  ADD CONSTRAINT player_recent_matches_pkey
  PRIMARY KEY (player_id, source, external_tourney_id, external_match_num);

-- New index supporting the reader-side dedup query (DISTINCT ON ordering).
CREATE INDEX IF NOT EXISTS player_recent_matches_dedup_idx
  ON player_recent_matches (player_id, played_on, lower(opponent_name), source DESC);

COMMIT;
