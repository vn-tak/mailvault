-- 0004 — an alias gets a working life, not just an address.
--
-- `notes` is free text for the owner ("used for the Selinow staging account, rotate if
-- spammed"). `pinned` keeps the handful that matter at the top of the list; `archived`
-- takes one out of the default view without deleting anything — an archived alias keeps
-- receiving until it is disabled, because stopping mail is a separate, explicit switch.

ALTER TABLE aliases ADD COLUMN notes TEXT;
ALTER TABLE aliases ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE aliases ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
