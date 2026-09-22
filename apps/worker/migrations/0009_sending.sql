-- 0009 — the mailbox learns to send, which means it needs to know what a conversation is.
--
-- Outbound mail is stored in `messages` beside inbound rather than in a separate table:
-- one thread is one list read in one query, and a sent message that lives somewhere else
-- is a message the owner cannot find when they are looking at the conversation it belongs
-- to. `direction` is what separates them, `alias_id` is who it was sent as, and the raw
-- MIME goes to R2 under the same key scheme, so "delete this message" already covers it.
--
-- `thread_root_id` is denormalised on purpose. Deriving a thread by walking
-- `in_reply_to` would re-join the whole chain on every list read to answer "show me this
-- conversation", and every message in a mailbox belongs to exactly one thread — a
-- denormalised id is the cheap, honest shape.
--
-- `provider_message_id` gets an index because threading resolves a reply by looking up the
-- Message-ID it quotes, and that lookup runs on every inbound message from now on.

ALTER TABLE messages ADD COLUMN direction TEXT NOT NULL DEFAULT 'IN';
ALTER TABLE messages ADD COLUMN thread_root_id TEXT;
ALTER TABLE messages ADD COLUMN in_reply_to TEXT;
ALTER TABLE messages ADD COLUMN references_json TEXT;
ALTER TABLE messages ADD COLUMN reply_to TEXT;
ALTER TABLE messages ADD COLUMN cc TEXT;
ALTER TABLE messages ADD COLUMN send_status TEXT;
ALTER TABLE messages ADD COLUMN send_error TEXT;

-- Mail that arrived before threading existed is its own thread. Nothing is guessed from
-- subjects, because "Re: Invoice" across two unrelated customers is not a conversation.
UPDATE messages SET thread_root_id = id WHERE thread_root_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages (thread_root_id, received_at);
CREATE INDEX IF NOT EXISTS idx_messages_provider_id ON messages (provider_message_id);

-- Sending is a separate entitlement from receiving, with its own DNS records and its own
-- owner confirmation, so it gets its own column triple rather than overloading
-- `mail_status`, which describes the inbound path.
ALTER TABLE domains ADD COLUMN sending_status TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE domains ADD COLUMN sending_tag TEXT;
ALTER TABLE domains ADD COLUMN sending_checked_at TEXT;
