-- 0002 — sender authentication per message, enforcement policy per domain.
--
-- `auth_verdict` is the trust judgement (TRUSTED / UNVERIFIED / SPOOFED) computed at
-- delivery time from Authentication-Results with alignment checking. `auth_json` keeps
-- the raw outcomes + evidence so the detail view can show *why*, and so the judgement can
-- be re-derived without re-fetching the message.
--
-- Existing rows keep 'UNVERIFIED': their headers were never assessed, and guessing after
-- the fact would be worse than admitting we do not know.

ALTER TABLE messages ADD COLUMN auth_verdict TEXT NOT NULL DEFAULT 'UNVERIFIED';
ALTER TABLE messages ADD COLUMN auth_json TEXT;

-- OFF = record only, WARN = record and flag in the UI (default), REJECT = refuse delivery.
ALTER TABLE domains ADD COLUMN auth_policy TEXT NOT NULL DEFAULT 'WARN';
