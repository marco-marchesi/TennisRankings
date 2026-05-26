-- Adds live-ranking + live-race columns to live_projections.
-- Applied idempotently (if-not-exists). See scraper/projections/
-- derive-live-points.ts for how these get computed.

alter table live_projections add column if not exists live_points integer;
alter table live_projections add column if not exists live_rank integer;
alter table live_projections add column if not exists live_race_points integer;
alter table live_projections add column if not exists live_race_rank integer;
alter table live_projections add column if not exists live_rank_change integer;
