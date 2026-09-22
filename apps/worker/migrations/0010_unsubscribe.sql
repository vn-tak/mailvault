-- 0010 — the two headers that turn a pile of mail into a mailbox you can live in.
--
-- `List-Unsubscribe` / `List-Unsubscribe-Post` (RFC 8058) are what a real client renders as
-- a one-click "Unsubscribe" beside the sender. This mailbox exists partly to hand a throwaway
-- address to shops and newsletters, so the ability to leave one — without searching for the
-- link inside the message, and without revealing a permanent address — is the feature that
-- makes the alias useful rather than merely disposable.
--
-- Both are stored verbatim and judged at render time: an unsubscribe URL is sender-supplied
-- content, so the reader gets it only for a message whose sender authentication aligned.
-- Re-deriving it from the raw copy in R2 would work, but a list read must not fetch bodies.

ALTER TABLE messages ADD COLUMN list_unsubscribe TEXT;
ALTER TABLE messages ADD COLUMN list_unsubscribe_post TEXT;
