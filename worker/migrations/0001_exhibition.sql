CREATE TABLE constellations (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  claim_hash TEXT NOT NULL,
  slot INTEGER NOT NULL UNIQUE,
  title TEXT NOT NULL,
  drawing TEXT NOT NULL,
  nickname TEXT,
  message TEXT,
  creator TEXT,
  created_at INTEGER NOT NULL,
  published_at INTEGER
);
CREATE INDEX published_sky ON constellations(published_at);
CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  constellation_id TEXT NOT NULL REFERENCES constellations(id) ON DELETE CASCADE,
  visitor TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX comments_by_work ON comments(constellation_id, created_at DESC, id DESC);
CREATE TABLE likes (
  constellation_id TEXT NOT NULL REFERENCES constellations(id) ON DELETE CASCADE,
  visitor TEXT NOT NULL,
  PRIMARY KEY (constellation_id, visitor)
);
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  window INTEGER NOT NULL,
  count INTEGER NOT NULL
);
