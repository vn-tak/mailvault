-- 0007 — mailbox rules.
--
-- A rule organises mail; it can never delete it, and it never decides whether mail is
-- accepted (that is the alias table's job alone). `archived` takes a message out of the
-- working list without removing it, and `applied_rule_*` records what happened together
-- with how the rule was worded *at that moment*, so a message archived months ago can
-- still be explained after the rule has been edited or deleted.

CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  match_json TEXT NOT NULL,
  action_json TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  last_hit_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE messages ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN rule_tag TEXT;
ALTER TABLE messages ADD COLUMN applied_rule_id TEXT;
ALTER TABLE messages ADD COLUMN applied_rule_note TEXT;
