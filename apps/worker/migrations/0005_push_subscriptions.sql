-- 0005 — browser push subscriptions for "new mail arrived".
--
-- A push endpoint URL is a bearer credential: anyone holding it can push to that
-- device. It therefore stays server-side in D1 and is never returned by an API response
-- or logged. `fails` prunes subscriptions the browser has already retracted (404/410)
-- instead of letting them accumulate forever.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  fails INTEGER NOT NULL DEFAULT 0,
  last_ok_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
