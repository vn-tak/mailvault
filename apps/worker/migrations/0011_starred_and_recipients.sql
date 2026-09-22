-- 0011 — a star you can actually sort by, and delivery that is reported per recipient.
--
-- `starred` is the one message flag the mailbox has that no rule can set: the owner marks
-- a message and nothing else ever changes it. It stays a column rather than a tag because
-- the list filters and counts on it, and a tag is free text that a rule writes.

ALTER TABLE messages ADD COLUMN starred INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_messages_starred ON messages (starred, received_at DESC) WHERE starred = 1;

-- A send has one row but several destinations, and Email Sending reports what happened to
-- each of them separately: three recipients can produce one `delivered` and two `bounced`
-- events for the same Message-ID. Collapsing that into `messages.send_status` is what the
-- list badge shows, and it is derived from these rows rather than stored twice by hand.
--
-- The unique key is (message_id, address) because that is exactly what an event names.
-- Events also arrive out of order across batches, so the writer keeps a status from moving
-- backwards — see `db/recipients.ts`. `rank` is that ordering, stored beside the status so
-- the guard is one arithmetic comparison inside an atomic upsert rather than a
-- read-modify-write round trip that two concurrent batches could interleave.
CREATE TABLE IF NOT EXISTS message_recipients (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  address TEXT NOT NULL,
  list TEXT NOT NULL DEFAULT 'to',
  status TEXT NOT NULL,
  rank INTEGER NOT NULL DEFAULT 0,
  smtp_code TEXT,
  detail TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (message_id, address)
);

CREATE INDEX IF NOT EXISTS idx_message_recipients_message ON message_recipients (message_id);
