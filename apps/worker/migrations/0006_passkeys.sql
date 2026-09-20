-- 0006 — passkey step-up for the operations that cannot be undone.
--
-- Cloudflare Access proves *which account* you signed in as. A step-up proves that the
-- same person is holding the device right now, so a leaked session cookie cannot purge
-- mail or detach a domain by itself.
--
-- `credential_id` + `public_key` are verifiers, not secrets — but they are still never
-- returned by an API. A challenge and a grant are both single-use and short-lived: the
-- grant token itself is never stored, only its SHA-256, so a database read cannot hand
-- out someone else's second factor.
--
-- These tables hold no mail. Pruning happens inline when a new row is written, not on a
-- cron — see SECURITY.md §10 for why nothing about messages is ever time-deleted.

CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  device_label TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS step_up_grants (
  token_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expiry ON webauthn_challenges (expires_at);
CREATE INDEX IF NOT EXISTS idx_step_up_grants_expiry ON step_up_grants (expires_at);
