-- MailVault V1 initial schema.
-- Timestamps are stored as ISO-8601 UTC strings (e.g. 2026-09-19T12:34:56.789Z) so
-- that lexicographic ordering == chronological ordering for the *_received_at indexes.
-- The application always writes these values; CURRENT_TIMESTAMP is only a fallback.

PRAGMA foreign_keys = ON;

-- Cloudflare zones that MailVault tracks. Discovery stores a row; provisioning is a
-- separate, owner-triggered state machine (see mail_status). A discovered domain is
-- inert until explicitly enabled — nothing here is mutated at Worker startup.
CREATE TABLE IF NOT EXISTS domains (
  id                    TEXT PRIMARY KEY,
  cloudflare_zone_id    TEXT NOT NULL UNIQUE,
  cloudflare_account_id TEXT,
  name                  TEXT NOT NULL UNIQUE,
  zone_status           TEXT NOT NULL,
  zone_type             TEXT NOT NULL,
  mail_status           TEXT NOT NULL DEFAULT 'DISCOVERED',
  routing_status        TEXT NOT NULL DEFAULT 'UNKNOWN',
  catch_all_status      TEXT NOT NULL DEFAULT 'UNKNOWN',
  conflict_type         TEXT NOT NULL DEFAULT 'NONE',
  conflict_details_json TEXT,
  last_checked_at       TEXT,
  created_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Alias mailboxes. `address` is the normalized lowercase full address and is the
-- exact-match key used by the inbound email handler. Receiving is gated on status.
CREATE TABLE IF NOT EXISTS aliases (
  id         TEXT PRIMARY KEY,
  domain_id  TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  local_part TEXT NOT NULL,
  address    TEXT NOT NULL UNIQUE,
  label      TEXT,
  status     TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (domain_id, local_part)
);

-- Message metadata. R2 is authoritative for content; this table never stores bodies.
-- dedupe_key is UNIQUE and makes repeated delivery of the same event idempotent.
CREATE TABLE IF NOT EXISTS messages (
  id                      TEXT PRIMARY KEY,
  domain_id               TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  -- Nullable: an alias may be deleted while its mail is intentionally kept. The
  -- original recipient is always preserved in envelope_to, so a message stays
  -- attributable even after its alias row is gone.
  alias_id                TEXT REFERENCES aliases(id) ON DELETE SET NULL,
  provider_message_id     TEXT,
  dedupe_key              TEXT NOT NULL UNIQUE,
  envelope_from           TEXT,
  envelope_to             TEXT,
  header_from             TEXT,
  header_to               TEXT,
  subject                 TEXT,
  preview                 TEXT,
  received_at             TEXT NOT NULL,
  raw_size                INTEGER NOT NULL DEFAULT 0,
  raw_r2_key              TEXT NOT NULL,
  parsed_r2_key           TEXT,
  has_attachments         INTEGER NOT NULL DEFAULT 0,
  attachment_count        INTEGER NOT NULL DEFAULT 0,
  is_read                 INTEGER NOT NULL DEFAULT 0,
  extracted_codes_json    TEXT,
  verification_links_json TEXT,
  created_at              TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Attachment metadata; bytes live in R2 keyed by r2_key.
CREATE TABLE IF NOT EXISTS attachments (
  id            TEXT PRIMARY KEY,
  message_id    TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  filename      TEXT NOT NULL,
  safe_filename TEXT NOT NULL,
  content_type  TEXT,
  size          INTEGER NOT NULL DEFAULT 0,
  r2_key        TEXT NOT NULL,
  content_id    TEXT,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Append-only audit trail of provisioning attempts for troubleshooting (section 8).
CREATE TABLE IF NOT EXISTS provisioning_events (
  id          TEXT PRIMARY KEY,
  domain_id   TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  event       TEXT NOT NULL,
  status      TEXT,
  details_json TEXT,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Query indexes (kept minimal — this is a personal-scale app, section 44/46).
CREATE INDEX IF NOT EXISTS idx_aliases_domain          ON aliases (domain_id);
CREATE INDEX IF NOT EXISTS idx_messages_alias_received ON messages (alias_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_domain_received ON messages (domain_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_unread         ON messages (is_read) WHERE is_read = 0;
CREATE INDEX IF NOT EXISTS idx_messages_sender         ON messages (header_from);
CREATE INDEX IF NOT EXISTS idx_messages_subject        ON messages (subject);
CREATE INDEX IF NOT EXISTS idx_attachments_message     ON attachments (message_id);
CREATE INDEX IF NOT EXISTS idx_provisioning_domain     ON provisioning_events (domain_id, created_at DESC);
