CREATE TABLE links (
  slug TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  expires_at TEXT,
  disabled_at TEXT,
  clicks INTEGER NOT NULL DEFAULT 0,
  last_click_at TEXT
);

CREATE INDEX links_created_at ON links (created_at);

CREATE TABLE clicks_daily (
  slug TEXT NOT NULL REFERENCES links (slug) ON DELETE CASCADE,
  day TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT '',
  referrer_host TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (slug, day, country, referrer_host)
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  github_id INTEGER NOT NULL UNIQUE,
  login TEXT NOT NULL,
  name TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE web_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE INDEX web_sessions_expires_at ON web_sessions (expires_at);
