-- Additions for top-800 expansion + DB-backed player photos.
-- See src/db/schema.ts for the matching Drizzle declarations.

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS photo_bytes BYTEA,
  ADD COLUMN IF NOT EXISTS photo_content_type TEXT,
  ADD COLUMN IF NOT EXISTS photo_fetched_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS photo_attempt_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS slug_stable_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS last_seen_in_rankings_at TIMESTAMP WITH TIME ZONE;

-- Backfill: existing players have stable slugs and we've been seeing them
-- in rankings; set both timestamps to "now" for everything that's already
-- there so the new write paths don't treat them as un-seen.
UPDATE players
SET slug_stable_at = COALESCE(slug_stable_at, NOW()),
    last_seen_in_rankings_at = COALESCE(last_seen_in_rankings_at, NOW())
WHERE slug_stable_at IS NULL OR last_seen_in_rankings_at IS NULL;
