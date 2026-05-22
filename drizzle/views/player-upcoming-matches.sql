create table if not exists player_upcoming_matches (
  player_id integer not null references players(id) on delete cascade,
  source text not null default 'tennis_explorer',
  te_match_id text not null,
  scheduled_date date not null,
  scheduled_time text,
  tournament_slug text,
  tournament_name text not null,
  tournament_level text,
  opponent_name text not null,
  opponent_country text,
  fetched_at timestamptz not null default now(),
  primary key (player_id, source, te_match_id)
);
create index if not exists player_upcoming_player_date_idx
  on player_upcoming_matches (player_id, scheduled_date);
