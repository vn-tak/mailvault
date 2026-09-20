-- 0003 — full-text search over message text.
--
-- A separate FTS5 index keyed by message id, because `messages.id` is a UUID text and
-- message bodies deliberately live in R2, not D1. Indexed: subject, preview snippet and
-- the full From header. OTP codes are NOT indexed here — they stay in
-- `extracted_codes_json` and are matched with LIKE, so searching "55905149" works for
-- mail that was stored before this table existed.

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  message_id UNINDEXED,
  subject,
  preview,
  sender
);

-- Backfill from what D1 already holds.
INSERT INTO messages_fts (message_id, subject, preview, sender)
SELECT id, COALESCE(subject, ''), COALESCE(preview, ''), COALESCE(header_from, '')
FROM messages
WHERE id NOT IN (SELECT message_id FROM messages_fts);
