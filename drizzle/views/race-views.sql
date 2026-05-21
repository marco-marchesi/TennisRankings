-- Convenience views over the latest race-rankings snapshot for each tour.
-- See src/db/schema.ts for the matching `pgView` declarations (which Drizzle
-- exposes as typed query targets but does not auto-create on push in 0.24.x).
--
-- Apply with:
--   docker exec -i tennisrankings-db psql -U tennisrankings -d tennisrankings \
--     < drizzle/views/race-views.sql

CREATE OR REPLACE VIEW atp_race AS
SELECT
  rs.rank,
  rs.points,
  rs.week_of,
  p.id AS player_id,
  p.slug,
  p.full_name,
  p.country_code,
  p.date_of_birth,
  p.height_cm,
  p.plays::text AS plays,
  p.photo_url,
  COALESCE(
    rs.tournaments_played,
    (
      SELECT count(DISTINCT prm.tournament_name)::int
      FROM player_recent_matches prm
      WHERE prm.player_id = p.id
        AND prm.played_on >= date_trunc('year', current_date)
    )
  ) AS tournaments_played
FROM rankings_snapshots rs
JOIN players p ON p.id = rs.player_id
WHERE rs.tour = 'atp'
  AND rs.is_race = true
  AND rs.week_of = (
    SELECT max(week_of) FROM rankings_snapshots
    WHERE tour = 'atp' AND is_race = true
  )
ORDER BY rs.rank;

CREATE OR REPLACE VIEW wta_race AS
SELECT
  rs.rank,
  rs.points,
  rs.week_of,
  p.id AS player_id,
  p.slug,
  p.full_name,
  p.country_code,
  p.date_of_birth,
  p.height_cm,
  p.plays::text AS plays,
  p.photo_url,
  COALESCE(
    rs.tournaments_played,
    (
      SELECT count(DISTINCT prm.tournament_name)::int
      FROM player_recent_matches prm
      WHERE prm.player_id = p.id
        AND prm.played_on >= date_trunc('year', current_date)
    )
  ) AS tournaments_played
FROM rankings_snapshots rs
JOIN players p ON p.id = rs.player_id
WHERE rs.tour = 'wta'
  AND rs.is_race = true
  AND rs.week_of = (
    SELECT max(week_of) FROM rankings_snapshots
    WHERE tour = 'wta' AND is_race = true
  )
ORDER BY rs.rank;
