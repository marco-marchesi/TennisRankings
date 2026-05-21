CREATE TABLE IF NOT EXISTS leaderboards (
  tour TEXT NOT NULL,
  category TEXT NOT NULL,
  window_key TEXT NOT NULL DEFAULT 'last_52',
  rank INTEGER NOT NULL,
  player_name TEXT NOT NULL,
  player_slug TEXT,
  ta_player_id TEXT,
  country_code TEXT,
  matches INTEGER,
  stats JSONB NOT NULL,
  scraped_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tour, category, window_key, rank)
);

CREATE INDEX IF NOT EXISTS leaderboards_player_idx ON leaderboards (player_slug);
