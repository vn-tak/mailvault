-- 0008 — opt-in semantic search.
--
-- `app_settings` holds the switches the owner turns on deliberately. Semantic search is
-- off until it is turned on, because enabling it copies a short excerpt of each message
-- into a vector index — a second place mail content exists, which is exactly the kind of
-- thing that should be a choice rather than a default.
--
-- `embedded_at` records what has actually been copied there, so the status screen can say
-- how much is indexed and turning the feature off can delete exactly those vectors.

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE messages ADD COLUMN embedded_at TEXT;
